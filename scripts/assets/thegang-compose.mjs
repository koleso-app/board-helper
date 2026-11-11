// Builds The Gang illustrations from the English rulebook rendered at scale 4 (sources/thegang-x4/page-NN.png,
// render-one.mjs): pieces of the book's pictures without the English words, with our Russian labels.
// Boxes are in pixels of those renders (1361×1928). Output: sources/assets/thegang/<name>.webp (for the private repo).
// Run: node scripts/assets/thegang-compose.mjs [name…]
import fs from "node:fs";
import path from "node:path";
import { root, createCanvas, loadImage, sheet, put, fit, text, tag, badge, saver, UI, UIB, INK, MUTED } from "./compose-kit.mjs";

const save = saver(path.join(root, "sources", "assets", "thegang"));
const pages = {};
const page = async n => (pages[n] ||= await loadImage(fs.readFileSync(path.join(root, "sources", "thegang-x4", `page-${String(n).padStart(2, "0")}.png`))));
async function cut(n, [x0, y0, x1, y1]) {
  const img = await page(n), c = createCanvas(x1 - x0, y1 - y0);
  c.getContext("2d").drawImage(img, x0, y0, x1 - x0, y1 - y0, 0, 0, c.width, c.height);
  return c;
}
const W = 720, PAPER = "#FBF8F2";

const jobs = {
  // the table of the book: vaults and alarms, the overview cards, the chips — numbered, the words under it
  async setup() {
    const img = await cut(3, [150, 635, 1172, 1508]);
    const h = img.height * W / img.width;
    const legend = [["1", "хранилища и сигнализация — серым вверх"], ["2", "каждому — две памятки"], ["3", "фишки — по числу игроков"]];
    save("setup", sheet(W, Math.round(h + 24 + 46 * legend.length), PAPER, x => {
      put(x, img, 0, 0, W);
      legend.forEach(([n, t], i) => { const y = h + 34 + i * 46; badge(x, n, 34, y, 17); text(x, t, 64, y + 9, { align: "left", size: 25 }); });
    }));
  },
  // what is in the box
  async materials() {
    const cells = [
      [[146, 253, 457, 496], "52 игральные карты"], [[583, 315, 869, 443], "3 хранилища"], [[929, 315, 1217, 443], "3 сигнализации"],
      [[156, 626, 459, 820], "памятки, по 6"], [[579, 632, 869, 826], "10 карт испытаний"], [[925, 618, 1219, 826], "10 карт специалистов"],
    ];
    const imgs = []; for (const [b] of cells) imgs.push(await cut(2, b));
    const CW = 232, CH = 150, TH = 46;
    save("materials", sheet(W, 2 * (CH + TH) + 20, PAPER, x => {
      cells.forEach(([, t], i) => {
        const col = i % 3, row = Math.floor(i / 3), X = 8 + col * (CW + 4), Y = 10 + row * (CH + TH);
        fit(x, imgs[i], X, Y, CW, CH);
        text(x, t, X + CW / 2, Y + CH + 30, { size: 21, maxW: CW - 6 });
      });
    }));
  },
  // the chips of the four rounds
  async chips() {
    const img = await cut(2, [146, 1118, 1225, 1287]);
    const h = img.height * W / img.width;
    const cols = [["белые", "раунд 1"], ["жёлтые", "раунд 2"], ["оранжевые", "раунд 3"], ["красные", "раунд 4"]];
    save("chips", sheet(W, Math.round(h + 104), PAPER, x => {
      put(x, img, 0, 0, W);
      cols.forEach(([c, r], i) => { const cx = W * (0.125 + 0.25 * i); text(x, c, cx, h + 34, { font: UIB(24) }); text(x, r, cx, h + 64, { size: 22, color: MUTED }); });
      text(x, "на каждой фишке от 1 до 6 звёзд", W / 2, h + 96, { size: 20, color: MUTED });
    }));
  },
  // a vault cracked, an alarm set off
  async flip() {
    const ok = await cut(8, [828, 100, 1259, 312]), bad = await cut(8, [828, 395, 1259, 600]);
    const w = 430, h1 = ok.height * w / ok.width, h2 = bad.height * w / bad.width;
    save("flip", sheet(W, Math.round(Math.max(h1, h2) + 110), PAPER, x => {
      put(x, ok, 0, 10, w * 0.8); put(x, bad, W - w * 0.8, 10, w * 0.8);
      const y = Math.max(h1, h2) * 0.8 + 50;
      text(x, "Удача: хранилище — золотом вверх", w * 0.4, y, { font: UIB(22), maxW: w * 0.8 - 10, lh: 27 });
      text(x, "Провал: сигнализация — красным вверх", W - w * 0.4, y, { font: UIB(22), maxW: w * 0.8 - 10, lh: 27 });
    }));
  },
  // the values of single cards, from weak to strong
  async values() {
    const img = await cut(9, [136, 415, 1225, 608]);
    const h = img.height * W / img.width;
    save("values", sheet(W, Math.round(h + 54), PAPER, x => {
      put(x, img, 0, 0, W);
      text(x, "слабее", 16, h + 36, { align: "left", font: UIB(24), color: MUTED });
      text(x, "сильнее: A, K, Q, J, 10 … 2", W - 16, h + 36, { align: "right", font: UIB(24) });
    }));
  },
  // the ten hand rankings, strongest first, with the book's example cards
  async ranking() {
    const rows = [
      [11, [107, 324, 465, 404], "Роял-флеш", "10 J Q K A одной масти"],
      [11, [107, 102, 465, 181], "Стрит-флеш", "5 подряд одной масти"],
      [10, [102, 1538, 465, 1617], "Каре", "4 одного значения"],
      [10, [102, 1297, 465, 1377], "Фулл-хаус", "тройка + пара"],
      [10, [102, 987, 465, 1066], "Флеш", "5 одной масти"],
      [10, [102, 726, 465, 805], "Стрит", "5 подряд"],
      [10, [102, 102, 465, 181], "Тройка", "3 одного значения"],
      [9, [109, 1560, 465, 1638], "Две пары", "2 + 2"],
      [9, [109, 1243, 465, 1320], "Пара", "2 одного значения"],
      [9, [109, 925, 465, 1003], "Старшая карта", "ничего из этого"],
    ];
    const imgs = []; for (const [p, b] of rows) imgs.push(await cut(p, b));
    const RH = 74;
    save("ranking", sheet(W, rows.length * RH + 70, PAPER, x => {
      text(x, "сильнее", 16, 30, { align: "left", font: UIB(20), color: MUTED });
      rows.forEach(([, , name, d], i) => {
        const y = 44 + i * RH;
        if (i % 2) { x.fillStyle = "rgba(0,0,0,.035)"; x.fillRect(0, y - 4, W, RH); }
        badge(x, i + 1, 26, y + RH / 2 - 4, 16);
        fit(x, imgs[i], 52, y, 300, RH - 8);
        text(x, name, 370, y + 30, { align: "left", font: UIB(25) });
        text(x, d, 370, y + 58, { align: "left", size: 21, color: MUTED });
      });
      text(x, "слабее", 16, rows.length * RH + 62, { align: "left", font: UIB(20), color: MUTED });
    }), 80);
  },
  // the showdown of the book: four players, their chips of the four rounds, the community cards in the middle
  async showdown() {
    const img = await cut(11, [109, 1039, 1252, 1780]);
    const h = img.height * W / img.width;
    // the players' names of the book stay (Trudy, Doris, Arsène, Danny); the caption is ours
    save("showdown", sheet(W, Math.round(h + 96), PAPER, x => {
      put(x, img, 0, 0, W);
      text(x, "Вскрытие вчетвером: решают красные фишки — руки открывают от 1 звезды к 4", W / 2, h + 38, { size: 23, maxW: W - 30, lh: 29 });
    }));
  },
};

const only = process.argv.slice(2).filter(a => !a.startsWith("--"));
for (const [name, job] of Object.entries(jobs)) if (!only.length || only.includes(name)) await job();
