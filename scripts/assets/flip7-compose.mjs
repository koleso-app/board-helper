// Builds the illustrations of Flip 7 and Flip 7: With A Vengeance from their rulebooks rendered large (the books are
// vector, so a scale-10 render is sharp): cards cut out one by one or as rows, set together with Russian labels.
// Input (private): sources/flip7-x10, sources/flip7v-x10 (render.mjs at scale 10). Output: sources/assets/flip7, flip7v.
// Boxes are in units of an 864-wide page. Run: node scripts/assets/flip7-compose.mjs [flip7|flip7v] [names…]
import { src, sheet, cut, put, fit, text, tag, badge, arrow, pixel, saver, createCanvas, UI, UIB, DISP, INK, MUTED, NAVY } from "./compose-kit.mjs";

const W = 720, PAPER = "#FDF6E3";
const F7 = "flip7-x10", V = "flip7v-x10";

// a row of cards with a name under each
async function namedRow(dir, page, boxes, names, o = {}) {
  const cards = []; for (const b of boxes) cards.push(await cut(dir, page, b));
  const n = cards.length, gap = 12, cw = (W - 24 - gap * (n - 1)) / n, ch = Math.max(...cards.map(c => c.height * cw / c.width));
  return sheet(W, Math.round(ch + 30 + (o.lines || 1) * 30 + 26), PAPER, x => {
    cards.forEach((c, i) => { const X = 12 + i * (cw + gap); put(x, c, X, 14, cw); text(x, names[i], X + cw / 2, ch + 48, { font: UIB(o.size || 21), maxW: cw + 8, lh: 25 }); });
  });
}
// one card, alone
async function single(save, dir, page, box, name) { const c = await cut(dir, page, box), w = 300, h = c.height * w / c.width, s = createCanvas(w, Math.round(h)); s.getContext("2d").drawImage(c, 0, 0, w, h); save(name, s, 78); }

const flip7 = {
  async "cover-square"(save) {
    const art = await cut(F7, 1, [100, 262, 796, 722]), s2 = 512, bg = pixel(art, 6, 6);
    // the top of «ПРАВИЛА» under the band gives way to the background
    const ax = art.getContext("2d"), k = art.width / 696; ax.fillStyle = bg; ax.fillRect((440 - 100) * k, (676 - 262) * k, (700 - 440) * k, (722 - 676) * k);
    save("cover-square", sheet(s2, s2, bg, x => fit(x, art, 8, 8, s2 - 16, s2 - 16)), 74);
  },
  // the number cards with their counts; the book's note in the corner gives way to ours
  async numbers(save) {
    const img = await cut(F7, 3, [30, 545, 830, 1080]), h = img.height * W / img.width;
    save("numbers", sheet(W, Math.round(h + 100), PAPER, x => {
      put(x, img, 0, 0, W);
      const k = W / 800; x.fillStyle = pixel(img, 10, img.height - 10); x.fillRect((505 - 30) * k, (912 - 545) * k, W, h);
      text(x, "«0» — очков не даёт, но входит в семь карт", (505 - 30) * k + 10, (960 - 545) * k, { align: "left", font: UIB(22), maxW: W - (505 - 30) * k - 20, lh: 27 });
      text(x, "79 числовых карт: каждой столько, каков номер (12 — двенадцать)", W / 2, h + 44, { size: 23, maxW: W - 30 });
    }));
  },
  // modifiers and actions together: the rest of the deck
  async specials(save) {
    const mods = await cut(F7, 4, [30, 140, 822, 297]), acts = await cut(F7, 4, [30, 440, 512, 602]);
    const mh = mods.height * W / mods.width, aw = W * 482 / 792, ah = acts.height * aw / acts.width;
    save("specials", sheet(W, Math.round(mh + ah + 150), PAPER, x => {
      tag(x, "6 модификаторов, по одной", 14, 28, { align: "left", size: 22 });
      put(x, mods, 0, 52, W);
      tag(x, "9 действий, по три", 14, mh + 86, { align: "left", size: 22 });
      put(x, acts, 0, mh + 110, aw);
      text(x, "«Заморозь!», «Переверни три!», «Вторая попытка!»", aw + 14, mh + 160, { align: "left", size: 21, maxW: W - aw - 20, lh: 26 });
    }));
  },
  async modifiers(save) {
    const img = await cut(F7, 4, [30, 140, 822, 297]), h = img.height * W / img.width;
    save("modifiers", sheet(W, Math.round(h + 66), PAPER, x => { put(x, img, 0, 0, W); text(x, "+2 … +10 добавляют очки, ×2 удваивает сумму чисел", W / 2, h + 42, { size: 23, maxW: W - 30 }); }));
  },
  actions: save => namedRow(F7, 4, [[33, 441, 138, 598], [196, 441, 301, 598], [360, 441, 465, 598]], ["«Заморозь!»", "«Переверни три!»", "«Вторая попытка!»"]).then(c => save("actions", c)),
  freeze: save => single(save, F7, 4, [33, 441, 138, 598], "freeze"),
  flip3: save => single(save, F7, 4, [196, 441, 301, 598], "flip3"),
  second: save => single(save, F7, 4, [360, 441, 465, 598], "second"),
  // a line of numbers and a modifier above it (the book's example)
  async line(save) {
    const img = await cut(F7, 6, [30, 36, 500, 490]), w = 520, h = img.height * w / img.width;
    save("line", sheet(W, Math.round(h + 20), PAPER, x => {
      put(x, img, 0, 10, w);
      text(x, "Числа — в линию, модификатор — над ней.", w + 10, 120, { align: "left", font: UIB(22), maxW: W - w - 16, lh: 27 });
      text(x, "11 + 5 + 12 = 28, с +4 — 32 очка", w + 10, 300, { align: "left", size: 22, maxW: W - w - 16, lh: 27 });
    }));
  },
  // the scoring order with real cards: numbers, ×2, modifiers, +15
  async score(save) {
    const nums = []; for (const b of [[687, 732, 786, 886], [198, 548, 298, 703], [362, 732, 462, 886], [35, 732, 135, 886], [362, 548, 462, 703]]) nums.push(await cut(F7, 3, b));
    const x2 = await cut(F7, 4, [684, 143, 784, 295]), p4 = await cut(F7, 4, [164, 143, 264, 295]);
    const cw = 96, ch = 144;
    save("score", sheet(W, 560, PAPER, x => {
      const row = (y, label) => { badge(x, label, 26, y + ch / 2, 18); };
      row(16, 1); nums.forEach((c, i) => fit(x, c, 52 + i * (cw + 8), 16, cw, ch)); text(x, "= 36", 52 + 5 * (cw + 8) + 10, 16 + ch / 2 + 12, { align: "left", font: DISP(30) });
      text(x, "Сложите числа", 52, ch + 50, { align: "left", font: UIB(22) });
      const y2 = ch + 80;
      badge(x, 2, 26, y2 + ch / 2, 18); fit(x, x2, 52, y2, cw, ch); text(x, "×2 — удвойте сумму чисел: 72", 160, y2 + ch / 2 + 8, { align: "left", font: UIB(23), maxW: 180, lh: 28 });
      badge(x, 3, 380, y2 + ch / 2, 18); fit(x, p4, 406, y2, cw, ch); text(x, "+4 — прибавьте: 76", 512, y2 + ch / 2 + 8, { align: "left", font: UIB(23), maxW: 200, lh: 28 });
      const y3 = y2 + ch + 40;
      badge(x, 4, 26, y3 + 20, 18); text(x, "Семь разных чисел («Подкидной 7») — ещё +15, после ×2", 56, y3 + 28, { align: "left", font: UIB(23), maxW: W - 70, lh: 29 });
      text(x, "Бонус 15 не удваивается.", 56, y3 + 96, { align: "left", size: 22, color: MUTED });
    }));
  },
};

const flip7v = {
  async "cover-square"(save) {
    const art = await cut(V, 1, [100, 150, 842, 935]);
    const ax = art.getContext("2d"), k = art.width / 742; ax.fillStyle = pixel(art, Math.round(60 * k), Math.round(730 * k)); ax.fillRect((582 - 100) * k, (862 - 150) * k, art.width, art.height);
    const s2 = 512;
    save("cover-square", sheet(s2, s2, pixel(art, Math.round(60 * k), Math.round(730 * k)), x => fit(x, art, 6, 6, s2 - 12, s2 - 12)), 74);
  },
  async numbers(save) {
    const img = await cut(V, 3, [30, 548, 830, 1085]), h = img.height * W / img.width, k = W / 800;
    save("numbers", sheet(W, Math.round(h + 70), PAPER, x => {
      put(x, img, 0, 0, W);
      x.fillStyle = pixel(img, 10, img.height - 10); x.fillRect((497 - 30) * k, (905 - 548) * k, W, h);
      text(x, "+ 3 особые: «Зеро», «Несчастливая 7», «Счастливая 13»", (497 - 30) * k + 10, (950 - 548) * k, { align: "left", font: UIB(22), maxW: W - (497 - 30) * k - 20, lh: 27 });
      text(x, "Числа 1–13: каждого столько, каков номер (13 — тринадцать)", W / 2, h + 44, { size: 23, maxW: W - 30 });
    }));
  },
  async specials(save) {
    const z = await cut(V, 9, [30, 403, 145, 577]), u = await cut(V, 9, [30, 742, 145, 916]), l = await cut(V, 10, [32, 27, 152, 210]);
    const cw = 200;
    save("specials", sheet(W, 400, PAPER, x => {
      [[z, "«Зеро»"], [u, "«Несчастливая 7»"], [l, "«Счастливая 13»"]].forEach(([c, n], i) => { const X = 20 + i * 235; fit(x, c, X, 14, cw, 300); text(x, n, X + cw / 2, 350, { font: UIB(22), maxW: 220 }); });
    }));
  },
  async modifiers(save) {
    const img = await cut(V, 4, [30, 125, 822, 287]), h = img.height * W / img.width;
    save("modifiers", sheet(W, Math.round(h + 66), PAPER, x => { put(x, img, 0, 0, W); text(x, "−2 … −10 отнимают очки, ÷2 делит сумму чисел пополам", W / 2, h + 42, { size: 23, maxW: W - 30 }); }));
  },
  actions: save => namedRow(V, 4, [[33, 409, 135, 568], [186, 409, 288, 568], [339, 409, 441, 568], [493, 409, 595, 568], [646, 409, 748, 568]],
    ["«Ещё одну!»", "«Переверни четыре!»", "«Обмен»", "«Кража»", "«Сброс»"], { size: 18, lines: 2 }).then(c => save("actions", c)),
  async line(save) {
    const img = await cut(V, 5, [45, 293, 818, 455]), h = img.height * W / img.width;
    save("line", sheet(W, Math.round(h + 100), PAPER, x => { put(x, img, 0, 0, W); text(x, "Семь разных чисел — «Подкидной 7»: +15, раунд сразу заканчивается", W / 2, h + 44, { size: 23, maxW: W - 30 }); }));
  },
  // the book's example: 48, ÷2 = 24, −4 = 20, +15 = 35
  async example(save) {
    const nums = await cut(V, 7, [35, 512, 440, 602]), half = await cut(V, 7, [492, 512, 550, 602]), m4 = await cut(V, 7, [603, 512, 661, 602]);
    const nh = nums.height * W / nums.width;
    save("example", sheet(W, Math.round(nh + 300), PAPER, x => {
      put(x, nums, 0, 10, W);
      text(x, "3 + 11 + 5 + 7 + 10 + 8 + 4 = 48", W / 2, nh + 50, { font: UIB(24) });
      const y = nh + 80, cw = 90, ch = 140;
      fit(x, half, 30, y, cw, ch); text(x, "÷2 — 24", 30 + cw + 12, y + ch / 2 + 9, { align: "left", font: DISP(26) });
      fit(x, m4, 290, y, cw, ch); text(x, "−4 — 20", 290 + cw + 12, y + ch / 2 + 9, { align: "left", font: DISP(26) });
      text(x, "+15 — 35", 690, y + ch / 2 + 9, { align: "right", font: DISP(26), color: "#C0392B" });
      text(x, "Сначала ÷2 (вниз), потом вычеты, в конце +15 за семь чисел", W / 2, y + ch + 44, { size: 22, maxW: W - 30 });
    }));
  },
  zero: save => single(save, V, 9, [30, 403, 145, 577], "zero"),
  unlucky7: save => single(save, V, 9, [30, 742, 145, 916], "unlucky7"),
  lucky13: save => single(save, V, 10, [32, 27, 152, 210], "lucky13"),
  justonemore: save => single(save, V, 11, [27, 22, 144, 197], "justonemore"),
  swap: save => single(save, V, 11, [27, 235, 144, 410], "swap"),
  steal: save => single(save, V, 11, [27, 443, 144, 618], "steal"),
  discard: save => single(save, V, 11, [27, 648, 144, 826], "discard"),
  flip4: save => single(save, V, 11, [27, 854, 144, 1040], "flip4"),
};

const [game, ...only] = process.argv.slice(2);
for (const [id, jobs] of [["flip7", flip7], ["flip7v", flip7v]]) {
  if (game && game !== id) continue;
  const save = saver(src("assets/" + id));
  for (const [name, job] of Object.entries(jobs)) if (!only.length || only.includes(name)) await job(save);
}
