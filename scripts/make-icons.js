// Draws the app icon (two fanned cards on a terracotta tile) and writes PNGs with no dependencies.
// Run: node scripts/make-icons.js
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}
const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const BG = hex("#C4502C"), CREAM = hex("#FFF6E6"), NAVY = hex("#2B3A55"), PIP = hex("#C4502C"), EDGE = hex("#1E1B16");

// signed distance to a rounded rectangle centred at (cx,cy), half sizes hw,hh, corner r, rotated by a
function rrect(x, y, cx, cy, hw, hh, r, a) {
  const c = Math.cos(-a), s = Math.sin(-a);
  const dx = x - cx, dy = y - cy;
  const px = Math.abs(dx * c - dy * s) - (hw - r), py = Math.abs(dx * s + dy * c) - (hh - r);
  return Math.hypot(Math.max(px, 0), Math.max(py, 0)) + Math.min(Math.max(px, py), 0) - r;
}

// mode: "tile" (rounded tile), "full" (square, for maskable / Windows), "flat" (no background)
function sample(u, v, mode) {
  const layers = [];
  if (mode === "tile") { if (rrect(u, v, .5, .5, .5, .5, .22, 0) <= 0) layers.push(BG); else return [0, 0, 0, 0]; }
  else if (mode === "full") layers.push(BG);
  const k = mode === "full" ? .78 : 1;                     // maskable icons need a safe zone
  const P = (x, y) => [.5 + (x - .5) * k, .5 + (y - .5) * k];
  const [bx, by] = P(.60, .52), [fx, fy] = P(.42, .50), [px, py] = P(.42, .50);
  const back = rrect(u, v, bx, by, .17 * k, .24 * k, .035 * k, .30);
  const front = rrect(u, v, fx, fy, .17 * k, .24 * k, .035 * k, -.22);
  if (back <= .012 * k) layers.push(back <= 0 ? NAVY : CREAM);
  if (front <= .012 * k) layers.push(front <= 0 ? CREAM : EDGE);
  if (Math.hypot(u - px, v - py) <= .065 * k) layers.push(PIP);
  if (!layers.length) return [0, 0, 0, 0];
  return [...layers[layers.length - 1], 255];
}

function render(size, mode) {
  const ss = 4, buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let j = 0; j < ss; j++) for (let i = 0; i < ss; i++) {
      const c = sample((x + (i + .5) / ss) / size, (y + (j + .5) / ss) / size, mode);
      r += c[0] * c[3]; g += c[1] * c[3]; b += c[2] * c[3]; a += c[3];
    }
    const o = (y * size + x) * 4;
    if (a) { buf[o] = r / a; buf[o + 1] = g / a; buf[o + 2] = b / a; }
    buf[o + 3] = a / (ss * ss);
  }
  return png(size, buf);
}

const root = path.join(__dirname, "..");
const out = path.join(root, "app", "icons"), build = path.join(root, "build");
fs.mkdirSync(out, { recursive: true }); fs.mkdirSync(build, { recursive: true });
const files = [
  [path.join(out, "icon-192.png"), 192, "tile"],
  [path.join(out, "icon-512.png"), 512, "tile"],
  [path.join(out, "maskable-512.png"), 512, "full"],
  [path.join(out, "apple-touch-icon.png"), 180, "full"],
  [path.join(out, "icon.png"), 256, "tile"],
  [path.join(build, "icon.png"), 512, "tile"],
];
for (const [file, size, mode] of files) fs.writeFileSync(file, render(size, mode));
console.log("icons:", files.length);
