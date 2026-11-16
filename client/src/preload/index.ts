import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type {
  Channel,
  Invite,
  IpcResult,
  ScreenSource,
  Session,
  SessionEndReason,
  VoiceCredentials,
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

  getChannels: () => call<{ channels: Channel[]; online: boolean }>('channels:get'),
  connect: (channelId: number) => call<VoiceCredentials>('channels:connect', channelId),
  createChannel: (name: string) => call<unknown>('channels:create', name),
  renameChannel: (id: number, name: string) => call<unknown>('channels:rename', id, name),
  deleteChannel: (id: number) => call<unknown>('channels:delete', id),
  createInvite: () => call<Invite>('invites:create'),

  updateProfile: (patch: { nickname: string }) => call<Session>('me:update', patch),
  setAvatar: (webp: Uint8Array) => call<Session>('me:set-avatar', webp),
  removeAvatar: () => call<Session>('me:remove-avatar'),

  getScreenSources: () => call<ScreenSource[]>('screen:sources'),
  selectScreenSource: (id: string, audio: boolean) => call<void>('screen:select', id, audio),

  getAutostart: () => call<boolean>('app:get-autostart'),
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
