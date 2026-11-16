export interface User {
  id: string;
  nickname: string;
  isAdmin: boolean;
  /** Avatar version (cache key); null = no avatar. */
  avatar: number | null;
}

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

export interface AchievementDef {
  code: string;
  title: string;
  description: string;
  rarity: Rarity;
  icon: string;
  manual?: boolean;
}

export interface Profile extends User {
  createdAt: number;
  lastSeenAt: number | null;
  voiceSeconds: number;
  streamsCount: number;
  achievements: { code: string; awardedAt: number }[];
  pinned: string[];
}

export interface ChannelMember {
  id: string;
  nickname: string;
  avatar: number | null;
  /** Achievement codes the user shows off. */
  pinned?: string[];
  streaming: boolean;
  joinedAt: number;
}

export interface Channel {
  id: number;
  name: string;
  members: ChannelMember[];
}

export interface Session {
  serverUrl: string;
  user: User;
}

export interface VoiceCredentials {
  url: string;
  room: string;
  token: string;
}

export interface Invite {
  code: string;
  max_uses: number | null;
  uses: number;
  expires_at: number | null;
}

export interface ScreenSource {
  id: string;
  kind: 'screen' | 'window';
  name: string;
  /** JPEG data URL. */
  thumbnail: string;
  /** App icon as PNG data URL (windows only). */
  icon: string | null;
}

/** Shape of every IPC reply: errors are passed as data so their message survives the bridge. */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string };

export type SessionEndReason = 'kicked' | 'invalid' | 'logout';
