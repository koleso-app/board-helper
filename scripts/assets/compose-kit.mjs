// Shared tools for composing game illustrations from rulebook renders: fonts with Cyrillic, paper, text, tags, badges, arrows.
// Used by flip7-compose.mjs (faraway-compose.mjs keeps its own copy of the same tools).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage, GlobalFonts } from "@napi-rs/canvas";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const src = p => path.join(root, "sources", p);
for (const [f, fam] of [["onest-cyrillic-600-normal", "OnestC"], ["onest-latin-600-normal", "OnestL"], ["onest-cyrillic-700-normal", "OnestCB"], ["onest-latin-700-normal", "OnestLB"],
  ["unbounded-cyrillic-700-normal", "UnbC"], ["unbounded-latin-700-normal", "UnbL"]]) GlobalFonts.registerFromPath(path.join(root, "app", "fonts", f + ".woff2"), fam);
export const UI = s => `${s}px OnestL, OnestC`, UIB = s => `${s}px OnestLB, OnestCB`, DISP = s => `${s}px UnbL, UnbC`;
export const INK = "#22305E", MUTED = "#5F6B78", ACCENT = "#E0603B", YELLOW = "#F2C230", NAVY = "#1E2F8F";
export { createCanvas, loadImage };

const cache = {};
// a page of a render folder; boxes are in units of an 864-wide page, k = render width / 864
export async function pageOf(dir, n) {
  const key = dir + n;
  if (!cache[key]) cache[key] = await loadImage(fs.readFileSync(src(`${dir}/page-${String(n).padStart(2, "0")}.png`)));
  return cache[key];
}
export async function cut(dir, n, [x0, y0, x1, y1]) {
  const img = await pageOf(dir, n), k = img.width / 864;
  const c = createCanvas(Math.round((x1 - x0) * k), Math.round((y1 - y0) * k));
  c.getContext("2d").drawImage(img, x0 * k, y0 * k, (x1 - x0) * k, (y1 - y0) * k, 0, 0, c.width, c.height);
  return c;
}
export const pixel = (c, X, Y) => { const d = c.getContext("2d").getImageData(X, Y, 1, 1).data; return "#" + [d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, "0")).join(""); };
export function sheet(W, H, bg, draw) {
  const c = createCanvas(W, H), x = c.getContext("2d");
  x.fillStyle = bg; x.fillRect(0, 0, W, H); x.textBaseline = "alphabetic";
  draw(x, c);
  return c;
}
export const put = (x, img, X, Y, w) => { const h = img.height * w / img.width; x.drawImage(img, X, Y, w, h); return h; };
// an image fitted into a box (keeps its shape, centred)
export function fit(x, img, X, Y, w, h) { const k = Math.min(w / img.width, h / img.height), iw = img.width * k, ih = img.height * k; x.drawImage(img, X + (w - iw) / 2, Y + (h - ih) / 2, iw, ih); return { w: iw, h: ih }; }
export function text(x, s, X, Y, o = {}) {
  x.font = o.font || UI(o.size || 26); x.fillStyle = o.color || INK; x.textAlign = o.align || "center";
  const words = String(s).split(" "), lines = []; let line = "";
  for (const w of words) { const t = line ? line + " " + w : w; if (o.maxW && x.measureText(t).width > o.maxW && line) { lines.push(line); line = w; } else line = t; }
  lines.push(line);
  const lh = o.lh || (o.size || 26) * 1.25;
  lines.forEach((l, i) => x.fillText(l, X, Y + i * lh));
  return lines.length * lh;
}
export function roundRect(x, X, Y, w, h, r) { x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + w, Y, X + w, Y + h, r); x.arcTo(X + w, Y + h, X, Y + h, r); x.arcTo(X, Y + h, X, Y, r); x.arcTo(X, Y, X + w, Y, r); x.closePath(); }
export function tag(x, s, X, Y, o = {}) {
  const size = o.size || 24; x.font = o.font || UIB(size);
  const w = x.measureText(s).width + 2 * (o.pad || 14), h = size + 18;
  const L = o.align === "left" ? X : o.align === "right" ? X - w : X - w / 2;
  x.fillStyle = o.bg || NAVY; roundRect(x, L, Y - h / 2, w, h, h / 2); x.fill();
  x.fillStyle = o.color || "#fff"; x.textAlign = "center"; x.fillText(s, L + w / 2, Y + size * 0.36);
  return w;
}
export function badge(x, n, X, Y, r) { r = r || 22; x.fillStyle = YELLOW; x.beginPath(); x.arc(X, Y, r, 0, Math.PI * 2); x.fill(); x.strokeStyle = INK; x.lineWidth = 3; x.stroke(); x.fillStyle = INK; x.font = DISP(r * 1.05); x.textAlign = "center"; x.fillText(String(n), X, Y + r * 0.38); }
export function arrow(x, x1, y1, x2, y2, color) {
  x.strokeStyle = color || ACCENT; x.fillStyle = color || ACCENT; x.lineWidth = 5; x.lineCap = "round";
  x.beginPath(); x.moveTo(x1, y1); x.lineTo(x2, y2); x.stroke();
  const a = Math.atan2(y2 - y1, x2 - x1), s = 16;
  x.beginPath(); x.moveTo(x2, y2); x.lineTo(x2 - s * Math.cos(a - .45), y2 - s * Math.sin(a - .45)); x.lineTo(x2 - s * Math.cos(a + .45), y2 - s * Math.sin(a + .45)); x.closePath(); x.fill();
}
export function saver(outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  return (name, c, q) => { const buf = c.toBuffer("image/webp", q || 72); fs.writeFileSync(path.join(outDir, name + ".webp"), buf); console.log(path.basename(outDir) + "/" + name, c.width + "x" + c.height, Math.round(buf.length / 1024) + "KB"); };
}
