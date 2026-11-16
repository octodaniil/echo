import { db, queries, type User } from './db.ts';

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

export interface AchievementDef {
  code: string;
  title: string;
  description: string;
  rarity: Rarity;
  /** Icon key, rendered by the client. */
  icon: string;
  /** Only an admin can give it. */
  manual?: boolean;
}

export const CATALOG: AchievementDef[] = [
  { code: 'beta_tester', title: 'Первый бета-тестер', description: 'Был с Echo с самого начала и ловил баги первым', rarity: 'legendary', icon: 'flask', manual: true },
  { code: 'founder', title: 'Основатель', description: 'Поднял свой сервер Echo', rarity: 'epic', icon: 'crown' },
  { code: 'first_steps', title: 'Первые шаги', description: 'Впервые зашёл в голосовой канал', rarity: 'common', icon: 'door' },
  { code: 'voice_1h', title: 'Разговорчивый', description: 'Провёл в голосе 1 час', rarity: 'common', icon: 'wave' },
  { code: 'voice_10h', title: 'Душа компании', description: 'Провёл в голосе 10 часов', rarity: 'rare', icon: 'waves' },
  { code: 'voice_100h', title: 'Легенда войса', description: 'Провёл в голосе 100 часов', rarity: 'legendary', icon: 'infinity' },
  { code: 'marathon', title: 'Марафонец', description: '4 часа подряд в одном канале', rarity: 'epic', icon: 'timer' },
  { code: 'night_owl', title: 'Полуночник', description: 'Был в голосе между 3 и 5 утра', rarity: 'rare', icon: 'moon' },
  { code: 'streamer', title: 'В эфире', description: 'Запустил первую трансляцию', rarity: 'common', icon: 'broadcast' },
  { code: 'stream_10', title: 'Стример', description: 'Провёл 10 трансляций', rarity: 'rare', icon: 'signal' },
  { code: 'full_house', title: 'Полный сбор', description: 'Был в канале, где собрались 5 человек и больше', rarity: 'rare', icon: 'people' },
];

const byCode = new Map(CATALOG.map((a) => [a.code, a]));
export const isAchievement = (code: string) => byCode.has(code);

// ---------- storage ----------

db.exec(`
  CREATE TABLE IF NOT EXISTS user_achievements (
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code        TEXT NOT NULL,
    awarded_at  INTEGER NOT NULL,
    PRIMARY KEY (user_id, code)
  );
`);

const q = {
  list: db.prepare('SELECT code, awarded_at FROM user_achievements WHERE user_id = ? ORDER BY awarded_at'),
  insert: db.prepare('INSERT OR IGNORE INTO user_achievements (user_id, code, awarded_at) VALUES (?, ?, ?)'),
  remove: db.prepare('DELETE FROM user_achievements WHERE user_id = ? AND code = ?'),
  addVoice: db.prepare('UPDATE users SET voice_seconds = voice_seconds + ? WHERE id = ?'),
  addStream: db.prepare('UPDATE users SET streams_count = streams_count + 1 WHERE id = ?'),
  stats: db.prepare('SELECT voice_seconds, streams_count, is_admin FROM users WHERE id = ?'),
  setPinned: db.prepare('UPDATE users SET pinned = ? WHERE id = ?'),
};

export function listAchievements(userId: string) {
  return (q.list.all(userId) as { code: string; awarded_at: number }[])
    .filter((r) => byCode.has(r.code))
    .map((r) => ({ code: r.code, awardedAt: r.awarded_at }));
}

let onAwarded: (userId: string, code: string) => void = () => {};
export function setAwardListener(fn: (userId: string, code: string) => void) {
  onAwarded = fn;
}

/** Gives an achievement; returns true if it is new. */
export function award(userId: string, code: string): boolean {
  if (!byCode.has(code)) return false;
  const res = q.insert.run(userId, code, Date.now());
  const isNew = Number(res.changes) > 0;
  if (isNew) onAwarded(userId, code);
  return isNew;
}

export function revoke(userId: string, code: string) {
  q.remove.run(userId, code);
  const pinned = getPinned(userId).filter((c) => c !== code);
  q.setPinned.run(JSON.stringify(pinned), userId);
}

export function getPinnedFromRow(json: string | null | undefined): string[] {
  try {
    const list = JSON.parse(json ?? '[]') as unknown;
    return Array.isArray(list) ? list.filter((c): c is string => typeof c === 'string' && byCode.has(c)) : [];
  } catch {
    return [];
  }
}

export function getPinned(userId: string): string[] {
  const row = queries.userById.get(userId) as User | undefined;
  return getPinnedFromRow(row?.pinned);
}

export const MAX_PINNED = 3;

export function setPinned(userId: string, codes: string[]) {
  const owned = new Set(listAchievements(userId).map((a) => a.code));
  const clean = [...new Set(codes)].filter((c) => owned.has(c)).slice(0, MAX_PINNED);
  q.setPinned.run(JSON.stringify(clean), userId);
  return clean;
}

export function getStats(userId: string) {
  const row = q.stats.get(userId) as { voice_seconds: number; streams_count: number; is_admin: number } | undefined;
  return { voiceSeconds: row?.voice_seconds ?? 0, streamsCount: row?.streams_count ?? 0 };
}

// ---------- automatic rules ----------

const HOUR = 3600;

function checkVoiceTotals(userId: string) {
  const { voiceSeconds } = getStats(userId);
  if (voiceSeconds >= 1 * HOUR) award(userId, 'voice_1h');
  if (voiceSeconds >= 10 * HOUR) award(userId, 'voice_10h');
  if (voiceSeconds >= 100 * HOUR) award(userId, 'voice_100h');
}

/** Local hour on the server's time zone (Europe/Moscow by default). */
function localHour(ms: number): number {
  const tz = process.env.ECHO_TZ ?? 'Europe/Moscow';
  return Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: tz }).format(ms));
}

interface Session {
  room: string;
  since: number;
  accounted: number;
}

/** Who is in voice right now, for time tracking. Keyed by user id. */
const sessions = new Map<string, Session>();

export function voiceJoined(userId: string, room: string) {
  if (!queries.userById.get(userId)) return;
  const now = Date.now();
  const prev = sessions.get(userId);
  if (prev && prev.room !== room) voiceLeft(userId, prev.room);
  if (!sessions.has(userId)) sessions.set(userId, { room, since: now, accounted: now });
  award(userId, 'first_steps');
}

export function voiceLeft(userId: string, room: string) {
  const s = sessions.get(userId);
  if (!s || s.room !== room) return;
  flush(userId, s, Date.now());
  sessions.delete(userId);
}

function flush(userId: string, s: Session, now: number) {
  const secs = Math.floor((now - s.accounted) / 1000);
  if (secs > 0) {
    q.addVoice.run(secs, userId);
    s.accounted += secs * 1000;
  }
  checkVoiceTotals(userId);
  if (now - s.since >= 4 * HOUR * 1000) award(userId, 'marathon');
  const h = localHour(now);
  if (h >= 3 && h < 5) award(userId, 'night_owl');
}

/** Everyone currently in a room (to keep sessions in sync after restarts and for full_house). */
export function roomMembers(room: string, userIds: string[]) {
  for (const id of userIds) if (!sessions.has(id)) voiceJoined(id, room);
  if (userIds.length >= 5) for (const id of userIds) award(id, 'full_house');
}

export function streamStarted(userId: string) {
  if (!queries.userById.get(userId)) return;
  q.addStream.run(userId);
  award(userId, 'streamer');
  if (getStats(userId).streamsCount >= 10) award(userId, 'stream_10');
}

export function syncAdmins() {
  for (const u of queries.listUsers.all() as unknown as User[]) if (u.is_admin) award(u.id, 'founder');
}

/** Accrue voice time every minute so a restart loses at most a minute. */
export function startAchievementClock() {
  syncAdmins();
  setInterval(() => {
    const now = Date.now();
    for (const [id, s] of sessions) flush(id, s, now);
  }, 60_000).unref();
}
