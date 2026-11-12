// Builds the «Битва игрушек» (Toy Battle) pictures: the cover from the publisher's photo of the box (sources/dl-toy/cover.png,
// choochoogames.ru); the rest from the Russian rules of Choo Choo Games (sources/dl-toy/toy-ru.pdf — two spreads of three pages,
// rendered at scale 3 into sources/toy-x/ru-Nx3.png by render-one.mjs: spread 1 = pages 5, 6, 1; spread 2 = pages 2, 3, 4).
// Boxes are given in the spread at scale 0.6 (1046 wide) and scaled to the big render.
// Output: sources/assets/toybattle/<name>.webp (for the private repo). Run: node scripts/assets/toybattle-compose.mjs [name…]
import fs from "node:fs";
import path from "node:path";
import { root, createCanvas, loadImage, saver } from "./compose-kit.mjs";

const save = saver(path.join(root, "sources", "assets", "toybattle"));
const img = async p => loadImage(fs.readFileSync(path.join(root, "sources", p)));
function crop(im, [x0, y0, x1, y1], w) {
  const k = w / (x1 - x0), c = createCanvas(w, Math.round((y1 - y0) * k));
  c.getContext("2d").drawImage(im, x0, y0, x1 - x0, y1 - y0, 0, 0, c.width, c.height);
  return c;
}
const spread = async (n, box, w) => { const im = await img(`toy-x/ru-${n}x3.png`), k = im.width / 1046; return crop(im, box.map(v => Math.round(v * k)), w); };

const jobs = {
  // the box, its front
  async "cover-square"() { save("cover-square", crop(await img("dl-toy/cover.png"), [0, 0, 1556, 1556], 512), 78); },
  // the table at the start: the board between the players, the racks, the reserves, the discard (page 2)
  async setup() { save("setup", await spread(2, [24, 168, 336, 342], 640)); },
  // the connection to the H.Q.: an example (page 4)
  async placement() { save("placement", await spread(2, [700, 222, 1042, 340], 640)); },
  // a region taken: the medals in its middle (page 5)
  async region() { save("region", await spread(1, [24, 160, 332, 346], 640)); },
  // how the H.Q. look on the eight boards (page 6)
  async hqs() { save("hqs", await spread(1, [360, 112, 690, 184], 720)); },
  // what is in the box (page 1)
  async components() { save("components", await spread(1, [698, 250, 1026, 313], 640)); },
};
const only = process.argv.slice(2);
for (const [name, job] of Object.entries(jobs)) if (!only.length || only.includes(name)) await job();
