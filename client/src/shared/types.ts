export interface User {
  id: string;
  nickname: string;
  isAdmin: boolean;
  isModerator?: boolean;
  /** Profile banner version (cache key); null = none. */
  banner?: number | null;
  /** Avatar version (cache key); null = no avatar. */
  avatar: number | null;
}

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary' | 'unique';

export interface AchievementDef {
  code: string;
  title: string;
  description: string;
  rarity: Rarity;
  category?: string;
  icon: string;
  manual?: boolean;
  /** Secret until earned (the catalog shows a placeholder). */
  hidden?: boolean;
  /** One of a kind; holder = nickname of the only person who has it. */
  unique?: boolean;
  holder?: string | null;
}

/** Rank from achievements: points by rarity -> level; rank by level (0 Сигнал … 4 Сингулярность). */
export interface Prestige {
  points: number;
  level: number;
  tier: 0 | 1 | 2 | 3 | 4;
  /** Points where the current level starts and the next begins (progress ring). */
  levelFloor?: number;
  nextLevelAt?: number;
  /** Level where the next rank begins (null at the top). */
  nextTierLevel?: number | null;
  /** Points needed for the next tier (null at the top). */
  nextTierAt: number | null;
  tierFloor: number;
}

export type CosmeticSlot = 'ring' | 'frame' | 'name' | 'plate';

/** Equipped cosmetics (ids rendered by the client). */
export interface Look {
  ring: string;
  frame: string;
  name: string;
  plate: string;
}

export interface Cosmetic {
  id: string;
  slot: CosmeticSlot;
  title: string;
  group: 'basic' | 'level' | 'achievement' | 'exclusive';
  unlock: { level?: number; achievement?: string; unique?: boolean; role?: 'admin' | 'staff' };
  unlocked: boolean;
}

export interface CosmeticsCatalog {
  slots: { id: CosmeticSlot; title: string }[];
  items: Cosmetic[];
  style: Look;
}

export type StatusState = 'online' | 'away' | 'dnd';

export interface UserStatus {
  state: StatusState;
  text: string;
  emoji: string;
}

export interface Activity {
  game: string;
  since: number;
}

export interface PresenceUser {
  id: string;
  nickname: string;
  avatar: number | null;
  pinned: string[];
  activity: Activity | null;
  prestige?: Prestige;
  uniques?: string[];
  role?: 'admin' | 'moderator' | null;
  banner?: number | null;
  style?: Look;
  status?: UserStatus;
  /** Voice-muted by a moderator. */
  muted?: boolean;
}

export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'none' }
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'ready'; version: string }
  | { state: 'error'; message: string };

export interface AchievementCategory {
  id: string;
  title: string;
}

export interface Profile extends User {
  createdAt: number;
  lastSeenAt: number | null;
  voiceSeconds: number;
  streamsCount: number;
  gameSeconds: number;
  gamesCount: number;
  topGames: { game: string; seconds: number }[];
  /** Days in a row with voice activity (ending today or yesterday). */
  streakDays?: number;
  /** How far along countable, not yet earned achievements are (never secret ones). */
  progress?: Record<string, { value: number; target: number; unit: string }>;
  achievements: { code: string; awardedAt: number }[];
  pinned: string[];
  prestige: Prestige;
  uniques?: string[];
  style?: Look;
  status?: UserStatus;
  /** Full definitions of hidden achievements this person has earned. */
  revealed?: AchievementDef[];
}

export interface ChannelMember {
  id: string;
  nickname: string;
  avatar: number | null;
  /** Achievement codes the user shows off. */
  pinned?: string[];
  prestige?: Prestige;
  uniques?: string[];
  role?: 'admin' | 'moderator' | null;
  banner?: number | null;
  style?: Look;
  status?: UserStatus;
  muted?: boolean;
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

/** Everyone on the server, online or not (staff also see bans and mute times). */
export interface Member {
  id: string;
  nickname: string;
  avatar: number | null;
  role: 'admin' | 'moderator' | null;
  online: boolean;
  lastSeenAt: number | null;
  createdAt: number;
  muted: boolean;
  mutedUntil: number | null;
  banned: boolean;
  bannedUntil: number | null;
  banReason: string | null;
  /** Exclusive cosmetics the admin granted ("slot:id"; staff only see this). */
  granted: string[];
}

export type ModAction = 'disconnect' | 'mute' | 'unmute' | 'nickname' | 'ban' | 'unban' | 'role' | 'delete' | 'cosmetic';

export interface ModerationEvent {
  action: 'disconnect' | 'mute' | 'unmute' | 'rename' | 'role';
  by: string | null;
  until?: number;
  nickname?: string;
  role?: 'moderator' | 'member';
}

export interface ChatMessage {
  id: number;
  conv: string;
  author: string;
  text: string;
  createdAt: number;
  editedAt: number | null;
  deleted: boolean;
  replyTo: number | null;
  mentions: string[];
  attachment: { key: string; type: string; size: number; w: number | null; h: number | null; gone: boolean } | null;
}

export type ChatEvent =
  | { type: 'new' | 'edit' | 'delete'; message: ChatMessage }
  | { type: 'cleared'; conv: string };

export interface ChatState {
  unread: { conv: string; lastId: number; unread: number; mentions: number }[];
  dms: { conv: string; with: string; unread: number; last: ChatMessage | null }[];
}

export interface ChatStorage {
  bytes: number;
  attachments: number;
  cap: number;
  messages: number;
}

export type SessionEndReason = 'kicked' | 'invalid' | 'logout';
