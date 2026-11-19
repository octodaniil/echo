import { db, queries, type User } from './db.ts';

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary' | 'unique';
export type Category = 'special' | 'voice' | 'games' | 'stream' | 'social' | 'secret' | 'pioneers';

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
  /** Friends-only ("Первооткрыватели"): invisible to people without access. */
  pioneer?: boolean;
}

export const CATEGORIES: { id: Category; title: string }[] = [
  { id: 'special', title: 'Уникальные' },
  { id: 'voice', title: 'Голос' },
  { id: 'games', title: 'Игры' },
  { id: 'stream', title: 'Трансляции' },
  { id: 'social', title: 'Компания' },
  { id: 'secret', title: 'Секреты' },
  { id: 'pioneers', title: 'Первооткрыватели' },
];

const U = 'Такая ачивка может быть только у одного человека';

export const CATALOG: AchievementDef[] = [
  // ---------- unique: one holder, ever ----------
  { code: 'founder', title: 'Основатель', description: `Поднял свой сервер Echo. ${U}`, rarity: 'unique', category: 'special', icon: 'crown', unique: true },
  { code: 'beta_tester', title: 'Первый бета-тестер', description: `Был с Echo с самого начала и ловил баги первым. ${U}`, rarity: 'unique', category: 'special', icon: 'flask', manual: true, unique: true },
  { code: 'first_stream_ever', title: 'Первый эфир', description: `Самым первым на сервере запустил трансляцию. ${U}`, rarity: 'unique', category: 'special', icon: 'broadcast', unique: true },
  { code: 'pioneer_100h', title: 'Первопроходец', description: `Первым набрал 100 часов в голосе. ${U}`, rarity: 'unique', category: 'special', icon: 'flag', unique: true },
  { code: 'first_singularity', title: 'Сингулярность №1', description: `Первым дошёл до высшего ранга. ${U}`, rarity: 'unique', category: 'special', icon: 'singularity', unique: true },
  { code: 'first_secret', title: 'Взломщик', description: `Первым открыл секретную ачивку. ${U}`, rarity: 'unique', category: 'special', icon: 'key', unique: true },
  { code: 'first_museum', title: 'Музей', description: `Первым сыграл в 25 разных игр. ${U}`, rarity: 'unique', category: 'special', icon: 'stack', unique: true },
  { code: 'iron_streak', title: 'Несгибаемый', description: `Первым заходил в голос 30 дней подряд. ${U}`, rarity: 'unique', category: 'special', icon: 'flame', unique: true },

  // ---------- voice ----------
  { code: 'first_steps', title: 'Первые шаги', description: 'Впервые зашёл в голосовой канал', rarity: 'common', category: 'voice', icon: 'door' },
  { code: 'voice_1h', title: 'Разговорчивый', description: 'Провёл в голосе 1 час', rarity: 'common', category: 'voice', icon: 'wave' },
  { code: 'voice_10h', title: 'Душа компании', description: 'Провёл в голосе 10 часов', rarity: 'rare', category: 'voice', icon: 'waves' },
  { code: 'voice_100h', title: 'Легенда войса', description: 'Провёл в голосе 100 часов', rarity: 'legendary', category: 'voice', icon: 'infinity' },
  { code: 'voice_500h', title: 'Живёт в Echo', description: 'Провёл в голосе 500 часов', rarity: 'legendary', category: 'voice', icon: 'home' },
  { code: 'marathon', title: 'Марафонец', description: '4 часа подряд в одном канале', rarity: 'epic', category: 'voice', icon: 'timer' },
  { code: 'night_owl', title: 'Полуночник', description: 'Был в голосе между 3 и 5 утра', rarity: 'rare', category: 'voice', icon: 'moon' },
  { code: 'night_owl_10', title: 'Сова', description: 'Был в голосе глубокой ночью (3–5 утра) в 10 разных ночей', rarity: 'epic', category: 'voice', icon: 'owl' },
  { code: 'streak_7', title: 'Неделя в строю', description: 'Заходил в голос 7 дней подряд', rarity: 'rare', category: 'voice', icon: 'calendar' },
  { code: 'streak_30', title: 'Месяц в строю', description: 'Заходил в голос 30 дней подряд', rarity: 'legendary', category: 'voice', icon: 'flame' },
  { code: 'regular_100', title: 'Завсегдатай', description: 'Был в голосе в 100 разных дней', rarity: 'legendary', category: 'voice', icon: 'calendar' },

  // ---------- games ----------
  { code: 'gamer', title: 'Геймер', description: 'Запустил игру, пока Echo был включён', rarity: 'common', category: 'games', icon: 'gamepad' },
  { code: 'game_10h', title: 'Задрот', description: 'Наиграл 10 часов', rarity: 'rare', category: 'games', icon: 'joystick' },
  { code: 'game_100h', title: 'Не выключает компьютер', description: 'Наиграл 100 часов', rarity: 'legendary', category: 'games', icon: 'trophy' },
  { code: 'game_500h', title: 'Киберспортсмен', description: 'Наиграл 500 часов', rarity: 'legendary', category: 'games', icon: 'medal' },
  { code: 'collector', title: 'Коллекционер', description: 'Играл в 5 разных игр', rarity: 'rare', category: 'games', icon: 'stack' },
  { code: 'collector_15', title: 'Библиотекарь', description: 'Играл в 15 разных игр', rarity: 'epic', category: 'games', icon: 'stack' },
  { code: 'one_game_100h', title: 'Однолюб', description: 'Наиграл 100 часов в одной игре', rarity: 'epic', category: 'games', icon: 'heart' },
  { code: 'session_6h', title: 'Залип', description: '6 часов подряд в одной игре', rarity: 'epic', category: 'games', icon: 'timer' },
  { code: 'teammates', title: 'Тиммейты', description: 'Играли в одну игру, сидя в одном голосовом канале', rarity: 'rare', category: 'games', icon: 'handshake' },
  { code: 'squad', title: 'Отряд', description: 'Трое и больше одновременно в одной игре', rarity: 'epic', category: 'games', icon: 'shield' },
  { code: 'squad_5', title: 'Пятёрка', description: 'Пятеро в одной игре и в одном голосовом канале', rarity: 'legendary', category: 'games', icon: 'shield' },

  // ---------- streams ----------
  { code: 'streamer', title: 'В эфире', description: 'Запустил первую трансляцию', rarity: 'common', category: 'stream', icon: 'broadcast' },
  { code: 'stream_10', title: 'Стример', description: 'Провёл 10 трансляций', rarity: 'rare', category: 'stream', icon: 'signal' },
  { code: 'stream_50', title: 'Ведущий', description: 'Провёл 50 трансляций', rarity: 'epic', category: 'stream', icon: 'mic' },
  { code: 'stream_200', title: 'Телеканал', description: 'Провёл 200 трансляций', rarity: 'legendary', category: 'stream', icon: 'tv' },
  { code: 'stream_3h', title: 'Эфир без конца', description: 'Одна трансляция длиной 3 часа', rarity: 'epic', category: 'stream', icon: 'timer' },

  // ---------- company ----------
  { code: 'full_house', title: 'Полный сбор', description: 'Был в канале, где собрались 5 человек и больше', rarity: 'rare', category: 'social', icon: 'people' },
  { code: 'big_house', title: 'Аншлаг', description: 'Был в канале, где собрались 8 человек и больше', rarity: 'legendary', category: 'social', icon: 'people' },
  { code: 'met_5', title: 'Знакомства', description: 'Посидел в голосе с 5 разными людьми', rarity: 'rare', category: 'social', icon: 'handshake' },
  { code: 'met_all', title: 'Свой среди своих', description: 'Посидел в голосе с каждым на сервере (если вас хотя бы четверо)', rarity: 'epic', category: 'social', icon: 'globe' },
  { code: 'duo_100h', title: 'Неразлучные', description: '100 часов в голосе вместе с одним и тем же человеком', rarity: 'legendary', category: 'social', icon: 'heart' },

  // ---------- secret (masked until earned) ----------
  { code: 'echo_of_silence', title: 'Эхо тишины', description: 'Просидел час в голосовом канале совсем один', rarity: 'rare', category: 'secret', icon: 'echo', hidden: true },
  { code: 'ghost_town', title: 'Город-призрак', description: 'Просидел в канале один 3 часа подряд', rarity: 'epic', category: 'secret', icon: 'ghost', hidden: true },
  { code: 'early_bird', title: 'Ранняя пташка', description: 'Зашёл в голос между 6 и 7 утра', rarity: 'rare', category: 'secret', icon: 'sunrise', hidden: true },
  { code: 'all_nighter', title: 'Не спится', description: '8 часов подряд в одном канале', rarity: 'legendary', category: 'secret', icon: 'coffee', hidden: true },
  { code: 'hopper', title: 'Попрыгунчик', description: 'Сменил канал 10 раз за 10 минут', rarity: 'epic', category: 'secret', icon: 'shuffle', hidden: true },
  { code: 'midnight', title: 'Ровно в полночь', description: 'Зашёл в голос в 00:00', rarity: 'rare', category: 'secret', icon: 'moon', hidden: true },
  { code: 'leet', title: '1337', description: 'Был в голосе в 13:37', rarity: 'rare', category: 'secret', icon: 'terminal', hidden: true },
  { code: 'friday13', title: 'Пятница, 13', description: 'Был в голосе в пятницу 13-го', rarity: 'epic', category: 'secret', icon: 'cat', hidden: true },
  { code: 'new_year', title: 'С Новым годом!', description: 'Встретил Новый год в голосовом канале', rarity: 'legendary', category: 'secret', icon: 'sparkle', hidden: true },
  { code: 'comeback', title: 'Блудный сын', description: 'Вернулся в голос после 30 дней отсутствия', rarity: 'rare', category: 'secret', icon: 'door', hidden: true },

  // ---------- pioneers ("Первооткрыватели"): friends who drop in now and then ----------
  // Auto ones reward what an occasional friend actually does (dropping in, coming back,
  // a game night, a weekend or holiday together) so they keep up with daily regulars;
  // the honours are given by the admin / moderators.
  ...pioneers([
    // one of a kind — honours
    ['p_best_friend', 'Лучший друг', 'Особое место в компании — выдаёт админ', 'unique', 'heart', true],
    ['p_mascot', 'Талисман', 'Когда он в пати, всем везёт', 'unique', 'star', true],
    ['p_voice_of_reason', 'Голос разума', 'Тот, кого слушают, когда все спорят', 'unique', 'mic', true],
    ['p_soul', 'Душа Echo', 'Без него здесь было бы совсем не так', 'unique', 'sparkle', true],
    // legendary
    ['p_always_welcome', 'Всегда желанный гость', 'Заходит редко, но каждый раз — праздник', 'legendary', 'door', true],
    ['p_veteran_friend', 'Друг со стажем', 'Был в голосе в шести разных месяцах', 'legendary', 'calendar', false],
    ['p_party_maker', 'Собрал всех', 'Был в канале, где собрались шестеро и больше', 'legendary', 'people', false],
    ['p_clutch', 'Клатч века', 'Затащил так, что это обсуждали неделю', 'legendary', 'trophy', true],
    ['p_heart', 'Сердце компании', 'Без него созвоны уже не те', 'legendary', 'heart', true],
    // epic
    ['p_regular_guest', 'Свой человек', 'Был в голосе в трёх разных месяцах', 'epic', 'home', false],
    ['p_long_awaited', 'Долгожданный', 'Вернулся в голос после двух недель тишины', 'epic', 'flag', false],
    ['p_game_night', 'Игровая ночь', 'Два часа подряд в голосе с компанией из троих и больше', 'epic', 'gamepad', false],
    ['p_weekend', 'Выходные с друзьями', 'Был в голосе и в субботу, и в воскресенье одних выходных', 'epic', 'calendar', false],
    ['p_holiday', 'Праздник с друзьями', 'Был в голосе в праздник: Новый год, 23 февраля, 8 марта, 9 мая', 'epic', 'cake', false],
    ['p_mvp', 'MVP вечера', 'Лучший игрок вечера по мнению компании', 'epic', 'medal', true],
    ['p_meme_lord', 'Мем-лорд', 'Шутка, которую повторяют до сих пор', 'epic', 'star', true],
    ['p_peacemaker', 'Миротворец', 'Помирил всех после проигранной катки', 'epic', 'handshake', true],
    // rare
    ['p_crowd', 'Ворвался в тусовку', 'Зашёл, когда в канале уже сидели трое и больше', 'rare', 'broadcast', false],
    ['p_friday', 'Пятничный вечер', 'Был в голосе в пятницу после семи вечера', 'rare', 'moon', false],
    ['p_late', 'Опоздун', 'Опоздал на собранный созвон на целый час', 'rare', 'timer', true],
    ['p_afk', 'Ушёл за чаем', 'Весь созвон был AFK, но формально присутствовал', 'rare', 'coffee', true],
    ['p_echo_echo', 'Эхо-эхо', 'Забыл про колонки — и все услышали себя', 'rare', 'echo', true],
    ['p_muted_talk', 'Говорю в пустоту', 'Долго рассказывал что-то с выключенным микрофоном', 'rare', 'micoff', true],
    ['p_loudest', 'Громкость 200%', 'Самый громкий крик в истории канала', 'rare', 'wave', true],
    ['p_invite', 'Позвал друга', 'Привёл нового человека в Echo', 'rare', 'door', true],
    // common
    ['p_hello', 'Привет, Echo', 'Получил доступ к разделу «Первооткрыватели»', 'common', 'flag', false],
    ['p_drop_in', 'На огонёк', 'Заглянул в голос, где уже кто-то сидит', 'common', 'coffee', false],
    ['p_first_word', 'Первое слово', 'Написал первое сообщение в чат', 'common', 'chat', false],
    ['p_birthday', 'С днём рождения!', 'Поздравили всем каналом', 'common', 'cake', true],
    ['p_feedback', 'Отзыв', 'Рассказал, что думает о новой версии Echo', 'common', 'chat', true],
  ]),
];

function pioneers(rows: [string, string, string, Rarity, string, boolean][]): AchievementDef[] {
  return rows.map(([code, title, description, rarity, icon, manual]) => ({
    code,
    title,
    description,
    rarity,
    category: 'pioneers' as const,
    icon,
    pioneer: true,
    ...(manual ? { manual: true } : {}),
    ...(rarity === 'unique' ? { unique: true, description: `${description}. Такая может быть только у одного человека` } : {}),
  }));
}

/** What clients see: hidden achievements are masked unless the viewer has earned them;
 *  friends-only ones are left out entirely for people without access. */
export function catalogFor(ownedCodes: Set<string>, pioneerAccess = false) {
  return CATALOG.filter((a) => pioneerAccess || !a.pioneer).map((a) => {
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

  -- Days (server time zone) someone was in voice; night = also between 3 and 5 am.
  CREATE TABLE IF NOT EXISTS user_days (
    user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day      TEXT NOT NULL,
    night    INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, day)
  );

  -- Time spent in the same voice channel, per pair (a < b).
  CREATE TABLE IF NOT EXISTS user_pairs (
    a        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    b        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    seconds  INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (a, b)
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
  gameTotals: db.prepare(
    'SELECT COALESCE(SUM(seconds), 0) AS total, COUNT(*) AS games, COALESCE(MAX(seconds), 0) AS best FROM user_games WHERE user_id = ?',
  ),
  topGames: db.prepare('SELECT game, seconds FROM user_games WHERE user_id = ? ORDER BY seconds DESC LIMIT 3'),
  holderOf: db.prepare('SELECT user_id FROM user_achievements WHERE code = ? LIMIT 1'),
  markDay: db.prepare(
    'INSERT INTO user_days (user_id, day, night) VALUES (?, ?, ?) ON CONFLICT(user_id, day) DO UPDATE SET night = MAX(night, excluded.night)',
  ),
  days: db.prepare('SELECT day FROM user_days WHERE user_id = ? ORDER BY day DESC'),
  lastDayBefore: db.prepare('SELECT day FROM user_days WHERE user_id = ? AND day < ? ORDER BY day DESC LIMIT 1'),
  nights: db.prepare('SELECT COUNT(*) AS n FROM user_days WHERE user_id = ? AND night = 1'),
  addPair: db.prepare(
    'INSERT INTO user_pairs (a, b, seconds) VALUES (?, ?, ?) ON CONFLICT(a, b) DO UPDATE SET seconds = seconds + excluded.seconds',
  ),
  partners: db.prepare(
    'SELECT COUNT(*) AS n, COALESCE(MAX(seconds), 0) AS best FROM user_pairs WHERE (a = ? OR b = ?) AND seconds > 0',
  ),
  userCount: db.prepare('SELECT COUNT(*) AS n FROM users'),
};

/** Friends-only achievements go only to people who can see the section. */
export function awardFriend(userId: string, code: string) {
  const u = queries.userById.get(userId) as User | undefined;
  if (u && (u.is_pioneer || u.is_admin || u.is_moderator)) award(userId, code);
}

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
  if (!isNew) return false;
  onAwarded(userId, code);
  // Chain rules that depend on other achievements.
  if (def.hidden) award(userId, 'first_secret');
  if (prestigeOf(userId).tier >= 4) award(userId, 'first_singularity');
  return true;
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
  const games = q.gameTotals.get(userId) as { total: number; games: number; best: number };
  return {
    voiceSeconds: row?.voice_seconds ?? 0,
    streamsCount: row?.streams_count ?? 0,
    gameSeconds: games.total,
    gamesCount: games.games,
    bestGameSeconds: games.best,
    topGames: q.topGames.all(userId) as { game: string; seconds: number }[],
    streakDays: currentStreak(userId),
  };
}

// ---------- time helpers (server time zone, Europe/Moscow by default) ----------

const HOUR = 3600;
const TZ = process.env.ECHO_TZ ?? 'Europe/Moscow';

function localParts(ms: number) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      hourCycle: 'h23',
    })
      .formatToParts(ms)
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  return {
    day: `${parts.year}-${parts.month}-${parts.day}`,
    month: Number(parts.month),
    date: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: parts.weekday,
  };
}

const dayNumber = (day: string) => Math.floor(Date.parse(`${day}T00:00:00Z`) / 86_400_000);

/** Consecutive days (ending today or yesterday) with voice activity. */
function currentStreak(userId: string): number {
  const days = (q.days.all(userId) as { day: string }[]).map((r) => dayNumber(r.day));
  if (days.length === 0) return 0;
  const today = dayNumber(localParts(Date.now()).day);
  if (days[0]! < today - 1) return 0;
  let streak = 1;
  for (let i = 1; i < days.length && days[i] === days[i - 1]! - 1; i++) streak++;
  return streak;
}

/** Time-of-day secrets checked whenever someone is in voice. */
function checkClock(userId: string, now: number, justJoined: boolean) {
  const t = localParts(now);
  if (t.hour >= 3 && t.hour < 5) award(userId, 'night_owl');
  if (justJoined && t.hour >= 6 && t.hour < 7) award(userId, 'early_bird');
  if (justJoined && t.hour === 0 && t.minute === 0) award(userId, 'midnight');
  if (t.hour === 13 && t.minute === 37) award(userId, 'leet');
  if (t.weekday === 'Fri' && t.date === 13) award(userId, 'friday13');
  if ((t.month === 12 && t.date === 31 && t.hour === 23 && t.minute >= 30) || (t.month === 1 && t.date === 1 && t.hour === 0 && t.minute < 30)) {
    award(userId, 'new_year');
  }
}

/** Records today's voice day and checks streak / regular / night / comeback rules. */
function markDay(userId: string, now: number) {
  const t = localParts(now);
  const night = t.hour >= 3 && t.hour < 5 ? 1 : 0;
  const prev = q.lastDayBefore.get(userId, t.day) as { day: string } | undefined;
  q.markDay.run(userId, t.day, night);
  if (prev && dayNumber(t.day) - dayNumber(prev.day) >= 30) award(userId, 'comeback');

  const streak = currentStreak(userId);
  if (streak >= 7) award(userId, 'streak_7');
  if (streak >= 30) {
    award(userId, 'streak_30');
    award(userId, 'iron_streak');
  }
  if ((q.days.all(userId) as unknown[]).length >= 100) award(userId, 'regular_100');
  if ((q.nights.get(userId) as { n: number }).n >= 10) award(userId, 'night_owl_10');

  // friends who drop in now and then
  if (prev && dayNumber(t.day) - dayNumber(prev.day) >= 14) awardFriend(userId, 'p_long_awaited');
  const months = new Set((q.days.all(userId) as { day: string }[]).map((r) => r.day.slice(0, 7))).size;
  if (months >= 3) awardFriend(userId, 'p_regular_guest');
  if (months >= 6) awardFriend(userId, 'p_veteran_friend');
  if (t.weekday === 'Sun' && prev && dayNumber(t.day) - dayNumber(prev.day) === 1) awardFriend(userId, 'p_weekend');
  if (t.weekday === 'Fri' && t.hour >= 19) awardFriend(userId, 'p_friday');
  const md = `${t.month}-${t.date}`;
  if ((t.month === 1 && t.date <= 8) || (t.month === 12 && t.date === 31) || ['2-23', '3-8', '5-9'].includes(md)) {
    awardFriend(userId, 'p_holiday');
  }
}

// ---------- voice sessions ----------

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

function checkVoiceTotals(userId: string) {
  const { voiceSeconds } = getStats(userId);
  if (voiceSeconds >= 1 * HOUR) award(userId, 'voice_1h');
  if (voiceSeconds >= 10 * HOUR) award(userId, 'voice_10h');
  if (voiceSeconds >= 100 * HOUR) {
    award(userId, 'voice_100h');
    award(userId, 'pioneer_100h');
  }
  if (voiceSeconds >= 500 * HOUR) award(userId, 'voice_500h');
}

export function voiceJoined(userId: string, room: string) {
  if (!queries.userById.get(userId)) return;
  const now = Date.now();
  const prev = sessions.get(userId);
  if (prev && prev.room !== room) voiceLeft(userId, prev.room);
  if (!sessions.has(userId)) sessions.set(userId, { room, since: now, accounted: now, aloneSince: null });
  award(userId, 'first_steps');
  const others = [...sessions].filter(([id, s]) => id !== userId && s.room === room).length;
  if (others >= 1) awardFriend(userId, 'p_drop_in');
  if (others >= 3) awardFriend(userId, 'p_crowd');
  markDay(userId, now);
  checkClock(userId, now, true);

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
    // Time together, counted from the side of the lower id so each pair is added once.
    for (const [otherId, other] of sessions) {
      if (otherId !== userId && other.room === s.room && userId < otherId) q.addPair.run(userId, otherId, secs);
    }
  }
  checkVoiceTotals(userId);
  checkSocial(userId);
  if (now - s.since >= 4 * HOUR * 1000) award(userId, 'marathon');
  if (now - s.since >= 2 * HOUR * 1000 && [...sessions].filter(([id, o]) => id !== userId && o.room === s.room).length >= 2) {
    awardFriend(userId, 'p_game_night');
  }
  if (now - s.since >= 8 * HOUR * 1000) award(userId, 'all_nighter');

  const alone = ![...sessions].some(([id, other]) => id !== userId && other.room === s.room);
  if (!alone) s.aloneSince = null;
  else {
    s.aloneSince ??= now;
    if (now - s.aloneSince >= HOUR * 1000) award(userId, 'echo_of_silence');
    if (now - s.aloneSince >= 3 * HOUR * 1000) award(userId, 'ghost_town');
  }
  markDay(userId, now);
  checkClock(userId, now, false);
}

function checkSocial(userId: string) {
  const p = q.partners.get(userId, userId) as { n: number; best: number };
  if (p.n >= 5) award(userId, 'met_5');
  const total = (q.userCount.get() as { n: number }).n;
  if (total >= 4 && p.n >= total - 1) award(userId, 'met_all');
  if (p.best >= 100 * HOUR) award(userId, 'duo_100h');
}

// ---------- prestige: level and rank from achievement points ----------

const POINTS: Record<Rarity, number> = { common: 10, rare: 30, epic: 75, legendary: 200, unique: 300 };
/** Rank by level: Сигнал 1–4, Резонанс 5–8, Импульс 9–12, Квазар 13–16, Сингулярность 17+. */
const TIER_LEVELS = [1, 5, 9, 13, 17];

export interface Prestige {
  points: number;
  level: number;
  tier: number;
  /** Points where the current level starts / the next one begins (for the progress ring). */
  levelFloor: number;
  nextLevelAt: number;
  /** Level at which the next rank begins (null at the top). */
  nextTierLevel: number | null;
  // Kept for older clients.
  nextTierAt: number | null;
  tierFloor: number;
}

/** Level L needs 10·(L−1)² points: 10 → 2, 90 → 4, 640 → 9, 2560 → 17. */
const pointsForLevel = (level: number) => 10 * (level - 1) ** 2;

export function prestigeFromPoints(points: number): Prestige {
  const level = 1 + Math.floor(Math.sqrt(points / 10));
  let tier = 0;
  while (tier + 1 < TIER_LEVELS.length && level >= TIER_LEVELS[tier + 1]!) tier++;
  const nextTierLevel = TIER_LEVELS[tier + 1] ?? null;
  return {
    points,
    level,
    tier,
    levelFloor: pointsForLevel(level),
    nextLevelAt: pointsForLevel(level + 1),
    nextTierLevel,
    nextTierAt: nextTierLevel ? pointsForLevel(nextTierLevel) : null,
    tierFloor: pointsForLevel(TIER_LEVELS[tier]!),
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

/** All achievement codes per user (for cosmetic unlocks). */
export function ownedMap(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const r of allAwards.all() as { user_id: string; code: string }[]) {
    if (!out.has(r.user_id)) out.set(r.user_id, new Set());
    out.get(r.user_id)!.add(r.code);
  }
  return out;
}

// ---------- games ----------

interface GameSession {
  game: string;
  since: number;
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
  const { gameSeconds, gamesCount, bestGameSeconds } = getStats(userId);
  if (gameSeconds >= 10 * HOUR) award(userId, 'game_10h');
  if (gameSeconds >= 100 * HOUR) award(userId, 'game_100h');
  if (gameSeconds >= 500 * HOUR) award(userId, 'game_500h');
  if (bestGameSeconds >= 100 * HOUR) award(userId, 'one_game_100h');
  checkCollection(userId, gamesCount);
  if (now - g.since >= 6 * HOUR * 1000) award(userId, 'session_6h');
}

function checkCollection(userId: string, gamesCount: number) {
  if (gamesCount >= 5) award(userId, 'collector');
  if (gamesCount >= 15) award(userId, 'collector_15');
  if (gamesCount >= 25) award(userId, 'first_museum');
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
    gameSessions.set(userId, { game, since: now, accounted: now });
    q.addGame.run(userId, game, 0); // counts toward "different games" right away
    award(userId, 'gamer');
    checkCollection(userId, getStats(userId).gamesCount);
  }
  checkTogether();
}

/** Squad: 3+ in the same game. Teammates: same game + same channel (5 of them: "Пятёрка"). */
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
    for (const together of byRoom.values()) {
      if (together.length >= 2) for (const id of together) award(id, 'teammates');
      if (together.length >= 5) for (const id of together) award(id, 'squad_5');
    }
  }
}

/** Everyone currently in a room (to keep sessions in sync after restarts and for full_house). */
export function roomMembers(room: string, userIds: string[]) {
  for (const id of userIds) if (!sessions.has(id)) voiceJoined(id, room);
  if (userIds.length >= 5) for (const id of userIds) award(id, 'full_house');
  if (userIds.length >= 8) for (const id of userIds) award(id, 'big_house');
  if (userIds.length >= 6) for (const id of userIds) awardFriend(id, 'p_party_maker');
}

// ---------- streams ----------

/** When each running stream started. */
const streams = new Map<string, number>();

export function streamStarted(userId: string) {
  if (!queries.userById.get(userId)) return;
  q.addStream.run(userId);
  streams.set(userId, Date.now());
  award(userId, 'streamer');
  award(userId, 'first_stream_ever');
  const { streamsCount } = getStats(userId);
  if (streamsCount >= 10) award(userId, 'stream_10');
  if (streamsCount >= 50) award(userId, 'stream_50');
  if (streamsCount >= 200) award(userId, 'stream_200');
}

export function streamStopped(userId: string) {
  const since = streams.get(userId);
  streams.delete(userId);
  if (since && Date.now() - since >= 3 * HOUR * 1000) award(userId, 'stream_3h');
}

export function syncAdmins() {
  for (const u of queries.listUsers.all() as unknown as User[]) if (u.is_admin) award(u.id, 'founder');
}

/** Accrue voice/game time every minute so a restart loses at most a minute. */
export function startAchievementClock() {
  syncAdmins();
  setInterval(() => {
    const now = Date.now();
    for (const [id, s] of sessions) flush(id, s, now);
    for (const [id, g] of gameSessions) flushGame(id, g, now);
    for (const [id, since] of streams) if (now - since >= 3 * HOUR * 1000) award(id, 'stream_3h');
  }, 60_000).unref();
}

// ---------- progress toward countable achievements (never for secret ones) ----------

export interface Progress {
  value: number;
  target: number;
  unit: string;
}

export function progressOf(userId: string): Record<string, Progress> {
  const st = getStats(userId);
  const days = (q.days.all(userId) as unknown[]).length;
  const nights = (q.nights.get(userId) as { n: number }).n;
  const pairs = q.partners.get(userId, userId) as { n: number; best: number };
  const others = Math.max(0, (q.userCount.get() as { n: number }).n - 1);
  const h = (secs: number) => Math.floor(secs / HOUR);
  const out: Record<string, Progress> = {};
  const add = (code: string, value: number, target: number, unit: string) => {
    if (!byCode.get(code)?.hidden) out[code] = { value: Math.min(value, target), target, unit };
  };
  add('voice_1h', Math.floor(st.voiceSeconds / 60), 60, 'мин');
  add('voice_10h', h(st.voiceSeconds), 10, 'ч');
  add('voice_100h', h(st.voiceSeconds), 100, 'ч');
  add('pioneer_100h', h(st.voiceSeconds), 100, 'ч');
  add('voice_500h', h(st.voiceSeconds), 500, 'ч');
  add('game_10h', h(st.gameSeconds), 10, 'ч');
  add('game_100h', h(st.gameSeconds), 100, 'ч');
  add('game_500h', h(st.gameSeconds), 500, 'ч');
  add('one_game_100h', h(st.bestGameSeconds), 100, 'ч');
  add('collector', st.gamesCount, 5, 'игр');
  add('collector_15', st.gamesCount, 15, 'игр');
  add('first_museum', st.gamesCount, 25, 'игр');
  add('stream_10', st.streamsCount, 10, 'эфиров');
  add('stream_50', st.streamsCount, 50, 'эфиров');
  add('stream_200', st.streamsCount, 200, 'эфиров');
  add('streak_7', st.streakDays, 7, 'дн подряд');
  add('streak_30', st.streakDays, 30, 'дн подряд');
  add('iron_streak', st.streakDays, 30, 'дн подряд');
  add('regular_100', days, 100, 'дн');
  add('night_owl_10', nights, 10, 'ночей');
  add('met_5', pairs.n, 5, 'чел');
  if (others >= 3) add('met_all', pairs.n, others, 'чел');
  add('duo_100h', h(pairs.best), 100, 'ч');
  return out;
}
