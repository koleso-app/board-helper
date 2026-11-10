// Serves app/ to try the phone version in a browser.
//   npm run web       -> http://127.0.0.1:5180 (this PC only)
//   npm run web:lan   -> also reachable from a phone on the same Wi-Fi (prints the address)
const http = require("http"), fs = require("fs"), path = require("path"), os = require("os");
const root = path.join(__dirname, "..", "app"), port = Number(process.env.PORT) || 5180;
const lan = process.argv.includes("--lan");
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json", ".json": "application/json", ".txt": "text/plain; charset=utf-8" };
http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/+/, "") || "index.html";
  const file = path.join(root, rel);
  if (!file.startsWith(root + path.sep) && file !== root) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404).end("not found"); return; }
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" }).end(buf);
  });
}).listen(port, lan ? "0.0.0.0" : "127.0.0.1", () => {
  console.log(`Помощник настолок: http://127.0.0.1:${port}`);
  if (lan) for (const list of Object.values(os.networkInterfaces())) for (const a of list || [])
    if (a.family === "IPv4" && !a.internal) console.log(`  с телефона в той же сети: http://${a.address}:${port}`);
});
