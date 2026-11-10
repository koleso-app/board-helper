// Makes a square thumbnail from a wide image on a solid background: node square.mjs <in> <out> <size> <bg>
import fs from "node:fs";
import { createCanvas, loadImage } from "@napi-rs/canvas";
const [, , input, output, sizeArg, bg] = process.argv;
const size = Number(sizeArg) || 384, img = await loadImage(fs.readFileSync(input));
const c = createCanvas(size, size), ctx = c.getContext("2d");
ctx.fillStyle = bg || "#DCEBDD"; ctx.fillRect(0, 0, size, size);
const w = size * 0.94, h = img.height * w / img.width;
ctx.imageSmoothingQuality = "high";
ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
fs.writeFileSync(output, c.toBuffer("image/webp", 72));
console.log(output, size + "x" + size);
