// Renders the Echo logo (teal ring with a soft outer ring on a dark rounded square)
// into build/icon.png (512x512). electron-builder turns it into the .ico.
// Run: node scripts/make-icon.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const N = 512;
const SS = 4; // supersampling per axis for anti-aliasing
const px = new Float32Array(N * N * 4);

const bg = [17, 18, 20];
const teal = [45, 212, 191];

// Rounded-square background.
const radius = 112;
function inRoundRect(x, y) {
  const dx = Math.max(radius - x, 0, x - (N - radius));
  const dy = Math.max(radius - y, 0, y - (N - radius));
  return dx * dx + dy * dy <= radius * radius;
}

const c = N / 2;
for (let y = 0; y < N; y++) {
  for (let x = 0; x < N; x++) {
    let bgCov = 0, ring = 0, halo = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const fx = x + (sx + 0.5) / SS;
        const fy = y + (sy + 0.5) / SS;
        if (!inRoundRect(fx, fy)) continue;
        bgCov++;
        const d = Math.hypot(fx - c, fy - c);
        if (d >= 118 && d <= 162) ring++; // main ring
        else if (d >= 182 && d <= 202) halo++; // faint echo ring
      }
    }
    const n = SS * SS;
    const a = bgCov / n;
    const r = ring / n, h = (halo / n) * 0.35;
    const i = (y * N + x) * 4;
    for (let k = 0; k < 3; k++) {
      const base = bg[k];
      let v = base + (teal[k] - base) * h;
      v = v + (teal[k] - v) * (r / Math.max(a, 1e-6));
      px[i + k] = v;
    }
    px[i + 3] = a * 255;
  }
}

// Encode PNG (RGBA, 8-bit).
const raw = Buffer.alloc(N * (N * 4 + 1));
for (let y = 0; y < N; y++) {
  raw[y * (N * 4 + 1)] = 0;
  for (let x = 0; x < N * 4; x++) raw[y * (N * 4 + 1) + 1 + x] = Math.round(Math.min(255, Math.max(0, px[y * N * 4 + x])));
}
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, cr]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4);
ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

mkdirSync(new URL('../build/', import.meta.url), { recursive: true });
writeFileSync(new URL('../build/icon.png', import.meta.url), png);
console.log(`build/icon.png written (${png.length} bytes)`);
