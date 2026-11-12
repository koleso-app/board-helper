// Builds the Coconuts («Кокосики») pictures: the cover from the box on the publisher's promo picture
// (sources/dl-coconuts/coco-cover.png, Choo Choo Games), straightened; the rest from the Russian rules
// (sources/dl-coconuts/coco-ru.pdf, pages rendered at scale 4 into sources/coco-x/ru-N x4.png by render-one.mjs).
// Output: sources/assets/coconuts/<name>.webp (for the private repo). Run: node scripts/assets/coconuts-compose.mjs [name…]
import fs from "node:fs";
import path from "node:path";
import { root, createCanvas, loadImage, saver, text, UIB, INK } from "./compose-kit.mjs";

const save = saver(path.join(root, "sources", "assets", "coconuts"));
const page = async n => loadImage(fs.readFileSync(path.join(root, "sources", "coco-x", `ru-${n}x4.png`)));
function crop(img, [x0, y0, x1, y1], w) {
  const k = w / (x1 - x0), c = createCanvas(w, Math.round((y1 - y0) * k));
  c.getContext("2d").drawImage(img, x0, y0, x1 - x0, y1 - y0, 0, 0, c.width, c.height);
  return c;
}
// the box front stands at an angle on the promo picture: map the unit square onto its four corners (a projective map)
// and sample the picture back, so the front comes out flat
function homography([[x0, y0], [x1, y1], [x2, y2], [x3, y3]]) {   // corners: top-left, top-right, bottom-right, bottom-left
  const dx1 = x1 - x2, dx2 = x3 - x2, sx = x0 - x1 + x2 - x3, dy1 = y1 - y2, dy2 = y3 - y2, sy = y0 - y1 + y2 - y3;
  const den = dx1 * dy2 - dx2 * dy1, g = (sx * dy2 - dx2 * sy) / den, h = (dx1 * sy - sx * dy1) / den;
  const a = x1 - x0 + g * x1, b = x3 - x0 + h * x3, d = y1 - y0 + g * y1, e = y3 - y0 + h * y3;
  return (u, v) => { const w = g * u + h * v + 1; return [(a * u + b * v + x0) / w, (d * u + e * v + y0) / w]; };
}
function straighten(img, quad, size, inset) {
  const sc = createCanvas(img.width, img.height), sx = sc.getContext("2d"); sx.drawImage(img, 0, 0);
  const src = sx.getImageData(0, 0, img.width, img.height), W = img.width;
  const out = createCanvas(size, size), ox = out.getContext("2d"), dst = ox.createImageData(size, size), map = homography(quad);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const u = inset + (1 - 2 * inset) * (i + 0.5) / size, v = inset + (1 - 2 * inset) * (j + 0.5) / size;
    const [X, Y] = map(u, v), x0 = Math.floor(X), y0 = Math.floor(Y), fx = X - x0, fy = Y - y0, o = (j * size + i) * 4;
    for (let k = 0; k < 4; k++) {   // bilinear
      const p = (yy, xx) => src.data[(yy * W + xx) * 4 + k];
      dst.data[o + k] = (p(y0, x0) * (1 - fx) + p(y0, x0 + 1) * fx) * (1 - fy) + (p(y0 + 1, x0) * (1 - fx) + p(y0 + 1, x0 + 1) * fx) * fy;
    }
  }
  ox.putImageData(dst, 0, 0);
  return out;
}

// the stacks named under a layout, as the rules mark them: a single ring — a yellow cup in a red one, a double ring — two yellow
function withLegend(pic, rows) {
  const H = 64, c = createCanvas(pic.width, pic.height + rows.length * H + 16), x = c.getContext("2d");
  x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); x.drawImage(pic, 0, 0);
  rows.forEach(([double, label], i) => {
    const cy = pic.height + 8 + i * H + H / 2;
    x.strokeStyle = INK; x.lineWidth = 3.5;
    x.beginPath(); x.arc(44, cy, 17, 0, Math.PI * 2); x.stroke();
    if (double) { x.beginPath(); x.arc(44, cy, 10, 0, Math.PI * 2); x.stroke(); }
    text(x, label, 78, cy + 11, { font: UIB(30), align: "left" });
  });
  return c;
}
const jobs = {
  // the box: its front corners on the 2160 × 1440 promo picture; the white rim of the lid trimmed
  async "cover-square"() {
    const img = await loadImage(fs.readFileSync(path.join(root, "sources", "dl-coconuts", "coco-cover.png")));
    const big = straighten(img, [[340, 295], [1090, 310], [950, 1180], [197, 1020]], 1024, 0.035);
    save("cover-square", crop(big, [0, 0, 1024, 1024], 512), 76);
  },
  // the cups for 2 or 4 players: a square of 3 × 3, with the two kinds of stacks named
  async cups4() { const img = await page(3); save("cups4", withLegend(crop(img, [150, 448, 800, 1092], 640), [[false, "в углах — жёлтая в красной"], [true, "в центре — жёлтая в жёлтой"]])); },
  // the cups for 3 players: a triangle of 10 places
  async cups3() { const img = await page(3); save("cups3", withLegend(crop(img, [880, 448, 1530, 1092], 640), [[false, "4 места — жёлтая в красной"]])); },
  // what each player takes: the launcher, the board with its stumps, the magic cards, the coconuts
  async kit() { const img = await page(2); save("kit", crop(img, [60, 1230, 1640, 2330], 720)); },
  // the cups taken: three on the stumps, then the pyramid of six
  async pyramid() { const img = await page(3); save("pyramid", crop(img, [1000, 1600, 1400, 1990], 480)); },
  // the six magic cards with their pictures
  async cards() { const img = await page(4); save("cards", crop(img, [60, 1180, 1640, 2240], 720)); },
};
const only = process.argv.slice(2);
for (const [name, job] of Object.entries(jobs)) if (!only.length || only.includes(name)) await job();
