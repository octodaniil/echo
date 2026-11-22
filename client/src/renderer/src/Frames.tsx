import type { JSX } from 'preact';

/**
 * Avatar frames, drawn as SVG in a 200×200 box where the picture is a circle of radius 48
 * in the middle (the level ring sits at ~54, frames start at ~62). Animations only run when
 * the frame has the `fx-anim` class (profile, tiles, previews); in lists they are still.
 */

/** Shared gradients and filters: mounted once in the page. */
export function FrameDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <defs>
        <linearGradient id="fGold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#fff1b8" />
          <stop offset=".45" stop-color="#ffc24a" />
          <stop offset="1" stop-color="#ff8a00" />
        </linearGradient>
        <linearGradient id="fBlue" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#d6f6ff" />
          <stop offset=".5" stop-color="#5ab4ff" />
          <stop offset="1" stop-color="#1f5bd6" />
        </linearGradient>
        <linearGradient id="fVio" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#ffffff" />
          <stop offset=".4" stop-color="#b48cff" />
          <stop offset="1" stop-color="#4b1fa8" />
        </linearGradient>
        <linearGradient id="fFire" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stop-color="#ff3d00" />
          <stop offset=".6" stop-color="#ffb02e" />
          <stop offset="1" stop-color="#fff3c0" />
        </linearGradient>
        <radialGradient id="fHole" cx=".5" cy=".5" r=".5">
          <stop offset=".55" stop-color="#000" stop-opacity="0" />
          <stop offset=".62" stop-color="#b48cff" stop-opacity=".9" />
          <stop offset=".7" stop-color="#ff9cf0" stop-opacity=".5" />
          <stop offset="1" stop-color="#000" stop-opacity="0" />
        </radialGradient>
        <linearGradient id="fHolo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#ff4fd8" />
          <stop offset=".25" stop-color="#ffe08a" />
          <stop offset=".5" stop-color="#2ef2d0" />
          <stop offset=".75" stop-color="#59a8ff" />
          <stop offset="1" stop-color="#b46cff" />
        </linearGradient>
        <filter id="fGlow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.2" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="fGlow2" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
        <linearGradient id="fNova" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stop-color="#ff3d00" />
          <stop offset=".55" stop-color="#ffb02e" />
          <stop offset="1" stop-color="#fff6d8" />
        </linearGradient>
        <linearGradient id="fHyper" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#fff" />
          <stop offset=".4" stop-color="#ff5cc8" />
          <stop offset="1" stop-color="#7b2fff" />
        </linearGradient>
        <radialGradient id="fLens" cx=".5" cy=".5" r=".5">
          <stop offset=".5" stop-color="#000" stop-opacity="0" />
          <stop offset=".58" stop-color="#ffd678" stop-opacity=".9" />
          <stop offset=".66" stop-color="#b48cff" stop-opacity=".6" />
          <stop offset="1" stop-color="#000" stop-opacity="0" />
        </radialGradient>
        <path id="fTxt" d="M100,100 m-86,0 a86,86 0 1,1 172,0 a86,86 0 1,1 -172,0" />
        <path id="fTxt2" d="M100,100 m-84,0 a84,84 0 1,1 168,0 a84,84 0 1,1 -168,0" />
      </defs>
    </svg>
  );
}

const C = (props: JSX.SVGAttributes<SVGCircleElement>) => <circle cx="100" cy="100" fill="none" {...props} />;

const BAR_H = [14, 10, 16, 9, 15, 11, 14, 9, 16, 12, 14, 10, 15, 9, 16, 11, 14, 10, 15, 9, 16, 12, 14, 10];

const FRAMES: Record<string, () => JSX.Element> = {
  contour: () => (
    <>
      <C r="62" stroke="#29f0cf" stroke-width="2.5" />
      <path d="M100 30v8M100 162v8M30 100h8M162 100h8" stroke="#29f0cf" stroke-width="2" />
    </>
  ),
  brackets: () => (
    <>
      <g fill="none" stroke="#29f0cf" stroke-width="3" stroke-linecap="square">
        <path d="M52 70 A58 58 0 0 1 70 52" />
        <path d="M130 52 A58 58 0 0 1 148 70" />
        <path d="M148 130 A58 58 0 0 1 130 148" />
        <path d="M70 148 A58 58 0 0 1 52 130" />
      </g>
      <C r="66" stroke="rgba(41,240,207,.25)" stroke-width="1" />
    </>
  ),
  dotted: () => (
    <>
      <C r="64" stroke="#29f0cf" stroke-width="2" stroke-dasharray="2 6" />
      <C r="70" stroke="rgba(41,240,207,.35)" stroke-width="1" />
      <circle cx="100" cy="30" r="3" fill="#29f0cf" />
    </>
  ),
  scale: () => (
    <>
      <C r="61" stroke="#29f0cf" stroke-width="1.5" />
      <C r="71" stroke="#29f0cf" stroke-width="1.5" stroke-dasharray="1 4.6" />
    </>
  ),
  radar: () => (
    <>
      <C r="62" stroke="#3ad7ff" stroke-width="2" />
      <C r="76" stroke="rgba(58,215,255,.25)" />
      <C r="88" stroke="rgba(58,215,255,.12)" />
      <g class="fx-spin fx-fast">
        <path d="M100 100 L100 12 A88 88 0 0 1 162 38 Z" fill="url(#fBlue)" opacity=".18" />
        <path d="M100 12 L100 38" stroke="#bff3ff" stroke-width="2" />
      </g>
      <circle cx="160" cy="70" r="3" fill="#bff3ff" class="fx-blink" />
    </>
  ),
  resonator: () => (
    <g filter="url(#fGlow)">
      <g class="fx-spin" fill="none" stroke-linecap="round">
        <path d="M100 36 A64 64 0 0 1 164 100" stroke="#29f0cf" stroke-width="3" />
        <path d="M100 164 A64 64 0 0 1 36 100" stroke="#29f0cf" stroke-width="3" />
      </g>
      <g class="fx-spin fx-rev" fill="none">
        <path d="M100 26 A74 74 0 0 1 174 100" stroke="#9ffcf0" stroke-width="1.5" stroke-dasharray="3 5" />
        <path d="M100 174 A74 74 0 0 1 26 100" stroke="#9ffcf0" stroke-width="1.5" stroke-dasharray="3 5" />
      </g>
      <g class="fx-spin fx-slow" fill="none">
        <path d="M162 58 A84 84 0 0 1 184 100" stroke="#29f0cf" stroke-width="2" />
        <path d="M38 142 A84 84 0 0 1 16 100" stroke="#29f0cf" stroke-width="2" />
      </g>
    </g>
  ),
  impulse: () => (
    <>
      <C r="64" stroke="rgba(255,92,154,.35)" stroke-width="5" />
      <C r="64" stroke="#ff5c9a" stroke-width="3" pathLength="100" stroke-dasharray="8 92" class="fx-flow" filter="url(#fGlow)" />
      <C r="64" stroke="#fff" stroke-width="3" pathLength="100" stroke-dasharray="2 48" class="fx-flow fx-quick" />
      <g class="fx-pulse">
        <C r="80" stroke="#ff5c9a" stroke-width="1" opacity=".6" />
      </g>
      <g fill="#ff5c9a">
        <path d="M100 18l5 8h-10z" />
        <path d="M182 100l-8 5v-10z" />
        <path d="M100 182l-5-8h10z" />
        <path d="M18 100l8-5v10z" />
      </g>
    </>
  ),
  accretion: () => (
    <>
      <g opacity=".85">
        <path d="M100 4 L106 60 L94 60 Z" fill="url(#fVio)" class="fx-pulse" />
        <path d="M100 196 L94 140 L106 140 Z" fill="url(#fVio)" class="fx-pulse" />
      </g>
      <ellipse cx="100" cy="100" rx="92" ry="26" fill="none" stroke="url(#fVio)" stroke-width="6" opacity=".35" filter="url(#fGlow2)" />
      <g class="fx-spin fx-fast">
        <ellipse cx="100" cy="100" rx="88" ry="22" fill="none" stroke="#ffb46b" stroke-width="2" stroke-dasharray="20 10 4 10" />
      </g>
      <ellipse cx="100" cy="100" rx="78" ry="17" fill="none" stroke="#b48cff" stroke-width="3" />
      <C r="62" stroke="#b48cff" stroke-width="2" />
    </>
  ),
  horizon: () => (
    <>
      <circle cx="100" cy="100" r="96" fill="url(#fHole)" class="fx-pulse" />
      <C r="64" stroke="#000" stroke-width="10" />
      <g class="fx-spin fx-fast">
        <C r="68" stroke="#fff" stroke-width="1.5" pathLength="100" stroke-dasharray="30 70" filter="url(#fGlow)" />
      </g>
      <g class="fx-spin fx-rev">
        <C r="74" stroke="#ff9cf0" stroke-width="1" pathLength="100" stroke-dasharray="10 15" />
      </g>
      <g class="fx-spin fx-slow">
        <circle cx="186" cy="100" r="2" fill="#fff" />
        <circle cx="30" cy="70" r="1.5" fill="#ffd36b" />
        <circle cx="60" cy="176" r="1.5" fill="#b48cff" />
        <circle cx="150" cy="30" r="1.2" fill="#fff" />
      </g>
    </>
  ),
  pulsar: () => (
    <>
      <C r="62" stroke="#8fe3ff" stroke-width="2.5" />
      <g class="fx-spin fx-fast" filter="url(#fGlow)">
        <path d="M100 100 L196 70 L196 84 Z" fill="#d6f6ff" opacity=".8" />
        <path d="M100 100 L4 130 L4 116 Z" fill="#d6f6ff" opacity=".8" />
      </g>
      <g fill="none" stroke="rgba(143,227,255,.35)">
        <ellipse cx="100" cy="100" rx="80" ry="40" />
        <ellipse cx="100" cy="100" rx="40" ry="80" />
      </g>
      <g class="fx-spin fx-slow fx-rev">
        <C r="74" stroke="#8fe3ff" stroke-width="1" stroke-dasharray="2 4" />
      </g>
    </>
  ),
  magnetar: () => (
    <>
      <g fill="none" stroke="url(#fBlue)" stroke-width="2.2" filter="url(#fGlow)">
        <path d="M100 38 C40 -10 40 210 100 162" />
        <path d="M100 38 C160 -10 160 210 100 162" />
        <path d="M100 38 C10 -40 10 240 100 162" opacity=".45" />
        <path d="M100 38 C190 -40 190 240 100 162" opacity=".45" />
      </g>
      <C r="62" stroke="url(#fBlue)" stroke-width="4" filter="url(#fGlow)" />
      <g stroke="#e6faff" stroke-width="2" fill="none" class="fx-zap">
        <path d="M150 50 l-8 10 l7 2 l-9 12" />
        <path d="M48 150 l8 -10 l-7 -2 l9 -12" />
      </g>
    </>
  ),
  supernova: () => (
    <>
      <C r="70" stroke="#ffb02e" stroke-width="3" class="fx-wave" />
      <C r="70" stroke="#ffd36b" stroke-width="2" class="fx-wave fx-wave2" />
      <C r="62" stroke="url(#fNova)" stroke-width="5" filter="url(#fGlow)" />
      <g class="fx-spin fx-slow" fill="#ffd36b">
        <circle cx="100" cy="14" r="2.5" />
        <circle cx="176" cy="66" r="2" />
        <circle cx="160" cy="160" r="3" />
        <circle cx="40" cy="168" r="2" />
        <circle cx="20" cy="80" r="2.5" />
        <circle cx="64" cy="24" r="1.6" />
        <circle cx="150" cy="30" r="1.8" />
      </g>
      <g stroke="#fff6d8" stroke-width="2" stroke-linecap="round" opacity=".8">
        <path d="M100 28v-10M172 100h10M100 172v10M28 100H18" />
      </g>
    </>
  ),
  hypernova: () => (
    <>
      <C r="96" stroke="url(#fHyper)" stroke-width="10" opacity=".25" filter="url(#fGlow2)" />
      <g class="fx-pulse" filter="url(#fGlow)">
        <path d="M100 0 L108 52 L92 52 Z" fill="url(#fHyper)" />
        <path d="M100 200 L92 148 L108 148 Z" fill="url(#fHyper)" />
      </g>
      <C r="74" stroke="#ff5cc8" stroke-width="2" class="fx-wave" />
      <C r="74" stroke="#7b2fff" stroke-width="2" class="fx-wave fx-wave2" />
      <g class="fx-spin fx-fast">
        <C r="68" stroke="#fff" stroke-width="1.5" pathLength="100" stroke-dasharray="15 35" filter="url(#fGlow)" />
      </g>
      <C r="62" stroke="url(#fHyper)" stroke-width="4" />
    </>
  ),
  absolute: () => (
    <>
      <circle cx="100" cy="100" r="98" fill="url(#fLens)" class="fx-pulse" />
      <g class="fx-spin fx-slow">
        <text font-family="JetBrains Mono, monospace" font-size="8" font-weight="700" letter-spacing="3" fill="#ffd678" opacity=".8">
          <textPath href="#fTxt">LEVEL 50 // SINGULARITY // ABSOLUTE // LEVEL 50 // SINGULARITY // ABSOLUTE //</textPath>
        </text>
      </g>
      <ellipse cx="100" cy="100" rx="94" ry="24" fill="none" stroke="url(#fGold)" stroke-width="5" opacity=".35" filter="url(#fGlow2)" />
      <g class="fx-spin fx-fast">
        <ellipse cx="100" cy="100" rx="90" ry="20" fill="none" stroke="url(#fGold)" stroke-width="2" stroke-dasharray="24 8 4 8" />
      </g>
      <C r="64" stroke="#000" stroke-width="10" />
      <g class="fx-spin">
        <C r="68" stroke="#fff" stroke-width="1.8" pathLength="100" stroke-dasharray="40 60" filter="url(#fGlow)" />
      </g>
      <C r="61" stroke="url(#fGold)" stroke-width="2.5" />
      <g class="fx-spin fx-slow fx-rev" fill="#fff">
        <circle cx="180" cy="40" r="2" class="fx-twinkle" />
        <circle cx="24" cy="160" r="2.4" class="fx-twinkle" />
        <circle cx="170" cy="168" r="1.6" class="fx-twinkle" />
        <circle cx="30" cy="34" r="1.4" class="fx-twinkle" />
      </g>
      <g transform="translate(100 26)" filter="url(#fGlow)">
        <path d="M0 -10 L3 -3 L10 0 L3 3 L0 10 L-3 3 L-10 0 L-3 -3 Z" fill="#fff" />
      </g>
    </>
  ),
  bond: () => (
    <>
      <g filter="url(#fGlow)" fill="none" stroke-width="3">
        <circle cx="88" cy="100" r="62" stroke="#29f0cf" />
        <circle cx="112" cy="100" r="62" stroke="#ff7ab8" />
      </g>
      <g class="fx-spin fx-slow">
        <circle cx="100" cy="30" r="4" fill="#fff" />
        <circle cx="100" cy="170" r="4" fill="#fff" />
      </g>
      <path d="M100 34 C 84 24, 86 8, 100 17 C 114 8, 116 24, 100 34 Z" fill="#ff7ab8" stroke="#fff" stroke-width="1.5" filter="url(#fGlow)" />
    </>
  ),
  owl: () => (
    <>
      <C r="64" stroke="#7d8cff" stroke-width="2" />
      <g class="fx-spin fx-slow">
        <path d="M100 14 a16 16 0 1 0 14 24 a12 12 0 1 1 -14 -24z" fill="#ffe7a6" filter="url(#fGlow)" />
      </g>
      <g fill="#fff">
        <circle cx="40" cy="50" r="1.5" class="fx-twinkle" />
        <circle cx="160" cy="60" r="1.2" class="fx-twinkle" style={{ animationDelay: '-1s' }} />
        <circle cx="150" cy="160" r="1.6" class="fx-twinkle" style={{ animationDelay: '-.4s' }} />
        <circle cx="34" cy="140" r="1.2" class="fx-twinkle" style={{ animationDelay: '-1.8s' }} />
      </g>
    </>
  ),
  eternal: () => (
    <>
      <g class="fx-flick" filter="url(#fGlow)" fill="url(#fFire)">
        <path d="M100 22 C108 38 116 40 112 56 C120 48 124 40 122 30 C134 46 132 60 124 68 Z" opacity=".9" />
        <path d="M60 40 C62 56 70 60 64 74 C74 68 78 58 76 48 C86 62 82 76 72 82 Z" opacity=".85" />
        <path d="M140 40 C138 56 130 60 136 74 C126 68 122 58 124 48 C114 62 118 76 128 82 Z" opacity=".85" />
      </g>
      <C r="64" stroke="url(#fFire)" stroke-width="4" />
      <C r="70" stroke="#ff7a1a" stroke-width="1" opacity=".5" />
    </>
  ),
  onair: () => (
    <>
      <C r="64" stroke="#ff3d8b" stroke-width="2.5" />
      <g fill="none" stroke="#ff3d8b" stroke-linecap="round">
        <path d="M28 70 A80 80 0 0 0 28 130" stroke-width="2.5" class="fx-pulse" />
        <path d="M14 58 A96 96 0 0 0 14 142" stroke-width="1.5" opacity=".6" class="fx-pulse" style={{ animationDelay: '-.6s' }} />
        <path d="M172 70 A80 80 0 0 1 172 130" stroke-width="2.5" class="fx-pulse" />
        <path d="M186 58 A96 96 0 0 1 186 142" stroke-width="1.5" opacity=".6" class="fx-pulse" style={{ animationDelay: '-.6s' }} />
      </g>
      <rect x="80" y="160" width="40" height="14" fill="#ff3d8b" />
      <circle cx="87" cy="167" r="3" fill="#fff" class="fx-blink" />
      <text x="93" y="171" font-family="JetBrains Mono, monospace" font-size="9" font-weight="700" fill="#fff">
        REC
      </text>
    </>
  ),
  legend: () => (
    <>
      <g class="fx-bars" fill="#39ff9c">
        {BAR_H.map((h, i) => (
          <g key={i} transform={`rotate(${i * 15} 100 100)`}>
            <rect x="98" y={34 - h} width="4" height={h} style={{ animationDelay: `${-((i * 37) % 9) / 10}s` }} />
          </g>
        ))}
      </g>
      <C r="62" stroke="#39ff9c" stroke-width="2.5" filter="url(#fGlow)" />
    </>
  ),
  five: () => (
    <>
      <C r="62" stroke="#ffc24a" stroke-width="2" />
      <g class="fx-spin">
        <polygon points="100,18 178,75 148,166 52,166 22,75" fill="none" stroke="rgba(255,194,74,.45)" stroke-width="1.2" />
        <g fill="#ffc24a" filter="url(#fGlow)">
          <circle cx="100" cy="18" r="5" />
          <circle cx="178" cy="75" r="5" />
          <circle cx="148" cy="166" r="5" />
          <circle cx="52" cy="166" r="5" />
          <circle cx="22" cy="75" r="5" />
        </g>
      </g>
    </>
  ),
  prism: () => (
    <>
      <g class="fx-spin fx-fast">
        <C r="66" stroke="url(#fHolo)" stroke-width="6" filter="url(#fGlow)" />
      </g>
      <g class="fx-spin fx-rev fx-slow" fill="url(#fHolo)" opacity=".85">
        <path d="M100 10 l6 14 -6 6 -6 -6z" />
        <path d="M190 100 l-14 6 -6 -6 6 -6z" />
        <path d="M100 190 l-6 -14 6 -6 6 6z" />
        <path d="M10 100 l14 -6 6 6 -6 6z" />
      </g>
      <C r="78" stroke="url(#fHolo)" stroke-width="1" stroke-dasharray="2 4" />
    </>
  ),
  pioneer: () => (
    <>
      <C r="62" stroke="#5fe3b0" stroke-width="2.5" />
      <C r="74" stroke="rgba(95,227,176,.35)" stroke-width="1" stroke-dasharray="1 5" />
      <g class="fx-spin fx-slow">
        <C r="84" stroke="rgba(255,214,120,.5)" stroke-width="1" pathLength="100" stroke-dasharray="18 7" />
      </g>
      <g stroke="#5fe3b0" stroke-width="2">
        <path d="M100 24v12M176 100h-12M100 176v-12M24 100h12" />
      </g>
      <g fill="#ffd678">
        <path d="M100 8 L106 24 L100 20 L94 24 Z" />
      </g>
      <text x="100" y="47" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="9" font-weight="700" fill="#ffd678">N</text>
      <g fill="none" stroke="#ffd678" stroke-width="1.2">
        <path d="M150 34 v-14 h12 l-3 4 3 4 h-12" />
      </g>
    </>
  ),
  circle: () => (
    <>
      <g class="fx-spin fx-slow" fill="none">
        <C r="64" stroke="#7fe0ff" stroke-width="2" />
        <circle cx="100" cy="100" r="70" stroke="#ffb3d9" stroke-width="2" transform="translate(4 -3)" opacity=".85" />
      </g>
      <g fill="#fff">
        <circle cx="100" cy="24" r="2.5" class="fx-twinkle" />
        <circle cx="166" cy="70" r="2" class="fx-twinkle" style={{ animationDelay: '-.8s' }} />
        <circle cx="150" cy="160" r="2.5" class="fx-twinkle" style={{ animationDelay: '-1.4s' }} />
        <circle cx="44" cy="156" r="2" class="fx-twinkle" style={{ animationDelay: '-.3s' }} />
        <circle cx="32" cy="74" r="2.5" class="fx-twinkle" style={{ animationDelay: '-2s' }} />
      </g>
      <C r="82" stroke="rgba(255,179,217,.3)" stroke-width="1" stroke-dasharray="3 6" />
    </>
  ),
  bughunter: () => (
    <>
      <C r="62" stroke="#9cff57" stroke-width="2" />
      <g class="fx-spin">
        <C r="76" stroke="#9cff57" stroke-width="1.5" pathLength="100" stroke-dasharray="20 5" opacity=".6" />
      </g>
      <g stroke="#9cff57" stroke-width="2.5">
        <path d="M100 14v22M100 164v22M14 100h22M164 100h22" />
      </g>
      <g transform="translate(162 38)" fill="#9cff57">
        <ellipse cx="0" cy="0" rx="5" ry="7" />
        <path d="M-5 -3 l-5 -3 M5 -3 l5 -3 M-5 2 l-6 1 M5 2 l6 1 M-4 6 l-4 4 M4 6 l4 4" stroke="#9cff57" stroke-width="1.5" />
      </g>
      <circle cx="162" cy="38" r="12" fill="none" stroke="#ff4d6d" stroke-width="1.5" class="fx-pulse" />
    </>
  ),
  architect: () => (
    <>
      <C r="96" stroke="url(#fGold)" stroke-width="10" opacity=".25" filter="url(#fGlow2)" />
      <g class="fx-spin fx-slow">
        <text font-family="JetBrains Mono, monospace" font-size="8.5" font-weight="700" letter-spacing="3" fill="#ffc24a" opacity=".85">
          <textPath href="#fTxt">ECHO // ROOT ACCESS // ARCHITECT // ECHO // ROOT ACCESS // ARCHITECT //</textPath>
        </text>
      </g>
      <g class="fx-spin fx-rev">
        <C r="76" stroke="url(#fGold)" stroke-width="1.2" stroke-dasharray="1 3" />
      </g>
      <g fill="none" stroke="#ffc24a" stroke-width="1.4" opacity=".9">
        <path d="M100 34 V22 H122 V14" />
        <path d="M160 78 H174 V60 H184" />
        <path d="M162 128 H178 V146" />
        <path d="M40 128 H24 V150 H16" />
        <path d="M38 76 H26 V56" />
        <path d="M100 166 V180 H78 V188" />
      </g>
      <g fill="#fff1b8">
        <circle cx="122" cy="14" r="2.5" />
        <circle cx="184" cy="60" r="2.5" />
        <circle cx="178" cy="146" r="2.5" />
        <circle cx="16" cy="150" r="2.5" />
        <circle cx="26" cy="56" r="2.5" />
        <circle cx="78" cy="188" r="2.5" />
      </g>
      <C r="66" stroke="#ffc24a" stroke-width="1" pathLength="100" stroke-dasharray="4 96" class="fx-flow" filter="url(#fGlow)" />
      <C r="62" stroke="url(#fGold)" stroke-width="4" filter="url(#fGlow)" />
      <g transform="translate(100 31)" filter="url(#fGlow)">
        <path d="M-16 8 L-18 -8 L-8 0 L0 -12 L8 0 L18 -8 L16 8 Z" fill="url(#fGold)" stroke="#2a1a00" stroke-width="1" />
        <circle cx="0" cy="-12" r="2.4" fill="#fff" />
      </g>
    </>
  ),
  guardian: () => (
    <>
      <C r="96" stroke="url(#fBlue)" stroke-width="10" opacity=".22" filter="url(#fGlow2)" />
      <g class="fx-spin fx-slow fx-rev">
        <text font-family="JetBrains Mono, monospace" font-size="8.5" font-weight="700" letter-spacing="3" fill="#8fe3ff" opacity=".85">
          <textPath href="#fTxt2">MODERATOR // GUARDIAN // ORDER // MODERATOR // GUARDIAN // ORDER //</textPath>
        </text>
      </g>
      <g fill="none" stroke="#3a8bff" stroke-width="1.2" opacity=".75">
        <polygon points="164,64 180,73 180,91 164,100 148,91 148,73" />
        <polygon points="164,104 180,113 180,131 164,140 148,131 148,113" opacity=".6" />
        <polygon points="36,64 52,73 52,91 36,100 20,91 20,73" />
        <polygon points="36,104 52,113 52,131 36,140 20,131 20,113" opacity=".6" />
        <polygon points="100,142 116,151 116,169 100,178 84,169 84,151" />
      </g>
      <g class="fx-spin fx-fast">
        <path d="M100 100 L100 30 A70 70 0 0 1 135 39 Z" fill="url(#fBlue)" opacity=".3" />
      </g>
      <C r="62" stroke="url(#fBlue)" stroke-width="4" filter="url(#fGlow)" />
      <g transform="translate(100 32)" filter="url(#fGlow)">
        <path d="M0 -14 L13 -8 V2 C13 10 6 15 0 18 C-6 15 -13 10 -13 2 V-8 Z" fill="url(#fBlue)" stroke="#001428" stroke-width="1" />
        <path d="M-5 1 l4 4 7 -8" fill="none" stroke="#fff" stroke-width="2" />
      </g>
    </>
  ),
};

/** Main color of each frame, for the compact version in lists. */
export const FRAME_COLOR: Record<string, string> = {
  contour: '#29f0cf',
  brackets: '#29f0cf',
  dotted: '#29f0cf',
  scale: '#29f0cf',
  radar: '#3ad7ff',
  resonator: '#29f0cf',
  impulse: '#ff5c9a',
  accretion: '#b48cff',
  horizon: '#ff9cf0',
  pulsar: '#8fe3ff',
  magnetar: '#5ab4ff',
  supernova: '#ffb02e',
  hypernova: '#ff5cc8',
  absolute: '#ffd678',
  bond: '#ff7ab8',
  owl: '#9aa6ff',
  eternal: '#ff7a1a',
  onair: '#ff3d8b',
  legend: '#39ff9c',
  five: '#ffc24a',
  prism: '#ffe08a',
  pioneer: '#5fe3b0',
  circle: '#ffb3d9',
  bughunter: '#9cff57',
  architect: '#ffc24a',
  guardian: '#5ab4ff',
};

export const hasFrame = (id: string | undefined) => !!id && id in FRAMES;

/** Picture radius in the 200-box is 48: a frame box is this many times the picture size. */
export const FRAME_SCALE = 200 / 96;

export function FrameSvg({ id, animated }: { id: string; animated: boolean }) {
  const draw = FRAMES[id];
  if (!draw) return null;
  return (
    <svg class={`frame-svg${animated ? ' fx-anim' : ''}`} viewBox="0 0 200 200" aria-hidden="true">
      {draw()}
    </svg>
  );
}
