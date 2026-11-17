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

export function bannerUrl(userId: string, version: number | null | undefined): string | null {
  return version && serverUrl ? `${serverUrl}/api/banners/${userId}?v=${version}` : null;
}

const BANNER_MAX = 4 * 1024 * 1024;

/** Animated WebP has an "ANIM" chunk near the start. */
async function isAnimatedWebp(file: File): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  return new TextDecoder('ascii').decode(head).includes('ANIM');
}

/**
 * Prepares a profile banner. Animated GIF/WebP are uploaded as they are (cropping would
 * lose the animation); still images are center-cropped to 3:1 and encoded as WebP.
 */
export async function makeBanner(file: File): Promise<{ data: Uint8Array; type: string }> {
  const animated = file.type === 'image/gif' || (file.type === 'image/webp' && (await isAnimatedWebp(file)));
  if (animated) {
    if (file.size > BANNER_MAX) throw new Error('Анимированный баннер больше 4 МБ — сожми его или возьми короче');
    return { data: new Uint8Array(await file.arrayBuffer()), type: file.type };
  }
  const bitmap = await createImageBitmap(file);
  const W = 960;
  const H = 320;
  const scale = Math.max(W / bitmap.width, H / bitmap.height);
  const sw = W / scale;
  const sh = H / scale;
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, (bitmap.width - sw) / 2, (bitmap.height - sh) / 2, sw, sh, 0, 0, W, H);
  bitmap.close();
  const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.85 });
  return { data: new Uint8Array(await blob.arrayBuffer()), type: 'image/webp' };
}

export function useSettings(): Settings {
  const [s, setS] = useState(settings.get());
  useEffect(() => settings.subscribe((next) => setS(next)), []);
  return s;
}

const AVATAR_MAX = 2 * 1024 * 1024;

/**
 * Prepares an avatar. Animated GIF/WebP go up as they are (the circle crop happens when
 * shown); still images are center-cropped to a 256x256 WebP (sharp on big profile rings).
 */
export async function makeAvatar(file: File): Promise<{ data: Uint8Array; type: string }> {
  const animated = file.type === 'image/gif' || (file.type === 'image/webp' && (await isAnimatedWebp(file)));
  if (animated) {
    if (file.size > AVATAR_MAX) throw new Error('Анимированный аватар больше 2 МБ — сожми его или возьми короче');
    return { data: new Uint8Array(await file.arrayBuffer()), type: file.type };
  }
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = new OffscreenCanvas(256, 256);
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 256, 256);
  bitmap.close();
  const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.86 });
  return { data: new Uint8Array(await blob.arrayBuffer()), type: 'image/webp' };
}
