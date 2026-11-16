import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.ts';

export interface User {
  id: string;
  nickname: string;
  is_admin: number;
  created_at: number;
  last_seen_at: number | null;
  /** Timestamp of the last avatar upload, used as a cache-busting version; null = no avatar. */
  avatar_version: number | null;
  /** JSON array of achievement codes shown on the profile. */
  pinned: string;
  is_moderator: number;
  banner_version: number | null;
  banner_type: string | null;
}

export interface Invite {
  code: string;
  grants_admin: number;
  max_uses: number | null;
  uses: number;
  expires_at: number | null;
  created_by: string | null;
  created_at: number;
}

export interface Channel {
  id: number;
  name: string;
  position: number;
}

mkdirSync(dirname(config.dbPath), { recursive: true });

export const db = new DatabaseSync(config.dbPath);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    nickname      TEXT NOT NULL,
    is_admin      INTEGER NOT NULL DEFAULT 0,
    token_hash    TEXT NOT NULL UNIQUE,
    created_at    INTEGER NOT NULL,
    last_seen_at  INTEGER
  );
  CREATE UNIQUE INDEX IF NOT EXISTS users_nickname ON users (nickname COLLATE NOCASE);

  CREATE TABLE IF NOT EXISTS invites (
    code          TEXT PRIMARY KEY,
    grants_admin  INTEGER NOT NULL DEFAULT 0,
    max_uses      INTEGER,
    uses          INTEGER NOT NULL DEFAULT 0,
    expires_at    INTEGER,
    created_by    TEXT,
    created_at    INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS channels (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    position    INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL
  );
`);

// Migrations for databases created by older versions.
const userColumns = db.prepare('PRAGMA table_info(users)').all() as { name: string }[];
const addColumn = (name: string, ddl: string) => {
  if (!userColumns.some((c) => c.name === name)) db.exec(`ALTER TABLE users ADD COLUMN ${ddl}`);
};
addColumn('avatar_version', 'avatar_version INTEGER');
addColumn('voice_seconds', 'voice_seconds INTEGER NOT NULL DEFAULT 0');
addColumn('streams_count', 'streams_count INTEGER NOT NULL DEFAULT 0');
// Achievement codes shown on the profile (JSON array).
addColumn('pinned', "pinned TEXT NOT NULL DEFAULT '[]'");
// Moderator role (no extra powers yet).
addColumn('is_moderator', 'is_moderator INTEGER NOT NULL DEFAULT 0');
// Profile banner: version (cache key) and stored image type.
addColumn('banner_version', 'banner_version INTEGER');
addColumn('banner_type', 'banner_type TEXT');

export const avatarDir = join(dirname(config.dbPath), 'avatars');
mkdirSync(avatarDir, { recursive: true });

// Seed a couple of channels on first start.
const channelCount = db.prepare('SELECT COUNT(*) AS n FROM channels').get() as { n: number };
if (channelCount.n === 0) {
  const insert = db.prepare('INSERT INTO channels (name, position, created_at) VALUES (?, ?, ?)');
  ['Общий', 'Игры'].forEach((name, i) => insert.run(name, i, Date.now()));
}

/** Runs fn inside a transaction (node:sqlite is synchronous, so this is safe). */
export function transaction<T>(fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export const queries = {
  userByTokenHash: db.prepare(
    'SELECT id, nickname, is_admin, created_at, last_seen_at, avatar_version, pinned, is_moderator, banner_version, banner_type FROM users WHERE token_hash = ?',
  ),
  userByNickname: db.prepare(
    'SELECT id, nickname, is_admin, created_at, last_seen_at, avatar_version, pinned, is_moderator, banner_version, banner_type FROM users WHERE nickname = ? COLLATE NOCASE',
  ),
  listUsers: db.prepare(
    'SELECT id, nickname, is_admin, created_at, last_seen_at, avatar_version, pinned, is_moderator, banner_version, banner_type FROM users ORDER BY created_at',
  ),
  insertUser: db.prepare(
    'INSERT INTO users (id, nickname, is_admin, token_hash, created_at) VALUES (?, ?, ?, ?, ?)',
  ),
  deleteUser: db.prepare('DELETE FROM users WHERE id = ?'),
  touchUser: db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?'),
  renameUser: db.prepare('UPDATE users SET nickname = ? WHERE id = ?'),
  setAvatarVersion: db.prepare('UPDATE users SET avatar_version = ? WHERE id = ?'),
  setModerator: db.prepare('UPDATE users SET is_moderator = ? WHERE id = ?'),
  setBanner: db.prepare('UPDATE users SET banner_version = ?, banner_type = ? WHERE id = ?'),
  userProfiles: db.prepare('SELECT id, nickname, avatar_version, pinned, is_admin, is_moderator, banner_version FROM users'),
  userById: db.prepare(
    'SELECT id, nickname, is_admin, created_at, last_seen_at, avatar_version, pinned, is_moderator, banner_version, banner_type FROM users WHERE id = ?',
  ),

  inviteByCode: db.prepare('SELECT * FROM invites WHERE code = ?'),
  listInvites: db.prepare('SELECT * FROM invites ORDER BY created_at DESC'),
  insertInvite: db.prepare(
    'INSERT INTO invites (code, grants_admin, max_uses, expires_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ),
  useInvite: db.prepare('UPDATE invites SET uses = uses + 1 WHERE code = ?'),
  deleteInvite: db.prepare('DELETE FROM invites WHERE code = ?'),

  listChannels: db.prepare('SELECT id, name, position FROM channels ORDER BY position, id'),
  channelById: db.prepare('SELECT id, name, position FROM channels WHERE id = ?'),
  insertChannel: db.prepare(
    'INSERT INTO channels (name, position, created_at) VALUES (?, (SELECT COALESCE(MAX(position), -1) + 1 FROM channels), ?)',
  ),
  renameChannel: db.prepare('UPDATE channels SET name = ? WHERE id = ?'),
  deleteChannel: db.prepare('DELETE FROM channels WHERE id = ?'),
};
