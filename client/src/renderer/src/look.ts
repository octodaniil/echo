import type { Look, Prestige } from '../../shared/types';

/** Ranks by level (server: 1–4, 5–8, 9–12, 13–16, 17+). */
export const RANK_NAMES = ['Сигнал', 'Резонанс', 'Импульс', 'Квазар', 'Сингулярность'];

export const rankName = (p: Prestige | undefined) => RANK_NAMES[p?.tier ?? 0] ?? RANK_NAMES[0]!;

/** 0..1 progress inside the current level. */
export function levelProgress(p: Prestige | undefined): number {
  if (!p || p.nextLevelAt === undefined || p.levelFloor === undefined) return 0;
  const span = p.nextLevelAt - p.levelFloor;
  return span > 0 ? Math.min(1, Math.max(0, (p.points - p.levelFloor) / span)) : 1;
}

/**
 * Ring colors: `c` is the solid color used for glows, numbers and name effects;
 * `bg` is what paints the ring itself (a gradient for the fancy ones).
 */
export const RINGS: Record<string, { c: string; bg?: string }> = {
  accent: { c: 'var(--accent)' },
  cyan: { c: '#3ad7ff' },
  violet: { c: '#a78bfa' },
  lime: { c: '#b6ff3a' },
  rose: { c: '#ff5c9a' },
  amber: { c: '#ffb02e' },
  white: { c: '#eef4fb' },
  aurora: { c: '#5ef0d8', bg: 'conic-gradient(from 200deg, #29f0cf, #7b61ff, #ff5cc8, #29f0cf)' },
  plasma: { c: '#ff5cc8', bg: 'conic-gradient(from 90deg, #ff3cac, #784ba0, #2b86c5, #ff3cac)' },
  void: { c: '#b9a4ff', bg: 'conic-gradient(from 0deg, #000, #3b1e8a, #b9a4ff, #fff, #3b1e8a, #000)' },
  ember: { c: '#ff7a1a', bg: 'conic-gradient(from 30deg, #ff3d00, #ffb02e, #ff6a00, #ffd36b, #ff3d00)' },
  prism: { c: '#ffe08a', bg: 'var(--holo)' },
};

export const DEFAULT_LOOK: Look = { ring: 'accent', frame: 'none', name: 'none', plate: 'none' };

export function ringOf(look: Look | undefined) {
  const r = RINGS[look?.ring ?? 'accent'] ?? RINGS.accent!;
  return { c: r.c, bg: r.bg ?? r.c };
}

/** CSS variables every look-aware element uses. */
export function lookVars(look: Look | undefined): Record<string, string> {
  const r = ringOf(look);
  return { '--rc': r.c, '--rbg': r.bg };
}
