// renders one page of a PDF at a scale: node render-one.mjs <pdf> <page> <scale> <out.png>
import fs from "node:fs";
import { createCanvas } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
const [, , input, pn, sc, out] = process.argv;
const doc = await getDocument({ data: new Uint8Array(fs.readFileSync(input)), useSystemFonts: true }).promise;
const page = await doc.getPage(Number(pn)), vp = page.getViewport({ scale: Number(sc) });
const c = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
fs.writeFileSync(out, c.toBuffer("image/png")); console.log(c.width, c.height);
// what the page is made of: count of images and their sizes
const ops = await page.getOperatorList(); let imgs = 0; for (const fn of ops.fnArray) if (fn === 85 || fn === 86 || fn === 82) imgs++;
console.log("image ops", imgs);
