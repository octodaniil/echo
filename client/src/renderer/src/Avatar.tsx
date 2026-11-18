import { useState } from 'preact/hooks';
import type { Look, Prestige, StatusState } from '../../shared/types';
import { FRAME_COLOR, FRAME_SCALE, FrameSvg, hasFrame } from './Frames';
import { levelProgress, lookVars, rankName } from './look';
import { avatarUrl } from './profile';

// Stable pleasant hue per user so letter avatars are distinguishable.
function hue(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

/**
 * Avatar with a HUD level ring: the ring fills up with progress toward the next level,
 * in the color the user picked, with the level number on it. Frames are extra layers
 * around it. Everything is static unless `animated` (large avatars) or speaking.
 */
export function Avatar({
  id,
  name,
  avatar,
  size = 32,
  speaking = false,
  prestige,
  look,
  uniques,
  status,
  animated = size >= 64,
}: {
  id: string;
  name: string;
  avatar?: number | null;
  size?: number;
  speaking?: boolean;
  prestige?: Prestige;
  look?: Look;
  /** Unique achievements: holographic emblem in the corner. */
  uniques?: string[];
  /** Away / do-not-disturb dot (nothing for "online"). */
  status?: StatusState;
  animated?: boolean;
}) {
  const url = avatarUrl(id, avatar);
  const [broken, setBroken] = useState<string | null>(null);
  const showImage = url && broken !== url;
  const ring = Math.max(2, Math.round(size * 0.065));
  const frame = hasFrame(look?.frame) ? look!.frame : null;
  // Big avatars get the full drawn frame; space for it is reserved around the avatar so it
  // never covers the nickname or anything next to it. Small ones (lists) get a compact ring.
  const full = !!frame && size >= 40;
  const pad = full ? Math.round((size * FRAME_SCALE - size) / 2) : frame ? 3 : 0;
  const showLevel = !!prestige && size >= 30;
  const cls = [
    'avatar-wrap',
    prestige ? 'has-ring' : '',
    frame ? (full ? 'has-frame' : 'mini-frame') : '',
    `ring-${look?.ring ?? 'accent'}`,
    speaking ? 'speaking' : '',
    animated ? 'anim' : '',
    size < 30 ? 'small' : '',
    uniques?.length ? 'has-unique' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <span
      class={cls}
      style={{
        width: size,
        height: size,
        margin: pad ? `${pad}px` : undefined,
        '--ring': `${ring}px`,
        '--fc': frame ? FRAME_COLOR[frame] : undefined,
        '--pad': `${pad}px`,
        '--p': `${Math.round(levelProgress(prestige) * 100)}`,
        ...lookVars(look),
      }}
      title={prestige ? `${rankName(prestige)} · уровень ${prestige.level}` : undefined}
    >
      {prestige && <span class="lvl-ring" />}
      {full && (
        <span class="frame-box" style={{ inset: `-${pad}px` }}>
          <FrameSvg id={frame} animated={animated} />
        </span>
      )}
      <span
        class="avatar"
        style={{
          width: size,
          height: size,
          fontSize: size * 0.42,
          background: showImage ? 'var(--panel-2)' : `hsl(${hue(id)} 45% 42%)`,
        }}
      >
        {showImage ? (
          <img src={url} alt="" draggable={false} onError={() => setBroken(url)} />
        ) : (
          name.trim().charAt(0).toUpperCase() || '?'
        )}
      </span>
      {showLevel && (
        <span class="lvl-num" style={{ fontSize: Math.max(8.5, Math.round(size * 0.17)) }}>
          {prestige.level}
        </span>
      )}
      {status && status !== 'online' && (
        <span class={`status-dot st-${status}`} style={{ width: Math.min(20, Math.max(9, size * 0.24)), height: Math.min(20, Math.max(9, size * 0.24)) }} />
      )}
    </span>
  );
}

/** Nickname with the equipped name effect, tinted with the ring color. */
export function Nick({ name, look, class: cls = '' }: { name: string; look?: Look; class?: string }) {
  const fx = look?.name && look.name !== 'none' ? `nfx nfx-${look.name}` : '';
  return (
    <span class={`${fx} ${cls}`.trim()} style={fx ? lookVars(look) : undefined} data-text={name}>
      {name}
    </span>
  );
}
