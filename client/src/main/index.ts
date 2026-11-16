import { app, BrowserWindow, clipboard, ipcMain, session as electronSession, shell } from 'electron';
import { join } from 'node:path';
import type { Channel, Invite, IpcResult, Session, SessionEndReason, User, VoiceCredentials } from '../shared/types';
import { authed, request } from './api';
import { startEvents } from './events';
import { clearSession, loadSession, normalizeServerUrl, saveSession, type ActiveSession } from './session';
import { installDisplayMediaHandler, listSources, selectSource } from './screen';
import { installUpdateNow, startUpdater, type UpdateInfo } from './updater';

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
    },
    onUnauthorized(reason) {
      void endSession(reason);
    },
  });
}

async function endSession(reason: SessionEndReason) {
  stopEvents?.();
  stopEvents = null;
  current = null;
  channels = [];
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

  handle('me:set-avatar', async (data: Uint8Array) => {
    const { user } = await authed<{ user: User }>(requireSession(), '/api/me/avatar', {
      method: 'PUT',
      raw: { data, type: 'image/webp' },
    });
    return updateUser(user);
  });

  handle('me:remove-avatar', async () => {
    const { user } = await authed<{ user: User }>(requireSession(), '/api/me/avatar', { method: 'DELETE' });
    return updateUser(user);
  });

  // ---------- screen sharing ----------

  handle('screen:sources', () => listSources(win?.getTitle() ?? 'Echo'));
  handle('screen:select', (id: string, audio: boolean) => selectSource(id, audio));

  // ---------- app ----------

  handle('app:get-autostart', () => app.isPackaged && app.getLoginItemSettings().openAtLogin);
  handle('app:set-autostart', (enabled: boolean) => {
    if (!app.isPackaged) throw new Error('Автозапуск работает только в установленной версии');
    app.setLoginItemSettings({ openAtLogin: enabled });
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
    backgroundColor: '#111214',
    autoHideMenuBar: true,
    title: 'Echo',
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

  win.once('ready-to-show', () => win?.show());
  win.on('closed', () => (win = null));

  // Never navigate away or open popups inside the app; links go to the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(join(__dirname, '../renderer/index.html'));
}

app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.whenReady().then(() => {
  // Only the microphone and screen capture are ever allowed.
  const allowed = new Set(['media', 'display-capture']);
  electronSession.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(allowed.has(permission));
  });
  electronSession.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));
  installDisplayMediaHandler();

  registerIpc();
  const saved = loadSession();
  if (saved) beginSession(saved);
  createWindow();
  startUpdater((info) => {
    readyUpdate = info;
    send('update-ready', info);
  });
});

app.setAppUserModelId('io.github.octodaniil.echo');

app.on('window-all-closed', () => app.quit());
