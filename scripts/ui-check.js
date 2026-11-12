/* «Весь текст помещается» — проверка в браузере (docs/ui.md).
   Как запустить: открыть приложение на ширине телефона (360, 375, 412 px), вставить этот файл в консоль,
   затем выполнить `await uiCheck()`. Скрипт обходит все экраны, вкладки, шаги формы и подготовки, лист
   раунда, диалог завершения и лист голосового вопроса. Возвращает список нарушений; пустой список — всё
   в порядке. Данные не меняются: листы и диалоги закрываются без сохранения, голосовой помощник
   подменяется только на время проверки и в сеть не ходит.
   Что считается нарушением:
   - элемент выходит за край экрана;
   - элемент вылезает из своей карточки (панель, строка, кнопка, чип…);
   - текст обрезан многоточием или по числу строк;
   - у текста скрыт хвост;
   - подсказка в пустом поле (placeholder) шире самого поля. */
(() => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const BOX = ".panel,.entry,.sheet,.sess-hero,.pl,.kpi,.item,.grow,.gcard,.pc-game,.setup-card,.stat-tile,.pick-row,.step,.note,.btn,.chip,.badge,.mi,.tile,.flag,.card-t,.seat,.pc-line";
  const SCROLLERS = ".hscroll,.scroll-x,.pick-list";
  // texts that may be cut on purpose: what a person typed and made very long is shortened in a row
  const allowCut = el => el.closest(".mi") || el.closest(".back") || (el.matches(".ell") && el.closest(".sheet-next"));

  function scan(where) {
    const vw = document.documentElement.clientWidth, out = [];
    const roots = [document.querySelector("main"), document.getElementById("overlay-root"), document.querySelector(".topbar")].filter(Boolean);
    for (const root of roots) for (const el of root.querySelectorAll("*")) {
      if (el.closest("svg") || el.closest("[hidden]")) continue;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const inScroller = el.closest(SCROLLERS);
      const txt = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 70);
      const name = typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\s+/).join(".") : el.tagName.toLowerCase();
      let why = "";
      if (!inScroller && (r.right > vw + 1 || r.left < -1)) why = "за краем экрана";
      else if (cs.textOverflow === "ellipsis" && el.scrollWidth > el.clientWidth + 1) why = allowCut(el) ? "" : "обрезано многоточием";
      else if (cs.webkitLineClamp && cs.webkitLineClamp !== "none" && el.scrollHeight > el.clientHeight + 2) why = "обрезано по строкам";
      else if (!el.children.length && txt && /hidden|clip/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1) why = allowCut(el) ? "" : "хвост текста скрыт";
      else {
        const box = el.parentElement && el.parentElement.closest(BOX);
        if (box && !(inScroller && box.contains(inScroller))) {
          const b = box.getBoundingClientRect();
          if (r.right > b.right + 1.5 || r.left < b.left - 1.5) why = "вылезает из " + (typeof box.className === "string" ? "." + box.className.trim().split(/\s+/)[0] : box.tagName);
        }
      }
      if (!why && el.matches("input:not([type=checkbox]):not([type=radio]),textarea") && el.placeholder && !el.value) {
        const ps = getComputedStyle(el, "::placeholder"), room = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - (el.type === "search" ? 20 : 0);
        ctx.font = `${ps.fontStyle} ${ps.fontWeight} ${ps.fontSize} ${ps.fontFamily}`;
        if (ctx.measureText(el.placeholder).width > room - (el.type === "number" ? 6 : 0)) why = "подсказка в поле не помещается";
        if (why) { out.push(`${where} — ${why}: ${name} «${el.placeholder}»`); continue; }
      }
      if (why) out.push(`${where} — ${why}: ${name} «${txt}»`);
    }
    return out;
  }
  const ctx = document.createElement("canvas").getContext("2d");
  async function visit(hash) { location.hash = hash; await wait(450); window.scrollTo(0, 0); }
  async function withTabs(where) {
    const keys = [...document.querySelectorAll('[data-act="pc-tab"],[data-act="gc-tab"],[data-act="pl-tab"]')].map(b => [b.dataset.act, b.dataset.tab]);
    if (!keys.length) return scan(where);
    const out = [];
    for (const [act, tab] of keys) { const b = document.querySelector(`[data-act="${act}"][data-tab="${tab}"]`); if (b) { b.click(); await wait(300); } out.push(...scan(`${where} [${tab}]`)); }
    return out;
  }
  async function closeOverlay() { if (document.querySelector("#overlay-root .overlay")) { history.back(); await wait(350); } }

  window.uiCheck = async () => {
    const errors = [], onErr = e => errors.push((e.error && e.error.message) || e.message || String(e.reason || e));
    const origErr = console.error; console.error = (...a) => { errors.push(a.map(x => (x && x.message) || String(x)).join(" ")); origErr.apply(console, a); };
    window.addEventListener("error", onErr); window.addEventListener("unhandledrejection", onErr);
    const S = BH.state, out = [], vw = document.documentElement.clientWidth;
    const routes = ["#/", "#/games", "#/sessions", "#/menu", "#/players", "#/places", "#/stats", "#/settings/sync", "#/settings/voice", "#/settings/theme", "#/settings/backup"];
    for (const g of BH.games) routes.push("#/games/" + g.id);
    for (const p of S.players) routes.push("#/players/" + p.id);
    for (const p of S.places) routes.push("#/places/" + p.id);
    for (const s of S.sessions) { routes.push("#/s/" + s.id); if (s.status !== "finished") routes.push("#/s/" + s.id + "/rules"); }
    for (const r of routes) { await visit(r); out.push(...await withTabs(r)); }
    // the new game form, every step open
    await visit("#/new");
    for (const st of [...document.querySelectorAll('[data-act="draft-step"]')].map(b => b.dataset.step)) {
      const b = document.querySelector(`[data-act="draft-step"][data-step="${st}"]`);
      if (b && b.getAttribute("aria-expanded") !== "true") { b.click(); await wait(250); }
      out.push(...scan(`#/new [${st}]`));
    }
    // setup: every step
    for (const s of S.sessions.filter(x => x.status === "setup")) {
      await visit("#/s/" + s.id + "/setup");
      const n = document.querySelectorAll(".setup-dots button").length;
      for (let k = 0; k < n; k++) { document.querySelector(`.setup-dots [data-i="${k}"]`).click(); await wait(300); out.push(...scan(`#/s/${s.id}/setup [шаг ${k + 1}]`)); }
    }
    // the wheel, and the name once chosen: the buttons are seen without scrolling, with room to spare
    // (the first player is taken off only in memory for a moment, nothing is saved)
    const seen = where => { for (const b of document.querySelectorAll(".wheel-bar .btn")) if (b.getBoundingClientRect().bottom > window.innerHeight - 12) out.push(`${where} — кнопка «${b.innerText.trim()}» у самого края экрана или ниже`); };
    for (const s of S.sessions.filter(x => x.status === "first" || (x.status === "playing" && !x.rounds.length && BH.game(x.gameId).first))) {
      const was = s.first;
      try {
        s.first = null; await visit("#/s/" + s.id + "/first"); await wait(150);
        out.push(...scan(`#/s/${s.id}/first [колесо]`)); seen(`#/s/${s.id}/first [колесо]`);
      } finally { s.first = was; }
      if (was) { await visit("#/"); await visit("#/s/" + s.id + "/first"); await wait(150); out.push(...scan(`#/s/${s.id}/first [выбран]`)); seen(`#/s/${s.id}/first [выбран]`); }
    }
    // running games: the round sheet with the cards of each player, editing a round, the finish dialog, a voice answer
    const V = BH.voice, keep = { ready: V.ready, canListen: V.canListen, speaks: V.speaks, ask: V.ask };
    try {
      V.ready = () => true; V.canListen = false; V.speaks = () => false;
      V.ask = async () => ({ answer: "Да, можно. Остановившийся игрок не защищён: его карты остаются в раунде, и на него можно сыграть любое действие, кроме тех, что требуют активного игрока.", quote: "Карты остановившегося игрока остаются в раунде до самого конца, и их всё ещё можно украсть, поменять или сбросить.", page: "11–12", ref: (BH.game(S.sessions[0] && S.sessions[0].gameId) || BH.games[0]).rules[0].id, found: true });
      for (const s of S.sessions.filter(x => x.status === "playing")) {
        await visit("#/s/" + s.id + "/play");
        // a cooperative game: the choice of a card, the finish dialog — looked at only, nothing is pressed in them
        if (document.querySelector('[data-act="heist"]')) {
          const cp = document.querySelector('[data-act="coop-pick"]'); if (cp) { cp.click(); await wait(300); out.push(...scan(`${s.id} [выбор карты]`)); await closeOverlay(); }
          const fm = document.querySelector('[data-act="finish-menu"]'); if (fm) { fm.click(); await wait(300); out.push(...scan(`${s.id} [завершить]`)); await closeOverlay(); }
          continue;
        }
        // a game scored at the end: its score sheet, reached from «Завершить»
        if (!document.querySelector('[data-act="new-round"]')) {
          const fm = document.querySelector('[data-act="finish-menu"]'); if (fm) { fm.click(); await wait(300); out.push(...scan(`${s.id} [завершить]`)); }
          const go = document.querySelector('[data-act="dlg"][data-i="0"]'); if (go) { go.click(); await wait(350); }
          const ids = [...document.querySelectorAll('.overlay [data-act="end-entry"][data-p]')].map(x => x.dataset.p);
          for (const id of [...new Set(ids)]) { const e = document.querySelector(`.overlay [data-act="end-entry"][data-p="${id}"]`); if (e && e.getAttribute("aria-expanded") !== "true") { e.click(); await wait(250); } out.push(...scan(`${s.id} [подсчёт славы, ${id}]`)); }
          await closeOverlay();
          continue;
        }
        document.querySelector('[data-act="new-round"]').click(); await wait(350);
        const ids = [...document.querySelectorAll('.overlay [data-act="open-entry"][data-p]')].map(x => x.dataset.p).filter(Boolean);
        out.push(...scan(`${s.id} [лист раунда]`));
        for (const id of [...new Set(ids)]) { const e = document.querySelector(`.overlay [data-act="open-entry"][data-p="${id}"]`); if (e) { e.click(); await wait(250); } out.push(...scan(`${s.id} [лист раунда, карты ${id}]`)); }
        // a bust on the open entry: the cards hide, the note shows (the sheet is closed without saving)
        const bf = document.querySelector('.overlay .entry.open [data-act="flag"][data-f="bust"]');
        if (bf) { bf.click(); await wait(250); out.push(...scan(`${s.id} [лист раунда, перебор]`)); }
        await closeOverlay();
        if (s.rounds.length) { const row = document.querySelector('[data-act="edit-round"]'); if (row) { row.click(); await wait(350); out.push(...scan(`${s.id} [исправить раунд]`)); await closeOverlay(); } }
        document.querySelector('[data-act="finish-menu"]').click(); await wait(300); out.push(...scan(`${s.id} [завершить]`)); await closeOverlay();
        document.querySelector('[data-act="ask-open"]').click(); await wait(350);
        const inp = document.querySelector('.overlay input[name=q]');
        if (inp) { inp.value = "Можно ли украсть карту у того, кто уже остановился и не берёт карты?"; inp.closest("form").requestSubmit(); await wait(500); const d = document.querySelector(".overlay details"); if (d) d.open = true; await wait(100); out.push(...scan(`${s.id} [голосовой ответ]`)); }
        await closeOverlay();
      }
    } finally { Object.assign(V, keep); }
    window.removeEventListener("error", onErr); window.removeEventListener("unhandledrejection", onErr); console.error = origErr;
    for (const e of errors) out.push("ошибка в коде: " + e);
    return [...new Set(out)].map(x => `${vw}px · ${x}`);
  };
})();
