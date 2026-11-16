import { db, queries, type User } from './db.ts';

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary' | 'unique';
export type Category = 'voice' | 'stream' | 'games' | 'social' | 'special';

export interface AchievementDef {
  code: string;
  title: string;
  description: string;
  rarity: Rarity;
  category: Category;
  /** Icon key, rendered by the client. */
  icon: string;
  /** Only an admin can give it. */
  manual?: boolean;
  /** Secret: title and description are revealed only once earned. */
  hidden?: boolean;
  /** One of a kind: only a single person can ever hold it. */
  unique?: boolean;
}

export const CATEGORIES: { id: Category; title: string }[] = [
  { id: 'special', title: 'Особые' },
  { id: 'voice', title: 'Голос' },
  { id: 'games', title: 'Игры' },
  { id: 'stream', title: 'Трансляции' },
  { id: 'social', title: 'Сообщество' },
];

export const CATALOG: AchievementDef[] = [
  // special
  { code: 'founder', title: 'Основатель', description: 'Поднял свой сервер Echo. Такой человек может быть только один', rarity: 'unique', category: 'special', icon: 'crown', unique: true },
  { code: 'beta_tester', title: 'Первый бета-тестер', description: 'Был с Echo с самого начала и ловил баги первым. Такой человек может быть только один', rarity: 'unique', category: 'special', icon: 'flask', manual: true, unique: true },
  // voice
  { code: 'first_steps', title: 'Первые шаги', description: 'Впервые зашёл в голосовой канал', rarity: 'common', category: 'voice', icon: 'door' },
  { code: 'voice_1h', title: 'Разговорчивый', description: 'Провёл в голосе 1 час', rarity: 'common', category: 'voice', icon: 'wave' },
  { code: 'voice_10h', title: 'Душа компании', description: 'Провёл в голосе 10 часов', rarity: 'rare', category: 'voice', icon: 'waves' },
  { code: 'voice_100h', title: 'Легенда войса', description: 'Провёл в голосе 100 часов', rarity: 'legendary', category: 'voice', icon: 'infinity' },
  { code: 'marathon', title: 'Марафонец', description: '4 часа подряд в одном канале', rarity: 'epic', category: 'voice', icon: 'timer' },
  { code: 'night_owl', title: 'Полуночник', description: 'Был в голосе между 3 и 5 утра', rarity: 'rare', category: 'voice', icon: 'moon' },
  // games
  { code: 'gamer', title: 'Геймер', description: 'Запустил игру, пока Echo был включён', rarity: 'common', category: 'games', icon: 'gamepad' },
  { code: 'game_10h', title: 'Задрот', description: 'Наиграл 10 часов', rarity: 'rare', category: 'games', icon: 'joystick' },
  { code: 'game_100h', title: 'Не выключает компьютер', description: 'Наиграл 100 часов', rarity: 'legendary', category: 'games', icon: 'trophy' },
  { code: 'collector', title: 'Коллекционер', description: 'Играл в 5 разных игр', rarity: 'rare', category: 'games', icon: 'stack' },
  { code: 'teammates', title: 'Тиммейты', description: 'Играли в одну игру, сидя в одном голосовом канале', rarity: 'rare', category: 'games', icon: 'handshake' },
  { code: 'squad', title: 'Отряд', description: 'Трое и больше одновременно в одной игре', rarity: 'epic', category: 'games', icon: 'shield' },
  // stream
  { code: 'streamer', title: 'В эфире', description: 'Запустил первую трансляцию', rarity: 'common', category: 'stream', icon: 'broadcast' },
  { code: 'stream_10', title: 'Стример', description: 'Провёл 10 трансляций', rarity: 'rare', category: 'stream', icon: 'signal' },
  // social
  { code: 'full_house', title: 'Полный сбор', description: 'Был в канале, где собрались 5 человек и больше', rarity: 'rare', category: 'social', icon: 'people' },
  // hidden — the catalog only shows "secret achievement" until someone earns them
  { code: 'echo_of_silence', title: 'Эхо тишины', description: 'Просидел час в голосовом канале совсем один', rarity: 'rare', category: 'voice', icon: 'echo', hidden: true },
  { code: 'early_bird', title: 'Ранняя пташка', description: 'Зашёл в голос между 6 и 7 утра', rarity: 'rare', category: 'voice', icon: 'sunrise', hidden: true },
  { code: 'all_nighter', title: 'Не спится', description: '8 часов подряд в одном канале', rarity: 'legendary', category: 'voice', icon: 'coffee', hidden: true },
  { code: 'hopper', title: 'Попрыгунчик', description: 'Сменил канал 10 раз за 10 минут', rarity: 'epic', category: 'social', icon: 'shuffle', hidden: true },
];

/** What clients see: hidden achievements are masked unless the viewer has earned them. */
export function catalogFor(ownedCodes: Set<string>) {
  return CATALOG.map((a) => {
    if (a.hidden && !ownedCodes.has(a.code)) {
      return { code: a.code, title: 'Скрытая ачивка', description: 'Получишь — узнаешь', rarity: a.rarity, category: a.category, icon: 'question', hidden: true };
    }
    if (a.unique) {
      const holder = holderOf(a.code);
      const name = holder ? (queries.userById.get(holder) as User | undefined)?.nickname : undefined;
      return { ...a, holder: name ?? null };
    }
    return a;
  });
}

export const definition = (code: string) => CATALOG.find((a) => a.code === code);

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

  -- Time per game, for "hours played" stats and game achievements.
  CREATE TABLE IF NOT EXISTS user_games (
    user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game     TEXT NOT NULL,
    seconds  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, game)
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
  addGame: db.prepare(
    'INSERT INTO user_games (user_id, game, seconds) VALUES (?, ?, ?) ON CONFLICT(user_id, game) DO UPDATE SET seconds = seconds + excluded.seconds',
  ),
  gameTotals: db.prepare('SELECT COALESCE(SUM(seconds), 0) AS total, COUNT(*) AS games FROM user_games WHERE user_id = ?'),
  topGames: db.prepare('SELECT game, seconds FROM user_games WHERE user_id = ? ORDER BY seconds DESC LIMIT 3'),
  holderOf: db.prepare('SELECT user_id FROM user_achievements WHERE code = ? LIMIT 1'),
};

/** Who holds a unique achievement (if anyone). */
export function holderOf(code: string): string | null {
  return (q.holderOf.get(code) as { user_id: string } | undefined)?.user_id ?? null;
}

export function listAchievements(userId: string) {
  return (q.list.all(userId) as { code: string; awarded_at: number }[])
    .filter((r) => byCode.has(r.code))
    .map((r) => ({ code: r.code, awardedAt: r.awarded_at }));
}

let onAwarded: (userId: string, code: string) => void = () => {};
export function setAwardListener(fn: (userId: string, code: string) => void) {
  onAwarded = fn;
}

/** Gives an achievement; returns true if it is new. Unique ones go to the first person only. */
export function award(userId: string, code: string): boolean {
  const def = byCode.get(code);
  if (!def) return false;
  if (def.unique) {
    const holder = holderOf(code);
    if (holder && holder !== userId) return false;
  }
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
  const games = q.gameTotals.get(userId) as { total: number; games: number };
  return {
    voiceSeconds: row?.voice_seconds ?? 0,
    streamsCount: row?.streams_count ?? 0,
    gameSeconds: games.total,
    gamesCount: games.games,
    topGames: q.topGames.all(userId) as { game: string; seconds: number }[],
  };
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
  /** Since when they've been alone in the room (null = not alone). */
  aloneSince: number | null;
}

/** Recent channel switches per user, for "hopper". */
const switches = new Map<string, number[]>();

/** Who is in voice right now, for time tracking. Keyed by user id. */
const sessions = new Map<string, Session>();

export function voiceJoined(userId: string, room: string) {
  if (!queries.userById.get(userId)) return;
  const now = Date.now();
  const prev = sessions.get(userId);
  if (prev && prev.room !== room) voiceLeft(userId, prev.room);
  if (!sessions.has(userId)) sessions.set(userId, { room, since: now, accounted: now, aloneSince: null });
  award(userId, 'first_steps');

  const h = localHour(now);
  if (h >= 6 && h < 7) award(userId, 'early_bird');

  const recent = [...(switches.get(userId) ?? []), now].filter((t) => now - t < 10 * 60_000);
  switches.set(userId, recent);
  if (recent.length >= 10) award(userId, 'hopper');
  checkTogether();
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
  if (now - s.since >= 8 * HOUR * 1000) award(userId, 'all_nighter');

  const alone = ![...sessions].some(([id, other]) => id !== userId && other.room === s.room);
  if (!alone) s.aloneSince = null;
  else {
    s.aloneSince ??= now;
    if (now - s.aloneSince >= HOUR * 1000) award(userId, 'echo_of_silence');
  }
  const h = localHour(now);
  if (h >= 3 && h < 5) award(userId, 'night_owl');
}

// ---------- prestige: rank from achievements ----------

const POINTS: Record<Rarity, number> = { common: 10, rare: 25, epic: 60, legendary: 150, unique: 200 };
/** Tier floors: none, bronze, silver, gold, legend. */
const TIERS = [0, 30, 100, 220, 400];

export interface Prestige {
  points: number;
  level: number;
  tier: number;
  nextTierAt: number | null;
  tierFloor: number;
}

export function prestigeFromPoints(points: number): Prestige {
  let tier = 0;
  while (tier + 1 < TIERS.length && points >= TIERS[tier + 1]!) tier++;
  return {
    points,
    // Grows quickly at first, slower later: 10 pts -> 1, 100 -> 4, 400 -> 8, 845 -> 11.
    level: Math.max(1, Math.floor(Math.sqrt(points / 6.5))),
    tier,
    nextTierAt: TIERS[tier + 1] ?? null,
    tierFloor: TIERS[tier]!,
  };
}

const allAwards = db.prepare('SELECT user_id, code FROM user_achievements');

/** Everyone's prestige in one query (used for channel/presence snapshots). */
export function prestigeMap(): Map<string, Prestige> {
  const pts = new Map<string, number>();
  for (const r of allAwards.all() as { user_id: string; code: string }[]) {
    const def = byCode.get(r.code);
    if (def) pts.set(r.user_id, (pts.get(r.user_id) ?? 0) + POINTS[def.rarity]);
  }
  return new Map([...pts].map(([id, p]) => [id, prestigeFromPoints(p)]));
}

export const prestigeOf = (userId: string) => prestigeMap().get(userId) ?? prestigeFromPoints(0);

/** Who holds which one-of-a-kind achievements (they get special looks everywhere). */
export function uniquesMap(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const r of allAwards.all() as { user_id: string; code: string }[]) {
    if (byCode.get(r.code)?.unique) out.set(r.user_id, [...(out.get(r.user_id) ?? []), r.code]);
  }
  return out;
}

// ---------- games ----------

interface GameSession {
  game: string;
  accounted: number;
}

/** What each online user is playing right now (reported by their client). */
const gameSessions = new Map<string, GameSession>();

function flushGame(userId: string, g: GameSession, now: number) {
  const secs = Math.floor((now - g.accounted) / 1000);
  if (secs > 0) {
    q.addGame.run(userId, g.game, secs);
    g.accounted += secs * 1000;
  }
  const { gameSeconds, gamesCount } = getStats(userId);
  if (gameSeconds >= 10 * HOUR) award(userId, 'game_10h');
  if (gameSeconds >= 100 * HOUR) award(userId, 'game_100h');
  if (gamesCount >= 5) award(userId, 'collector');
}

/** Called when a user's detected game changes (null = stopped / went offline). */
export function gameChanged(userId: string, game: string | null) {
  if (!queries.userById.get(userId)) return;
  const now = Date.now();
  const prev = gameSessions.get(userId);
  if (prev) {
    flushGame(userId, prev, now);
    gameSessions.delete(userId);
  }
  if (game) {
    gameSessions.set(userId, { game, accounted: now });
    q.addGame.run(userId, game, 0); // counts toward "different games" right away
    award(userId, 'gamer');
    if (getStats(userId).gamesCount >= 5) award(userId, 'collector');
  }
  checkTogether();
}

/** Squad: 3+ people in the same game. Teammates: same game and same voice channel. */
function checkTogether() {
  const byGame = new Map<string, string[]>();
  for (const [id, g] of gameSessions) byGame.set(g.game, [...(byGame.get(g.game) ?? []), id]);
  for (const ids of byGame.values()) {
    if (ids.length >= 3) for (const id of ids) award(id, 'squad');
    if (ids.length < 2) continue;
    const byRoom = new Map<string, string[]>();
    for (const id of ids) {
      const room = sessions.get(id)?.room;
      if (room) byRoom.set(room, [...(byRoom.get(room) ?? []), id]);
    }
    for (const together of byRoom.values()) if (together.length >= 2) for (const id of together) award(id, 'teammates');
  }
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
    for (const [id, g] of gameSessions) flushGame(id, g, now);
  }, 60_000).unref();
}
