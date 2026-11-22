import { app, BrowserWindow, clipboard, globalShortcut, ipcMain, powerMonitor, session as electronSession, shell } from 'electron';
import { join } from 'node:path';
import type {
  AchievementDef,
  Channel,
  Invite,
  IpcResult,
  Profile,
  Session,
  SessionEndReason,
  User,
  VoiceCredentials,
  CosmeticsCatalog,
  Look,
  UserStatus,
} from '../shared/types';
import { authed, request } from './api';
import { startEvents } from './events';
import { clearSession, loadSession, normalizeServerUrl, saveSession, type ActiveSession } from './session';
import { knownGames, listWindowedApps, startGameWatcher, type GamesConfig } from './games';
import { installDisplayMediaHandler, listSources, selectSource } from './screen';
import { createTray, type TrayState } from './tray';
import { checkNow, installUpdateNow, startUpdater, updateStatus, type UpdateInfo } from './updater';

// Voice must keep playing without a click first.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// ECHO_PROFILE=name runs an isolated instance (own login, own single-instance lock),
// handy for testing two users on one machine.
if (process.env.ECHO_PROFILE) {
  app.setPath('userData', join(app.getPath('appData'), `Echo-${process.env.ECHO_PROFILE}`));
}

if (!app.requestSingleInstanceLock()) app.quit();

let win: BrowserWindow | null = null;
let current: ActiveSession | null = null;
let stopEvents: (() => void) | null = null;
let channels: Channel[] = [];
let serverOnline = false;
let readyUpdate: UpdateInfo | null = null;
let presence: unknown[] = [];
let gamesConfig: GamesConfig = { enabled: true, custom: {} };
let closeToTray = true;
/** Set when the user really wants to quit (tray menu, update), not just close the window. */
let quitting = false;
let tray: ReturnType<typeof createTray> | null = null;
// Started with Windows: stay in the tray until clicked.
const startHidden = process.argv.includes('--hidden');

const games = startGameWatcher(
  () => gamesConfig,
  (game) => {
    send('game', game);
    void reportGame(game);
  },
);

/** Tell the server what we play (it shows it to friends and counts game achievements). */
async function reportGame(game: string | null) {
  if (!current) return;
  await authed(current, '/api/me/activity', { method: 'PUT', body: { game } }).catch(() => {});
}

function send(channel: string, payload?: unknown) {
  win?.webContents.send(channel, payload);
}

function beginSession(s: ActiveSession) {
  current = s;
  stopEvents?.();
  stopEvents = startEvents(s, {
    onChannels(next) {
      channels = next;
      send('channels', next);
    },
    onConnectionChange(online) {
      serverOnline = online;
      send('server-status', online);
      // The server keeps "playing X" in memory only: tell it again after a reconnect.
      if (online && games.current) void reportGame(games.current);
    },
    onPresence(users) {
      presence = users;
      send('presence', users);
    },
    onUnauthorized(reason) {
      void endSession(reason);
    },
    onAchievement(payload) {
      send('achievement', payload);
    },
    onMove(channelId, by) {
      send('move', { channelId, by });
    },
    onBanned(message) {
      banned = message;
      send('banned', message);
    },
    onModeration(payload) {
      send('moderation', payload);
    },
    onAfk(on) {
      send('afk', on);
    },
    onWeekly(payload) {
      send('weekly', payload);
    },
    onFun(payload) {
      send('fun', payload);
    },
    onChat(event, payload) {
      send(event === 'typing' ? 'chat-typing' : 'chat', payload);
    },
  });
}

/** Ban message while we are banned (the session is kept so an unban just works). */
let banned: string | null = null;

async function endSession(reason: SessionEndReason) {
  stopEvents?.();
  stopEvents = null;
  current = null;
  channels = [];
  presence = [];
  serverOnline = false;
  await clearSession();
  send('session-ended', reason);
}

function requireSession(): ActiveSession {
  if (!current) throw new Error('Не выполнен вход');
  return current;
}

/** Registers an IPC handler whose errors reach the renderer as readable messages. */
function handle<A extends unknown[], T>(name: string, fn: (...args: A) => Promise<T> | T) {
  ipcMain.handle(name, async (_event, ...args): Promise<IpcResult<T>> => {
    try {
      return { ok: true, data: await fn(...(args as A)) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}

function registerIpc() {
  handle('session:get', (): Session | null =>
    current ? { serverUrl: current.serverUrl, user: current.user } : null,
  );

  handle('auth:join', async (args: { serverUrl: string; invite: string; nickname: string }): Promise<Session> => {
    let serverUrl: string;
    try {
      serverUrl = normalizeServerUrl(args.serverUrl);
    } catch {
      throw new Error('Некорректный адрес сервера');
    }
    const { token, user } = await request<{ token: string; user: User }>(serverUrl, '/api/auth/join', {
      method: 'POST',
      body: { invite: args.invite, nickname: args.nickname },
    });
    const s = { serverUrl, user, token };
    await saveSession(s);
    beginSession(s);
    return { serverUrl, user };
  });

  handle('auth:logout', () => endSession('logout'));

  handle('channels:get', () => ({ channels, online: serverOnline }));
  handle('presence:get', () => presence);

  // ---------- games ----------

  handle('games:config', (cfg: GamesConfig) => {
    const was = gamesConfig.enabled;
    gamesConfig = cfg;
    games.refresh();
    if (was && !cfg.enabled) void reportGame(null);
  });
  handle('games:current', () => games.current);
  handle('games:apps', () => listWindowedApps());
  handle('games:known', () => knownGames());

  // ---------- tray & window ----------

  handle('tray:state', (state: TrayState) => tray?.update(state));
  handle('app:set-close-to-tray', (on: boolean) => {
    closeToTray = on;
  });

  // ---------- updates ----------

  handle('update:check', () => checkNow());
  handle('update:status', () => updateStatus());

  // "Check now" on the server-down screen: reconnect immediately instead of waiting for backoff.
  handle('events:retry', () => {
    if (current) beginSession(current);
  });

  handle('channels:connect', (id: number) =>
    authed<VoiceCredentials>(requireSession(), `/api/channels/${id}/connect`, { method: 'POST', body: {} }),
  );

  handle('channels:create', (name: string) =>
    authed(requireSession(), '/api/channels', { method: 'POST', body: { name } }),
  );

  handle('channels:rename', (id: number, name: string) =>
    authed(requireSession(), `/api/channels/${id}`, { method: 'PATCH', body: { name } }),
  );

  handle('channels:delete', (id: number) => authed(requireSession(), `/api/channels/${id}`, { method: 'DELETE' }));

  // ---------- profile ----------

  const updateUser = async (user: User): Promise<Session> => {
    const s = requireSession();
    current = { ...s, user };
    await saveSession(current);
    return { serverUrl: current.serverUrl, user };
  };

  handle('me:update', async (patch: { nickname: string }) => {
    const { user } = await authed<{ user: User }>(requireSession(), '/api/me', { method: 'PATCH', body: patch });
    return updateUser(user);
  });

  handle('me:set-avatar', async (data: Uint8Array, type?: string) => {
    const { user } = await authed<{ user: User }>(requireSession(), '/api/me/avatar', {
      method: 'PUT',
      raw: { data, type: type === 'image/gif' ? 'image/gif' : 'image/webp' },
    });
    return updateUser(user);
  });

  handle('me:set-banner', async (data: Uint8Array, type: string) => {
    const { user } = await authed<{ user: User }>(requireSession(), '/api/me/banner', {
      method: 'PUT',
      raw: { data, type },
    });
    return updateUser(user);
  });

  handle('me:remove-banner', async () => {
    const { user } = await authed<{ user: User }>(requireSession(), '/api/me/banner', { method: 'DELETE' });
    return updateUser(user);
  });

  handle('me:remove-avatar', async () => {
    const { user } = await authed<{ user: User }>(requireSession(), '/api/me/avatar', { method: 'DELETE' });
    return updateUser(user);
  });

  // ---------- achievements & profiles ----------

  handle('ach:catalog', () =>
    authed<{ catalog: AchievementDef[]; categories?: { id: string; title: string }[] }>(requireSession(), '/api/achievements'),
  );
  handle('profile:get', async (id: string) =>
    (await authed<{ profile: Profile }>(requireSession(), `/api/users/${encodeURIComponent(id)}/profile`)).profile,
  );
  handle('cosmetics:get', () => authed<CosmeticsCatalog>(requireSession(), '/api/cosmetics'));
  handle('me:style', async (patch: Partial<Look>) =>
    (await authed<{ style: Look }>(requireSession(), '/api/me/style', { method: 'PATCH', body: patch })).style,
  );
  handle('me:status', async (status: UserStatus) =>
    (await authed<{ status: UserStatus }>(requireSession(), '/api/me/status', { method: 'PUT', body: status })).status,
  );
  handle('me:pinned', async (codes: string[]) =>
    (await authed<{ pinned: string[] }>(requireSession(), '/api/me/pinned', { method: 'PUT', body: { codes } })).pinned,
  );
  handle('ach:award', (userId: string, code: string) =>
    authed(requireSession(), `/api/users/${encodeURIComponent(userId)}/achievements`, { method: 'POST', body: { code } }),
  );
  handle('ach:revoke', (userId: string, code: string) =>
    authed(requireSession(), `/api/users/${encodeURIComponent(userId)}/achievements/${encodeURIComponent(code)}`, {
      method: 'DELETE',
    }),
  );

  handle('banned:get', () => banned);
  handle('weekly:get', () => authed(requireSession(), '/api/weekly'));
  handle('fun:get', () => authed(requireSession(), '/api/fun'));
  handle('bets:create', (question: string, options: string[]) =>
    authed(requireSession(), '/api/bets', { method: 'POST', body: { question, options } }),
  );
  handle('bets:stake', (id: number, option: number, amount: number) =>
    authed(requireSession(), `/api/bets/${Number(id)}/stake`, { method: 'POST', body: { option, amount } }),
  );
  handle('bets:settle', (id: number, action: string, winner?: number) =>
    authed(requireSession(), `/api/bets/${Number(id)}/settle`, { method: 'POST', body: { action, winner } }),
  );
  handle('predict', (kind: string, pick: string) => authed(requireSession(), '/api/predictions', { method: 'POST', body: { kind, pick } }));
  handle('capsules:seal', (text: string, target: string, openAt: number) =>
    authed(requireSession(), '/api/capsules', { method: 'POST', body: { text, target, openAt } }),
  );
  handle('quests:start', (friendId: string) => authed(requireSession(), '/api/quests', { method: 'POST', body: { friendId } }));
  handle('recap:get', async (which: string) =>
    (await authed<{ recap: unknown }>(requireSession(), `/api/recap?week=${which === 'current' ? 'current' : 'last'}`)).recap,
  );
  handle('voice:activity', () => authed(requireSession(), '/api/me/voice-activity', { method: 'POST', body: {} }));
  // ---------- chat ----------
  const conv = (c: string) => encodeURIComponent(c);
  handle('chat:history', (c: string, before?: number) =>
    authed(requireSession(), `/api/chat/${conv(c)}?limit=50${before ? `&before=${before}` : ''}`),
  );
  handle('chat:send', (c: string, text: string, replyTo: number | null) =>
    authed(requireSession(), `/api/chat/${conv(c)}`, { method: 'POST', body: { text, replyTo } }),
  );
  handle('chat:image', (c: string, data: Uint8Array, type: string, text: string, replyTo: number | null, w: number, h: number) =>
    authed(requireSession(), `/api/chat/${conv(c)}/image`, {
      method: 'POST',
      raw: { data, type },
      headers: {
        'x-echo-text': encodeURIComponent(text),
        'x-echo-reply': replyTo ? String(replyTo) : '',
        'x-echo-w': String(w),
        'x-echo-h': String(h),
      },
    }),
  );
  handle('chat:edit', (id: number, text: string) => authed(requireSession(), `/api/chat/message/${id}`, { method: 'PATCH', body: { text } }));
  handle('chat:delete', (id: number) => authed(requireSession(), `/api/chat/message/${id}`, { method: 'DELETE' }));
  handle('chat:read', (c: string, id: number) => authed(requireSession(), `/api/chat/${conv(c)}/read`, { method: 'POST', body: { id } }));
  handle('chat:typing', (c: string) => authed(requireSession(), `/api/chat/${conv(c)}/typing`, { method: 'POST', body: {} }));
  handle('chat:state', () => authed(requireSession(), '/api/chat-state'));
  handle('chat:storage', () => authed(requireSession(), '/api/chat-storage'));
  handle('chat:cleanup', (days: number) => authed(requireSession(), '/api/chat-storage/cleanup', { method: 'POST', body: { days } }));
  handle('chat:clear', (c: string) => authed(requireSession(), `/api/chat/${conv(c)}`, { method: 'DELETE' }));
  // Windows notifications: bring the window up when one is clicked; blink the taskbar.
  handle('app:show', () => showWindow());
  handle('app:flash', () => {
    if (win && !win.isFocused()) win.flashFrame(true);
  });
  handle('members:list', async () => (await authed<{ members: unknown[] }>(requireSession(), '/api/members')).members);
  handle('mod:action', (userId: string, action: string, body?: unknown) => {
    const id = encodeURIComponent(userId);
    if (action === 'nickname') return authed(requireSession(), `/api/mod/${id}/nickname`, { method: 'PATCH', body });
    if (action === 'delete') return authed(requireSession(), `/api/users/${id}`, { method: 'DELETE' });
    if (!['disconnect', 'mute', 'unmute', 'ban', 'unban', 'role', 'cosmetic', 'pioneer'].includes(action)) throw new Error('Неизвестное действие');
    return authed(requireSession(), `/api/mod/${id}/${action}`, { method: 'POST', body: body ?? {} });
  });
  handle('channels:move', (channelId: number, userId: string) =>
    authed(requireSession(), `/api/channels/${channelId}/move`, { method: 'POST', body: { userId } }),
  );

  // ---------- global hotkeys ----------

  // Registered system-wide so they work while a game has focus. Electron only reports
  // key presses (no release), so every action is a toggle.
  handle('hotkeys:set', (map: Record<string, string | null>) => {
    globalShortcut.unregisterAll();
    const result: Record<string, string | null> = {};
    for (const [action, accel] of Object.entries(map)) {
      if (!accel) continue;
      try {
        const ok = globalShortcut.register(accel, () => send('hotkey', action));
        result[action] = ok ? null : 'Сочетание занято другой программой';
      } catch {
        result[action] = 'Это сочетание нельзя назначить';
      }
    }
    return result;
  });

  // ---------- screen sharing ----------

  handle('screen:sources', () => listSources(win?.getTitle() ?? 'Echo'));
  handle('screen:select', (id: string, audio: boolean) => selectSource(id, audio));

  // ---------- app ----------

  handle('app:idle-seconds', () => powerMonitor.getSystemIdleTime());
  handle('app:get-autostart', () => app.isPackaged && app.getLoginItemSettings().openAtLogin);
  handle('app:set-autostart', (enabled: boolean) => {
    if (!app.isPackaged) throw new Error('Автозапуск работает только в установленной версии');
    // --hidden: start in the tray instead of popping the window up at login.
    app.setLoginItemSettings({ openAtLogin: enabled, args: ['--hidden'] });
    return enabled;
  });

  handle('app:info', () => ({ version: app.getVersion(), update: readyUpdate }));
  handle('update:install', () => installUpdateNow());

  handle('invites:create', async () => {
    const { invite } = await authed<{ invite: Invite }>(requireSession(), '/api/invites', {
      method: 'POST',
      body: { expiresInHours: 72 },
    });
    clipboard.writeText(invite.code);
    return invite;
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 700,
    minWidth: 760,
    minHeight: 480,
    show: false,
    backgroundColor: '#05070b',
    autoHideMenuBar: true,
    title: 'Echo',
    // Our own title bar (drawn by the page); Windows keeps its native min/max/close buttons.
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#05070b', symbolColor: '#9fb0c4', height: 32 },
    // Packaged builds take the icon from the .exe.
    ...(app.isPackaged ? {} : { icon: join(__dirname, '../../build/icon.png') }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      // Chromium heavily throttles timers in hidden windows, which would break
      // LiveKit's keep-alive pings while Echo sits minimized during a call.
      backgroundThrottling: false,
    },
  });

  win.once('ready-to-show', () => !startHidden && win?.show());
  // Closing the window keeps Echo in the tray (voice keeps working), unless quitting.
  win.on('close', (e) => {
    if (quitting || !closeToTray || !tray) return;
    e.preventDefault();
    win?.hide();
  });
  win.on('closed', () => {
    win = null;
    // Pop-out stream windows can't live without the main window.
    app.quit();
  });

  // Pop-out windows for streams (about:blank, same renderer process, so they can show
  // the very same video track without decoding it twice). Everything else: links go to
  // the browser, nothing navigates inside the app.
  win.webContents.setWindowOpenHandler(({ url, frameName }) => {
    if (url === 'about:blank' && frameName.startsWith('echo-')) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 960,
          height: 560,
          minWidth: 320,
          minHeight: 200,
          backgroundColor: '#000000',
          autoHideMenuBar: true,
          title: 'Echo',
          ...(app.isPackaged ? {} : { icon: join(__dirname, '../../build/icon.png') }),
          webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false, spellcheck: false },
        },
      };
    }
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('did-create-window', (child) => {
    child.setMenuBarVisibility(false);
    child.webContents.on('will-navigate', (e) => e.preventDefault());
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(join(__dirname, '../renderer/index.html'));
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

app.on('second-instance', showWindow);
app.on('before-quit', () => {
  quitting = true;
});

app.whenReady().then(() => {
  // Only the microphone, screen capture and HTML fullscreen (watching streams) are allowed.
  const allowed = new Set(['notifications', 'media', 'display-capture', 'fullscreen']);
  electronSession.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(allowed.has(permission));
  });
  electronSession.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));
  installDisplayMediaHandler();

  registerIpc();
  const saved = loadSession();
  if (saved) beginSession(saved);
  createWindow();
  startUpdater(
    (info) => {
      readyUpdate = info;
      send('update-ready', info);
    },
    (status) => send('update-status', status),
  );
  tray = createTray(
    showWindow,
    (action) => send('hotkey', action),
    () => {
      quitting = true;
      app.quit();
    },
  );
});

app.setAppUserModelId('io.github.octodaniil.echo');

app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => globalShortcut.unregisterAll());
