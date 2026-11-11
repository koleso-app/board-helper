/* Game illustrations (covers, setup pictures, rule pictures) for personal use.
   They are NOT part of the public site: they live in the owner's private data repository
   (nastolki-assets/<game>/<name>.webp) and are fetched with the same GitHub token as the sync,
   then kept in this device's cache, so they also show offline. Without access the drawn
   schematic stays in place.
   Markup: <div data-asset="flip7/numbers flip7/specials">fallback</div>; "name@card" = a single card, shown small. */
(function () {
  "use strict";
  const BH = window.BH;
  const CACHE = "nastolki-img-v3";   // v3: the new pictures of Faraway (same names, new content)
  // the previous set (a few pictures were re-cut since): dropped, the new one loads on demand
  if ("caches" in window) for (const old of ["nastolki-img-v1", "nastolki-img-v2"]) caches.delete(old).catch(() => {});
  const EXT = ".webp";   // small: the whole Flip 7 set is about 230 KB, loaded once
  const urls = new Map();      // "game/name" -> object URL (this page load)
  const failed = new Set();    // missing on the server: do not ask again this page load
  const pending = new Map();

  const cacheKey = id => "https://img.cache/" + id + EXT;
  async function fromCache(id) {
    if (!("caches" in window)) return null;
    try { const c = await caches.open(CACHE); const r = await c.match(cacheKey(id)); return r ? await r.blob() : null; } catch (e) { return null; }
  }
  async function toCache(id, blob) {
    if (!("caches" in window)) return;
    try { const c = await caches.open(CACHE); await c.put(cacheKey(id), new Response(blob, { headers: { "Content-Type": "image/webp" } })); } catch (e) {}
  }
  async function fromRepo(id) {
    const c = BH.cloud && BH.cloud.cfg;
    if (!c || (typeof navigator !== "undefined" && navigator.onLine === false)) return null;
    const res = await fetch(`https://api.github.com/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/contents/nastolki-assets/${id}${EXT}`, {
      headers: { Authorization: "Bearer " + c.token, Accept: "application/vnd.github.raw", "X-GitHub-Api-Version": "2022-11-28" }, cache: "no-store",
    });
    // missing, no access or rate-limited: do not ask again for every picture on every screen this session
    if (res.status === 404 || res.status === 401 || res.status === 403 || res.status === 429) { failed.add(id); return null; }
    if (!res.ok) return null;
    const blob = await res.blob();
    toCache(id, blob);
    return blob;
  }
  function load(id) {
    if (urls.has(id)) return Promise.resolve(urls.get(id));
    if (failed.has(id)) return Promise.resolve(null);
    if (!pending.has(id)) pending.set(id, (async () => {
      try {
        const blob = (await fromCache(id)) || (await fromRepo(id));
        if (!blob) return null;
        const u = URL.createObjectURL(blob); urls.set(id, u); return u;
      } catch (e) { return null; } finally { pending.delete(id); }
    })());
    return pending.get(id);
  }

  const A = BH.assets = {};
  // markup helpers for templates
  A.attr = (game, names) => (names && names.length ? ` data-asset="${names.map(n => BH.esc(game + "/" + n)).join(" ")}"` : "");
  A.cover = g => g.images && g.images.cover ? A.attr(g.id, [g.images.cover]) : "";

  /* fills every [data-asset] block under root whose pictures are available */
  A.hydrate = root => {
    for (const el of (root || document).querySelectorAll("[data-asset]:not([data-asset-done])")) {
      el.setAttribute("data-asset-done", "");
      const items = el.getAttribute("data-asset").split(/\s+/).filter(Boolean).map(x => { const [id, kind] = x.split("@"); return { id, kind }; });
      Promise.all(items.map(it => load(it.id))).then(list => {
        const ok = items.map((it, i) => ({ it, u: list[i] })).filter(x => x.u);
        if (!ok.length || !el.isConnected) return;
        el.innerHTML = ok.map(x => `<img src="${x.u}" alt="" class="${x.it.kind === "card" ? "a-card" : "a-wide"}" loading="lazy" decoding="async">`).join("");
        el.classList.add("has-img");
      });
    }
  };
  A.clear = async () => { try { await caches.delete(CACHE); } catch (e) {} urls.clear(); failed.clear(); };
})();
