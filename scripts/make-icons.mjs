// Dependency-free PNG icon generator: node scripts/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
};
const png = (size, rgba) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
};

const BG = [0x0f, 0x9d, 0x58], BG2 = [0x0b, 0x6e, 0x3e], FG = [255, 255, 255];
// coverage in [0,1] of unit-square point (u,v) by the shapes; 4x4 supersampling
const sample = (u, v) => {
  const r = 0.22;
  const cx = Math.min(Math.max(u, r), 1 - r), cy = Math.min(Math.max(v, r), 1 - r);
  if ((u - cx) ** 2 + (v - cy) ** 2 > r * r) return null; // outside rounded square
  // up arrow: head triangle + shaft
  const head = v >= 0.2 && v <= 0.5 && Math.abs(u - 0.5) <= (v - 0.2) * 0.9;
  const shaft = v > 0.5 && v <= 0.68 && Math.abs(u - 0.5) <= 0.1;
  const tray = v >= 0.76 && v <= 0.84 && u >= 0.22 && u <= 0.78;
  if (head || shaft || tray) return FG;
  return v > 0.5 ? BG2 : BG; // two-tone
};
const draw = (size) => {
  const out = Buffer.alloc(size * size * 4), S = 4;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let rs = 0, gs = 0, bs = 0, n = 0;
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const c = sample((x + (i + 0.5) / S) / size, (y + (j + 0.5) / S) / size);
      if (c) { rs += c[0]; gs += c[1]; bs += c[2]; n++; }
    }
    const o = (y * size + x) * 4;
    if (n) { out[o] = rs / n; out[o + 1] = gs / n; out[o + 2] = bs / n; out[o + 3] = Math.round(255 * n / (S * S)); }
  }
  return out;
};

mkdirSync('icons', { recursive: true });
for (const s of [16, 32, 48, 128]) writeFileSync(`icons/icon${s}.png`, png(s, draw(s)));
console.log('icons written');
