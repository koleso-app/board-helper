/* Помощник настолок — private sync library (no UI, no app state).
 *
 * Data leaves the device only as an AES-256-GCM ciphertext. The key is derived from the
 * user's own passphrase (PBKDF2-SHA-256, 600 000 rounds) and never leaves the device.
 * The ciphertext is one file in the user's own PRIVATE GitHub repository (the same one
 * «Колесо недели» uses, file nastolki.enc.json), reached with a fine-grained token.
 *
 * Works in browsers, in the Electron window and in Node 20+ (for tests).
 */
(function (root) {
  "use strict";
  const FORMAT = "nastolki-e2e-1";
  const ITER = 600000;
  const FILE = "nastolki.enc.json";
  const cryptoObj = () => root.crypto || globalThis.crypto;
  const te = new TextEncoder(), td = new TextDecoder();

  /* ---------- base64 for bytes and for UTF-8 text ---------- */
  function b64(bytes) { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); }
  function unb64(str) { const s = atob(str), out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out; }
  const textToB64 = t => b64(te.encode(t));
  const b64ToText = s => td.decode(unb64(s));

  /* ---------- encryption ---------- */
  const keyCache = new Map();
  async function deriveKey(pass, saltB64) {
    const id = saltB64 + "\u0000" + pass;
    if (keyCache.has(id)) return keyCache.get(id);
    const subtle = cryptoObj().subtle;
    const base = await subtle.importKey("raw", te.encode(pass), "PBKDF2", false, ["deriveKey"]);
    const key = await subtle.deriveKey({ name: "PBKDF2", salt: unb64(saltB64), iterations: ITER, hash: "SHA-256" },
      base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    keyCache.set(id, key);
    return key;
  }
  async function seal(obj, pass, saltB64) {
    const c = cryptoObj();
    const salt = saltB64 || b64(c.getRandomValues(new Uint8Array(16))), iv = c.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(pass, salt);
    const ct = new Uint8Array(await c.subtle.encrypt({ name: "AES-GCM", iv }, key, te.encode(JSON.stringify(obj))));
    return { format: FORMAT, kdf: "PBKDF2-SHA256", iter: ITER, salt, iv: b64(iv), ct: b64(ct) };
  }
  class SyncError extends Error { constructor(msg, code) { super(msg); this.code = code; } }
  async function open(env, pass) {
    if (!env || env.format !== FORMAT) throw new SyncError("Файл синхронизации в неизвестном формате", "bad_format");
    const key = await deriveKey(pass, env.salt);
    let plain;
    try { plain = await cryptoObj().subtle.decrypt({ name: "AES-GCM", iv: unb64(env.iv) }, key, unb64(env.ct)); }
    catch (e) { throw new SyncError("Неверный пароль шифрования", "wrong_password"); }
    return JSON.parse(td.decode(plain));
  }

  /* ---------- GitHub storage (Contents API) ---------- */
  const clean = s => String(s || "").trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/i, "").replace(/\/+$/, "");
  const fileOf = cfg => cfg.file || FILE;
  function api(cfg, suffix) {
    return `https://api.github.com/repos/${encodeURIComponent(clean(cfg.owner))}/${encodeURIComponent(clean(cfg.repo))}${suffix || ""}`;
  }
  async function gh(cfg, url, init) {
    let res;
    try {
      res = await fetch(url, Object.assign({ cache: "no-store" }, init, {
        headers: Object.assign({ Accept: "application/vnd.github+json", Authorization: "Bearer " + String(cfg.token).trim(), "X-GitHub-Api-Version": "2022-11-28" }, (init && init.headers) || {}),
      }));
    } catch (e) { throw new SyncError("Нет связи с GitHub.", "offline"); }
    if (res.status === 401) throw new SyncError("GitHub не принял токен. Проверьте, что он скопирован целиком и не истёк.", "auth");
    if (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0") throw new SyncError("GitHub временно ограничил запросы. Попробую позже.", "rate");
    return res;
  }
  // refuse to sync into a public repository, even though the file is encrypted
  async function checkRepo(cfg) {
    const res = await gh(cfg, api(cfg));
    if (res.status === 404 || res.status === 403) throw new SyncError("Репозиторий не найден или токену не дан доступ к нему.", "no_repo");
    if (!res.ok) throw new SyncError("GitHub ответил ошибкой " + res.status + ".", "http");
    const info = await res.json();
    if (!info.private) throw new SyncError("Репозиторий публичный. Для данных нужен закрытый (Private) репозиторий.", "public_repo");
    return true;
  }
  async function pull(cfg) {
    const res = await gh(cfg, api(cfg, "/contents/" + fileOf(cfg)));
    if (res.status === 404) return { env: null, sha: null };
    if (res.status === 403) throw new SyncError("Токену не хватает прав: нужен доступ Contents — Read and write к этому репозиторию.", "forbidden");
    if (!res.ok) throw new SyncError("GitHub ответил ошибкой " + res.status + ".", "http");
    const body = await res.json();
    let text;
    if (body.content) text = b64ToText(String(body.content).replace(/\s/g, ""));
    else {  // GitHub leaves out inline content for files over 1 MB
      const raw = await gh(cfg, api(cfg, "/contents/" + fileOf(cfg)), { headers: { Accept: "application/vnd.github.raw" } });
      if (!raw.ok) throw new SyncError("GitHub ответил ошибкой " + raw.status + ".", "http");
      text = await raw.text();
    }
    return { env: JSON.parse(text), sha: body.sha };
  }
  async function push(cfg, env, sha) {
    const res = await gh(cfg, api(cfg, "/contents/" + fileOf(cfg)), {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({ message: "nastolki sync " + new Date().toISOString(), content: textToB64(JSON.stringify(env)) }, sha ? { sha } : {})),
    });
    if (res.status === 409) return false;   // another device wrote first: pull, merge, retry
    if (res.status === 422) {
      let msg = ""; try { msg = String((await res.json()).message || ""); } catch (e) {}
      if (/sha/i.test(msg)) return false;
      throw new SyncError("GitHub отклонил запись" + (msg ? ": " + msg : "") + ".", "rejected");
    }
    if (res.status === 403 || res.status === 404) throw new SyncError("Токену не хватает прав: нужен доступ Contents — Read and write к этому репозиторию.", "forbidden");
    if (!res.ok) throw new SyncError("GitHub ответил ошибкой " + res.status + ".", "http");
    return true;
  }

  /* ---------- merge: per record, last writer wins, deletions remembered ----------
   * meta.u[key]   = when the record was last changed on any device
   * meta.del[key] = when it was deleted
   * keys: p:<player>  pl:<place>  s:<session>
   * Equal stamps: the remote copy wins, so every device ends with the same data.
   * Settings (theme, voice speed) belong to the device and are never synced. */
  const COLLECTIONS = [["players", "p:"], ["places", "pl:"], ["sessions", "s:"], ["answers", "q:"]];
  function merge(L, R) {
    L = L || {}; R = R || {};
    const u = {}, del = {};
    for (const s of [L, R]) {
      const m = s.meta || {};
      for (const [k, t] of Object.entries(m.u || {})) if (!(u[k] >= t)) u[k] = t;
      for (const [k, t] of Object.entries(m.del || {})) if (!(del[k] >= t)) del[k] = t;
    }
    const st = (s, k) => (s.meta && s.meta.u && s.meta.u[k]) || 0;
    const alive = k => !(k in del) || (u[k] || 0) > del[k];
    for (const k of Object.keys(del)) if (alive(k)) delete del[k];       // re-created after the deletion
    for (const k of Object.keys(u)) if (!alive(k)) delete u[k];
    const out = { v: 1, settings: JSON.parse(JSON.stringify(L.settings || {})), placesTouched: true, meta: { u, del } };
    for (const [name, p] of COLLECTIONS) {
      const m = new Map(), order = [];
      for (const s of [L, R]) for (const r of s[name] || []) {
        if (!r || !r.id) continue;
        const t = st(s, p + r.id), cur = m.get(r.id);
        if (!cur) { m.set(r.id, { r, t }); order.push(r.id); }
        else if (t >= cur.t) m.set(r.id, { r, t });
      }
      out[name] = order.filter(id => alive(p + id)).map(id => JSON.parse(JSON.stringify(m.get(id).r)));
    }
    // one fixed order on every device, otherwise two devices would keep rewriting each other's file
    const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    out.players.sort((a, b) => (a.created || 0) - (b.created || 0) || byId(a, b));
    out.places.sort((a, b) => (a.id === "home" ? -1 : b.id === "home" ? 1 : byId(a, b)));
    out.sessions.sort((a, b) => (b.created || 0) - (a.created || 0) || byId(a, b));
    out.answers.sort((a, b) => (b.at || 0) - (a.at || 0) || byId(a, b));
    return out;
  }

  /* records as key -> JSON text, to notice what changed between two saves */
  function recordMap(state) {
    const m = new Map();
    for (const [name, p] of COLLECTIONS) for (const r of (state && state[name]) || []) if (r && r.id) m.set(p + r.id, JSON.stringify(r));
    return m;
  }
  /* stamps changed records and remembers deleted ones; returns true when anything changed */
  function stampChanges(state, before, now) {
    state.meta = state.meta || { u: {}, del: {} };
    const u = state.meta.u = state.meta.u || {}, del = state.meta.del = state.meta.del || {};
    let t = Math.max(now || Date.now(), 1);
    for (const v of Object.values(u)) if (v >= t) t = v + 1;               // never older than what we have seen
    for (const v of Object.values(del)) if (v >= t) t = v + 1;
    const after = recordMap(state);
    let changed = false;
    for (const [k, j] of after) if (before.get(k) !== j) { u[k] = t; delete del[k]; changed = true; }
    for (const k of before.keys()) if (!after.has(k)) { del[k] = t; delete u[k]; changed = true; }
    return { changed, map: after };
  }

  /* key-order independent JSON, to compare two states */
  function stable(v) {
    if (Array.isArray(v)) return "[" + v.map(stable).join(",") + "]";
    if (v && typeof v === "object") return "{" + Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => JSON.stringify(k) + ":" + stable(v[k])).join(",") + "}";
    return JSON.stringify(v);
  }
  /* what travels: everything but this device's own settings */
  const shared = s => ({ v: 1, players: s.players || [], places: s.places || [], sessions: s.sessions || [], answers: s.answers || [], meta: s.meta || { u: {}, del: {} } });

  const lib = { FILE, FORMAT, ITER, seal, open, checkRepo, pull, push, merge, recordMap, stampChanges, stable, shared, SyncError };
  if (typeof module === "object" && module.exports) module.exports = lib;
  else root.BHSync = lib;
})(typeof window !== "undefined" ? window : globalThis);
