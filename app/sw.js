// Offline cache for the phone version: the app's own files only.
// Service workers run only over HTTPS (or on localhost), so offline mode needs the app hosted on HTTPS.
const CACHE = "nastolki-v66";
const FONTS = ["onest-cyrillic-400", "onest-latin-400", "onest-cyrillic-500", "onest-latin-500", "onest-cyrillic-600", "onest-latin-600",
  "onest-cyrillic-700", "onest-latin-700", "unbounded-cyrillic-600", "unbounded-latin-600", "unbounded-cyrillic-700", "unbounded-latin-700"]
  .map(f => `fonts/${f}-normal.woff2`);
const SHELL = ["./", "index.html", "styles.css", "manifest.webmanifest", "fonts/fonts.css", ...FONTS,
  "js/util.js", "js/sync.js", "js/store.js", "js/cloud.js", "js/voice.js", "js/assets.js", "js/games.js", "js/chances.js", "js/art.js", "js/speech.js", "js/wheel.js", "js/rules.js", "js/app.js",
  "games/flip7.js", "games/flip7v.js", "games/faraway.js", "games/thegang.js", "games/crokinole.js", "games/coconuts.js", "games/goldfever.js", "games/zoo.js", "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "icons/apple-touch-icon.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => /^nastolki-v\d+$/.test(k) && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  // network first so updates arrive at once; after 3 s on a weak connection the cached copy is used
  // the app page itself may fall back to index.html; a script or a style never does (it would break the app)
  const isPage = e.request.mode === "navigate";
  e.respondWith(new Promise(resolve => {
    let done = false;
    const fromCache = () => caches.match(e.request).then(r => r || (isPage ? caches.match("index.html") : null));
    // slow network: after 3 s use the cached copy of this exact file, if there is one; otherwise keep waiting
    const timer = setTimeout(() => caches.match(e.request).then(r => { if (r && !done) { done = true; resolve(r); } }), 3000);
    // "no-cache": always ask the server, so a new version shows on the next opening, not 10 minutes later
    fetch(e.request, { cache: "no-cache" }).then(res => {
      if (res.ok) {
        const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy));
        if (!done) { done = true; clearTimeout(timer); resolve(res); }
        return;
      }
      // a server error (e.g. 503 while GitHub Pages publishes an update): keep the cached copy
      caches.match(e.request).then(r => { if (!done) { done = true; clearTimeout(timer); resolve(r || res); } });
    }).catch(() => fromCache().then(r => { if (!done) { done = true; clearTimeout(timer); resolve(r || Response.error()); } }));
  }));
});
