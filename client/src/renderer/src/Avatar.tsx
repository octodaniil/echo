import { useState } from 'preact/hooks';
import { avatarUrl } from './profile';

// Stable pleasant hue per user so letter avatars are distinguishable.
function hue(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

export function Avatar({
  id,
  name,
  avatar,
  size = 32,
  speaking = false,
}: {
  id: string;
  name: string;
  avatar?: number | null;
  size?: number;
  speaking?: boolean;
}) {
  const url = avatarUrl(id, avatar);
  const [broken, setBroken] = useState<string | null>(null);
  const showImage = url && broken !== url;
  return (
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
  );
}
