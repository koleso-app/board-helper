// Offline cache for the phone version: the app's own files only.
// Service workers run only over HTTPS (or on localhost), so offline mode needs the app hosted on HTTPS.
const CACHE = "nastolki-v7";
const FONTS = ["onest-cyrillic-400", "onest-latin-400", "onest-cyrillic-500", "onest-latin-500", "onest-cyrillic-600", "onest-latin-600",
  "onest-cyrillic-700", "onest-latin-700", "unbounded-cyrillic-600", "unbounded-latin-600", "unbounded-cyrillic-700", "unbounded-latin-700"]
  .map(f => `fonts/${f}-normal.woff2`);
const SHELL = ["./", "index.html", "styles.css", "manifest.webmanifest", "fonts/fonts.css", ...FONTS,
  "js/util.js", "js/sync.js", "js/store.js", "js/cloud.js", "js/voice.js", "js/games.js", "js/art.js", "js/speech.js", "js/wheel.js", "js/rules.js", "js/app.js",
  "games/flip7.js", "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "icons/apple-touch-icon.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith("nastolki-") && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  // network first so updates arrive at once; after 3 s on a weak connection the cached copy is used
  e.respondWith(new Promise(resolve => {
    let done = false;
    const fromCache = () => caches.match(e.request).then(r => r || caches.match("index.html"));
    const timer = setTimeout(() => fromCache().then(r => { if (r && !done) { done = true; resolve(r); } }), 3000);
    // "no-cache": always ask the server, so a new version shows on the next opening, not 10 minutes later
    fetch(e.request, { cache: "no-cache" }).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      if (!done) { done = true; clearTimeout(timer); resolve(res); }
    }).catch(() => fromCache().then(r => { if (!done) { done = true; clearTimeout(timer); resolve(r || Response.error()); } }));
  }));
});
