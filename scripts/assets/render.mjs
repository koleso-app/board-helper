// Renders every page of a PDF to PNG: node render.mjs <pdf> <outDir> [scale]
import fs from "node:fs";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
const [, , input, outDir, scaleArg] = process.argv;
const scale = Number(scaleArg) || 2;
fs.mkdirSync(outDir, { recursive: true });
const doc = await getDocument({ data: new Uint8Array(fs.readFileSync(input)), useSystemFonts: true }).promise;
for (let i = 1; i <= doc.numPages; i++) {
  const page = await doc.getPage(i);
  const vp = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
  const ctx = canvas.getContext("2d");
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  fs.writeFileSync(path.join(outDir, `page-${String(i).padStart(2, "0")}.png`), canvas.toBuffer("image/png"));
  console.log("page", i, Math.ceil(vp.width) + "x" + Math.ceil(vp.height));
}
