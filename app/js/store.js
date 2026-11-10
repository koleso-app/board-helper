/* State and saving. Everything lives in one JSON object kept in this device's localStorage
   (in the PC program that is the program's own data folder). Backups: export/import a JSON file. */
(function () {
  "use strict";
  const BH = window.BH;
  const KEY = "board-helper-v1";
  const FORMAT = "board-helper-1";

  /* Everything read from storage or a backup file goes through here: ids, colours and numbers are
     checked so that nothing odd can reach the page markup, and broken pieces are dropped, not fatal. */
  const ID = /^[A-Za-z0-9_-]{1,40}$/;
  const COLOR = /^#[0-9a-fA-F]{6}$/;
  const isObj = v => !!v && typeof v === "object" && !Array.isArray(v);
  const arr = v => (Array.isArray(v) ? v : []);
  const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max || 40) : "");
  const num = v => { const n = Number(v); return Number.isFinite(n) ? Math.round(n) : 0; };
  const time = v => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : undefined);
  const ids = (v, allowed) => [...new Set(arr(v).filter(x => typeof x === "string" && ID.test(x) && (!allowed || allowed.has(x))))];
  const STATUS = new Set(["setup", "first", "playing", "finished"]);

  function cleanSel(d) {
    if (!isObj(d)) return null;
    const sel = isObj(d.sel) ? d.sel : {}, picks = {}, flags = {};
    for (const [k, v] of Object.entries(isObj(sel.picks) ? sel.picks : {})) if (ID.test(k)) picks[k] = arr(v).filter(x => typeof x === "number" || (typeof x === "string" && x.length < 12));
    for (const [k, v] of Object.entries(isObj(sel.flags) ? sel.flags : {})) if (ID.test(k)) flags[k] = !!v;
    const manual = d.manual === null || d.manual === undefined || d.manual === "" ? null : num(d.manual);
    return { sel: { picks, flags }, manual };
  }

  function normalize(s) {
    s = isObj(s) ? s : {};
    const players = [], seen = new Set();
    for (const p of arr(s.players)) {
      if (!isObj(p) || typeof p.id !== "string" || !ID.test(p.id) || seen.has(p.id) || !str(p.name)) continue;
      seen.add(p.id);
      players.push({ id: p.id, name: str(p.name), color: COLOR.test(p.color) ? p.color : BH.COLORS[players.length % BH.COLORS.length], created: time(p.created) || Date.now(), hidden: !!p.hidden });
    }
    const places = arr(s.places).filter(p => isObj(p) && typeof p.id === "string" && ID.test(p.id) && str(p.name)).map(p => ({ id: p.id, name: str(p.name) }));
    const st = isObj(s.settings) ? s.settings : {};
    const out = {
      v: 1,
      players,
      places,
      sessions: [],
      settings: {
        theme: ["auto", "light", "dark"].includes(st.theme) ? st.theme : "auto",
        voiceRate: [0.85, 1, 1.2].includes(Number(st.voiceRate)) ? Number(st.voiceRate) : 1,
        speakAnswers: st.speakAnswers !== false,   // read the assistant's answers aloud (this device only)
      },
      placesTouched: true,
    };
    if (!out.places.length && !s.placesTouched) out.places.push({ id: "home", name: "Дома" });
    const placeIds = new Set(out.places.map(p => p.id));
    for (const x of arr(s.sessions)) {
      if (!isObj(x) || typeof x.id !== "string" || !ID.test(x.id) || typeof x.gameId !== "string" || !ID.test(x.gameId)) continue;
      const pl = ids(x.players, seen);
      if (!pl.length) continue;
      const allowed = new Set(pl);
      const rounds = arr(x.rounds).filter(isObj).map(r => {
        const sc = isObj(r.scores) ? r.scores : {}, fl = isObj(r.flags) ? r.flags : {}, de = isObj(r.detail) ? r.detail : {};
        const out = { at: time(r.at) || 0, scores: {}, flags: {}, detail: {} };
        if (typeof r.leader === "string" && allowed.has(r.leader)) out.leader = r.leader;
        for (const id of pl) {
          out.scores[id] = num(sc[id]);
          out.flags[id] = { bust: !!(isObj(fl[id]) && fl[id].bust), flip7: !!(isObj(fl[id]) && fl[id].flip7) };
          const d = cleanSel(de[id]); if (d) out.detail[id] = d;
        }
        return out;
      });
      const setupDone = {};
      for (const [k, v] of Object.entries(isObj(x.setupDone) ? x.setupDone : {})) if (ID.test(k)) setupDone[k] = !!v;
      const status = STATUS.has(x.status) ? x.status : "setup";
      out.sessions.push({
        id: x.id, gameId: x.gameId, exp: ids(x.exp), players: pl,
        placeId: typeof x.placeId === "string" && placeIds.has(x.placeId) ? x.placeId : null,
        created: time(x.created) || Date.now(), startedAt: time(x.startedAt), finishedAt: time(x.finishedAt),
        status, setupDone, rounds,
        first: typeof x.first === "string" && allowed.has(x.first) ? x.first : null,
        winners: ids(x.winners, allowed),
        opts: (() => { const o = {}; for (const [k, v] of Object.entries(isObj(x.opts) ? x.opts : {})) if (ID.test(k)) o[k] = !!v; return o; })(),
        final: (() => { if (!isObj(x.final)) return undefined; const f = {}; for (const id of pl) if (x.final[id] !== undefined && x.final[id] !== null && x.final[id] !== "") f[id] = num(x.final[id]); return Object.keys(f).length ? f : undefined; })(),
        continueTie: Number.isInteger(x.continueTie) && x.continueTie > 0 ? x.continueTie : undefined,
      });
    }
    // answers of the voice assistant, kept so the same question costs nothing again (synced too)
    out.answers = arr(s.answers).filter(a => isObj(a) && typeof a.id === "string" && ID.test(a.id) && typeof a.game === "string" && ID.test(a.game) && typeof a.answer === "string")
      .map(a => ({ id: a.id, game: a.game, q: str(a.q, 400), answer: str(a.answer, 600), quote: str(a.quote, 400), page: Number.isInteger(a.page) && a.page > 0 && a.page < 500 ? a.page : null, at: time(a.at) || 0 }));
    // sync stamps: when each record last changed / was deleted (see js/sync.js)
    const META_KEY = /^(p|pl|s|q):[A-Za-z0-9_-]{1,40}$/;
    const m = isObj(s.meta) ? s.meta : {};
    out.meta = { u: {}, del: {} };
    for (const part of ["u", "del"]) for (const [k, t] of Object.entries(isObj(m[part]) ? m[part] : {}))
      if (META_KEY.test(k) && Number.isFinite(t) && t > 0) out.meta[part][k] = t;
    return out;
  }

  function readLocal() {
    try { const t = localStorage.getItem(KEY); return t ? JSON.parse(t) : null; } catch (e) { return null; }
  }

  BH.state = normalize(readLocal());

  /* Every save first notes which players, places and games changed since the last save
     (stamp) or disappeared (deletion mark), then writes to this device. The sync sends it on. */
  let seen = window.BHSync ? BHSync.recordMap(BH.state) : new Map();
  BH.resetSeen = () => { if (window.BHSync) seen = BHSync.recordMap(BH.state); };
  let saveTimer = null;
  BH.save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(BH.saveNow, 150);
  };
  function writeLocal() {
    try { localStorage.setItem(KEY, JSON.stringify(BH.state)); return true; }
    catch (e) { BH.toast("Не удалось сохранить на этом устройстве: " + (e.message || "ошибка")); return false; }
  }
  BH.saveNow = () => {
    clearTimeout(saveTimer);
    let changed = false;
    if (window.BHSync) { const r = BHSync.stampChanges(BH.state, seen); seen = r.map; changed = r.changed; }
    writeLocal();
    if (changed && BH.cloud) BH.cloud.changed();
  };
  // replaces the data with a merged copy from the sync: saved, but not counted as a local change
  BH.replaceFromSync = data => {
    const settings = BH.state.settings;
    BH.state = normalize(data);
    BH.state.settings = settings;
    BH.resetSeen();
    writeLocal();
  };
  window.addEventListener("pagehide", BH.saveNow);
  // another tab or the installed app changed the data: take the newer copy instead of overwriting it
  window.addEventListener("storage", e => {
    if (e.key !== KEY || !e.newValue) return;
    try { BH.state = normalize(JSON.parse(e.newValue)); BH.resetSeen(); if (BH._render) BH._render(); } catch (err) {}
  });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") BH.saveNow(); });

  /* ---------- lookups ---------- */
  BH.player = id => BH.state.players.find(p => p.id === id) || null;
  BH.place = id => BH.state.places.find(p => p.id === id) || null;
  BH.session = id => BH.state.sessions.find(s => s.id === id) || null;

  BH.addPlayer = (name, color) => {
    const used = new Set(BH.state.players.map(p => p.color));
    const p = { id: BH.uid(), name: String(name).trim().slice(0, 40), color: color || BH.COLORS.find(c => !used.has(c)) || BH.COLORS[BH.state.players.length % BH.COLORS.length], created: Date.now(), hidden: false };
    BH.state.players.push(p);
    BH.save();
    return p;
  };
  BH.addPlace = name => {
    const p = { id: BH.uid(), name: String(name).trim().slice(0, 40) };
    BH.state.places.push(p);
    BH.save();
    return p;
  };

  /* ---------- backup file ---------- */
  BH.exportData = () => {
    const blob = new Blob([JSON.stringify({ format: FORMAT, saved: new Date().toISOString(), data: BH.state }, null, 1)], { type: "application/json" });
    const d = new Date(), stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `nastolki-${stamp}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  // reads and checks a backup file; the caller decides whether to replace the current data
  BH.readBackup = file => new Promise((resolve, reject) => {
    if (!file) return reject(new Error("файл не выбран"));
    if (file.size > 10 * 1024 * 1024) return reject(new Error("файл слишком большой"));
    const r = new FileReader();
    r.onload = () => {
      try {
        let j;
        try { j = JSON.parse(r.result); } catch (e) { throw new Error("файл повреждён или это не JSON"); }
        if (!j || j.format !== FORMAT || !j.data) throw new Error("это не копия «Помощника настолок»");
        resolve(normalize(j.data));
      } catch (e) { reject(e); }
    };
    r.onerror = () => reject(new Error("не удалось прочитать файл"));
    r.readAsText(file);
  });

  BH._normalize = normalize; // for tests
})();
