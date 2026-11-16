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

/** After earning a hidden achievement the catalog must be fetched again to reveal it. */
export function reloadCatalog(): Promise<AchievementDef[]> {
  catalog = null;
  loading = null;
  return loadCatalog();
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
  unique: 'Уникальная',
};

/** One-of-a-kind achievements: emblem on the avatar and a title under the name. */
export const UNIQUE_INFO: Record<string, { title: string; icon: string }> = {
  founder: { title: 'Основатель Echo', icon: 'crown' },
  beta_tester: { title: 'Первый бета-тестер', icon: 'flask' },
};

/** Small holographic emblem pinned to the avatar of a unique-achievement holder. */
export function Emblem({ uniques, size }: { uniques: string[] | undefined; size: number }) {
  const code = uniques?.find((c) => UNIQUE_INFO[c]);
  if (!code) return null;
  const info = UNIQUE_INFO[code]!;
  const px = Math.max(14, Math.round(size * 0.36));
  return (
    <span class="emblem" style={{ width: px, height: px }} title={info.title}>
      <AchievementIcon icon={info.icon} size={Math.round(px * 0.62)} />
    </span>
  );
}

/** "👑 Основатель Echo" lines under a nickname. */
export function UniqueTitles({ uniques }: { uniques: string[] | undefined }) {
  const list = (uniques ?? []).filter((c) => UNIQUE_INFO[c]);
  if (list.length === 0) return null;
  return (
    <span class="unique-titles">
      {list.map((c) => (
        <span key={c} class="unique-title">
          <AchievementIcon icon={UNIQUE_INFO[c]!.icon} size={12} />
          {UNIQUE_INFO[c]!.title}
        </span>
      ))}
    </span>
  );
}

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

// ---------- more icons for game, hidden and secret achievements ----------
Object.assign(ICONS, {
  question: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17h.01" />
    </>
  ),
  echo: (
    <>
      <circle cx="12" cy="12" r="2" />
      <path d="M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7" opacity="0.7" />
      <path d="M5.5 5.5a9.5 9.5 0 0 0 0 13M18.5 5.5a9.5 9.5 0 0 1 0 13" opacity="0.4" />
    </>
  ),
  sunrise: (
    <>
      <path d="M12 2v6M5.2 10.2l1.4 1.4M2 18h2M20 18h2M17.4 11.6l1.4-1.4M22 22H2M8 6l4-4 4 4" />
      <path d="M16 18a4 4 0 0 0-8 0" />
    </>
  ),
  coffee: (
    <>
      <path d="M17 8h1a4 4 0 1 1 0 8h-1" />
      <path d="M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z" />
      <path d="M6 2v2M10 2v2M14 2v2" />
    </>
  ),
  shuffle: (
    <>
      <path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6A4 4 0 0 1 16.1 6H22" />
      <path d="m18 2 4 4-4 4M2 6h1.9c1.5 0 2.9.9 3.6 2.2M22 18h-5.9a4 4 0 0 1-3.3-1.7l-.4-.6" />
      <path d="m18 14 4 4-4 4" />
    </>
  ),
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
