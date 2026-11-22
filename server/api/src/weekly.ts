import { db, queries, type User } from './db.ts';

/**
 * Weekly life of the server: per-week counters (for the weekly recap and challenges),
 * the activity heat map, "who talked the most tonight" (crowns) and duo quests.
 * Everything is keyed by the server's local time (Europe/Moscow by default).
 */

const TZ = process.env.ECHO_TZ ?? 'Europe/Moscow';
const HOUR = 3600;

function local(ms: number) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short' })
      .formatToParts(ms)
      .map((x) => [x.type, x.value]),
  ) as Record<string, string>;
  const dow = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday!);
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), dow };
}

/** ISO week key like "2026-W47" (Monday-based). */
export function weekKey(ms = Date.now()): string {
  const { day } = local(ms);
  const d = new Date(`${day}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow + 3); // Thursday of this week decides the year
  const year = d.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week = 1 + Math.round(((d.getTime() - jan4.getTime()) / 86_400_000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}
export const lastWeekKey = () => weekKey(Date.now() - 7 * 86_400_000);

/** Monday 00:00 .. next Monday (ms) of the week containing `ms`, in server time. */
export function weekRange(ms = Date.now()) {
  const { day, dow, hour } = local(ms);
  // The zone's offset from UTC (whole hours, true for Moscow), so midnight is local midnight.
  const hourStart = Math.floor(ms / 3_600_000) * 3_600_000;
  const offset = Date.parse(`${day}T${String(hour).padStart(2, '0')}:00:00Z`) - hourStart;
  const start = Date.parse(`${day}T00:00:00Z`) - offset - dow * 86_400_000;
  return { start, end: start + 7 * 86_400_000 };
}

/** "Evening" day: from 06:00 to 06:00, so a late night still belongs to the evening it started. */
export const eveningKey = (ms = Date.now()) => local(ms - 6 * HOUR * 1000).day;
/** Current hour (0–23) in server time. */
export const localHour = (ms = Date.now()) => local(ms).hour;

db.exec(`
  CREATE TABLE IF NOT EXISTS user_weeks (
    user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    week     TEXT NOT NULL,
    voice_s  INTEGER NOT NULL DEFAULT 0,
    talk_s   INTEGER NOT NULL DEFAULT 0,
    game_s   INTEGER NOT NULL DEFAULT 0,
    together_game_s INTEGER NOT NULL DEFAULT 0,
    stream_s INTEGER NOT NULL DEFAULT 0,
    streams  INTEGER NOT NULL DEFAULT 0,
    messages INTEGER NOT NULL DEFAULT 0,
    days     INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, week)
  );
  CREATE TABLE IF NOT EXISTS pair_weeks (
    a TEXT NOT NULL, b TEXT NOT NULL, week TEXT NOT NULL,
    seconds INTEGER NOT NULL DEFAULT 0,
    days    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (a, b, week)
  );
  CREATE TABLE IF NOT EXISTS game_weeks (
    user_id TEXT NOT NULL, week TEXT NOT NULL, game TEXT NOT NULL,
    seconds INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, week, game)
  );
  -- voice seconds per weekday (0 = Monday) and hour, for the heat map
  CREATE TABLE IF NOT EXISTS voice_heat (
    user_id TEXT NOT NULL, week TEXT NOT NULL, dow INTEGER NOT NULL, hour INTEGER NOT NULL,
    voice_s INTEGER NOT NULL DEFAULT 0,
    talk_s  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, week, dow, hour)
  );
  -- per "evening" (06:00–06:00): who talked / streamed the most (crowns)
  CREATE TABLE IF NOT EXISTS user_evenings (
    user_id TEXT NOT NULL, evening TEXT NOT NULL,
    talk_s   INTEGER NOT NULL DEFAULT 0,
    stream_s INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, evening)
  );
  CREATE TABLE IF NOT EXISTS user_challenges (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    week TEXT NOT NULL, code TEXT NOT NULL, done_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, week, code)
  );
  CREATE TABLE IF NOT EXISTS duo_quests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    a TEXT NOT NULL, b TEXT NOT NULL, week TEXT NOT NULL,
    kind TEXT NOT NULL, target INTEGER NOT NULL,
    started_by TEXT NOT NULL, created_at INTEGER NOT NULL, done_at INTEGER,
    UNIQUE (a, b, week)
  );
`);

let achievementsInStmt: ReturnType<typeof db.prepare> | undefined;
const q = {
  addWeek: (col: string) =>
    db.prepare(
      `INSERT INTO user_weeks (user_id, week, ${col}) VALUES (?, ?, ?) ON CONFLICT(user_id, week) DO UPDATE SET ${col} = ${col} + excluded.${col}`,
    ),
  orDays: db.prepare(
    'INSERT INTO user_weeks (user_id, week, days) VALUES (?, ?, ?) ON CONFLICT(user_id, week) DO UPDATE SET days = days | excluded.days',
  ),
  addPair: db.prepare(
    `INSERT INTO pair_weeks (a, b, week, seconds, days) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(a, b, week) DO UPDATE SET seconds = seconds + excluded.seconds, days = days | excluded.days`,
  ),
  addGame: db.prepare(
    'INSERT INTO game_weeks (user_id, week, game, seconds) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, week, game) DO UPDATE SET seconds = seconds + excluded.seconds',
  ),
  addHeat: db.prepare(
    `INSERT INTO voice_heat (user_id, week, dow, hour, voice_s, talk_s) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, week, dow, hour) DO UPDATE SET voice_s = voice_s + excluded.voice_s, talk_s = talk_s + excluded.talk_s`,
  ),
  addEvening: db.prepare(
    `INSERT INTO user_evenings (user_id, evening, talk_s, stream_s) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, evening) DO UPDATE SET talk_s = talk_s + excluded.talk_s, stream_s = stream_s + excluded.stream_s`,
  ),
  week: db.prepare('SELECT * FROM user_weeks WHERE user_id = ? AND week = ?'),
  partnersWeek: db.prepare(
    'SELECT CASE WHEN a = ? THEN b ELSE a END AS other, seconds, days FROM pair_weeks WHERE (a = ? OR b = ?) AND week = ? ORDER BY seconds DESC',
  ),
  pairWeek: db.prepare('SELECT seconds, days FROM pair_weeks WHERE a = ? AND b = ? AND week = ?'),
  gamesWeek: db.prepare('SELECT game, seconds FROM game_weeks WHERE user_id = ? AND week = ? ORDER BY seconds DESC LIMIT 3'),
  heat: db.prepare('SELECT dow, hour, voice_s, talk_s FROM voice_heat WHERE user_id = ? AND week = ?'),
  evening: db.prepare('SELECT user_id, talk_s, stream_s FROM user_evenings WHERE evening = ?'),
  done: db.prepare('SELECT code FROM user_challenges WHERE user_id = ? AND week = ?'),
  markDone: db.prepare('INSERT OR IGNORE INTO user_challenges (user_id, week, code, done_at) VALUES (?, ?, ?, ?)'),
  doneCounts: db.prepare('SELECT user_id, COUNT(*) AS n FROM user_challenges GROUP BY user_id'),
  doneCount: db.prepare('SELECT COUNT(*) AS n FROM user_challenges WHERE user_id = ?'),
  questsOf: db.prepare('SELECT * FROM duo_quests WHERE (a = ? OR b = ?) AND week = ? ORDER BY id'),
  questFor: db.prepare('SELECT * FROM duo_quests WHERE a = ? AND b = ? AND week = ?'),
  insertQuest: db.prepare(
    'INSERT INTO duo_quests (a, b, week, kind, target, started_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ),
  finishQuest: db.prepare('UPDATE duo_quests SET done_at = ? WHERE id = ? AND done_at IS NULL'),
  questDoneCounts: db.prepare(
    `SELECT id, n FROM (
       SELECT a AS id, COUNT(*) AS n FROM duo_quests WHERE done_at IS NOT NULL GROUP BY a
       UNION ALL
       SELECT b AS id, COUNT(*) AS n FROM duo_quests WHERE done_at IS NOT NULL GROUP BY b)`,
  ),
  questDoneCount: db.prepare('SELECT COUNT(*) AS n FROM duo_quests WHERE done_at IS NOT NULL AND (a = ? OR b = ?)'),
  // user_achievements is created by achievements.ts, which loads after this module: prepare lazily.
  get achievementsIn() {
    return (achievementsInStmt ??= db.prepare('SELECT code, awarded_at FROM user_achievements WHERE user_id = ? AND awarded_at >= ? AND awarded_at < ? ORDER BY awarded_at'));
  },
};
const add = {
  voice_s: q.addWeek('voice_s'),
  talk_s: q.addWeek('talk_s'),
  game_s: q.addWeek('game_s'),
  together_game_s: q.addWeek('together_game_s'),
  stream_s: q.addWeek('stream_s'),
  streams: q.addWeek('streams'),
  messages: q.addWeek('messages'),
};

/** Seconds a single "I'm talking" ping stands for (the client sends at most one per 15 s while talking). */
export const TALK_PING_S = 15;

let onChange: (userId: string) => void = () => {};
/** Called when something that could complete a challenge / quest changed. */
export function setWeeklyListener(fn: (userId: string) => void) {
  onChange = fn;
}

// ---------------- recording ----------------

export function recordVoice(userId: string, secs: number, othersInRoom: string[]) {
  if (secs <= 0) return;
  const now = Date.now();
  const w = weekKey(now);
  const t = local(now);
  add.voice_s.run(userId, w, secs);
  q.orDays.run(userId, w, 1 << t.dow);
  q.addHeat.run(userId, w, t.dow, t.hour, secs, 0);
  for (const other of othersInRoom) {
    if (userId < other) q.addPair.run(userId, other, w, secs, 1 << t.dow);
  }
  onChange(userId);
}

export function recordTalk(userId: string) {
  const now = Date.now();
  const w = weekKey(now);
  const t = local(now);
  add.talk_s.run(userId, w, TALK_PING_S);
  q.addHeat.run(userId, w, t.dow, t.hour, 0, TALK_PING_S);
  q.addEvening.run(userId, eveningKey(now), TALK_PING_S, 0);
  onChange(userId);
}

export function recordGame(userId: string, game: string, secs: number, withFriendsInVoice: boolean) {
  if (secs <= 0) return;
  const w = weekKey();
  add.game_s.run(userId, w, secs);
  q.addGame.run(userId, w, game, secs);
  if (withFriendsInVoice) add.together_game_s.run(userId, w, secs);
  onChange(userId);
}

export function recordStreamStart(userId: string) {
  add.streams.run(userId, weekKey(), 1);
  onChange(userId);
}

export function recordStreamTime(userId: string, secs: number) {
  if (secs <= 0) return;
  add.stream_s.run(userId, weekKey(), secs);
  q.addEvening.run(userId, eveningKey(), 0, secs);
}

export function recordMessage(userId: string) {
  add.messages.run(userId, weekKey(), 1);
  onChange(userId);
}

// ---------------- weekly challenges ----------------

interface WeekRow {
  voice_s: number;
  talk_s: number;
  game_s: number;
  together_game_s: number;
  stream_s: number;
  streams: number;
  messages: number;
  days: number;
}

const bits = (n: number) => n.toString(2).replace(/0/g, '').length;

type ChallengeMetric = 'voiceH' | 'talkH' | 'days' | 'messages' | 'streams' | 'partners' | 'togetherGameH';

interface ChallengeKind {
  metric: ChallengeMetric;
  title: (n: number) => string;
  targets: number[];
  unit: string;
}

const KINDS: ChallengeKind[] = [
  { metric: 'voiceH', title: (n) => `Проведи в голосе ${n} ч`, targets: [3, 5, 8], unit: 'ч' },
  { metric: 'talkH', title: (n) => `Наговори ${n} ч`, targets: [1, 2, 3], unit: 'ч' },
  { metric: 'days', title: (n) => `Зайди в голос в ${n} разных дня`, targets: [3, 4], unit: 'дн' },
  { metric: 'messages', title: (n) => `Напиши ${n} сообщений в чат`, targets: [30, 60, 100], unit: 'сообщ.' },
  { metric: 'streams', title: (n) => `Запусти ${n} ${n === 1 ? 'трансляцию' : 'трансляции'}`, targets: [1, 2, 3], unit: 'эфиров' },
  { metric: 'partners', title: (n) => `Посиди в голосе с ${n} разными людьми`, targets: [2, 3, 4], unit: 'чел' },
  { metric: 'togetherGameH', title: (n) => `Поиграй ${n} ч, сидя в голосе с друзьями`, targets: [2, 4, 6], unit: 'ч' },
];

/** Deterministic little RNG so everyone gets the same three challenges each week. */
function seeded(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return ((h >>> 0) % 10000) / 10000;
  };
}

export interface Challenge {
  code: string;
  title: string;
  metric: ChallengeMetric;
  target: number;
  unit: string;
}

export function challengesFor(week = weekKey()): Challenge[] {
  const rnd = seeded(`echo-${week}`);
  const pool = [...KINDS];
  const out: Challenge[] = [];
  while (out.length < 3 && pool.length) {
    const kind = pool.splice(Math.floor(rnd() * pool.length), 1)[0]!;
    const target = kind.targets[Math.floor(rnd() * kind.targets.length)]!;
    out.push({ code: `${kind.metric}_${target}`, title: kind.title(target), metric: kind.metric, target, unit: kind.unit });
  }
  return out;
}

function metricsWeek(userId: string, week: string): Record<ChallengeMetric, number> {
  const r = (q.week.get(userId, week) as WeekRow | undefined) ?? {
    voice_s: 0, talk_s: 0, game_s: 0, together_game_s: 0, stream_s: 0, streams: 0, messages: 0, days: 0,
  };
  const partners = (q.partnersWeek.all(userId, userId, userId, week) as { seconds: number }[]).filter((p) => p.seconds >= 300).length;
  return {
    voiceH: Math.floor(r.voice_s / HOUR),
    talkH: Math.floor(r.talk_s / HOUR),
    days: bits(r.days),
    messages: r.messages,
    streams: r.streams,
    partners,
    togetherGameH: Math.floor(r.together_game_s / HOUR),
  };
}

/** Challenge progress for a week; newly completed ones are recorded. Returns the newly done codes. */
export function checkChallenges(userId: string, week = weekKey()) {
  const m = metricsWeek(userId, week);
  const done = new Set((q.done.all(userId, week) as { code: string }[]).map((r) => r.code));
  const fresh: string[] = [];
  for (const c of challengesFor(week)) {
    if (!done.has(c.code) && m[c.metric] >= c.target) {
      q.markDone.run(userId, week, c.code, Date.now());
      fresh.push(c.code);
    }
  }
  return fresh;
}

export function challengeState(userId: string, week = weekKey()) {
  const m = metricsWeek(userId, week);
  const done = new Set((q.done.all(userId, week) as { code: string }[]).map((r) => r.code));
  const { end } = weekRange();
  return {
    week,
    endsAt: end,
    items: challengesFor(week).map((c) => ({ ...c, value: Math.min(m[c.metric], c.target), done: done.has(c.code) })),
    totalDone: (q.doneCount.get(userId) as { n: number }).n,
  };
}

// ---------------- duo quests ----------------

const QUEST_KINDS = [
  { kind: 'hours', title: (n: number) => `Проведите вместе в голосе ${n} ч за неделю`, targets: [3, 5] },
  { kind: 'evenings', title: (n: number) => `Соберитесь вместе в голосе в ${n} разных дня`, targets: [3, 4] },
];

const pairOf = (x: string, y: string) => (x < y ? [x, y] : [y, x]) as [string, string];

interface QuestRow {
  id: number;
  a: string;
  b: string;
  week: string;
  kind: string;
  target: number;
  started_by: string;
  created_at: number;
  done_at: number | null;
}

function questView(r: QuestRow, me: string) {
  const pw = (q.pairWeek.get(r.a, r.b, r.week) as { seconds: number; days: number } | undefined) ?? { seconds: 0, days: 0 };
  const value = r.kind === 'hours' ? Math.floor(pw.seconds / HOUR) : bits(pw.days);
  const k = QUEST_KINDS.find((x) => x.kind === r.kind)!;
  return {
    id: r.id,
    with: r.a === me ? r.b : r.a,
    title: k.title(r.target),
    target: r.target,
    value: Math.min(value, r.target),
    unit: r.kind === 'hours' ? 'ч' : 'дн',
    done: !!r.done_at,
    startedBy: r.started_by,
  };
}

export function questsOf(userId: string, week = weekKey()) {
  return (q.questsOf.all(userId, userId, week) as unknown as QuestRow[]).map((r) => questView(r, userId));
}

/** One quest per pair per week; the kind is random. */
export function startQuest(userId: string, friendId: string) {
  if (userId === friendId) throw new Error('Квест — на двоих');
  if (!queries.userById.get(friendId)) throw new Error('Пользователь не найден');
  const week = weekKey();
  const [a, b] = pairOf(userId, friendId);
  if (q.questFor.get(a, b, week)) throw new Error('С этим другом квест на эту неделю уже есть');
  const mine = questsOf(userId, week).filter((x) => !x.done).length;
  if (mine >= 3) throw new Error('Не больше трёх активных квестов в неделю');
  const k = QUEST_KINDS[Math.floor(Math.random() * QUEST_KINDS.length)]!;
  const target = k.targets[Math.floor(Math.random() * k.targets.length)]!;
  q.insertQuest.run(a, b, week, k.kind, target, userId, Date.now());
  return questsOf(userId, week).find((x) => x.with === friendId)!;
}

/** Completes quests whose target is reached; returns the pairs that just finished. */
export function checkQuests(userId: string) {
  const week = weekKey();
  const finished: [string, string][] = [];
  for (const r of q.questsOf.all(userId, userId, week) as unknown as QuestRow[]) {
    if (r.done_at) continue;
    const v = questView(r, userId);
    if (v.value >= r.target) {
      q.finishQuest.run(Date.now(), r.id);
      finished.push([r.a, r.b]);
    }
  }
  return finished;
}

export const questsDone = (userId: string) => (q.questDoneCount.get(userId, userId) as { n: number }).n;
export const challengesDone = (userId: string) => (q.doneCount.get(userId) as { n: number }).n;

/** Bonus points toward the level: 25 per weekly challenge, 40 per finished duo quest. */
export function bonusPoints(): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of q.doneCounts.all() as { user_id: string; n: number }[]) out.set(r.user_id, (out.get(r.user_id) ?? 0) + r.n * 25);
  for (const r of q.questDoneCounts.all() as { id: string; n: number }[]) out.set(r.id, (out.get(r.id) ?? 0) + r.n * 40);
  return out;
}

// ---------------- crowns of the evening ----------------

export interface Crowns {
  talk: string | null;
  stream: string | null;
}

const CROWN_MIN = { talk: 20 * 60, stream: 30 * 60 };

/** Tonight's leaders; until tonight has one, yesterday's keeps the crown. */
/** Crown holders of one specific evening (no carry-over from the day before). */
export function crownOfEvening(evening: string): Crowns {
  const rows = q.evening.all(evening) as { user_id: string; talk_s: number; stream_s: number }[];
  const best = (col: 'talk_s' | 'stream_s', min: number) =>
    rows.filter((r) => r[col] >= min).sort((x, y) => y[col] - x[col])[0]?.user_id ?? null;
  return { talk: best('talk_s', CROWN_MIN.talk), stream: best('stream_s', CROWN_MIN.stream) };
}

export function crowns(): Crowns {
  const pick = (evening: string, col: 'talk_s' | 'stream_s', min: number) => {
    const rows = q.evening.all(evening) as { user_id: string; talk_s: number; stream_s: number }[];
    const best = rows.filter((r) => r[col] >= min).sort((x, y) => y[col] - x[col])[0];
    return best?.user_id ?? null;
  };
  const tonight = eveningKey();
  const yesterday = eveningKey(Date.now() - 86_400_000);
  return {
    talk: pick(tonight, 'talk_s', CROWN_MIN.talk) ?? pick(yesterday, 'talk_s', CROWN_MIN.talk),
    stream: pick(tonight, 'stream_s', CROWN_MIN.stream) ?? pick(yesterday, 'stream_s', CROWN_MIN.stream),
  };
}

// ---------------- weekly recap ----------------

export function recap(userId: string, week = lastWeekKey()) {
  const r = (q.week.get(userId, week) as WeekRow | undefined) ?? null;
  const partners = (q.partnersWeek.all(userId, userId, userId, week) as { other: string; seconds: number }[]).slice(0, 3);
  const nick = (id: string) => (queries.userById.get(id) as User | undefined)?.nickname ?? 'кто-то';
  // The week's time range for "achievements earned this week".
  const [y, wn] = week.split('-W').map(Number) as [number, number];
  const jan4 = Date.UTC(y, 0, 4);
  const monday = jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * 86_400_000 + (wn - 1) * 7 * 86_400_000;
  const achievements = q.achievementsIn.all(userId, monday - 4 * HOUR * 1000, monday + 7 * 86_400_000) as { code: string }[];
  const heat = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  let talkHeatTotal = 0;
  for (const h of q.heat.all(userId, week) as { dow: number; hour: number; voice_s: number; talk_s: number }[]) {
    heat[h.dow]![h.hour] = Math.round(h.voice_s / 60);
    talkHeatTotal += h.talk_s;
  }
  const done = (q.done.all(userId, week) as { code: string }[]).map((x) => x.code);
  return {
    week,
    empty: !r || (r.voice_s === 0 && r.messages === 0 && r.game_s === 0),
    voiceMinutes: Math.round((r?.voice_s ?? 0) / 60),
    talkMinutes: Math.round((r?.talk_s ?? talkHeatTotal) / 60),
    gameMinutes: Math.round((r?.game_s ?? 0) / 60),
    streams: r?.streams ?? 0,
    streamMinutes: Math.round((r?.stream_s ?? 0) / 60),
    messages: r?.messages ?? 0,
    days: bits(r?.days ?? 0),
    partners: partners.map((p) => ({ id: p.other, nickname: nick(p.other), minutes: Math.round(p.seconds / 60) })),
    games: (q.gamesWeek.all(userId, week) as { game: string; seconds: number }[]).map((g) => ({ game: g.game, minutes: Math.round(g.seconds / 60) })),
    achievements: achievements.map((a) => a.code),
    challenges: { done, total: challengesFor(week).length },
    heat,
  };
}
