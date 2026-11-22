import type { JSX } from 'preact';
import { RANK_NAMES } from './look';

/** Main color of each rank (emblem, labels). */
export const RANK_COLORS = ['#6fe3ff', '#29f0cf', '#5fe3b0', '#ff5c9a', '#b48cff', '#8fe3ff', '#5ab4ff', '#ffb02e', '#ff5cc8', '#ffd678'];

/** Ten emblems: from a simple chevron (Сигнал) to a black hole (Сингулярность). */
const EMBLEMS: (() => JSX.Element)[] = [
  () => <path d="M14 40 L32 28 L50 40" fill="none" stroke="#6fe3ff" stroke-width="4" />,
  () => (
    <g fill="none" stroke="#29f0cf" stroke-width="4">
      <path d="M14 44 L32 32 L50 44" />
      <path d="M14 32 L32 20 L50 32" />
    </g>
  ),
  () => (
    <g fill="none" stroke="#5fe3b0" stroke-width="3.5">
      <path d="M14 48 L32 36 L50 48" />
      <path d="M14 38 L32 26 L50 38" />
      <path d="M14 28 L32 16 L50 28" />
    </g>
  ),
  () => (
    <>
      <path d="M32 8 L54 32 L32 56 L10 32 Z" fill="none" stroke="#ff5c9a" stroke-width="3" />
      <path d="M32 18 L44 32 L32 46 L20 32 Z" fill="#ff5c9a" opacity=".55" />
    </>
  ),
  () => (
    <>
      <circle cx="32" cy="32" r="8" fill="url(#rVio)" />
      <ellipse cx="32" cy="32" rx="26" ry="8" fill="none" stroke="#b48cff" stroke-width="2.5" />
      <path d="M32 4 L34 24 L30 24 Z M32 60 L30 40 L34 40 Z" fill="#fff" />
    </>
  ),
  () => (
    <g filter="url(#rGlow)">
      <circle cx="32" cy="32" r="7" fill="#fff" />
      <path d="M32 32 L58 20 L58 26 Z M32 32 L6 44 L6 38 Z" fill="#8fe3ff" />
      <circle cx="32" cy="32" r="16" fill="none" stroke="#8fe3ff" stroke-width="1.5" stroke-dasharray="3 3" />
    </g>
  ),
  () => (
    <g filter="url(#rGlow)">
      <circle cx="32" cy="32" r="7" fill="url(#rIce)" />
      <g fill="none" stroke="#5ab4ff" stroke-width="2">
        <path d="M32 25 C14 10 14 54 32 39" />
        <path d="M32 25 C50 10 50 54 32 39" />
        <path d="M32 25 C4 0 4 64 32 39" opacity=".5" />
        <path d="M32 25 C60 0 60 64 32 39" opacity=".5" />
      </g>
    </g>
  ),
  () => (
    <g filter="url(#rGlow)">
      <circle cx="32" cy="32" r="9" fill="url(#rNova)" />
      <g stroke="#ffd36b" stroke-width="2.5" stroke-linecap="round">
        <path d="M32 4v12M32 48v12M4 32h12M48 32h12M12 12l8 8M44 44l8 8M52 12l-8 8M12 52l8-8" />
      </g>
      <circle cx="32" cy="32" r="18" fill="none" stroke="#ff8a3d" stroke-width="1.5" />
    </g>
  ),
  () => (
    <g filter="url(#rGlow)">
      <circle cx="32" cy="32" r="9" fill="url(#rHyper)" />
      <g fill="#ff5cc8">
        <path d="M32 0 L36 22 L28 22 Z" />
        <path d="M32 64 L28 42 L36 42 Z" />
      </g>
      <circle cx="32" cy="32" r="18" fill="none" stroke="#ff5cc8" stroke-width="2" />
      <circle cx="32" cy="32" r="26" fill="none" stroke="#7b2fff" stroke-width="1.5" stroke-dasharray="2 4" />
    </g>
  ),
  () => (
    <>
      <circle cx="32" cy="32" r="30" fill="url(#rLens)" />
      <circle cx="32" cy="32" r="11" fill="#000" stroke="#fff" stroke-width="1.5" />
      <ellipse cx="32" cy="32" rx="28" ry="7" fill="none" stroke="url(#rGold)" stroke-width="2.5" />
      <g fill="#fff">
        <circle cx="8" cy="14" r="1.2" />
        <circle cx="56" cy="50" r="1.4" />
        <circle cx="52" cy="10" r="1" />
      </g>
    </>
  ),
];

/** Gradients for the emblems: mounted once (with the frame defs). */
export function RankDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <defs>
        <linearGradient id="rGold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#fff1b8" />
          <stop offset=".45" stop-color="#ffc24a" />
          <stop offset="1" stop-color="#ff8a00" />
        </linearGradient>
        <linearGradient id="rVio" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#fff" />
          <stop offset=".45" stop-color="#b48cff" />
          <stop offset="1" stop-color="#4b1fa8" />
        </linearGradient>
        <linearGradient id="rIce" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#d6f6ff" />
          <stop offset=".5" stop-color="#5ab4ff" />
          <stop offset="1" stop-color="#1f5bd6" />
        </linearGradient>
        <linearGradient id="rNova" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stop-color="#ff3d00" />
          <stop offset=".55" stop-color="#ffb02e" />
          <stop offset="1" stop-color="#fff6d8" />
        </linearGradient>
        <linearGradient id="rHyper" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#fff" />
          <stop offset=".4" stop-color="#ff5cc8" />
          <stop offset="1" stop-color="#7b2fff" />
        </linearGradient>
        <radialGradient id="rLens" cx=".5" cy=".5" r=".5">
          <stop offset=".5" stop-color="#000" stop-opacity="0" />
          <stop offset=".58" stop-color="#ffd678" stop-opacity=".9" />
          <stop offset=".66" stop-color="#b48cff" stop-opacity=".6" />
          <stop offset="1" stop-color="#000" stop-opacity="0" />
        </radialGradient>
        <filter id="rGlow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1.6" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
    </svg>
  );
}

export function RankEmblem({ tier, size = 24, withTitle = true }: { tier: number; size?: number; withTitle?: boolean }) {
  const t = Math.max(0, Math.min(EMBLEMS.length - 1, tier));
  const draw = EMBLEMS[t]!;
  return (
    <svg class="rank-emblem" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      {withTitle && <title>{RANK_NAMES[t]}</title>}
      {draw()}
    </svg>
  );
}
