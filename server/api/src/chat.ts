import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { config } from './config.ts';
import { db, queries, type User } from './db.ts';

/**
 * Text chat: one conversation per voice channel ("ch:<id>") and private ones between two
 * people ("dm:<idA>|<idB>", ids sorted). Text is tiny and kept forever; only attachments
 * take space, so they live under a total cap and the oldest are removed first.
 */

export const attachDir = join(dirname(config.dbPath), 'attachments');
mkdirSync(attachDir, { recursive: true });

/** Total space for attachments (GB, env ECHO_ATTACH_CAP_GB). */
export const ATTACH_CAP = Number(process.env.ECHO_ATTACH_CAP_GB ?? 20) * 1024 ** 3;
export const ATTACH_MAX = 10 * 1024 * 1024;
export const TEXT_MAX = 2000;

db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    conv        TEXT NOT NULL,
    author      TEXT NOT NULL,
    text        TEXT NOT NULL DEFAULT '',
    created_at  INTEGER NOT NULL,
    edited_at   INTEGER,
    deleted     INTEGER NOT NULL DEFAULT 0,
    reply_to    INTEGER,
    mentions    TEXT NOT NULL DEFAULT '[]',
    att_key     TEXT,
    att_type    TEXT,
    att_size    INTEGER,
    att_w       INTEGER,
    att_h       INTEGER,
    att_gone    INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS messages_conv ON messages (conv, id);
  CREATE INDEX IF NOT EXISTS messages_att ON messages (att_key) WHERE att_key IS NOT NULL;

  CREATE TABLE IF NOT EXISTS chat_reads (
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    conv       TEXT NOT NULL,
    last_read  INTEGER NOT NULL,
    PRIMARY KEY (user_id, conv)
  );
`);

const q = {
  page: db.prepare('SELECT * FROM messages WHERE conv = ? AND id < ? ORDER BY id DESC LIMIT ?'),
  byId: db.prepare('SELECT * FROM messages WHERE id = ?'),
  insert: db.prepare(
    `INSERT INTO messages (conv, author, text, created_at, reply_to, mentions, att_key, att_type, att_size, att_w, att_h)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ),
  edit: db.prepare('UPDATE messages SET text = ?, edited_at = ?, mentions = ? WHERE id = ?'),
  remove: db.prepare("UPDATE messages SET deleted = 1, text = '', att_gone = CASE WHEN att_key IS NULL THEN 0 ELSE 1 END WHERE id = ?"),
  clearConv: db.prepare('DELETE FROM messages WHERE conv = ?'),
  convAttachments: db.prepare('SELECT att_key FROM messages WHERE conv = ? AND att_key IS NOT NULL AND att_gone = 0'),
  setRead: db.prepare(
    'INSERT INTO chat_reads (user_id, conv, last_read) VALUES (?, ?, ?) ON CONFLICT(user_id, conv) DO UPDATE SET last_read = MAX(last_read, excluded.last_read)',
  ),
  reads: db.prepare('SELECT conv, last_read FROM chat_reads WHERE user_id = ?'),
  convStats: db.prepare(
    `SELECT conv, MAX(id) AS last_id,
            SUM(CASE WHEN id > COALESCE((SELECT last_read FROM chat_reads r WHERE r.user_id = ? AND r.conv = m.conv), 0)
                      AND author != ? AND deleted = 0 THEN 1 ELSE 0 END) AS unread,
            SUM(CASE WHEN id > COALESCE((SELECT last_read FROM chat_reads r WHERE r.user_id = ? AND r.conv = m.conv), 0)
                      AND author != ? AND deleted = 0 AND mentions LIKE ? THEN 1 ELSE 0 END) AS mentions
       FROM messages m WHERE conv LIKE 'ch:%' OR conv LIKE ? OR conv LIKE ?
      GROUP BY conv`,
  ),
  attBytes: db.prepare('SELECT COALESCE(SUM(att_size), 0) AS bytes, COUNT(*) AS n FROM messages WHERE att_key IS NOT NULL AND att_gone = 0'),
  oldestAtt: db.prepare('SELECT id, att_key, att_size FROM messages WHERE att_key IS NOT NULL AND att_gone = 0 ORDER BY id LIMIT 50'),
  olderAtt: db.prepare('SELECT id, att_key FROM messages WHERE att_key IS NOT NULL AND att_gone = 0 AND created_at < ?'),
  markGone: db.prepare('UPDATE messages SET att_gone = 1 WHERE id = ?'),
  attByKey: db.prepare('SELECT conv, att_type, att_gone FROM messages WHERE att_key = ?'),
  msgCount: db.prepare('SELECT COUNT(*) AS n FROM messages'),
};

interface Row {
  id: number;
  conv: string;
  author: string;
  text: string;
  created_at: number;
  edited_at: number | null;
  deleted: number;
  reply_to: number | null;
  mentions: string;
  att_key: string | null;
  att_type: string | null;
  att_size: number | null;
  att_w: number | null;
  att_h: number | null;
  att_gone: number;
}

export const dmConv = (a: string, b: string) => `dm:${[a, b].sort().join('|')}`;
export const dmParties = (conv: string) => (conv.startsWith('dm:') ? conv.slice(3).split('|') : null);

/** Who may read/write this conversation. Throws a readable error otherwise. */
export function checkAccess(conv: string, user: User): void {
  if (conv.startsWith('ch:')) {
    const id = Number(conv.slice(3));
    if (!Number.isInteger(id) || !queries.channelById.get(id)) throw new Error('Нет такого канала');
    return;
  }
  const parties = dmParties(conv);
  if (!parties || parties.length !== 2 || !parties.includes(user.id)) throw new Error('Нет доступа к этой переписке');
  const other = parties.find((p) => p !== user.id) ?? user.id;
  if (!queries.userById.get(other)) throw new Error('Собеседник удалён');
}

/** Who gets live updates for a conversation (null = everyone). */
export const audience = (conv: string) => dmParties(conv);

export function toMessage(r: Row) {
  return {
    id: r.id,
    conv: r.conv,
    author: r.author,
    text: r.deleted ? '' : r.text,
    createdAt: r.created_at,
    editedAt: r.edited_at,
    deleted: !!r.deleted,
    replyTo: r.reply_to,
    mentions: JSON.parse(r.mentions) as string[],
    attachment:
      r.att_key && !r.deleted
        ? { key: r.att_key, type: r.att_type, size: r.att_size, w: r.att_w, h: r.att_h, gone: !!r.att_gone }
        : null,
  };
}
export type Message = ReturnType<typeof toMessage>;

export function history(conv: string, before: number | null, limit: number) {
  return (q.page.all(conv, before ?? Number.MAX_SAFE_INTEGER, limit) as unknown as Row[]).reverse().map(toMessage);
}

/** @nick mentions -> user ids (nicknames may contain spaces: longest match wins). */
function findMentions(text: string): string[] {
  if (!text.includes('@')) return [];
  const users = (queries.listUsers.all() as unknown as User[]).sort((a, b) => b.nickname.length - a.nickname.length);
  const lower = text.toLowerCase();
  const out = new Set<string>();
  for (const u of users) if (lower.includes(`@${u.nickname.toLowerCase()}`)) out.add(u.id);
  if (/@(все|all|everyone)\b/i.test(text)) for (const u of users) out.add(u.id);
  return [...out];
}

// Simple flood protection: at most 6 messages per 5 seconds per person.
const recent = new Map<string, number[]>();
function rateLimit(userId: string) {
  const now = Date.now();
  const list = (recent.get(userId) ?? []).filter((t) => now - t < 5000);
  if (list.length >= 6) throw new Error('Слишком быстро, подожди пару секунд');
  list.push(now);
  recent.set(userId, list);
}

export interface Attachment {
  data: Buffer;
  type: string;
  w: number | null;
  h: number | null;
}

export async function post(conv: string, author: User, text: string, replyTo: number | null, att: Attachment | null) {
  text = text.trim();
  if (!text && !att) throw new Error('Пустое сообщение');
  if (text.length > TEXT_MAX) throw new Error(`Сообщение длиннее ${TEXT_MAX} символов`);
  rateLimit(author.id);
  if (replyTo) {
    const parent = q.byId.get(replyTo) as Row | undefined;
    if (!parent || parent.conv !== conv) replyTo = null;
  }
  let key: string | null = null;
  if (att) {
    if (att.data.length > ATTACH_MAX) throw new Error('Файл больше 10 МБ');
    key = randomBytes(16).toString('hex');
    await writeFile(join(attachDir, key), att.data);
  }
  const res = q.insert.run(
    conv,
    author.id,
    text,
    Date.now(),
    replyTo,
    JSON.stringify(findMentions(text)),
    key,
    att?.type ?? null,
    att?.data.length ?? null,
    att?.w ?? null,
    att?.h ?? null,
  );
  q.setRead.run(author.id, conv, Number(res.lastInsertRowid));
  if (att) await enforceCap();
  return toMessage(q.byId.get(Number(res.lastInsertRowid)) as unknown as Row);
}

export function getRow(id: number) {
  return q.byId.get(id) as unknown as Row | undefined;
}

export function edit(id: number, text: string) {
  text = text.trim();
  if (!text) throw new Error('Пустое сообщение');
  if (text.length > TEXT_MAX) throw new Error(`Сообщение длиннее ${TEXT_MAX} символов`);
  q.edit.run(text, Date.now(), JSON.stringify(findMentions(text)), id);
  return toMessage(q.byId.get(id) as unknown as Row);
}

export async function remove(id: number) {
  const row = q.byId.get(id) as unknown as Row | undefined;
  if (row?.att_key && !row.att_gone) await rm(join(attachDir, row.att_key), { force: true });
  q.remove.run(id);
  return toMessage(q.byId.get(id) as unknown as Row);
}

export async function clearConversation(conv: string) {
  for (const r of q.convAttachments.all(conv) as { att_key: string }[]) await rm(join(attachDir, r.att_key), { force: true });
  q.clearConv.run(conv);
}

export function markRead(userId: string, conv: string, id: number) {
  q.setRead.run(userId, conv, id);
}

/** Unread and mention counts for every conversation the user can see. */
export function unread(userId: string) {
  const rows = q.convStats.all(userId, userId, userId, userId, `%"${userId}"%`, `dm:${userId}|%`, `dm:%|${userId}`) as {
    conv: string;
    last_id: number;
    unread: number;
    mentions: number;
  }[];
  return rows.map((r) => ({ conv: r.conv, lastId: r.last_id, unread: r.unread, mentions: r.mentions }));
}

/** Private conversations of a user with the latest message, newest first. */
export function dmList(userId: string) {
  const stats = unread(userId).filter((r) => r.conv.startsWith('dm:'));
  return stats
    .map((r) => {
      const other = dmParties(r.conv)!.find((p) => p !== userId) ?? userId;
      const last = q.byId.get(r.lastId) as unknown as Row | undefined;
      return { conv: r.conv, with: other, unread: r.unread, last: last ? toMessage(last) : null };
    })
    .sort((a, b) => (b.last?.id ?? 0) - (a.last?.id ?? 0));
}

// ---------- attachments: storage cap and cleanup ----------

export function attachmentInfo(key: string) {
  return q.attByKey.get(key) as { conv: string; att_type: string; att_gone: number } | undefined;
}

export function storageStats() {
  const s = q.attBytes.get() as { bytes: number; n: number };
  return { bytes: s.bytes, attachments: s.n, cap: ATTACH_CAP, messages: (q.msgCount.get() as { n: number }).n };
}

/** Over the cap: drop the oldest attachments (the messages stay, marked "file removed"). */
async function enforceCap() {
  let { bytes } = q.attBytes.get() as { bytes: number };
  while (bytes > ATTACH_CAP) {
    const batch = q.oldestAtt.all() as { id: number; att_key: string; att_size: number }[];
    if (batch.length === 0) break;
    for (const r of batch) {
      if (bytes <= ATTACH_CAP) break;
      await rm(join(attachDir, r.att_key), { force: true });
      q.markGone.run(r.id);
      bytes -= r.att_size;
    }
  }
}

/** Admin: remove attachments older than N days. */
export async function cleanupOlderThan(days: number) {
  const rows = q.olderAtt.all(Date.now() - days * 86_400_000) as { id: number; att_key: string }[];
  for (const r of rows) {
    await rm(join(attachDir, r.att_key), { force: true });
    q.markGone.run(r.id);
  }
  return rows.length;
}
