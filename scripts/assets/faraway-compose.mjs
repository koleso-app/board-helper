// Builds the Faraway illustrations from the sharp English rulebook and player aid: cards, icons and drawings
// are cut out without the English text and set together with our Russian labels.
// Input (private, not published): sources/faraway-en-hi (rulebook spreads rendered at scale 5, render.mjs),
// sources/faraway-aid-en-x6 (the aid at scale 6), sources/dl-faraway-press/png (the publisher's press pictures, Catch Up Games).
// Output: sources/assets/faraway/<name>.webp (for the private repo). The words are the official Russian edition's («Эврикус»).
// Boxes are in the units of the scale-1 render (a spread is 624×482, the aid page 312×482).
// Run: node scripts/assets/faraway-compose.mjs [--grid]   (--grid draws a coordinate grid to place labels)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage, GlobalFonts } from "@napi-rs/canvas";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const src = p => path.join(root, "sources", p), out = path.join(root, "sources", "assets", "faraway");
fs.mkdirSync(out, { recursive: true });
const GRID = process.argv.includes("--grid");
for (const [f, fam] of [["onest-cyrillic-600-normal", "OnestC"], ["onest-latin-600-normal", "OnestL"], ["onest-cyrillic-700-normal", "OnestCB"], ["onest-latin-700-normal", "OnestLB"],
  ["unbounded-cyrillic-700-normal", "UnbC"], ["unbounded-latin-700-normal", "UnbL"]]) GlobalFonts.registerFromPath(path.join(root, "app", "fonts", f + ".woff2"), fam);
const UI = s => `${s}px OnestL, OnestC`, UIB = s => `${s}px OnestLB, OnestCB`, DISP = s => `${s}px UnbL, UnbC`;

const PAPER = "#FBF7EF", INK = "#2E2238", PURPLE = "#4A3560", MUTED = "#6B6358", ACCENT = "#E0603B", YELLOW = "#F2C230";
const pages = {}, aid = {};
const page = async n => (pages[n] ||= await loadImage(fs.readFileSync(src(`faraway-en-hi/page-${String(n).padStart(2, "0")}.png`))));
const aidPage = async n => (aid[n] ||= await loadImage(fs.readFileSync(src(`faraway-aid-en-x6/page-${String(n).padStart(2, "0")}.png`))));
// a piece of a page: box in scale-1 units, k = the render scale
async function piece(img, k, [x0, y0, x1, y1]) {
  const c = createCanvas(Math.round((x1 - x0) * k), Math.round((y1 - y0) * k));
  c.getContext("2d").drawImage(img, x0 * k, y0 * k, (x1 - x0) * k, (y1 - y0) * k, 0, 0, c.width, c.height);
  return c;
}
const book = async (n, box) => piece(await page(n), 5, box);
const aidBox = async (n, box) => piece(await aidPage(n), 6, box);

// a canvas of width W on paper; draw(ctx) places things; height grows to fit
function sheet(W, H, draw) {
  const c = createCanvas(W, H), x = c.getContext("2d");
  x.fillStyle = PAPER; x.fillRect(0, 0, W, H);
  x.textBaseline = "alphabetic";
  draw(x, c);
  if (GRID) { x.strokeStyle = "rgba(255,0,0,.35)"; x.lineWidth = 1; x.font = UI(14); x.fillStyle = "red"; for (let i = 0; i < W; i += 50) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, H); x.stroke(); x.fillText(String(i), i + 2, 14); } for (let j = 0; j < H; j += 50) { x.beginPath(); x.moveTo(0, j); x.lineTo(W, j); x.stroke(); x.fillText(String(j), 2, j - 2); } }
  return c;
}
// an image scaled to width w at (x, y); returns its height
const put = (x, img, X, Y, w) => { const h = img.height * w / img.width; x.drawImage(img, X, Y, w, h); return h; };
// text, centered or left; wraps to maxW
function text(x, s, X, Y, o = {}) {
  x.font = o.font || UI(o.size || 26); x.fillStyle = o.color || INK; x.textAlign = o.align || "center";
  const words = String(s).split(" "), lines = []; let line = "";
  for (const w of words) { const t = line ? line + " " + w : w; if (o.maxW && x.measureText(t).width > o.maxW && line) { lines.push(line); line = w; } else line = t; }
  lines.push(line);
  const lh = o.lh || (o.size || 26) * 1.25;
  lines.forEach((l, i) => x.fillText(l, X, Y + i * lh));
  return lines.length * lh;
}
// a label in a rounded box (purple with white text by default)
function tag(x, s, X, Y, o = {}) {
  const size = o.size || 24; x.font = o.font || UIB(size);
  const w = x.measureText(s).width + 2 * (o.pad || 14), h = size + 18;
  const L = o.align === "left" ? X : o.align === "right" ? X - w : X - w / 2;
  x.fillStyle = o.bg || PURPLE; roundRect(x, L, Y - h / 2, w, h, h / 2); x.fill();
  x.fillStyle = o.color || "#fff"; x.textAlign = "center"; x.fillText(s, L + w / 2, Y + size * 0.36);
  return { L, R: L + w, T: Y - h / 2, B: Y + h / 2 };
}
function roundRect(x, X, Y, w, h, r) { x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + w, Y, X + w, Y + h, r); x.arcTo(X + w, Y + h, X, Y + h, r); x.arcTo(X, Y + h, X, Y, r); x.arcTo(X, Y, X + w, Y, r); x.closePath(); }
function arrow(x, x1, y1, x2, y2, color) {
  x.strokeStyle = color || ACCENT; x.fillStyle = color || ACCENT; x.lineWidth = 5; x.lineCap = "round";
  x.beginPath(); x.moveTo(x1, y1); x.lineTo(x2, y2); x.stroke();
  const a = Math.atan2(y2 - y1, x2 - x1), s = 16;
  x.beginPath(); x.moveTo(x2, y2); x.lineTo(x2 - s * Math.cos(a - .45), y2 - s * Math.sin(a - .45)); x.lineTo(x2 - s * Math.cos(a + .45), y2 - s * Math.sin(a + .45)); x.closePath(); x.fill();
}
function badge(x, n, X, Y, r) { x.fillStyle = YELLOW; x.beginPath(); x.arc(X, Y, r || 22, 0, Math.PI * 2); x.fill(); x.strokeStyle = INK; x.lineWidth = 3; x.stroke(); x.fillStyle = INK; x.font = DISP((r || 22) * 1.05); x.textAlign = "center"; x.fillText(String(n), X, Y + (r || 22) * 0.38); }
function save(name, c, q) { const buf = c.toBuffer("image/webp", q || 70); fs.writeFileSync(path.join(out, name + ".webp"), buf); console.log(name, c.width + "x" + c.height, Math.round(buf.length / 1024) + "KB"); }

/* ---------- the pictures ---------- */
const W = 720;
// a black-on-paper drawing turned into lines of one colour on a clear background
function inkify(c, color) {
  const x = c.getContext("2d"), d = x.getImageData(0, 0, c.width, c.height), a = d.data;
  const [R, G, B] = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));
  for (let i = 0; i < a.length; i += 4) {
    const L = (0.299 * a[i] + 0.587 * a[i + 1] + 0.114 * a[i + 2]) / 255;
    const k = Math.max(0, Math.min(1, (0.78 - L) / 0.5));
    a[i] = R; a[i + 1] = G; a[i + 2] = B; a[i + 3] = Math.round(255 * k);
  }
  x.putImageData(d, 0, 0);
  return c;
}
const pixel = (c, X, Y) => { const d = c.getContext("2d").getImageData(X, Y, 1, 1).data; return "#" + [d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, "0")).join(""); };
// a picture with a caption strip under it
async function captioned(name, pg, box, caption, o = {}) {
  const img = await book(pg, box), w = o.w || W, h = img.height * w / img.width;
  const c = sheet(w, Math.round(h + (o.strip || 72)), x => { put(x, img, 0, 0, w); text(x, caption, w / 2, h + 44, { size: o.size || 25, maxW: w - 30, font: o.font }); });
  save(name, c);
}
const jobs = {
  // the example of the player aid: the cards of each step, the words ours (checked against the English aid)
  async example() {
    const steps = [
      [[20, 68, 295, 116], "Первой открывается последняя карта, 28: 3 славы за каждый окико. Окико нет — 0."],
      [[20, 152, 295, 201], "Вторая, 14: 2 славы за каждую ночную карту. Ночная одна — 28, итого 2."],
      [[20, 249, 295, 296], "Третья, 49: 12 славы, если есть 2 удду и золотолоз. Золотолоз — на 14, удду — на 28 и на левом Святилище: 12."],
      [[20, 367, 295, 415], "Четвёртая, 44: удду и золотолоз есть. 2 славы за каждый Город и каждую Пустыню: Город 44, Пустыня 49 и Святилище-Пустыня — 6."],
    ];
    const rows = []; for (const [b] of steps) rows.push(await aidBox(2, b));
    const probe = createCanvas(W, 10).getContext("2d"); probe.font = UI(24);
    const lines = t => { let n = 1, line = ""; for (const w of t.split(" ")) { const tt = line ? line + " " + w : w; if (probe.measureText(tt).width > W - 80 && line) { n++; line = w; } else line = tt; } return n; };
    const rowH = rows[0].height * W / rows[0].width;
    let H = 20; for (const [, t] of steps) H += lines(t) * 30 + 16 + rowH + 26;
    const last = "Святилища: левое без задания — 0. Второе — 1 слава за подсказку: на нём самом и на 49 — 2.";
    H += lines(last) * 30 + 40;
    save("example", sheet(W, Math.round(H), x => {
      let y = 20;
      steps.forEach(([, t], i) => {
        badge(x, i + 1, 26, y + 14, 17);
        const th = text(x, t, 56, y + 22, { align: "left", size: 24, maxW: W - 80, lh: 30 });
        y += th + 16;
        put(x, rows[i], 0, y, W); y += rowH + 26;
      });
      badge(x, 5, 26, y + 14, 17);
      text(x, last, 56, y + 22, { align: "left", size: 24, maxW: W - 80, lh: 30 });
    }), 68);
  },
  async "cover-square"() {
    const art = await book(1, [10, 8, 302, 236]);
    const s2 = 512, c = createCanvas(s2, s2), x = c.getContext("2d");
    x.fillStyle = pixel(art, 4, art.height - 4); x.fillRect(0, 0, s2, s2);
    const k = Math.min(s2 / art.width, s2 / art.height) * 0.98, w = art.width * k, h = art.height * k;
    x.drawImage(art, (s2 - w) / 2, (s2 - h) / 2, w, h);
    save("cover-square", c, 74);
  },
  // setup: the table of the book with its numbers, and what each number is
  async setup() {
    const img = await loadImage(fs.readFileSync(src("dl-faraway-press/png/visuel-miseenplace.png")));
    const h = img.height * W / img.width;
    const legend = [["1", "по 3 карты Регионов каждому"], ["2", "рынок: игроков + 1 — за столом 5, карт 6"], ["3", "колода Регионов"], ["4", "колода Святилищ"]];
    save("setup", sheet(W, Math.round(h + 24 + 46 * legend.length), x => {
      x.drawImage(img, 0, 0, W, h);
      [[43, 330], [175, 205], [455, 112], [290, 106]].forEach(([X, Y], i) => badge(x, i + 1, X, Y, 19));
      legend.forEach(([n, t], i) => { const y = h + 34 + i * 46; badge(x, n, 34, y, 17); text(x, t, 64, y + 9, { align: "left", size: 25 }); });
    }));
  },
  async center() {
    const boxes = [[6, [489, 96, 527, 121]], [6, [528, 99, 565, 123]], [6, [568, 103, 603, 127]], [6, [480, 123, 522, 152]], [5, [401, 252, 457, 298]], [6, [564, 130, 605, 162]]];
    const cards = []; for (const [pg, b] of boxes) cards.push(await book(pg, b));
    save("center", sheet(W, 420, x => {
      const cw = 210, chh = 150;
      cards.forEach((c, i) => { const col = i % 3, row = Math.floor(i / 3), k = Math.min(cw / c.width, chh / c.height), w = c.width * k, h = c.height * k; x.drawImage(c, 24 + col * 232 + (cw - w) / 2, 16 + row * 170 + (chh - h) / 2, w, h); });
      tag(x, "Рынок: 5 игроков — 6 карт", W / 2, 385, { size: 26 });
    }));
  },
  async decks() {
    const reg = await book(3, [35, 72, 96, 123]), san = await book(3, [137, 72, 180, 116]);
    save("decks", sheet(W, 330, x => {
      const rh = put(x, reg, 60, 20, 270); put(x, san, 430, 30, 200);
      tag(x, "68 карт Регионов", 195, 295, { size: 24 }); tag(x, "45 карт Святилищ", 530, 295, { size: 24, bg: "#6B5A80" });
    }));
  },
  tableau: () => captioned("tableau", 3, [10, 369, 297, 458], "Святилища — отдельно, 8 Регионов — по порядку, слева направо", { strip: 100 }),
  async biomes() {
    const img = await book(4, [15, 72, 190, 128]);
    const h = img.height * W / img.width;
    save("biomes", sheet(W, Math.round(h + 66), x => {
      put(x, img, 0, 0, W);
      ["Пустыня", "Лес", "Река", "Город"].forEach((n, i) => text(x, n, W * (0.125 + 0.245 * i), h + 44, { font: UIB(27) }));
    }));
  },
  // a Region card: numbered marks on the picture, the words under it
  async card() {
    const img = await book(4, [165, 66, 516, 382]);
    const h = img.height * W / img.width;
    const legend = [
      ["1", "номер — время исследования, у каждой карты свой (1–68); светлое кольцо — день"],
      ["2", "тёмное кольцо — ночь"],
      ["3", "подсказка"],
      ["4", "ресурс — здесь окико"],
      ["5", "условие задания: нужные ресурсы"],
      ["6", "слава за выполненное задание"],
    ];
    save("card", sheet(W, Math.round(h + 40 + 62 * legend.length), x => {
      put(x, img, 0, 0, W);
      x.fillStyle = PAPER; x.fillRect(512, 0, W - 512, 82); x.fillRect(575, 0, W - 575, 130); x.fillRect(0, 0, 54, 130); x.fillRect(600, 528, W - 600, h - 528); x.fillRect(0, 598, 96, h - 598);
      [[147, 250], [145, 30], [318, 268], [385, 135], [370, 430], [370, 530]].forEach(([X, Y], i) => badge(x, i + 1, X, Y, 20));
      legend.forEach(([n, t], i) => { const y = h + 40 + i * 62; badge(x, n, 34, y, 18); text(x, t, 66, y + 9, { align: "left", size: 24, maxW: W - 80, lh: 28 }); });
    }));
  },
  // the three wonders, redrawn in our ink, with their names
  async wonders() {
    const st = inkify(await book(2, [327, 37, 387, 137]), INK), ch = inkify(await book(2, [503, 170, 593, 276]), INK), th = inkify(await book(2, [324, 328, 387, 438]), INK);
    const icons = await book(4, [512, 14, 610, 50]);
    save("wonders", sheet(W, 500, x => {
      const col = (img, cx, name) => { const hh = 250, w = img.width * hh / img.height, s2 = Math.min(1, 200 / w); x.drawImage(img, cx - w * s2 / 2, 20 + (hh - hh * s2) / 2, w * s2, hh * s2); text(x, name, cx, 310, { font: UIB(24), maxW: 220, lh: 28 }); };
      col(st, 120, "Удду"); col(ch, 360, "Окико"); col(th, 600, "Золотолоз");
      put(x, icons, 230, 365, 260);
      text(x, "чаще всего — удду, реже всего — золотолоз", W / 2, 480, { size: 23, color: MUTED });
    }));
  },
  // a quest with a prerequisite: the resources it needs, and the fame it gives
  async quest() {
    const pre = await book(4, [537, 268, 609, 323]), fame = await book(4, [352, 322, 396, 366]);
    save("quest", sheet(W, 360, x => {
      put(x, pre, 30, 30, 300);
      arrow(x, 350, 140, 440, 140);
      put(x, fame, 470, 40, 200);
      text(x, "условие: 2 окико и 1 золотолоз", 180, 300, { font: UIB(24), maxW: 320, lh: 28 });
      text(x, "есть — 15 славы", 570, 300, { font: UIB(24) });
    }));
  },
  // sanctuary cards: the bonus on top, the side quest below
  async sanctuaries() {
    const img = await book(5, [36, 84, 276, 324]);
    const h = img.height * W / img.width;
    save("sanctuaries", sheet(W, Math.round(h + 70), x => {
      put(x, img, 0, 0, W);
      // the English note of the book sits in the top left corner: our Russian one in its place
      x.fillStyle = PAPER; x.fillRect(0, 0, 300, 200);
      text(x, "Вверху — бонус: подсказки, ресурсы или ночь", 14, 50, { align: "left", font: UIB(27), maxW: 280, lh: 34 });
      text(x, "Внизу у некоторых — побочное задание на славу", W / 2, h + 44, { size: 25, maxW: W - 30 });
    }));
  },
  "sanct-biome": () => captioned("sanct-biome", 5, [14, 371, 137, 451], "Святилище с цветом считается Регионом этого биома, со значком ночи — ночной картой", { strip: 100 }),
  async phases() {
    const img = await book(5, [330, 67, 606, 95]);
    const h = img.height * W / img.width;
    save("phases", sheet(W, Math.round(h + 80), x => {
      put(x, img, 0, 0, W);
      [["Исследование Региона", 0.17], ["Обнаружение Святилищ", 0.5], ["Добор карт Регионов", 0.84]].forEach(([t, f]) => text(x, t, W * f, h + 34, { font: UIB(23), maxW: 220, lh: 27 }));
    }));
  },
  explore: () => captioned("explore", 5, [340, 250, 602, 386], "Все вместе кладут карту рубашкой вверх, затем вскрывают — справа от прошлой", { strip: 100 }),
  // finding sanctuaries: the example of the book (49 after 15; clues on the sanctuary, on 15 and on 49)
  async find() {
    const row = await book(6, [25, 205, 297, 267]), fan = await book(6, [160, 286, 295, 369]);
    const h1 = row.height * W / row.width;
    save("find", sheet(W, Math.round(h1 + 300), x => {
      put(x, row, 0, 0, W);
      put(x, fan, W - 300, h1 + 20, 280);
      text(x, "49 после 15 — номер больше: Святилище.", 20, h1 + 60, { align: "left", font: UIB(25), maxW: 390, lh: 31 });
      text(x, "Подсказок 3 — на Святилище, на 15 и на 49. Берёте 1 + 3 = 4 карты, оставите одну.", 20, h1 + 150, { align: "left", size: 24, maxW: 390, lh: 30 });
    }));
  },
  // the end of the exploration: a card from the center in turn; the leftover goes
  async leftover() {
    const take = await book(6, [478, 95, 607, 206]), gone = await book(6, [326, 338, 458, 466]);
    save("leftover", sheet(W, 480, x => {
      put(x, take, 10, 10, 340); put(x, gone, 380, 20, 330);
      text(x, "По очереди, от наименьшего номера, — карту с рынка в руку", 180, 420, { font: UIB(22), maxW: 330, lh: 27 });
      text(x, "Оставшуюся — из игры, затем новый рынок: игроков + 1", 545, 420, { font: UIB(22), maxW: 330, lh: 27 });
    }));
  },
  // the kinds of quests: the icons of the aid with our Russian words (the Russian aid has a mistake in the first row)
  async "scoring-icons"() {
    const rows = ["1 слава за каждую видимую подсказку", "4 — за каждый видимый окико", "2 — за каждый видимый удду", "3 — за каждый видимый золотолоз",
      "2 — за каждую карту Города и каждую — Реки", "4 — за каждую карту Леса", "10 — за каждый набор из 4 разных биомов", "4 — за каждую ночную карту", "19 — просто столько славы"];
    const icons = [];
    for (let i = 0; i < rows.length; i++) { const c = 60.5 + 26.65 * i; icons.push(await aidBox(1, [22, c - 12.5, 92, c + 12.5])); }
    const paperA = pixel(icons[0], 4, 4), band = pixel(icons[1], 4, 4);
    const RH = 84;
    save("scoring-icons", sheet(W, rows.length * RH + 110, x => {
      x.fillStyle = paperA; x.fillRect(0, 0, W, rows.length * RH + 110);
      rows.forEach((t, i) => {
        const y = 10 + i * RH;
        x.fillStyle = i % 2 ? band : paperA; x.fillRect(0, y, W, RH);
        const ih = put(x, icons[i], 10, y + 2, 230);
        text(x, t, 260, y + RH / 2 + 8, { align: "left", size: 25, maxW: W - 270, lh: 29 });
      });
      text(x, "Числа на картах свои. Видимые — открытые Регионы и все Святилища.", W / 2, rows.length * RH + 55, { size: 22, color: MUTED, maxW: W - 30 });
    }));
  },
};

const only = process.argv.slice(2).filter(a => !a.startsWith("--"));
for (const [name, job] of Object.entries(jobs)) if (!only.length || only.includes(name)) await job();
