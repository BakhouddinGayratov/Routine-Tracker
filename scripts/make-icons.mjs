/**
 * Render the PNG app icons from the same geometry as public/assets/icon.svg.
 *
 *   node scripts/make-icons.mjs
 *
 * Installable web apps need raster icons: Android builds its home-screen app
 * from 192px and 512px PNGs, and iOS ignores an SVG apple-touch-icon. The
 * shape is simple enough — a gradient rounded square and a check stroke — to
 * rasterise here with node:zlib instead of adding an image library.
 *
 * Re-run it after changing icon.svg, and keep the constants below in step.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'assets');

// icon.svg, in its 48×48 viewBox.
const RECT = { x: 2, y: 2, size: 44, radius: 13 };
const GRADIENT = [[0x81, 0x8c, 0xf8], [0xc0, 0x84, 0xfc]];   // #818cf8 → #c084fc, top-left → bottom-right
const CHECK = { points: [[14, 24.5], [20.5, 31], [34, 17.5]], width: 4.2, color: [0x0b, 0x0d, 0x14] };
const SAMPLES = 4;   // 4×4 supersampling per pixel for smooth edges

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

function insideRoundedRect(x, y, { x: rx, y: ry, size, radius }) {
  const cx = Math.min(Math.max(x, rx + radius), rx + size - radius);
  const cy = Math.min(Math.max(y, ry + radius), ry + size - radius);
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2
    && x >= rx && x <= rx + size && y >= ry && y <= ry + size;
}

function distanceToSegment(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax; const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function onCheck(x, y, check) {
  for (let i = 0; i < check.points.length - 1; i += 1) {
    if (distanceToSegment(x, y, check.points[i], check.points[i + 1]) <= check.width / 2) return true;
  }
  return false;
}

/**
 * @param {number} size       output pixels
 * @param {boolean} maskable  full-bleed background with the mark inside the
 *                            80% safe zone, for launchers that crop to a circle
 */
function render(size, maskable = false) {
  const rgba = Buffer.alloc(size * size * 4);
  // Maskable: the mark shrinks to the safe zone and the gradient fills the square.
  const scale = maskable ? 0.8 : 1;
  const offset = (48 - 48 * scale) / 2;

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let r = 0; let g = 0; let b = 0; let a = 0;
      for (let sy = 0; sy < SAMPLES; sy += 1) {
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const x = ((px + (sx + 0.5) / SAMPLES) / size) * 48;
          const y = ((py + (sy + 0.5) / SAMPLES) / size) * 48;
          const gradient = mix(GRADIENT[0], GRADIENT[1], Math.min(1, Math.max(0, (x + y) / 96)));
          const mx = (x - offset) / scale;
          const my = (y - offset) / scale;
          let color = null;
          if (maskable || insideRoundedRect(x, y, RECT)) color = gradient;
          if (color && onCheck(mx, my, CHECK)) color = CHECK.color;
          if (color) { r += color[0]; g += color[1]; b += color[2]; a += 255; }
        }
      }
      const n = SAMPLES * SAMPLES;
      const i = (py * size + px) * 4;
      // Premultiplied sums → straight alpha.
      const alpha = a / n;
      rgba[i] = alpha ? Math.round((r / n) * 255 / alpha) : 0;
      rgba[i + 1] = alpha ? Math.round((g / n) * 255 / alpha) : 0;
      rgba[i + 2] = alpha ? Math.round((b / n) * 255 / alpha) : 0;
      rgba[i + 3] = Math.round(alpha);
    }
  }
  return encodePng(size, size, rgba);
}

// --- Minimal PNG encoder (RGBA, 8-bit, no interlace) -------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;    // bit depth
  header[9] = 6;    // colour type: RGBA
  // compression, filter, interlace: all 0

  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;   // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const outputs = [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-512.png', 512, true],
  ['apple-touch-icon.png', 180, true],   // iOS rounds the corners itself, so no transparent edge
];

for (const [name, size, maskable] of outputs) {
  const file = path.join(OUT, name);
  fs.writeFileSync(file, render(size, maskable));
  console.log(`${name}  ${size}×${size}  ${fs.statSync(file).size} bytes`);
}
