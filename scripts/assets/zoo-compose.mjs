// Builds the «Зоопарк» (Team Zoo, Hobby World) pictures: the cover from the publisher's photo of the box front
// (sources/dl-zoo/zoopark-01.jpg), the cockatoo cards from zoopark-sp05.jpg; the rest from the Russian rules
// (sources/dl-zoo/zoopark-rules.pdf, pages 5–7 rendered at scale 4 into sources/zoo-x/ru-Nx4.png by render-one.mjs).
// Boxes are given in a 755-wide page (the scale 1.4 render) and scaled to the big render.
// Output: sources/assets/zoo/<name>.webp (for the private repo). Run: node scripts/assets/zoo-compose.mjs [name…]
import fs from "node:fs";
import path from "node:path";
import { root, createCanvas, loadImage, saver } from "./compose-kit.mjs";

const save = saver(path.join(root, "sources", "assets", "zoo"));
const img = async p => loadImage(fs.readFileSync(path.join(root, "sources", p)));
function crop(im, [x0, y0, x1, y1], w) {
  const k = w / (x1 - x0), c = createCanvas(w, Math.round((y1 - y0) * k));
  c.getContext("2d").drawImage(im, x0, y0, x1 - x0, y1 - y0, 0, 0, c.width, c.height);
  return c;
}
// a box on a rules page, in units of the 755-wide page
const page = async (n, box, w) => { const im = await img(`zoo-x/ru-${n}x4.png`), k = im.width / 755; return crop(im, box.map(v => Math.round(v * k)), w); };

const jobs = {
  // the box front: the title, the arch and the animals
  async "cover-square"() { save("cover-square", crop(await img("dl-zoo/zoopark-01.jpg"), [0, 0, 800, 800], 512), 78); },
  // the seven kinds of food with their names (page 5, bottom)
  async foods() { save("foods", await page(5, [40, 608, 722, 708], 720)); },
  // the table at the start: a set of food tiles before each player, the fake tiles in the middle, the deck (page 5)
  async setup() { save("setup", await page(5, [384, 290, 738, 594], 640)); },
  // what is in the box (page 5, top)
  async components() { save("components", await page(5, [48, 82, 372, 432], 560)); },
  // an animal card and its two foods: the llama eats vegetables and branches (page 6)
  // the card sticks out above the picture, next to the end of the text: the text is painted over with the page's colour
  async card() {
    const c = await page(6, [44, 138, 368, 268], 640), g = c.getContext("2d"), k = 640 / (368 - 44);
    const d = g.getImageData(4, 4, 1, 1).data; g.fillStyle = `rgb(${d[0]},${d[1]},${d[2]})`;
    g.fillRect(0, 0, Math.round((266 - 44) * k), Math.round((159 - 138) * k));
    save("card", c);
  },
  // to feed the llama, open these two tiles (page 6, bottom)
  async feed() { save("feed", await page(6, [44, 604, 368, 708], 640)); },
  // after the round: the winner adds a fake tile and shuffles (page 6, right; the pictures without the text above them)
  async after() { save("after", await page(6, [384, 414, 738, 652], 640)); },
  // the cockatoo card in play (page 7, right)
  async cockatoo() { save("cockatoo", await page(7, [384, 434, 738, 708], 640)); },
  // three cockatoo cards, one side each (the publisher's photo)
  async cockatoos() { save("cockatoos", crop(await img("dl-zoo/zoopark-sp05.jpg"), [0, 0, 1000, 435], 720)); },
};
const only = process.argv.slice(2);
for (const [name, job] of Object.entries(jobs)) if (!only.length || only.includes(name)) await job();
