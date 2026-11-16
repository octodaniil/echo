// Small helpers shared by components that show users.
import { useEffect, useState } from 'preact/hooks';
import { settings, type Settings } from './settings';

let serverUrl = '';

export function setServerUrl(url: string) {
  serverUrl = url;
}

export function avatarUrl(userId: string, version: number | null | undefined): string | null {
  return version && serverUrl ? `${serverUrl}/api/avatars/${userId}?v=${version}` : null;
}

export function useSettings(): Settings {
  const [s, setS] = useState(settings.get());
  useEffect(() => settings.subscribe((next) => setS(next)), []);
  return s;
}

/** Center-crops an image file to a square and encodes a 128x128 WebP. */
export async function makeAvatar(file: File): Promise<Uint8Array> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = new OffscreenCanvas(128, 128);
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 128, 128);
  bitmap.close();
  const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.86 });
  return new Uint8Array(await blob.arrayBuffer());
}
