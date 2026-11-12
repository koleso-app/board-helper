// Builds the crokinole pictures from the Russian rules of the Crowd Games edition (sources/dl-crokinole/croki-ru.pdf,
// pages rendered at scale 4 into sources/croki-x4/ru4-N.png by render-one.mjs): the cover and the labelled board.
// Output: sources/assets/crokinole/<name>.webp (for the private repo). Run: node scripts/assets/crokinole-compose.mjs
import fs from "node:fs";
import path from "node:path";
import { root, createCanvas, loadImage, saver } from "./compose-kit.mjs";

const save = saver(path.join(root, "sources", "assets", "crokinole"));
const page = async n => loadImage(fs.readFileSync(path.join(root, "sources", "croki-x4", `ru4-${n}.png`)));
function crop(img, [x0, y0, x1, y1], w) {
  const k = w / (x1 - x0), c = createCanvas(w, Math.round((y1 - y0) * k));
  c.getContext("2d").drawImage(img, x0, y0, x1 - x0, y1 - y0, 0, 0, c.width, c.height);
  return c;
}
const jobs = {
  // the cover of the rules: the title between a red and a blue disc
  // («ПРАВИЛА ИГРЫ» under the title is covered with the wood just below it)
  async "cover-square"() {
    const img = await page(1), c = createCanvas(img.width, img.height), x = c.getContext("2d");
    x.drawImage(img, 0, 0);
    x.drawImage(img, 440, 1452, 800, 104, 440, 1332, 800, 104);
    save("cover-square", crop(c, [0, 365, 1680, 2045], 512), 74);
  },
  // the board with its parts named (centre 20, rings 15 / 10 / 5, ditch 0, shooting line, quadrant line, posts)
  async board() { const img = await page(2); save("board", crop(img, [130, 1222, 1600, 1800], 720)); },
};
const only = process.argv.slice(2);
for (const [name, job] of Object.entries(jobs)) if (!only.length || only.includes(name)) await job();
