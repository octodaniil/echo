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
}

export interface Cosmetic {
  id: string;
  slot: Slot;
  title: string;
  unlock: Unlock;
}

export const SLOTS: { id: Slot; title: string }[] = [
  { id: 'ring', title: 'Цвет кольца' },
  { id: 'frame', title: 'Рамка аватара' },
  { id: 'name', title: 'Эффект ника' },
  { id: 'plate', title: 'Фон в списке' },
];

const free: Unlock = {};

export const COSMETICS: Cosmetic[] = [
  // Level ring colors ("accent" follows the theme).
  { id: 'accent', slot: 'ring', title: 'Цвет темы', unlock: free },
  { id: 'cyan', slot: 'ring', title: 'Циан', unlock: free },
  { id: 'violet', slot: 'ring', title: 'Фиалка', unlock: free },
  { id: 'lime', slot: 'ring', title: 'Лайм', unlock: free },
  { id: 'rose', slot: 'ring', title: 'Роза', unlock: { level: 3 } },
  { id: 'amber', slot: 'ring', title: 'Янтарь', unlock: { level: 5 } },
  { id: 'white', slot: 'ring', title: 'Белый шум', unlock: { level: 7 } },
  { id: 'aurora', slot: 'ring', title: 'Аврора', unlock: { level: 9 } },
  { id: 'plasma', slot: 'ring', title: 'Плазма', unlock: { level: 13 } },
  { id: 'void', slot: 'ring', title: 'Горизонт событий', unlock: { level: 17 } },
  { id: 'ember', slot: 'ring', title: 'Угли', unlock: { achievement: 'streak_30' } },
  { id: 'prism', slot: 'ring', title: 'Призма', unlock: { unique: true } },

  // Avatar frames.
  { id: 'none', slot: 'frame', title: 'Без рамки', unlock: free },
  { id: 'neon', slot: 'frame', title: 'Неон', unlock: { level: 3 } },
  { id: 'circuit', slot: 'frame', title: 'Схема', unlock: { level: 6 } },
  { id: 'orbit', slot: 'frame', title: 'Орбита', unlock: { level: 9 } },
  { id: 'glitch', slot: 'frame', title: 'Глитч', unlock: { level: 12 } },
  { id: 'radar', slot: 'frame', title: 'Радар', unlock: { achievement: 'night_owl_10' } },
  { id: 'eclipse', slot: 'frame', title: 'Затмение', unlock: { level: 17 } },
  { id: 'crown', slot: 'frame', title: 'Корона', unlock: { unique: true } },

  // Nickname effects.
  { id: 'none', slot: 'name', title: 'Обычный', unlock: free },
  { id: 'glow', slot: 'name', title: 'Свечение', unlock: { level: 4 } },
  { id: 'gradient', slot: 'name', title: 'Градиент', unlock: { level: 8 } },
  { id: 'scan', slot: 'name', title: 'Сканер', unlock: { level: 11 } },
  { id: 'glitch', slot: 'name', title: 'Глитч', unlock: { level: 15 } },
  { id: 'holo', slot: 'name', title: 'Голограмма', unlock: { unique: true } },

  // Nameplate behind the row in member lists.
  { id: 'none', slot: 'plate', title: 'Без фона', unlock: free },
  { id: 'grid', slot: 'plate', title: 'Сетка', unlock: { level: 5 } },
  { id: 'scanline', slot: 'plate', title: 'Развёртка', unlock: { level: 10 } },
  { id: 'aurora', slot: 'plate', title: 'Аврора', unlock: { level: 14 } },
  { id: 'stars', slot: 'plate', title: 'Звёзды', unlock: { achievement: 'new_year' } },
  { id: 'sunrise', slot: 'plate', title: 'Рассвет', unlock: { achievement: 'early_bird' } },
  { id: 'stream', slot: 'plate', title: 'Эфир', unlock: { achievement: 'stream_50' } },
];

export interface Style {
  ring: string;
  frame: string;
  name: string;
  plate: string;
}

export const DEFAULT_STYLE: Style = { ring: 'accent', frame: 'none', name: 'none', plate: 'none' };

const find = (slot: Slot, id: string) => COSMETICS.find((c) => c.slot === slot && c.id === id);

export function isUnlocked(c: Cosmetic, prestige: Prestige, owned: Set<string>, hasUnique: boolean): boolean {
  const u = c.unlock;
  if (u.level && prestige.level < u.level) return false;
  if (u.achievement && !owned.has(u.achievement)) return false;
  if (u.unique && !hasUnique) return false;
  return true;
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
  // The admin (server owner) has everything open, no grinding needed.
  const admins = new Set((queries.listUsers.all() as unknown as User[]).filter((u) => u.is_admin).map((u) => u.id));
  const open = (userId: string, c: Cosmetic, p: Prestige, have: Set<string>, hasUnique: boolean) =>
    admins.has(userId) || isUnlocked(c, p, have, hasUnique);
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
      return COSMETICS.map((c) => ({ ...c, unlocked: open(userId, c, p, have, hasUnique) }));
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
