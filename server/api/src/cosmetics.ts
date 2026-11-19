import { CATALOG, ownedMap, prestigeMap, prestigeFromPoints, type Prestige } from './achievements.ts';
import { queries, type User } from './db.ts';

/**
 * Cosmetics unlocked by progress. The server owns the rules (what is unlocked, what is
 * equipped); the client owns the looks and renders each item by its id.
 */
export type Slot = 'ring' | 'frame' | 'name' | 'plate';

export interface Unlock {
  /** Reach this level. */
  level?: number;
  /** Hold this achievement. */
  achievement?: string;
  /** Hold any one-of-a-kind achievement. */
  unique?: boolean;
  /** Only for the admin, or for staff (admin + moderators). The admin can also grant it. */
  role?: 'admin' | 'staff' | 'pioneer';
}

/** Where an item shows up in the Style tab. */
export type Group = 'basic' | 'level' | 'achievement' | 'pioneer' | 'exclusive';

export interface Cosmetic {
  id: string;
  slot: Slot;
  title: string;
  group: Group;
  unlock: Unlock;
}

export const SLOTS: { id: Slot; title: string }[] = [
  { id: 'frame', title: 'Рамка аватара' },
  { id: 'plate', title: 'Фон строки' },
  { id: 'name', title: 'Эффект ника' },
  { id: 'ring', title: 'Цвет кольца уровня' },
];

const free: Unlock = {};
const item = (slot: Slot, id: string, title: string, group: Group, unlock: Unlock = free): Cosmetic => ({ id, slot, title, group, unlock });

export const COSMETICS: Cosmetic[] = [
  // ---- level ring colors ("accent" follows the theme)
  item('ring', 'accent', 'Цвет темы', 'basic'),
  item('ring', 'cyan', 'Циан', 'basic'),
  item('ring', 'violet', 'Фиалка', 'basic'),
  item('ring', 'lime', 'Лайм', 'basic'),
  item('ring', 'rose', 'Роза', 'level', { level: 3 }),
  item('ring', 'amber', 'Янтарь', 'level', { level: 5 }),
  item('ring', 'white', 'Белый шум', 'level', { level: 7 }),
  item('ring', 'aurora', 'Аврора', 'level', { level: 9 }),
  item('ring', 'plasma', 'Плазма', 'level', { level: 13 }),
  item('ring', 'void', 'Горизонт событий', 'level', { level: 17 }),
  item('ring', 'ember', 'Угли', 'achievement', { achievement: 'streak_30' }),
  item('ring', 'prism', 'Призма', 'achievement', { unique: true }),

  // ---- avatar frames
  item('frame', 'none', 'Без рамки', 'basic'),
  item('frame', 'contour', 'Контур', 'basic'),
  item('frame', 'brackets', 'Скобки', 'basic'),
  item('frame', 'dotted', 'Пунктир', 'basic'),
  item('frame', 'scale', 'Шкала', 'basic'),
  item('frame', 'radar', 'Пеленг', 'level', { level: 3 }),
  item('frame', 'resonator', 'Резонатор', 'level', { level: 5 }),
  item('frame', 'impulse', 'Импульсный контур', 'level', { level: 9 }),
  item('frame', 'accretion', 'Аккреционный диск', 'level', { level: 13 }),
  item('frame', 'horizon', 'Горизонт событий', 'level', { level: 17 }),
  item('frame', 'owl', 'Полуночник', 'achievement', { achievement: 'night_owl_10' }),
  item('frame', 'eternal', 'Неугасимый', 'achievement', { achievement: 'streak_30' }),
  item('frame', 'onair', 'Прямой эфир', 'achievement', { achievement: 'stream_50' }),
  item('frame', 'legend', 'Голос легенды', 'achievement', { achievement: 'voice_100h' }),
  item('frame', 'five', 'Пятёрка', 'achievement', { achievement: 'squad_5' }),
  item('frame', 'prism', 'Призма', 'achievement', { unique: true }),
  item('frame', 'pioneer', 'Первопроходец', 'pioneer', { role: 'pioneer' }),
  item('frame', 'circle', 'Круг своих', 'pioneer', { achievement: 'p_regular_guest' }),
  item('frame', 'bughunter', 'Прицел', 'pioneer', { achievement: 'p_game_night' }),
  item('frame', 'architect', 'Архитектор', 'exclusive', { role: 'admin' }),
  item('frame', 'guardian', 'Страж', 'exclusive', { role: 'staff' }),

  // ---- nameplates (row background in lists)
  item('plate', 'none', 'Без фона', 'basic'),
  item('plate', 'line', 'Линия', 'basic'),
  item('plate', 'gradient', 'Градиент', 'basic'),
  item('plate', 'scanline', 'Развёртка', 'level', { level: 5 }),
  item('plate', 'datastream', 'Поток данных', 'level', { level: 9 }),
  item('plate', 'horizon', 'Горизонт', 'level', { level: 17 }),
  item('plate', 'stars', 'Ночное небо', 'achievement', { achievement: 'new_year' }),
  item('plate', 'flame', 'Пламя', 'achievement', { achievement: 'streak_30' }),
  item('plate', 'air', 'Эфир', 'achievement', { achievement: 'stream_50' }),
  item('plate', 'topo', 'Карта первопроходца', 'pioneer', { role: 'pioneer' }),
  item('plate', 'campfire', 'Костёр', 'pioneer', { achievement: 'p_long_awaited' }),
  item('plate', 'goldcode', 'Золотой код', 'exclusive', { role: 'admin' }),
  item('plate', 'shield', 'Щит', 'exclusive', { role: 'staff' }),

  // ---- nickname effects
  item('name', 'none', 'Обычный', 'basic'),
  item('name', 'glow', 'Свечение', 'basic'),
  item('name', 'gradient', 'Градиент', 'basic'),
  item('name', 'scan', 'Сканер', 'level', { level: 9 }),
  item('name', 'glitch', 'Глитч', 'level', { level: 13 }),
  item('name', 'chrome', 'Хром', 'level', { level: 17 }),
  item('name', 'holo', 'Голограмма', 'achievement', { unique: true }),
  item('name', 'pioneer', 'Первопроходец', 'pioneer', { role: 'pioneer' }),
  item('name', 'sunset', 'Закат', 'pioneer', { achievement: 'p_weekend' }),
  item('name', 'crown', 'Корона', 'exclusive', { role: 'admin' }),
  item('name', 'guard', 'Страж', 'exclusive', { role: 'staff' }),
];

/** Items the admin can hand out manually ("slot:id"). */
export const GRANTABLE = COSMETICS.filter((x) => x.group === 'exclusive').map((x) => `${x.slot}:${x.id}`);

export interface Style {
  ring: string;
  frame: string;
  name: string;
  plate: string;
}

export const DEFAULT_STYLE: Style = { ring: 'accent', frame: 'none', name: 'none', plate: 'none' };

const find = (slot: Slot, id: string) => COSMETICS.find((c) => c.slot === slot && c.id === id);

export function isUnlocked(c: Cosmetic, prestige: Prestige, owned: Set<string>, hasUnique: boolean, role: 0 | 1 | 2 = 0, pioneer = false): boolean {
  const u = c.unlock;
  // Friends-only items need access in any case (staff always have it).
  if (c.group === 'pioneer' && !pioneer && role < 1) return false;
  if (u.role === 'pioneer' && !pioneer && role < 1) return false;
  if (u.role === 'admin' && role < 2) return false;
  if (u.role === 'staff' && role < 1) return false;
  if (u.level && prestige.level < u.level) return false;
  if (u.achievement && !owned.has(u.achievement)) return false;
  if (u.unique && !hasUnique) return false;
  return true;
}

export function parseGrants(json: string | null | undefined): Set<string> {
  try {
    const v = JSON.parse(json ?? '[]') as unknown;
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && GRANTABLE.includes(x)) : []);
  } catch {
    return new Set();
  }
}

/** Admin gives or takes an exclusive item. */
export function setGrant(userId: string, key: string, on: boolean) {
  if (!GRANTABLE.includes(key)) throw new Error('Этот предмет нельзя выдать вручную');
  const row = queries.userById.get(userId) as User | undefined;
  const set = parseGrants(row?.cosmetics_granted);
  if (on) set.add(key);
  else set.delete(key);
  queries.setGrants.run(JSON.stringify([...set]), userId);
  return [...set];
}

function parseStyle(json: string | null | undefined): Partial<Style> {
  try {
    const v = JSON.parse(json ?? '{}') as unknown;
    return v && typeof v === 'object' ? (v as Partial<Style>) : {};
  } catch {
    return {};
  }
}

/** Builds the per-user context once, so snapshots don't re-query for every person. */
export function styleContext() {
  const prestige = prestigeMap();
  const owned = ownedMap();
  // The admin (server owner) has everything open, no grinding needed. Moderators get the
  // staff items; anyone can additionally hold exclusive items the admin granted to them.
  const users = queries.listUsers.all() as unknown as User[];
  const roles = new Map(users.map((u) => [u.id, (u.is_admin ? 2 : u.is_moderator ? 1 : 0) as 0 | 1 | 2]));
  const grants = new Map(users.map((u) => [u.id, parseGrants(u.cosmetics_granted)]));
  const pioneers = new Set(users.filter((u) => u.is_pioneer).map((u) => u.id));
  const open = (userId: string, x: Cosmetic, p: Prestige, have: Set<string>, hasUnique: boolean) =>
    roles.get(userId) === 2 ||
    !!grants.get(userId)?.has(`${x.slot}:${x.id}`) ||
    isUnlocked(x, p, have, hasUnique, roles.get(userId) ?? 0, pioneers.has(userId));
  return {
    /** Equipped style, with anything no longer unlocked falling back to the default. */
    resolve(userId: string, json: string | null | undefined): Style {
      const p = prestige.get(userId) ?? prestigeFromPoints(0);
      const have = owned.get(userId) ?? new Set<string>();
      const hasUnique = [...have].some((code) => UNIQUE_CODES.has(code));
      const want = parseStyle(json);
      const out = { ...DEFAULT_STYLE };
      for (const slot of ['ring', 'frame', 'name', 'plate'] as const) {
        const id = want[slot];
        const c = typeof id === 'string' ? find(slot, id) : undefined;
        if (c && open(userId, c, p, have, hasUnique)) out[slot] = c.id;
      }
      return out;
    },
    /** The full catalog with unlock state for one user. */
    catalog(userId: string) {
      const p = prestige.get(userId) ?? prestigeFromPoints(0);
      const have = owned.get(userId) ?? new Set<string>();
      const hasUnique = [...have].some((code) => UNIQUE_CODES.has(code));
      // Friends-only items are not even listed for people without access.
      const access = pioneers.has(userId) || (roles.get(userId) ?? 0) > 0;
      return COSMETICS.filter((x) => access || x.group !== 'pioneer').map((x) => ({
        ...x,
        unlocked: open(userId, x, p, have, hasUnique),
      }));
    },
  };
}

const UNIQUE_CODES = new Set(CATALOG.filter((a) => a.unique).map((a) => a.code));

export function styleOf(userId: string): Style {
  const row = queries.styleStatus.get(userId) as { style: string } | undefined;
  return styleContext().resolve(userId, row?.style);
}

/** Equips items; refuses anything locked. Returns the resulting style. */
export function equip(userId: string, patch: Partial<Record<Slot, string>>): Style {
  const ctx = styleContext();
  const row = queries.styleStatus.get(userId) as { style: string } | undefined;
  const current = ctx.resolve(userId, row?.style);
  const unlocked = ctx.catalog(userId);
  for (const slot of ['ring', 'frame', 'name', 'plate'] as const) {
    const id = patch[slot];
    if (id === undefined) continue;
    const c = unlocked.find((x) => x.slot === slot && x.id === id);
    if (!c) throw new Error('Нет такого предмета');
    if (!c.unlocked) throw new Error(`«${c.title}» ещё не открыт`);
    current[slot] = id;
  }
  queries.setStyle.run(JSON.stringify(current), userId);
  return current;
}

// ---------- status ----------

export type StatusState = 'online' | 'away' | 'dnd';

export interface Status {
  state: StatusState;
  text: string;
  emoji: string;
}

export const DEFAULT_STATUS: Status = { state: 'online', text: '', emoji: '' };

export function parseStatus(json: string | null | undefined): Status {
  try {
    const v = JSON.parse(json ?? '{}') as Partial<Status>;
    return {
      state: v.state === 'away' || v.state === 'dnd' ? v.state : 'online',
      text: typeof v.text === 'string' ? v.text.slice(0, 64) : '',
      emoji: typeof v.emoji === 'string' ? v.emoji.slice(0, 16) : '',
    };
  } catch {
    return { ...DEFAULT_STATUS };
  }
}

export function setStatus(userId: string, status: Status) {
  queries.setStatus.run(JSON.stringify(status), userId);
}
