// Cuts illustrations out of rendered rulebook pages: node crop.mjs <pagesDir> <outDir> <spec.json>
// spec: [{ name, page, box: [x0, y0, x1, y1] (in 864-wide page units), width }]
import fs from "node:fs";
import path from "node:path";
import { createCanvas, loadImage } from "@napi-rs/canvas";
const [, , pagesDir, outDir, specFile] = process.argv;
const spec = JSON.parse(fs.readFileSync(specFile, "utf8"));
fs.mkdirSync(outDir, { recursive: true });
const cache = new Map();
for (const s of spec) {
  const file = path.join(pagesDir, `page-${String(s.page).padStart(2, "0")}.png`);
  if (!cache.has(file)) cache.set(file, await loadImage(fs.readFileSync(file)));
  const img = cache.get(file), k = img.width / 864;
  const [x0, y0, x1, y1] = s.box.map(v => Math.round(v * k));
  const w = x1 - x0, h = y1 - y0, outW = Math.min(s.width || 900, w), outH = Math.round(h * outW / w);
  const c = createCanvas(outW, outH), ctx = c.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, x0, y0, w, h, 0, 0, outW, outH);
  const buf = c.toBuffer("image/webp", 70);
  fs.writeFileSync(path.join(outDir, s.name + ".webp"), buf);
  console.log(s.name, outW + "x" + outH, Math.round(buf.length / 1024) + "KB");
}
