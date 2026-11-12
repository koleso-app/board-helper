// Builds the «Доббль» (Dobble) cover: the photo of the Russian box from page 1 of the rules as the ig-store shop gives them
// (sources/dl-dobble/dobble-ru.pdf; the photo is embedded there at 327×326). The rest of the game's pictures are drawn in
// app/games/dobble.js. Output: sources/assets/dobble/cover-square.webp (for the private repo).
// Run: node scripts/assets/dobble-compose.mjs
import fs from "node:fs";
import path from "node:path";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { root, createCanvas, saver } from "./compose-kit.mjs";

const save = saver(path.join(root, "sources", "assets", "dobble"));

// the most square picture of a page (the box; the shop logo and the QR code are not), as a canvas (pdf.js gives RGB or RGBA pixels)
async function squarestImage(pdf, pageNo) {
  const doc = await getDocument({ data: new Uint8Array(fs.readFileSync(path.join(root, "sources", pdf))) }).promise;
  const page = await doc.getPage(pageNo), ops = await page.getOperatorList();
  let best = null;
  for (let i = 0; i < ops.fnArray.length; i++) if (ops.fnArray[i] === OPS.paintImageXObject) {
    const im = await new Promise(r => page.objs.get(ops.argsArray[i][0], r));
    const sq = im => Math.min(im.width, im.height) / Math.max(im.width, im.height) + im.width * im.height / 1e7;
    if (!best || sq(im) > sq(best)) best = im;
  }
  const c = createCanvas(best.width, best.height), x = c.getContext("2d"), out = x.createImageData(best.width, best.height);
  const n = best.width * best.height, ch = best.data.length / n;
  for (let p = 0; p < n; p++) {
    out.data[p * 4] = best.data[p * ch]; out.data[p * 4 + 1] = best.data[p * ch + 1]; out.data[p * 4 + 2] = best.data[p * ch + 2];
    out.data[p * 4 + 3] = ch === 4 ? best.data[p * ch + 3] : 255;
  }
  x.putImageData(out, 0, 0);
  return c;
}

// the box, centred on white in a square (the photo is almost square already; no upscaling)
const box = await squarestImage(path.join("dl-dobble", "dobble-ru.pdf"), 1);
const side = Math.max(box.width, box.height), sq = createCanvas(side, side), x = sq.getContext("2d");
x.fillStyle = "#FFFFFF"; x.fillRect(0, 0, side, side);
x.drawImage(box, Math.round((side - box.width) / 2), Math.round((side - box.height) / 2));
save("cover-square", sq, 86);
