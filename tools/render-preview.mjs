// Headless renderer — draws every state to PNG without a browser or ffmpeg.
// Usage: node tools/render-preview.mjs [outdir]
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

await import('../assets/buddy-core.js');       // sets globalThis.KB

const { W, H, FrameBuffer, renderFace } = globalThis.KB;
const outDir = process.argv[2] || '/tmp/kb-preview';
mkdirSync(outDir, { recursive: true });

const LIT = [0xff, 0x8a, 0x4d];
const UNLIT = [0x0a, 0x09, 0x08];
const SCALE = 6;

/* ---- minimal PNG writer (RGB, no deps) ---- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(w, h, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;      // bit depth
  ihdr[9] = 2;      // colour type: truecolour
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;                       // filter: none
    rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function raster(fb) {
  const w = W * SCALE, h = H * SCALE;
  const rgb = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const on = fb.buf[((y / SCALE) | 0) * W + ((x / SCALE) | 0)];
      const c = on ? LIT : UNLIT;
      const o = (y * w + x) * 3;
      rgb[o] = c[0]; rgb[o + 1] = c[1]; rgb[o + 2] = c[2];
    }
  }
  return png(w, h, rgb);
}

const shots = [
  ['idle',   { mode: 'idle',  glance: 0,  offsetX: 0, battery: 100 }],
  ['glance', { mode: 'idle',  glance: -1, offsetX: 0, battery: 82 }],
  ['blink',  { mode: 'blink', glance: 0,  offsetX: 0, battery: 82 }],
  ['happy',  { mode: 'happy', glance: 0,  offsetX: 0, battery: 76 }],
  ['dizzy',  { mode: 'dizzy', glance: 0,  offsetX: 3, battery: 64 }],
  ['sleep',  { mode: 'sleep', glance: 0,  offsetX: 0, zphase: 2, battery: 55 }],
];

const fb = new FrameBuffer();
for (const [name, s] of shots) {
  fb.clear();
  renderFace(fb, s);
  writeFileSync(`${outDir}/${name}.png`, raster(fb));
  let lit = 0;
  for (let i = 0; i < fb.buf.length; i++) lit += fb.buf[i];
  console.log(`${name.padEnd(7)} lit pixels: ${String(lit).padStart(4)}`);
}
console.log('wrote', outDir);
