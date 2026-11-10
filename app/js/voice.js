/* Voice assistant: speech -> text in Chrome (Web Speech), the question goes to the owner's
   Yandex Cloud function (rulebook + Alice AI + SpeechKit), the answer comes back as text,
   a quote with its page, and natural speech. Access is the GitHub sync connection itself:
   the function serves only someone holding a working token for the owner's private repo.
   Spoken texts are cached on the device, so a setup step costs money only the first time. */
(function () {
  "use strict";
  const BH = window.BH;
  const LS_URL = "board-helper-voice-url", LS_VOICE = "board-helper-voice-name";
  const DEFAULT_URL = "";   // filled in after the function is deployed
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
    why: () => !V.url() ? "Голосовой помощник ещё не подключён: нет адреса функции." : !(BH.cloud && BH.cloud.cfg) ? "Подключите синхронизацию с GitHub в настройках: она же даёт доступ к голосовому помощнику." : "",
    canListen: !!(window.SpeechRecognition || window.webkitSpeechRecognition),
  };

  async function call(body, signal) {
    const c = BH.cloud.cfg;
    let res;
    try {
      res = await fetch(V.url(), { method: "POST", headers: { "Content-Type": "application/json" }, signal,
        body: JSON.stringify(Object.assign({ gh: { owner: c.owner, repo: c.repo, token: c.token }, voice: V.voice() }, body)) });
    } catch (e) {
      if (e && e.name === "AbortError") throw e;
      throw Object.assign(new Error("Нет связи с помощником. Проверьте интернет."), { code: "offline" });
    }
    let j = null; try { j = await res.json(); } catch (e) {}
    if (!res.ok) throw Object.assign(new Error((j && j.error && j.error.message) || "Помощник ответил ошибкой " + res.status), { code: (j && j.error && j.error.code) || "http", status: res.status });
    return j;
  }

  /* ---------- ask ---------- */
  V.ask = (game, question, situation, signal) => call({ action: "ask", game, question, situation }, signal);

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
  V.listen = handlers => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { handlers.error && handlers.error("Этот браузер не умеет распознавать речь — напишите вопрос текстом."); return null; }
    const rec = new SR();
    rec.lang = "ru-RU"; rec.interimResults = true; rec.maxAlternatives = 1; rec.continuous = false;
    let final = "";
    rec.onresult = e => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) final += t; else interim += t;
      }
      handlers.partial && handlers.partial((final + " " + interim).trim());
    };
    rec.onerror = e => {
      const m = { "not-allowed": "Нет доступа к микрофону. Разрешите его для сайта в настройках Chrome.", "service-not-allowed": "Нет доступа к микрофону.", "no-speech": "Ничего не услышал. Попробуйте ещё раз.", network: "Для распознавания речи нужен интернет.", "audio-capture": "Микрофон не найден." };
      if (e.error !== "aborted") handlers.error && handlers.error(m[e.error] || "Не получилось распознать речь (" + e.error + ").");
    };
    rec.onend = () => handlers.done && handlers.done(final.trim());
    try { rec.start(); } catch (e) { handlers.error && handlers.error("Не получилось включить микрофон."); return null; }
    return rec;
  };
})();
