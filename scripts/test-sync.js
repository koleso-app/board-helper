// Sync check with a fake GitHub: two devices, offline queue, restart, deletion, conflicts.
// Run: node scripts/test-sync.js   (also part of npm test)
const fs = require("fs"), path = require("path"), vm = require("vm"), assert = require("assert");
const APP = path.join(__dirname, "..", "app");
const FILES = ["js/util.js", "js/sync.js", "js/store.js", "js/cloud.js", "js/games.js", "js/art.js", "games/flip7.js"];

/* ---------- fake GitHub contents API ---------- */
const gh = { files: {}, sha: 0, private: true, writes: 0 };
function fakeFetchFor(dev) {
  return async (url, init) => {
    if (!dev.online) throw new TypeError("Failed to fetch");
    const auth = (init && init.headers && init.headers.Authorization) || "";
    const reply = (status, body) => ({ status, ok: status >= 200 && status < 300, headers: { get: () => null }, json: async () => body, text: async () => JSON.stringify(body) });
    if (auth !== "Bearer good-token") return reply(401, { message: "Bad credentials" });
    const m = url.match(/^https:\/\/api\.github\.com\/repos\/([^/]+)\/([^/]+)(\/contents\/(.+))?$/);
    if (!m) return reply(404, {});
    if (!m[3]) return reply(200, { private: gh.private });
    const name = decodeURIComponent(m[4]), cur = gh.files[name];
    if (!init || !init.method || init.method === "GET") return cur ? reply(200, { content: cur.content, sha: cur.sha }) : reply(404, {});
    const body = JSON.parse(init.body);
    if (cur && body.sha !== cur.sha) return reply(409, { message: "is at x but expected y" });
    if (!cur && body.sha) return reply(409, {});
    gh.writes++;
    gh.files[name] = { content: body.content, sha: "sha" + (++gh.sha) };
    return reply(200, {});
  };
}

/* ---------- one device = one fresh page with its own storage ---------- */
function device(name, storage) {
  const store = storage || {};
  const dev = { name, online: true, store };
  const listeners = {};
  const ctx = {
    console, Date, Math, JSON, Set, Map, Array, Object, String, Number, Promise, Error, TypeError, Uint8Array, TextEncoder, TextDecoder, atob, btoa, crypto: globalThis.crypto,
    setTimeout: (f, ms) => { const t = setTimeout(f, ms); t.unref(); return t; }, clearTimeout, setInterval: () => 0,
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
    addEventListener: (t, f) => { (listeners[t] = listeners[t] || []).push(f); },
    document: { visibilityState: "visible", addEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] },
    navigator: { get onLine() { return dev.online; } },
  };
  ctx.window = ctx;
  ctx.fetch = fakeFetchFor(dev);
  vm.createContext(ctx);
  for (const f of FILES) vm.runInContext(fs.readFileSync(path.join(APP, f), "utf8"), ctx, { filename: f });
  dev.BH = ctx.BH;
  dev.fire = t => (listeners[t] || []).forEach(f => f());
  return dev;
}
const CFG = { owner: "me", repo: "koleso-data", token: "good-token", pass: "секретный пароль" };
const names = d => d.BH.state.players.map(p => p.name).sort().join(",");
const remotePlain = () => JSON.stringify(gh.files["nastolki.enc.json"] || "");
async function addGame(d, winnerName) {
  const BH = d.BH, p = BH.state.players.find(x => x.name === winnerName) || BH.addPlayer(winnerName);
  const s = { id: BH.uid(), gameId: "flip7", players: [p.id], created: Date.now(), status: "finished", rounds: [{ scores: { [p.id]: 200 } }], winners: [p.id], setupDone: {}, exp: [] };
  BH.state.sessions.unshift(s); BH.saveNow();
  return s;
}

let passed = 0;
async function t(name, fn) { try { await fn(); passed++; } catch (e) { console.error("FAIL " + name + "\n  " + (e && e.stack || e)); process.exitCode = 1; } }

(async () => {
  const A = device("A"), B = device("B");

  await t("first device needs the password twice", async () => {
    await assert.rejects(A.BH.cloud.connect(CFG, "другой"), /не совпадают/);
    assert.strictEqual(gh.writes, 0);
  });
  await t("public repository is refused", async () => {
    gh.private = false;
    await assert.rejects(A.BH.cloud.connect(CFG, CFG.pass), /публичный/);
    gh.private = true;
  });
  await t("first device connects and sends", async () => {
    A.BH.addPlayer("Аня"); A.BH.saveNow();
    const r = await A.BH.cloud.connect(CFG, CFG.pass);
    assert.strictEqual(r.firstDevice, true);
    assert.ok(gh.files["nastolki.enc.json"]);
    assert.strictEqual(A.BH.cloud.pending, false);
  });
  await t("the file on GitHub is encrypted", async () => assert.ok(!remotePlain().includes("Аня") && !Buffer.from(JSON.parse(remotePlain()).content, "base64").toString("utf8").includes("Аня")));
  await t("wrong password on another device stops before writing", async () => {
    const w = gh.writes, X = device("X");
    await assert.rejects(X.BH.cloud.connect(Object.assign({}, CFG, { pass: "неверный пароль" })), /Неверный пароль/);
    assert.strictEqual(gh.writes, w);
    assert.strictEqual(X.BH.cloud.cfg, null);
  });
  await t("second device merges its own data with the cloud", async () => {
    B.BH.addPlayer("Боря"); B.BH.saveNow();
    await B.BH.cloud.connect(CFG);
    assert.strictEqual(names(B), "Аня,Боря,Дома".replace(",Дома", ""));
    await A.BH.cloud.syncNow();
    assert.strictEqual(names(A), "Аня,Боря");
  });
  await t("a game recorded offline waits and survives a restart", async () => {
    B.online = false;
    await addGame(B, "Боря");
    assert.strictEqual(B.BH.cloud.pending, true);
    assert.strictEqual(await B.BH.cloud.syncNow(), false);
    assert.strictEqual(B.BH.cloud.status.state, "offline");
    // the phone is closed and opened again, still without a connection
    const B2 = device("B2", B.store); B2.online = false;
    assert.strictEqual(B2.BH.cloud.pending, true);
    assert.strictEqual(B2.BH.state.sessions.length, 1);
    // the connection is back
    B2.online = true;
    assert.strictEqual(await B2.BH.cloud.syncNow(), true);
    assert.strictEqual(B2.BH.cloud.pending, false);
    await A.BH.cloud.syncNow();
    assert.strictEqual(A.BH.state.sessions.length, 1);
    Object.assign(B, { BH: B2.BH, fire: B2.fire, online: true }); B.store = B2.store;
  });
  await t("both devices write at once: nothing is lost", async () => {
    await addGame(A, "Аня"); await addGame(B, "Боря");
    // B read the file before A wrote: its first write hits a conflict and retries after merging
    await Promise.all([A.BH.cloud.syncNow(), B.BH.cloud.syncNow()]);
    await A.BH.cloud.syncNow(); await B.BH.cloud.syncNow();
    assert.strictEqual(A.BH.state.sessions.length, 3);
    assert.strictEqual(B.BH.state.sessions.length, 3);
  });
  await t("a deletion reaches the other device", async () => {
    const victim = A.BH.state.sessions[0].id;
    A.BH.state.sessions = A.BH.state.sessions.filter(s => s.id !== victim); A.BH.saveNow();
    await A.BH.cloud.syncNow(); await B.BH.cloud.syncNow();
    assert.ok(!B.BH.state.sessions.some(s => s.id === victim));
    assert.strictEqual(B.BH.state.sessions.length, 2);
  });
  await t("an edit on one device and a newer edit on the other: the newer wins", async () => {
    const id = A.BH.state.players.find(p => p.name === "Аня").id;
    A.BH.player(id).name = "Анна"; A.BH.saveNow();
    await new Promise(r => setTimeout(r, 5));
    B.BH.player(id).name = "Аннушка"; B.BH.saveNow();
    await A.BH.cloud.syncNow(); await B.BH.cloud.syncNow(); await A.BH.cloud.syncNow();
    assert.strictEqual(A.BH.player(id).name, "Аннушка");
    assert.strictEqual(B.BH.player(id).name, "Аннушка");
  });
  await t("saved voice answers travel to the other device", async () => {
    A.BH.state.answers.unshift({ id: "aq1", game: "flip7", q: "можно ли заморозь на себя", answer: "Да.", quote: "", page: 6, at: Date.now() });
    A.BH.saveNow();
    await A.BH.cloud.syncNow(); await B.BH.cloud.syncNow();
    assert.ok(B.BH.state.answers.some(a => a.id === "aq1" && a.page === 6));
  });
  await t("device settings stay on the device", async () => {
    A.BH.state.settings.theme = "dark"; A.BH.saveNow();
    await A.BH.cloud.syncNow(); await B.BH.cloud.syncNow();
    assert.strictEqual(B.BH.state.settings.theme, "auto");
  });
  await t("nothing to send means no write", async () => {
    await A.BH.cloud.syncNow(); await B.BH.cloud.syncNow();
    const w = gh.writes;
    await A.BH.cloud.syncNow(); await B.BH.cloud.syncNow();
    assert.strictEqual(gh.writes, w);
  });
  await t("the «Колесо недели» connection is found on the same site", async () => {
    const W = device("W", { "koleso-sync": JSON.stringify(CFG) });
    const w = W.BH.cloud.wheelCfg();
    assert.strictEqual(w.repo, "koleso-data"); assert.strictEqual(w.pass, CFG.pass);
    await W.BH.cloud.connect(w);
    assert.strictEqual(names(W), "Аннушка,Боря");
  });
  console.log(`sync: ${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
})();
