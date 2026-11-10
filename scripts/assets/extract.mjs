// Extracts the text of a PDF, page by page, into a .txt file next to the given output path.
import fs from "node:fs";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
const [, , input, output] = process.argv;
const doc = await getDocument({ data: new Uint8Array(fs.readFileSync(input)), useSystemFonts: true }).promise;
let out = "";
for (let i = 1; i <= doc.numPages; i++) {
  const page = await doc.getPage(i);
  const tc = await page.getTextContent();
  let lastY = null, line = "";
  const lines = [];
  for (const it of tc.items) {
    const y = Math.round(it.transform[5]);
    if (lastY !== null && Math.abs(y - lastY) > 3) { lines.push(line); line = ""; }
    line += it.str;
    lastY = y;
  }
  lines.push(line);
  out += `\n===== СТРАНИЦА ${i} =====\n` + lines.map(l => l.trim()).filter(Boolean).join("\n") + "\n";
}
fs.writeFileSync(output, out);
console.log("pages:", doc.numPages, "chars:", out.length);
