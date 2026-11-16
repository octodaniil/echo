import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { Channel, Invite, IpcResult, Session, SessionEndReason, VoiceCredentials } from '../shared/types';

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

  onChannels: (cb: (channels: Channel[]) => void) => on('channels', cb),
  onServerStatus: (cb: (online: boolean) => void) => on('server-status', cb),
  onSessionEnded: (cb: (reason: SessionEndReason) => void) => on('session-ended', cb),
};

export type EchoApi = typeof api;

contextBridge.exposeInMainWorld('echo', api);
