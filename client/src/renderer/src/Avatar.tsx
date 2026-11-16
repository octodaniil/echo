import { useState } from 'preact/hooks';
import { Emblem } from './Achievements';
import { avatarUrl } from './profile';

// Stable pleasant hue per user so letter avatars are distinguishable.
function hue(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

/**
 * Avatar with an optional rank ring (tier 1 bronze … 4 legend). The ring is a static
 * gradient behind the picture: no animation, so it costs nothing after the first paint.
 */
export function Avatar({
  id,
  name,
  avatar,
  size = 32,
  speaking = false,
  tier = 0,
  uniques,
}: {
  id: string;
  name: string;
  avatar?: number | null;
  size?: number;
  speaking?: boolean;
  tier?: number;
  /** Unique achievements: holographic emblem in the corner. */
  uniques?: string[];
}) {
  const url = avatarUrl(id, avatar);
  const [broken, setBroken] = useState<string | null>(null);
  const showImage = url && broken !== url;
  return (
    <span
      class={`avatar-wrap tier-${tier}${uniques?.length ? ' has-unique' : ''}`}
      style={{ width: size, height: size, '--ring': `${Math.max(2, Math.round(size * 0.055))}px` }}
    >
      <span
        class={`avatar${speaking ? ' speaking' : ''}`}
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
      {size >= 20 && <Emblem uniques={uniques} size={size} />}
    </span>
  );
}

/** Nickname colored by rank. */
export function Nick({ name, tier = 0, class: cls = '' }: { name: string; tier?: number; class?: string }) {
  return <span class={`nick-t${tier} ${cls}`.trim()}>{name}</span>;
}
