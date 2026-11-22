import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type {
  AchievementCategory,
  AchievementDef,
  Channel,
  Invite,
  IpcResult,
  PresenceUser,
  Profile,
  UpdateStatus,
  ScreenSource,
  Session,
  SessionEndReason,
  VoiceCredentials,
  CosmeticsCatalog,
  Look,
  ChatEvent,
  ChatMessage,
  Recap,
  WeeklyState,
  FunState,
  FunEvent,
  ChatState,
  ChatStorage,
  Member,
  ModAction,
  ModerationEvent,
  UserStatus,
} from '../shared/types';

async function call<T>(name: string, ...args: unknown[]): Promise<T> {
  const result = (await ipcRenderer.invoke(name, ...args)) as IpcResult<T>;
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

function on<T>(name: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(name, listener);
  return () => ipcRenderer.off(name, listener);
}

const api = {
  getSession: () => call<Session | null>('session:get'),
  join: (args: { serverUrl: string; invite: string; nickname: string }) => call<Session>('auth:join', args),
  logout: () => call<void>('auth:logout'),

  retryConnection: () => call<void>('events:retry'),
  getChannels: () => call<{ channels: Channel[]; online: boolean }>('channels:get'),
  connect: (channelId: number) => call<VoiceCredentials>('channels:connect', channelId),
  createChannel: (name: string) => call<unknown>('channels:create', name),
  renameChannel: (id: number, name: string) => call<unknown>('channels:rename', id, name),
  deleteChannel: (id: number) => call<unknown>('channels:delete', id),
  createInvite: () => call<Invite>('invites:create'),

  updateProfile: (patch: { nickname: string }) => call<Session>('me:update', patch),
  setAvatar: (data: Uint8Array, type = 'image/webp') => call<Session>('me:set-avatar', data, type),
  removeAvatar: () => call<Session>('me:remove-avatar'),
  setBanner: (data: Uint8Array, type: string) => call<Session>('me:set-banner', data, type),
  removeBanner: () => call<Session>('me:remove-banner'),

  getAchievementCatalog: () =>
    call<{ catalog: AchievementDef[]; categories?: AchievementCategory[] }>('ach:catalog'),
  getProfile: (userId: string) => call<Profile>('profile:get', userId),
  setPinned: (codes: string[]) => call<string[]>('me:pinned', codes),
  getCosmetics: () => call<CosmeticsCatalog>('cosmetics:get'),
  setLook: (patch: Partial<Look>) => call<Look>('me:style', patch),
  setStatus: (status: UserStatus) => call<UserStatus>('me:status', status),
  awardAchievement: (userId: string, code: string) => call<unknown>('ach:award', userId, code),
  revokeAchievement: (userId: string, code: string) => call<unknown>('ach:revoke', userId, code),
  onAchievement: (cb: (a: { code: string; def?: AchievementDef }) => void) => on('achievement', cb),

  getPresence: () => call<PresenceUser[]>('presence:get'),
  onPresence: (cb: (users: PresenceUser[]) => void) => on('presence', cb),

  setGamesConfig: (cfg: { enabled: boolean; custom: Record<string, string> }) => call<void>('games:config', cfg),
  getCurrentGame: () => call<string | null>('games:current'),
  onGame: (cb: (game: string | null) => void) => on('game', cb),
  listWindowedApps: () => call<{ exe: string; title: string }[]>('games:apps'),
  listKnownGames: () => call<{ name: string; exes: string[] }[]>('games:known'),

  setTrayState: (state: { micMuted: boolean; deafened: boolean; channel: string | null }) => call<void>('tray:state', state),
  setCloseToTray: (on: boolean) => call<void>('app:set-close-to-tray', on),

  checkForUpdates: () => call<UpdateStatus>('update:check'),
  getUpdateStatus: () => call<UpdateStatus>('update:status'),
  onUpdateStatus: (cb: (s: UpdateStatus) => void) => on('update-status', cb),

  moveUser: (channelId: number, userId: string) => call<unknown>('channels:move', channelId, userId),
  onMove: (cb: (m: { channelId: number; by: string }) => void) => on('move', cb),
  getBanned: () => call<string | null>('banned:get'),
  voiceActivity: () => call<unknown>('voice:activity'),
  getWeekly: () => call<WeeklyState>('weekly:get'),
  getFun: () => call<FunState>('fun:get'),
  createBet: (question: string, options: string[]) => call<unknown>('bets:create', question, options),
  stakeBet: (id: number, option: number, amount: number) => call<unknown>('bets:stake', id, option, amount),
  settleBet: (id: number, action: 'lock' | 'resolve' | 'cancel', winner?: number) => call<unknown>('bets:settle', id, action, winner),
  predict: (kind: 'talk' | 'stream', pick: string) => call<unknown>('predict', kind, pick),
  sealCapsule: (text: string, target: string, openAt: number) => call<unknown>('capsules:seal', text, target, openAt),
  onFun: (cb: (e: FunEvent) => void) => on('fun', cb),
  startQuest: (friendId: string) => call<unknown>('quests:start', friendId),
  getRecap: (which: 'last' | 'current') => call<Recap>('recap:get', which),
  onWeekly: (cb: (e: { type: 'challenge' | 'quest'; title?: string; with?: string }) => void) => on('weekly', cb),
  onAfk: (cb: (on: boolean) => void) => on('afk', cb),
  onBanned: (cb: (message: string | null) => void) => on('banned', cb),
  onModeration: (cb: (m: ModerationEvent) => void) => on('moderation', cb),
  listMembers: () => call<Member[]>('members:list'),
  chatHistory: (conv: string, before?: number) => call<{ messages: ChatMessage[] }>('chat:history', conv, before),
  chatSend: (conv: string, text: string, replyTo: number | null) => call<{ message: ChatMessage }>('chat:send', conv, text, replyTo),
  chatImage: (conv: string, data: Uint8Array, type: string, text: string, replyTo: number | null, w: number, h: number) =>
    call<{ message: ChatMessage }>('chat:image', conv, data, type, text, replyTo, w, h),
  chatEdit: (id: number, text: string) => call<{ message: ChatMessage }>('chat:edit', id, text),
  chatDelete: (id: number) => call<unknown>('chat:delete', id),
  chatRead: (conv: string, id: number) => call<unknown>('chat:read', conv, id),
  chatTyping: (conv: string) => call<unknown>('chat:typing', conv),
  chatState: () => call<ChatState>('chat:state'),
  chatStorage: () => call<ChatStorage>('chat:storage'),
  chatCleanup: (days: number) => call<ChatStorage & { removed: number }>('chat:cleanup', days),
  chatClear: (conv: string) => call<unknown>('chat:clear', conv),
  onChat: (cb: (e: ChatEvent) => void) => on('chat', cb),
  onChatTyping: (cb: (e: { conv: string; userId: string }) => void) => on('chat-typing', cb),
  showWindow: () => call<unknown>('app:show'),
  flashWindow: () => call<unknown>('app:flash'),
  moderate: (userId: string, action: ModAction, body?: unknown) => call<unknown>('mod:action', userId, action, body),
  setHotkeys: (map: Record<string, string | null>) => call<Record<string, string | null>>('hotkeys:set', map),
  onHotkey: (cb: (action: string) => void) => on('hotkey', cb),

  getScreenSources: () => call<ScreenSource[]>('screen:sources'),
  selectScreenSource: (id: string, audio: boolean) => call<void>('screen:select', id, audio),

  getAutostart: () => call<boolean>('app:get-autostart'),
  idleSeconds: () => call<number>('app:idle-seconds'),
  setAutostart: (enabled: boolean) => call<boolean>('app:set-autostart', enabled),

  getAppInfo: () => call<{ version: string; update: { version: string } | null }>('app:info'),
  installUpdate: () => call<void>('update:install'),
  onUpdateReady: (cb: (info: { version: string }) => void) => on('update-ready', cb),

  onChannels: (cb: (channels: Channel[]) => void) => on('channels', cb),
  onServerStatus: (cb: (online: boolean) => void) => on('server-status', cb),
  onSessionEnded: (cb: (reason: SessionEndReason) => void) => on('session-ended', cb),
};

export type EchoApi = typeof api;

contextBridge.exposeInMainWorld('echo', api);
