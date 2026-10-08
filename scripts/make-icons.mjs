/**
 * Render the PNG app icons from the same geometry as public/assets/icon.svg.
 *
 *   node scripts/make-icons.mjs
 *
 * Installable web apps need raster icons: Android builds its home-screen app
 * from 192px and 512px PNGs, and iOS ignores an SVG apple-touch-icon. The
 * shape is simple enough — an ink tile with the day dial on it: a faint ring,
 * a bold red arc, a hand and a hub — to rasterise here with node:zlib instead
 * of adding an image library.
 *
 * Re-run it after changing icon.svg, and keep the constants below in step.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'assets');

// icon.svg, in its 48×48 viewBox.
const RECT = { x: 0, y: 0, size: 48, radius: 11 };
const INK = [0x1e, 0x1a, 0x14];        // the tile
const PAPER = [0xf2, 0xec, 0xe1];      // ring, hand, hub
const PENCIL = [0xd2, 0x4a, 0x2c];     // the arc — the paper theme's red pencil, a touch brighter on ink
const DIAL = { cx: 24, cy: 24, r: 15, ring: 3, arc: 3.8, arcTo: 120 };   // arc from 12 o'clock, clockwise, in degrees
const HAND = { points: [[24, 24], [31.8, 28.5]], width: 3 };
const HUB = 2.6;
const SAMPLES = 4;   // 4×4 supersampling per pixel for smooth edges

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

/** Which part of the dial covers (x, y) in mark space, or null. */
function dialColor(x, y) {
  const dx = x - DIAL.cx;
  const dy = y - DIAL.cy;
  const d = Math.hypot(dx, dy);
  if (d <= HUB) return PAPER;
  if (onCheck(x, y, { points: HAND.points, width: HAND.width })) return PAPER;

  // Angle from 12 o'clock, clockwise, 0–360.
  const angle = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
  const onArcBand = Math.abs(d - DIAL.r) <= DIAL.arc / 2 && angle <= DIAL.arcTo;
  const end = [DIAL.cx + DIAL.r * Math.sin(DIAL.arcTo * Math.PI / 180), DIAL.cy - DIAL.r * Math.cos(DIAL.arcTo * Math.PI / 180)];
  const onCap = Math.hypot(x - DIAL.cx, y - (DIAL.cy - DIAL.r)) <= DIAL.arc / 2 || Math.hypot(x - end[0], y - end[1]) <= DIAL.arc / 2;
  if (onArcBand || onCap) return PENCIL;
  if (Math.abs(d - DIAL.r) <= DIAL.ring / 2) return mix(INK, PAPER, 0.3);
  return null;
}

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
  // Maskable: the mark shrinks to the safe zone and the ink fills the square.
  const scale = maskable ? 0.8 : 1;
  const offset = (48 - 48 * scale) / 2;

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let r = 0; let g = 0; let b = 0; let a = 0;
      for (let sy = 0; sy < SAMPLES; sy += 1) {
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const x = ((px + (sx + 0.5) / SAMPLES) / size) * 48;
          const y = ((py + (sy + 0.5) / SAMPLES) / size) * 48;
          const mx = (x - offset) / scale;
          const my = (y - offset) / scale;
          let color = null;
          if (maskable || insideRoundedRect(x, y, RECT)) color = INK;
          if (color) color = dialColor(mx, my) || color;
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
