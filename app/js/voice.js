/* Voice assistant: speech -> text in Chrome (Web Speech), the question goes to the owner's
   Yandex Cloud function (rulebook + Alice AI + SpeechKit), the answer comes back as text,
   a quote with its page, and natural speech. Access is the GitHub sync connection itself:
   the function serves only someone holding a working token for the owner's private repo.
   Spoken texts are cached on the device, so a setup step costs money only the first time. */
(function () {
  "use strict";
  const BH = window.BH;
  const LS_URL = "board-helper-voice-url", LS_VOICE = "board-helper-voice-name";
  const DEFAULT_URL = "https://functions.yandexcloud.net/d4e11kuh0hsmrngs99ig";   // the owner's function; it answers only with the owner's token
  const CACHE = "nastolki-tts-v1";
  const read = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const write = (k, v) => { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) {} };

  const V = BH.voice = {
    VOICES: [["marina", "Марина"], ["dasha", "Даша"], ["jane", "Джейн"], ["lera", "Лера"], ["masha", "Маша"], ["julia", "Юлия"], ["ermil", "Ермил"], ["filipp", "Филипп"], ["kirill", "Кирилл"], ["anton", "Антон"]],
    url: () => read(LS_URL) || DEFAULT_URL,
    setUrl: u => write(LS_URL, String(u || "").trim()),
    voice: () => read(LS_VOICE) || "marina",
    setVoice: v => write(LS_VOICE, v),
    // ready when there is a function address and the sync connection that grants access
    ready: () => !!(V.url() && BH.cloud && BH.cloud.cfg),
    why: () => !V.url() ? "Голосовой помощник ещё не подключён: нет адреса функции." : !(BH.cloud && BH.cloud.cfg) ? "Подключите синхронизацию с GitHub (Меню → Синхронизация): она же даёт доступ к голосовому помощнику." : "",
    canListen: !!(window.SpeechRecognition || window.webkitSpeechRecognition),
    // answers read aloud? Off: the function is not even asked for sound, so speech costs nothing
    speaks: () => !(BH.state && BH.state.settings && BH.state.settings.speakAnswers === false),
  };

  async function call(body, signal) {
    const c = BH.cloud.cfg;
    let res;
    try {
      res = await fetch(V.url(), { method: "POST", headers: { "Content-Type": "application/json" }, signal,
        body: JSON.stringify(Object.assign({ gh: { owner: c.owner, repo: c.repo, token: String(c.token || "").trim() }, voice: V.voice() }, body)) });
    } catch (e) {
      if (e && e.name === "AbortError") throw e;
      throw Object.assign(new Error("Нет связи с помощником. Проверьте интернет."), { code: "offline" });
    }
    let j = null; try { j = await res.json(); } catch (e) {}
    if (!res.ok) throw Object.assign(new Error((j && j.error && j.error.message) || "Помощник ответил ошибкой " + res.status), { code: (j && j.error && j.error.code) || "http", status: res.status });
    return j;
  }

  /* ---------- ask: the same question again is answered from the device, for free ---------- */
  // answers live in the app data (BH.state.answers), so they sync through GitHub to every device
  const norm = q => String(q).toLowerCase().replace(/ё/g, "е").replace(/[^a-zа-я0-9×+ ]+/gi, " ").replace(/\s+/g, " ").trim();
  const fnv = s => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(36); };
  V.answerId = (game, question) => "a" + fnv(game + "|" + norm(question)) + fnv(norm(question) + "|" + game);
  V.ask = async (game, question, situation, signal) => {
    const id = V.answerId(game, question);
    // answers saved before the page was found by code (v2) may show a wrong page: those are asked again
    const saved = (BH.state.answers || []).find(a => a.id === id && a.v === 2);
    if (saved) {
      const audio = V.speaks() ? await cached(saved.answer) : null;
      return { answer: saved.answer, quote: saved.quote, page: saved.page, ref: saved.ref || null, found: true, audio, fromDevice: true };
    }
    const r = await call({ action: "ask", game, question, situation, speak: V.speaks() }, signal);
    if (r && r.found && r.answer) {
      const list = BH.state.answers = (BH.state.answers || []).filter(a => a.id !== id);
      list.unshift({ id, game, q: String(question).slice(0, 400), answer: r.answer, quote: r.quote || "", page: r.page || null, ref: r.ref || null, v: 2, at: Date.now() });
      if (list.length > 300) list.length = 300;           // keep the latest 300
      BH.saveNow();
    }
    return r;
  };
  V.forget = game => { BH.state.answers = (BH.state.answers || []).filter(a => game && a.game !== game); BH.saveNow(); };   // after a rules update

  /* ---------- speech: cached mp3 per (voice, text) ---------- */
  async function key(text) {
    const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(V.voice() + "\u0000" + text));
    return "https://tts.cache/" + Array.from(new Uint8Array(d)).map(b => b.toString(16).padStart(2, "0")).join("") + ".mp3";
  }
  async function cached(text) {
    if (!("caches" in window)) return null;
    try { const c = await caches.open(CACHE); const r = await c.match(await key(text)); return r ? await r.text() : null; } catch (e) { return null; }
  }
  async function store(text, b64) {
    if (!("caches" in window)) return;
    try { const c = await caches.open(CACHE); await c.put(await key(text), new Response(b64)); } catch (e) {}
  }
  V.audioFor = async (text, signal) => {
    const hit = await cached(text);
    if (hit) return hit;
    const j = await call({ action: "tts", text }, signal);
    if (j && j.audio) store(text, j.audio);
    return j.audio;
  };
  V.remember = (text, b64) => store(text, b64);

  let current = null;
  V.play = b64 => new Promise((resolve, reject) => {
    V.stopAudio();
    const bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: "audio/mpeg" }));
    const a = new Audio(url);
    current = { a, url, resolve };
    const end = ok => { URL.revokeObjectURL(url); if (current && current.a === a) current = null; ok ? resolve() : reject(new Error("не удалось воспроизвести звук")); };
    a.onended = () => end(true);
    a.onerror = () => end(false);
    a.play().catch(() => end(false));
  });
  V.stopAudio = () => { if (current) { const c = current; current = null; try { c.a.pause(); } catch (e) {} URL.revokeObjectURL(c.url); c.resolve(); } };

  // long text goes in pieces of up to ~900 characters, split on sentences
  V.pieces = text => {
    const out = []; let cur = "";
    for (const s of String(text).replace(/\s+/g, " ").match(/[^.!?…]+[.!?…]*\s*/g) || []) {
      if ((cur + s).length > 900 && cur) { out.push(cur.trim()); cur = ""; }
      cur += s;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  };
  V.say = async (text, isStopped) => {
    for (const p of V.pieces(text)) {
      if (isStopped()) return;
      const b64 = await V.audioFor(p);
      if (isStopped()) return;
      await V.play(b64);
    }
  };

  /* ---------- listening ---------- */
  /* Listens until the player presses "send": pauses while thinking do not end the question.
     Chrome stops recognition by itself after a silence, so it is restarted and the text kept.
     Returns { finish(), abort() }; handlers: partial(text), done(text), error(message). */
  V.listen = handlers => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { handlers.error && handlers.error("Этот браузер не умеет распознавать речь — напишите вопрос текстом."); return null; }
    let kept = "", live = "", finished = false, stopped = false, rec = null, restarts = 0;
    const clean = s => String(s || "").replace(/\s+/g, " ").trim();
    // Android Chrome repeats the whole phrase in every result ("Можно", "Можно ли", "Можно ли сыграть"…).
    // So one recognition run covers one phrase (continuous off) and only its latest, fullest text counts;
    // the phrases of several runs are joined, and a phrase that just repeats what we have replaces it.
    const join = (a, b) => {
      a = clean(a); b = clean(b);
      if (!a) return b;
      if (!b) return a;
      const la = a.toLowerCase(), lb = b.toLowerCase();
      if (lb.startsWith(la)) return b;          // the new text already contains the old one
      if (la.endsWith(lb)) return a;            // the same phrase again (a restart repeating the last words)
      // a restart that repeats only the tail and goes on: "…сыграть заморозь" + "заморозь на себя"
      const wa = a.split(" "), wb = b.split(" ");
      for (let k = Math.min(wa.length, wb.length - 1); k >= 1; k--) {
        const tail = wa.slice(-k).join(" ").toLowerCase();
        if (tail.length >= 4 && tail === wb.slice(0, k).join(" ").toLowerCase()) return a + " " + wb.slice(k).join(" ");
      }
      return a + " " + b;
    };
    const text = () => join(kept, live);
    const fatal = { "not-allowed": "Нет доступа к микрофону. Разрешите его для сайта в настройках Chrome.", "service-not-allowed": "Нет доступа к микрофону.", network: "Для распознавания речи нужен интернет.", "audio-capture": "Микрофон не найден." };
    function start() {
      rec = new SR();
      rec.lang = "ru-RU"; rec.interimResults = true; rec.maxAlternatives = 1; rec.continuous = false;
      rec.onresult = e => {
        // the fullest transcript of this run: the last result holds it on Android, the joined list elsewhere
        let joined = "";
        for (let i = 0; i < e.results.length; i++) joined = join(joined, e.results[i][0].transcript);
        const last = clean(e.results[e.results.length - 1][0].transcript);
        live = last.length >= joined.length ? last : joined;
        handlers.partial && handlers.partial(text());
      };
      rec.onerror = e => {
        if (fatal[e.error]) { stopped = true; handlers.error && handlers.error(fatal[e.error]); }
        // "no-speech" and "aborted" just mean a silence: keep listening
      };
      rec.onend = () => {
        kept = text(); live = "";
        if (stopped) return;
        if (finished) { stopped = true; handlers.done && handlers.done(kept); return; }
        if (++restarts > 40) { stopped = true; handlers.done && handlers.done(kept); return; }   // about a few minutes of silence
        try { start(); } catch (err) { stopped = true; handlers.done && handlers.done(kept); }
      };
      rec.start();
    }
    try { start(); } catch (e) { handlers.error && handlers.error("Не получилось включить микрофон."); return null; }
    V._join = join;   // for tests
    return {
      finish() { finished = true; try { rec.stop(); } catch (e) { stopped = true; handlers.done && handlers.done(text()); } },
      abort() { stopped = true; try { rec.abort(); } catch (e) {} },
    };
  };
})();
