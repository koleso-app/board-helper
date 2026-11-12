// Builds the Gold Fever («Жадюги») pictures: the cover from the publisher's photo of the box (sources/dl-goldfever/photo-02.jpg,
// Стиль Жизни), the bag from photo-05; the examples from the Russian rules (sources/dl-goldfever/gold-ru.pdf — two spreads,
// rendered at scale 4 into sources/gold-x/ru-N x4.png by render-one.mjs: spread 1 = pages 4 and 1, spread 2 = pages 2 and 3).
// Output: sources/assets/goldfever/<name>.webp (for the private repo). Run: node scripts/assets/goldfever-compose.mjs [name…]
import fs from "node:fs";
import path from "node:path";
import { root, createCanvas, loadImage, saver } from "./compose-kit.mjs";

const save = saver(path.join(root, "sources", "assets", "goldfever"));
const img = async p => loadImage(fs.readFileSync(path.join(root, "sources", p)));
function crop(im, [x0, y0, x1, y1], w) {
  const k = w / (x1 - x0), c = createCanvas(w, Math.round((y1 - y0) * k));
  c.getContext("2d").drawImage(im, x0, y0, x1 - x0, y1 - y0, 0, 0, c.width, c.height);
  return c;
}
const jobs = {
  // the box front, its upper square: the title and the hands with the nugget
  async "cover-square"() { save("cover-square", crop(await img("dl-goldfever/photo-02.jpg"), [274, 34, 732, 492], 512), 78); },
  // a bag with a few stones of each kind
  async bag() { save("bag", crop(await img("dl-goldfever/photo-05.jpg"), [170, 40, 990, 700], 640)); },
  // what is in the box: the kinds of stones and the bags (page 2, top)
  async components() { save("components", crop(await img("gold-x/ru-2x4.png"), [0, 0, 1693, 871], 720)); },
  // the example of a success: a nugget kept, two gravel given to another player (page 3, bottom)
  async success() { save("success", crop(await img("gold-x/ru-2x4.png"), [1780, 2128, 3386, 2536], 720)); },
  // the example of a bust: the second white gravel, everything back into the bag (page 4, top)
  async bust() { save("bust", crop(await img("gold-x/ru-1x4.png"), [0, 40, 1693, 650], 720)); },
};
const only = process.argv.slice(2);
for (const [name, job] of Object.entries(jobs)) if (!only.length || only.includes(name)) await job();
