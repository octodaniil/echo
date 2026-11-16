import type { JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { AchievementCategory, AchievementDef, Prestige, Rarity } from '../../shared/types';

// ---------- catalog (loaded once per session) ----------

let catalog: AchievementDef[] | null = null;
export let categories: AchievementCategory[] = [];
let loading: Promise<AchievementDef[]> | null = null;
const listeners = new Set<(c: AchievementDef[]) => void>();

export function loadCatalog(): Promise<AchievementDef[]> {
  if (catalog) return Promise.resolve(catalog);
  loading ??= window.echo
    .getAchievementCatalog()
    .then((r) => {
      catalog = r.catalog;
      categories = r.categories ?? [];
      listeners.forEach((fn) => fn(r.catalog));
      return r.catalog;
    })
    .catch(() => {
      loading = null;
      return [];
    });
  return loading;
}

export function useCatalog(): AchievementDef[] {
  const [c, setC] = useState<AchievementDef[]>(catalog ?? []);
  useEffect(() => {
    listeners.add(setC);
    void loadCatalog();
    return () => listeners.delete(setC);
  }, []);
  return c;
}

export const RARITY_LABEL: Record<Rarity, string> = {
  common: 'Обычная',
  rare: 'Редкая',
  epic: 'Эпическая',
  legendary: 'Легендарная',
};

// ---------- icons (24x24 strokes) ----------

const ICONS: Record<string, JSX.Element> = {
  flask: (
    <>
      <path d="M9 3h6M10 3v6l-5.5 9.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3" />
      <path d="M7.5 15h9" />
    </>
  ),
  crown: <path d="M3 18h18M4 18 3 7l5 4 4-6 4 6 5-4-1 11" />,
  door: (
    <>
      <path d="M5 21V4a1 1 0 0 1 1-1h9l4 2v16" />
      <path d="M3 21h18M12 12h.01" />
    </>
  ),
  wave: <path d="M2 12h3l2-5 3 10 3-14 3 14 2-5h4" />,
  waves: (
    <>
      <path d="M2 9c2.5-3 5-3 7.5 0s5 3 7.5 0 3.5-2 5-1" />
      <path d="M2 15c2.5-3 5-3 7.5 0s5 3 7.5 0 3.5-2 5-1" />
    </>
  ),
  infinity: <path d="M12 12c-2-2.7-4-4-6-4a4 4 0 0 0 0 8c2 0 4-1.3 6-4Zm0 0c2 2.7 4 4 6 4a4 4 0 0 0 0-8c-2 0-4 1.3-6 4Z" />,
  timer: (
    <>
      <circle cx="12" cy="13" r="8" />
      <path d="M12 9v4l2.5 2.5M9 2h6" />
    </>
  ),
  moon: <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" />,
  broadcast: (
    <>
      <circle cx="12" cy="12" r="2" />
      <path d="M16.2 7.8a6 6 0 0 1 0 8.4M7.8 16.2a6 6 0 0 1 0-8.4M19 5a10 10 0 0 1 0 14M5 19A10 10 0 0 1 5 5" />
    </>
  ),
  signal: <path d="M4 20v-3M9 20v-7M14 20V9M19 20V4" />,
  people: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
};

export function AchievementIcon({ icon, size = 22 }: { icon: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {ICONS[icon] ?? ICONS.crown}
    </svg>
  );
}

/** Hexagonal badge, colored by rarity. */
export function Badge({
  def,
  size = 56,
  locked = false,
  title,
}: {
  def: AchievementDef;
  size?: number;
  locked?: boolean;
  title?: string;
}) {
  return (
    <span
      class={`badge r-${def.rarity}${locked ? ' locked' : ''}`}
      style={{ width: size, height: size * 1.1 }}
      title={title ?? `${def.title} — ${def.description}`}
    >
      <span class="badge-inner">
        <AchievementIcon icon={locked ? 'lock' : def.icon} size={Math.round(size * 0.42)} />
      </span>
    </span>
  );
}

/** Small row of pinned badges (hover card, member lists). */
export function PinnedBadges({ codes, size = 22 }: { codes: string[] | undefined; size?: number }) {
  const all = useCatalog();
  const defs = (codes ?? []).map((c) => all.find((a) => a.code === c)).filter((a): a is AchievementDef => !!a);
  if (defs.length === 0) return null;
  return (
    <span class="pinned-badges">
      {defs.map((d) => (
        <Badge key={d.code} def={d} size={size} />
      ))}
    </span>
  );
}

// ---------- prestige ----------

export const TIER_NAMES = ['Новичок', 'Бронза', 'Серебро', 'Золото', 'Легенда'];

export const tierOf = (p: Prestige | undefined) => p?.tier ?? 0;

/** Small level chip next to a nickname, colored by rank. */
export function LevelChip({ prestige }: { prestige: Prestige | undefined }) {
  if (!prestige || prestige.points <= 0) return null;
  return (
    <span class={`lvl lvl-t${prestige.tier}`} title={`${TIER_NAMES[prestige.tier]} · уровень ${prestige.level} · ${prestige.points} очков`}>
      {prestige.level}
    </span>
  );
}

// ---------- more icons for game achievements ----------
Object.assign(ICONS, {
  gamepad: (
    <>
      <path d="M6 11h4M8 9v4M15 12h.01M18 10h.01" />
      <path d="M17.3 5H6.7a4 4 0 0 0-3.95 3.4L2 14.6A3 3 0 0 0 7.2 17l1.3-1.5a2 2 0 0 1 1.5-.7h4a2 2 0 0 1 1.5.7L16.8 17a3 3 0 0 0 5.2-2.4l-.75-6.2A4 4 0 0 0 17.3 5Z" />
    </>
  ),
  joystick: (
    <>
      <path d="M21 17a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2Z" />
      <path d="M12 15V8" />
      <circle cx="12" cy="5" r="3" />
    </>
  ),
  trophy: (
    <>
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
      <path d="M6 3h12v6a6 6 0 0 1-12 0Z" />
      <path d="M10 15v3h4v-3M8 21h8" />
    </>
  ),
  stack: (
    <>
      <path d="m12 2 9 5-9 5-9-5Z" />
      <path d="m3 12 9 5 9-5M3 17l9 5 9-5" />
    </>
  ),
  handshake: (
    <>
      <path d="m11 17 2 2a1 1 0 1 0 3-3" />
      <path d="m14 14 2.5 2.5a1 1 0 1 0 3-3l-3.9-3.9a3 3 0 0 0-4.2 0l-.9.9a1 1 0 1 1-3-3l2.8-2.8a5.8 5.8 0 0 1 7 .9L21 7" />
      <path d="m21 3 1 11h-2M3 3 2 14l6.5 6.5a1 1 0 1 0 3-3M3 4h8" />
    </>
  ),
  shield: (
    <>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
});
