/* Помощник настолок — screens and navigation.
   Routes (hash): #/ (home)  #/games  #/games/<id>  #/sessions (calendar)  #/menu  #/players  #/places  #/stats
   #/settings/sync|voice|theme|backup  #/new  #/s/<id>/setup|first|play|rules|done|edit */
(function () {
  "use strict";
  // a file that failed to load (e.g. a 503 while the site publishes an update) must not leave a
  // half-working app: check every part before anything uses it, and offer a reload
  {
    const W = window, B = W.BH || {};
    const parts = [["основа", B.esc && B.ICON], ["данные", B.state && B.saveNow], ["игры", B.games && B.games.length], ["правила", B.rulesUI], ["колесо", B.wheel],
      ["синхронизация", W.BHSync && B.cloud], ["голос", B.voice && B.speech], ["картинки", B.assets]];
    const missing = parts.filter(x => !x[1]).map(x => x[0]);
    if (missing.length) {
      const m = document.getElementById("main");
      if (m) m.innerHTML = '<div class="empty"><p>Не все части приложения загрузились (' + missing.join(", ") + '). Обычно это бывает, когда сайт как раз обновляется.</p><p style="margin-top:12px"><button class="btn primary big" id="reload-app">Обновить</button></p></div>';
      const b = document.getElementById("reload-app"); if (b) b.addEventListener("click", () => location.reload());
      return;
    }
  }
  const BH = window.BH, esc = BH.esc, I = BH.ICON;
  const main = document.getElementById("main");
  const overlayRoot = document.getElementById("overlay-root");
  const S = () => BH.state;

  /* ---------- theme ---------- */
  function applyTheme() {
    const t = S().settings.theme;
    if (t === "light" || t === "dark") document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
    const dark = t === "dark" || (t !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = dark ? "#15130F" : "#F4EFE6";
  }

  /* ---------- routing ---------- */
  /* Overlays (round sheet, dialogs, voice question) add one history entry, so the phone's Back
     closes the overlay instead of leaving the screen. Navigating from inside an overlay first
     drops that entry, so it never lingers in the history. */
  /* Every app entry in the history remembers the screen right before it ({back: "#/..."}, null for
     the first one). "Back" links and "go back after saving" use it to step back instead of piling up
     new entries, and never leave the app by mistake. */
  /* The screens of one game (the form, setup, wheel, play, result) also carry {origin}: the screen
     outside the game it was opened from (home, the calendar, a game's page). It passes from screen to
     screen of the game, so its back link and a deletion return there wherever the player went inside. */
  let ovPushed = false, pendingReplace = null, carry = null;   // carry: {back, origin} for the entry a replace creates
  let curState = null;        // the state of the entry shown before the latest navigation
  let quietUntil = 0;         // taps are ignored until then: the screen has just changed under the finger
  const quiet = () => { quietUntil = Date.now() + 350; };
  const SCREENS = ["setup", "first", "play", "rules", "done", "edit"];
  const urlOf = h => location.pathname + location.search + h;
  const normHash = h => (!h || h === "#" || h === "#/") ? "#/" : h;
  const inGameFlow = h => /^#\/(s\/|new)/.test(h || "");
  const backOf = () => { const st = history.state; return st && typeof st.back === "string" ? st.back : null; };
  const originState = () => { const st = history.state; return st && typeof st.origin === "string" ? st.origin : null; };
  const backIs = h => backOf() !== null && normHash(backOf()) === normHash(h);
  function ovOpen() { if (!ovPushed) { history.pushState({ ov: 1, back: backOf(), origin: originState() }, ""); ovPushed = true; } }
  function ovSync() {   // all overlays closed by a button: remove their history entry
    if (ovPushed && !sheet && !dialog && !ask) { ovPushed = false; if (history.state && history.state.ov) history.back(); }
  }
  window.addEventListener("popstate", e => {
    if (pendingReplace) { const h = pendingReplace; pendingReplace = null; carry = { back: backOf(), origin: originState() }; location.replace(urlOf(h)); return; }
    if (ovPushed && !(e.state && e.state.ov)) {   // Back pressed while an overlay is open: just close it
      ovPushed = false;
      if (ask) { stopListening(); if (askCtl) askCtl.abort(); askCtl = null; BH.voice.stopAudio(); ask = null; }
      sheet = null; dialog = null;
      renderOverlay();
    }
  });
  const go = h => {
    if (ovPushed) { ovPushed = false; location.replace(urlOf(h)); return; }   // takes the overlay's entry
    if (location.hash === h) render(); else location.hash = h;
  };
  // same, but the current screen is dropped from the history: "back" will not return to it
  // (used after a game is created, so "back" cannot bring up the form and create it twice)
  // if the screen we go to is the one right before this one, just step back to it (no duplicate entries)
  const goReplace = h => {
    if (backIs(h) && normHash(location.hash) !== normHash(h)) {
      if (ovPushed) { ovPushed = false; history.go(-2); } else history.back();
      return;
    }
    if (ovPushed) { ovPushed = false; pendingReplace = h; history.back(); return; }   // drop the overlay entry, then replace the screen
    if (location.hash === h) render(); else { carry = { back: backOf(), origin: originState() }; location.replace(urlOf(h)); }
  };
  function route() {
    const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
    return { a: parts[0] || "", b: parts[1] || "", c: parts[2] || "" };
  }

  let draft = null;           // new-game wizard in progress
  let prevHash = "";          // the screen before the current one
  let sheet = null;           // round entry sheet
  let dialog = null;          // confirm dialog
  let rulesQuery = "";
  let spinToken = 0;          // a wheel spin applies its result only if nothing changed meanwhile

  // the current copy of a game: a sync may have replaced BH.state since a dialog or a callback was set up
  const fresh = s => (s && BH.session(s.id)) || s;

  function confirmDelete(s) {
    const id = s.id;
    openDialog({ title: "Удалить партию?", text: "Она пропадёт из истории и статистики. Это нельзя отменить.", buttons: [
      { label: "Удалить", danger: true, run: () => { const to = originOf().href; S().sessions = S().sessions.filter(x => x.id !== id); BH.saveNow(); dialog = null; goReplace(to); } },
      { label: "Отмена", run: closeDialog }] });
  }

  // what a redraw of the same screen would lose: list scroll, typed text, the focused control
  const keyOf = el => {
    if (!el || !el.tagName) return null;
    const f = el.closest("form[data-form]");
    if (f && el.name) return `form[data-form="${f.dataset.form}"] [name="${el.name}"]`;
    if (!el.dataset || !el.dataset.act) return null;
    let k = `[data-act="${el.dataset.act}"]`;
    for (const a of ["id", "step", "list", "tab", "p", "i"]) if (el.dataset[a] !== undefined) k += `[data-${a}="${CSS.escape(el.dataset[a])}"]`;
    return k;
  };
  function keepState() {
    const st = { scroll: [], values: [], focus: keyOf(main.contains(document.activeElement) ? document.activeElement : null) };
    main.querySelectorAll(".pick-list[data-list]").forEach(l => st.scroll.push([l.dataset.list, l.scrollTop]));
    main.querySelectorAll('input[data-act="pick-q"], form[data-form] input[name="name"]:not([type=hidden])').forEach(i => { if (i.value) st.values.push([keyOf(i), i.value]); });
    return st;
  }
  function restoreState(st) {
    for (const [k, v] of st.values) { const i = k && BH.$(k); if (i && !i.value) { i.value = v; if (i.dataset.act === "pick-q") i.dispatchEvent(new Event("input", { bubbles: true })); } }
    for (const [list, top] of st.scroll) { const l = BH.$('.pick-list[data-list="' + list + '"]'); if (l) l.scrollTop = top; }
    if (st.focus) { const n = BH.$(st.focus); if (n) n.focus({ preventScroll: true }); }
  }
  let renderedHash = null;
  let pendingRule = null;   // a rule section to open once its page is drawn (from a voice answer)
  function openRule(id) {
    const n = BH.$("details#rule-" + id); if (!n) return;
    for (let p = n.parentElement; p; p = p.parentElement) if (p.matches("details.fold-sec, details.fold-grp")) p.open = true;
    n.open = true; n.classList.add("hit");
    setTimeout(() => n.scrollIntoView({ block: "start" }), 50);   // after the screen's own scroll to the top
  }
  function render() {
    const r = route();
    let html = "", nav = "home", inGame = false, after = null;
    try {
      if (r.a === "" ) html = viewHome();
      else if (r.a === "new") { html = viewNew(); nav = "sessions"; inGame = true; }
      else if (r.a === "sessions") { html = viewSessions(); nav = "sessions"; }
      else if (r.a === "menu") { html = viewMenu(); nav = "menu"; }
      else if (r.a === "places" && r.b) {
        const pl = BH.place(r.b); nav = "menu";
        if (!pl && backOf() !== null && !ovPushed) { history.back(); html = ""; }   // a deleted place, reached with Back / Forward
        else html = pl ? viewPlace(pl) : notFound("Такого места нет.");
      }
      else if (r.a === "places") { html = viewPlaces(); nav = "menu"; }
      else if (r.a === "s") {
        const s = BH.session(r.b);
        nav = "sessions";
        // a game deleted meanwhile, reached with Back: skip its entry instead of showing a dead page
        // (only inside the app's own history; a link from outside still gets the message)
        if (!s && backOf() !== null && !ovPushed) { history.back(); html = ""; }
        else if (!s) html = notFound("Партия не найдена. Возможно, её удалили.");
        else {
          inGame = r.c !== "done";
          const res = viewSession(s, r.c);
          html = res.html; after = res.after;
        }
      }
      else if (r.a === "games" && r.b) { const g = BH.game(r.b); nav = "games"; if (g) { html = viewGame(g); after = () => BH.rulesUI.bind(main, g); } else html = notFound("Такой игры нет в каталоге."); }
      else if (r.a === "games") { html = viewGames(); nav = "games"; }
      else if (r.a === "players" && r.b) {
        const p = BH.player(r.b); nav = "menu";
        if (!p && backOf() !== null && !ovPushed) { history.back(); html = ""; }   // a deleted player, reached with Back / Forward
        else html = p ? viewPlayer(p) : notFound("Такого игрока нет.");
      }
      else if (r.a === "players") { html = viewPlayers(); nav = "menu"; }
      else if (r.a === "stats") { html = viewStats(); nav = "menu"; }
      else if (r.a === "settings") { html = viewSettings(r.b); nav = "menu"; }
      else html = notFound("Такой страницы нет.");
    } catch (e) {
      console.error(e);
      html = `<div class="note">Что-то пошло не так: ${esc(e.message)}. <a href="#/">На главную</a></div>`;
    }
    const same = renderedHash === location.hash, kept = same ? keepState() : null;
    main.innerHTML = html;
    renderedHash = location.hash;
    if (kept) restoreState(kept);
    document.body.classList.toggle("in-game", inGame);
    BH.$$("[data-nav]").forEach(a => { if (a.dataset.nav === nav) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
    if (after) { try { after(); } catch (e) { console.error(e); } }
    renderOverlay();
    updateSync();
    BH.assets.hydrate(main);
    curState = history.state;
    if (pendingRule) { const id = pendingRule; pendingRule = null; openRule(id); }
  }
  // the sync waits while the user is in the middle of something
  let spinning = false;
  let cheer = null;            // the game just finished: confetti once over its result
  BH.uiBusy = () => {
    const a = document.activeElement;
    const typing = a && a.matches && a.matches("main input:not([type=checkbox]), main textarea") && a.value;   // half-typed text would be lost by a redraw
    return !!(sheet || dialog || ask || spinning || typing);
  };
  const notFound = text => `<div class="empty"><p>${esc(text)}</p><p style="margin-top:12px"><a class="btn" href="#/">На главную</a></p></div>`;
  // a back link to the previous screen steps back in the history instead of adding an entry,
  // so the phone's Back button does not bring the left screen up again
  const backLink = (href, text) => `<a class="back" href="${href}" data-act="nav-back" data-href="${href}" title="${esc(text)}">${I.back}<span>${esc(text)}</span></a>`;
  // a game session can be opened from the home screen, the sessions calendar or a game's page:
  // its back link leads to where it was opened from (remembered in the history), home otherwise
  function originOf() {
    const b = originState() || backOf(), seg = b ? normHash(b).replace(/^#\/?/, "").split("/") : [];
    if (seg[0] === "sessions") return { href: b, label: "Партии" };
    if (seg[0] === "games") { const g = seg[1] && BH.game(seg[1]); return { href: b, label: g ? g.name : "Игры" }; }
    if (seg[0] === "players") { const q = seg[1] && BH.player(seg[1]); return { href: b, label: q ? q.name : "Игроки" }; }
    if (seg[0] === "places") { const q = seg[1] && BH.place(seg[1]); return { href: b, label: q ? q.name : "Места" }; }
    return { href: "#/", label: "Главная" };
  }
  const backToOrigin = label => { const o = originOf(); return backLink(o.href, label || o.label); };
  // pages reached from several places (a game's page, players…): back to the main screen we came
  // from when it is one, else to the usual parent
  function backSmart(href, label) {
    const b = backOf(), seg = b ? normHash(b).replace(/^#\/?/, "").split("/") : null;
    if (seg) {
      if (seg[0] === "") return backLink("#/", "Главная");
      if (seg[0] === "games" && !seg[1]) return backLink(b, "Игры");
      if (seg[0] === "sessions") return backLink(b, "Партии");
      if (seg[0] === "menu") return backLink(b, "Меню");
      if (seg[0] === "s" && BH.session(seg[1])) return backLink(b, "Партия");
      if (seg[0] === "players" && !seg[1]) return backLink(b, "Игроки");
      if (seg[0] === "places" && !seg[1]) return backLink(b, "Места");
      if (seg[0] === "games" && seg[1] && !(route().a === "games" && route().b === seg[1])) { const q = BH.game(seg[1]); if (q) return backLink(b, q.name); }
      if (seg[0] === "players" && seg[1] && !(route().a === "players" && route().b === seg[1])) { const q = BH.player(seg[1]); if (q) return backLink(b, q.name); }
    }
    return backLink(href, label);
  }

  /* ---------- shared bits of the lists ---------- */
  const IC = {
    people: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3.2"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><path d="M16 5.5a3 3 0 0 1 0 5.6M17.5 14.5a5 5 0 0 1 3 4.5"/></svg>',
    cal: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>',
    trophy: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4h8v5a4 4 0 0 1-8 0V4z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20h7M9.5 17h5v3h-5z"/></svg>',
    dice: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1.3"/><circle cx="15" cy="15" r="1.3"/><circle cx="15" cy="9" r="1.3"/><circle cx="9" cy="15" r="1.3"/></svg>',
    chev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
    pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/></svg>',
    chart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20V11M12 20V5M19 20v-6"/></svg>',
    cloud: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 18a4 4 0 0 1-.5-8A5.5 5.5 0 0 1 17 8.5a4.5 4.5 0 0 1 0 9.5H7z"/></svg>',
    mic: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>',
    sun: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/></svg>',
    save: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
    cards: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="6" width="11" height="15" rx="2"/><path d="M9.5 3.5l9.6 2.6a2 2 0 0 1 1.4 2.4l-3 11"/></svg>',
    clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
    user: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/></svg>',
    building: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V6l8-3v17M12 9l8 3v8M3 20h18M7.5 9h1M7.5 13h1M7.5 16.5h1M15.5 15h1"/></svg>',
    bolt: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 3L5 13.5h6L10 21l8-10.5h-6z"/></svg>',
    puzzle: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h3.5a2 2 0 1 1 4 0H16v3.5a2 2 0 1 1 0 4V19H5z"/></svg>',
    cake: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h16M5.5 20v-7h13v7M5.5 15.5c1.6 1.2 3 1.2 4.3 0s3-1.2 4.4 0 2.9 1.2 4.3 0M12 13v-3M12 6.5c-.9-.9-.9-2 0-3 .9 1 .9 2.1 0 3z"/></svg>',
  };
  /* The parts of a screen, each with its own look (docs/ui.md):
     topline — back on the left, actions on the object on the right;
     a fact — a chip with its own icon (date, place, players, time…), never a line of words with dots;
     an action — a button; a status — a coloured badge. */
  // facts: meta([[IC.cal, "6 ноября", "Дата"], cond && [IC.pin, "Дача"]], "plain"); the text is HTML, escaped by the caller
  const meta = (items, cls) => {
    const list = items.filter(x => x && x[1] !== undefined && x[1] !== null && x[1] !== "");
    return list.length ? `<span class="meta ${cls || ""}">${list.map(([ic, t, title, c]) => `<span class="mi ${c || ""}"${title ? ` title="${esc(title)}"` : ""}>${ic || ""}<span>${t}</span></span>`).join("")}</span>` : "";
  };
  // a value with what it is about under it, for the key-value lines: two("197", "Коля, 13 октября")
  const two = (main, sub) => `${main}<small>${sub}</small>`;
  const topline = (back, actions) => `<div class="topline">${back || "<span></span>"}${actions ? `<div class="topline-act">${actions}</div>` : ""}</div>`;
  const MONTHS_NOM = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
  const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
  const MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
  const MONTHS_IN = ["январе", "феврале", "марте", "апреле", "мае", "июне", "июле", "августе", "сентябре", "октябре", "ноябре", "декабре"];
  const shortDate = ts => { const d = new Date(ts); return d.getDate() + " " + MONTHS_SHORT[d.getMonth()]; };
  // a date in a list row: short, with the year when it is not this one
  const rowDate = ts => shortDate(ts) + (new Date(ts).getFullYear() !== new Date().getFullYear() ? " " + new Date(ts).getFullYear() : "");
  const finishedSessions = () => S().sessions.filter(s => s.status === "finished");
  // the whole collection, most played first (then by name)
  function gamesByPlays() {
    const fin = finishedSessions();
    return BH.games.map(g => ({ g, n: fin.filter(s => s.gameId === g.id).length })).sort((a, b) => b.n - a.n || a.g.name.localeCompare(b.g.name, "ru"));
  }
  const coverOf = (g, cls) => `<span class="cover ${cls || ""}"${g ? BH.assets.cover(g) : ""}>${(g && g.cover) || ""}</span>`;
  const playersRange = g => (g.players.min === g.players.max ? g.players.min : g.players.min + "–" + g.players.max) + " " + BH.plural(g.players.max, "игрок", "игрока", "игроков");

  // one game as a tall card (home shelves): cover, optional count, name, a line under it
  function gameCard(g, o) {
    o = o || {};
    return `<a class="gcard" href="#/games/${esc(g.id)}">
      ${coverOf(g, "gcard-img")}
      ${o.count ? `<span class="gcard-count" title="Партий">${IC.cards}${o.count}</span>` : ""}
      <span class="gcard-t"><b>${esc(g.name)}</b>${o.meta ? `<span class="gcard-meta">${o.meta}</span>` : ""}</span>
    </a>`;
  }

  // everyone at the table as small faces: the winners first with a cup, then the others
  function tablePeople(s) {
    const finished = s.status === "finished";
    const w = finished ? s.winners.map(BH.player).filter(Boolean) : [];
    const rest = s.players.filter(id => !finished || !s.winners.includes(id)).map(BH.player).filter(Boolean);
    const coop = BH.isCoop(BH.game(s.gameId));
    const faces = list => list.slice(0, 3).map(p => BH.avatar(p, "sm")).join("") + (list.length > 3 ? `<span class="more">+${list.length - 3}</span>` : "");
    const names = list => esc(list.map(p => p.name).join(", "));
    return `<div class="sl-people">
      ${w.length ? `<span class="sl-win" title="${coop ? "Победа банды" : w.length > 1 ? "Ничья" : "Победа"}: ${names(w)}">${IC.trophy}<span class="faces">${faces(w)}</span></span>` : ""}
      ${rest.length ? `<span class="sl-rest" title="${finished ? (coop ? "Банда попалась" : "Играли") : "За столом"}: ${names(rest)}">${IC.people}<span class="faces">${faces(rest)}</span></span>` : ""}
    </div>`;
  }
  // one game session as a list row: cover, game, date · place; on the right the stage of a game still going,
  // the winners with a cup and the others (kept to the right, so the row does not grow taller)
  function sessionLine(s, o) {
    const g = BH.game(s.gameId), place = BH.place(s.placeId);
    let right = "";
    if (s.status === "setup") right = '<span class="badge warn">подготовка</span>';
    else if (s.status === "first") right = '<span class="badge warn">выбор первого</span>';
    else if (s.status === "playing") { const eg = BH.game(s.gameId), last = BH.isEndScored(eg) && eg.rounds.count; right = `<span class="badge accent">${BH.isRace(eg) ? "идёт игра" : last && s.rounds.length >= last ? "подсчёт славы" : (BH.isCoop(eg) ? "ограбление " : "раунд ") + (s.rounds.length + 1)}</span>`; }
    return `<a class="item sline" href="#/s/${s.id}">
      ${coverOf(g, "mini")}
      <div class="t"><b>${esc(g ? g.name : s.gameId)}</b>${meta([[IC.cal, rowDate(s.created), BH.fmtDate(s.created)], place && !(o && o.noPlace) && [IC.pin, esc(place.name), place.name]], "plain")}</div>
      <div class="sl-right">${right}${tablePeople(s)}</div>
    </a>`;
  }
  // one finished session as a tall card (home): cover, a cup when I won it, game, players, date
  function sessionCard(s, meId) {
    const g = BH.game(s.gameId);
    const won = meId && s.winners.includes(meId);
    return `<a class="gcard" href="#/s/${esc(s.id)}">
      ${coverOf(g, "gcard-img")}
      ${won ? `<span class="gcard-win" title="${BH.isCoop(g) ? "Банда победила" : s.winners.length > 1 ? "Ничья — вы среди победителей" : "Вы победили"}">${IC.trophy}</span>` : ""}
      <span class="gcard-t"><b>${esc(g ? g.name : s.gameId)}</b><span class="gcard-meta"><span>${IC.people}${s.players.length}</span><span>${IC.cal}${shortDate(s.created)}</span></span></span>
    </a>`;
  }

  /* ---------- home: me, my numbers, the latest games, the most played, the shelf of shame ---------- */
  function viewHome() {
    const me = BH.me(), fin = finishedSessions();
    const mine = me ? fin.filter(s => s.players.includes(me.id)) : fin;
    const live = S().sessions.filter(s => s.status !== "finished").sort((a, b) => (b.created || 0) - (a.created || 0));
    // the latest finished sessions (games still going are listed above them)
    const byDate = S().sessions.slice().sort((a, b) => (b.created || 0) - (a.created || 0));
    const recent = byDate.filter(s => s.status === "finished").slice(0, 10);
    // "repeat": the latest finished game (a game still going is not repeated), else the latest one
    const last = byDate.find(s => s.status === "finished" && BH.game(s.gameId)) || byDate.find(s => BH.game(s.gameId));
    const ranked = gamesByPlays(), top = ranked.filter(x => x.n).slice(0, 10), shelf = ranked.filter(x => !x.n);
    const nGames = BH.games.length;
    return `<div class="stack home">
      <a class="profile" href="#/players${me ? "/" + esc(me.id) : ""}">
        ${me ? BH.avatar(me, "xl") : `<span class="avatar xl avatar-empty" aria-hidden="true">?</span>`}
        <div class="profile-t">
          <h1>${me ? esc(me.name) : "Мои настолки"}</h1>
          <div class="profile-stats"><span>${IC.dice}${nGames} ${BH.plural(nGames, "игра", "игры", "игр")}</span><span>${IC.cards}${mine.length} ${BH.plural(mine.length, "партия", "партии", "партий")}</span></div>
          ${me ? "" : `<span class="small profile-hint">Отметьте себя в игроках — галочка «Это я»</span>`}
        </div>
      </a>
      ${live.length ? `<section class="panel"><div class="sec-h"><h2>Идут сейчас</h2><span class="badge accent">${live.length}</span></div><div class="list">${live.map(sessionLine).join("")}</div></section>` : ""}
      <section>
        <div class="sec-h"><h2>Последние партии</h2>${recent.length ? `<a class="sec-link" href="#/sessions">Все${IC.chev}</a>` : ""}</div>
        <div class="hscroll">
          <div class="tile-col">
            <a class="tile" href="#/new"><span class="tile-ic">${I.plus}</span><span>Новая партия</span></a>
            ${last ? `<button class="tile" data-act="repeat" data-sid="${esc(last.id)}">${coverOf(BH.game(last.gameId), "tile-cover")}<span>Повторить</span></button>` : ""}
          </div>
          ${recent.map(s => sessionCard(s, me && me.id)).join("")}
          ${recent.length ? "" : `<p class="muted small shelf-empty">Здесь появятся сыгранные партии.</p>`}
        </div>
      </section>
      ${top.length ? `<section>
        <div class="sec-h"><h2>Чаще всего играем</h2><a class="sec-link" href="#/games">Все игры${IC.chev}</a></div>
        <div class="hscroll">${top.map(x => gameCard(x.g, { count: x.n })).join("")}</div>
      </section>` : ""}
      <section>
        <div class="sec-h"><h2>Полка позора</h2>${shelf.length ? `<span class="badge" title="Игр, в которые ещё не играли">${shelf.length}</span>` : ""}</div>
        ${shelf.length ? `<div class="hscroll">${shelf.map(x => gameCard(x.g)).join("")}</div>` : `<p class="muted small">Пусто: в каждую игру из коллекции уже сыграли хотя бы раз.</p>`}
      </section>
    </div>`;
  }

  /* ---------- the sessions tab: a month calendar and the games of the month or of a chosen day ---------- */
  let cal = null;   // { y, m, day } — kept while moving around the app
  function viewSessions() {
    const now = new Date();
    if (!cal) cal = { y: now.getFullYear(), m: now.getMonth(), day: null };
    const first = new Date(cal.y, cal.m, 1), days = new Date(cal.y, cal.m + 1, 0).getDate();
    const lead = (first.getDay() + 6) % 7;   // weeks start on Monday
    const dayOf = s => { const d = new Date(s.created); return d.getFullYear() === cal.y && d.getMonth() === cal.m ? d.getDate() : 0; };
    const inMonth = S().sessions.filter(dayOf).sort((a, b) => (b.created || 0) - (a.created || 0));
    const per = {}; for (const s of inMonth) if (s.status === "finished") per[dayOf(s)] = (per[dayOf(s)] || 0) + 1;
    const thisMonth = cal.y === now.getFullYear() && cal.m === now.getMonth();
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push('<span class="cal-d off" aria-hidden="true"></span>');
    for (let d = 1; d <= days; d++) {
      const n = per[d] || 0;
      cells.push(`<button class="cal-d${thisMonth && d === now.getDate() ? " today" : ""}" data-act="cal-day" data-d="${d}" aria-pressed="${cal.day === d}" aria-label="${d} ${MONTHS_SHORT[cal.m]}${n ? ", " + n + " " + BH.plural(n, "партия", "партии", "партий") : ""}"><span>${d}</span><i class="dots">${"<b></b>".repeat(Math.min(n, 4))}</i></button>`);
    }
    // games still going are listed once, under «Идут сейчас»; the list below is what was played
    const shown = (cal.day ? inMonth.filter(s => dayOf(s) === cal.day) : inMonth).filter(s => s.status === "finished");
    const live = S().sessions.filter(s => s.status !== "finished");
    return `<div class="stack">
      <div class="page-head"><div><h1>Партии</h1><p class="sub">Сыграно: ${finishedSessions().length} ${BH.plural(finishedSessions().length, "партия", "партии", "партий")}</p></div><a class="btn primary" href="#/new">${I.plus}Новая партия</a></div>
      ${live.length ? `<section class="panel"><div class="sec-h"><h2>Идут сейчас</h2><span class="badge accent">${live.length}</span></div><div class="list">${live.map(sessionLine).join("")}</div></section>` : ""}
      <section class="panel cal">
        <div class="cal-head"><button class="icon-btn" data-act="cal-move" data-step="-1" aria-label="Предыдущий месяц">${I.back}</button>
          <b>${MONTHS_NOM[cal.m]} ${cal.y}</b>
          <button class="icon-btn cal-next" data-act="cal-move" data-step="1" aria-label="Следующий месяц">${I.back}</button></div>
        <div class="cal-grid cal-wd">${["пн", "вт", "ср", "чт", "пт", "сб", "вс"].map(x => `<span>${x}</span>`).join("")}</div>
        <div class="cal-grid">${cells.join("")}</div>
        ${thisMonth ? "" : `<div style="text-align:center;margin-top:6px"><button class="btn ghost sm" data-act="cal-today">К сегодняшнему дню</button></div>`}
      </section>
      <section class="panel">
        <div class="spread" style="margin-bottom:4px"><h2>${cal.day ? `Сыграно ${cal.day} ${MONTHS_GEN[cal.m]}` : `Сыграно в ${MONTHS_IN[cal.m]}`}</h2>${cal.day ? `<button class="btn ghost sm" data-act="cal-day" data-d="${cal.day}">Весь месяц</button>` : ""}</div>
        ${shown.length ? `<div class="list">${shown.map(sessionLine).join("")}</div>` : `<p class="muted small" style="padding:8px 0">${cal.day ? "В этот день сыгранных партий нет." : "В этом месяце сыгранных партий нет."}</p>`}
      </section>
    </div>`;
  }

  /* ---------- menu: players, places, stats and the settings, each in its own page ---------- */
  function viewMenu() {
    const st = S().settings, me = BH.me();
    const nP = S().players.filter(p => !p.hidden).length, nPl = S().places.length;
    const row = (href, icon, title, sub) => `<a class="item menu-row" href="${href}"><span class="menu-ic">${icon}</span><div class="t"><b>${title}</b><span>${sub}</span></div><span class="menu-chev">${IC.chev}</span></a>`;
    const voice = BH.voice.ready() ? (st.speakAnswers ? "работает, с озвучкой" : "работает, без озвучки") : "не подключён";
    const theme = { auto: "как в системе", light: "светлая", dark: "тёмная" }[st.theme] || "как в системе";
    return `<div class="stack">
      <div class="page-head"><div><h1>Меню</h1></div></div>
      <section class="panel"><div class="list">
        ${row("#/players", IC.people, "Игроки", meta([[IC.people, nP + " " + BH.plural(nP, "игрок", "игрока", "игроков")], me ? [IC.user, "это вы: " + esc(me.name)] : [IC.user, "отметьте себя", "", "accent"]], "plain"))}
        ${row("#/places", IC.pin, "Места", meta([[IC.pin, nPl + " " + BH.plural(nPl, "место", "места", "мест")]], "plain"))}
        ${row("#/stats", IC.chart, "Статистика", "победы, любимые игры и места")}
      </div></section>
      <section class="panel"><div class="list">
        ${row("#/settings/sync", IC.cloud, "Синхронизация", BH.cloud.cfg ? "с GitHub, включена" : "не подключена")}
        ${row("#/settings/voice", IC.mic, "Голосовой помощник", voice)}
        ${row("#/settings/theme", IC.sun, "Оформление", "тема: " + theme)}
        ${row("#/settings/backup", IC.save, "Копия данных", "сохранить в файл или загрузить")}
      </div></section>
      <p class="tiny muted">Помощник настолок ${esc(BH.version || "")} · правила в приложении пересказаны своими словами, полные правила — в книге правил игры.</p>
    </div>`;
  }

  /* ---------- new game: steps (date, game, place, players, result) ----------
     Each step shows one line of what is chosen; one step is open at a time, and picking a game or a
     place moves on to what is still missing. The same form edits a game that has not started yet
     (#/s/<id>/edit). A date in the past turns it into "record a game you already played". */
  const PAST_MS = 3 * 3600 * 1000;
  const visiblePlayers = ids => ids.filter(id => { const p = BH.player(id); return p && !p.hidden; });
  // the game to take "as last time" from: the latest finished one of this game, else the latest finished one
  function lastSessionFor(gameId) {
    const fin = finishedSessions().sort((a, b) => (b.created || 0) - (a.created || 0));
    return (gameId && fin.find(x => x.gameId === gameId)) || fin[0] || null;
  }
  function startDraft(gameId, from) {
    if (from) {
      draft = { editId: from.id, date: from.created, gameId: from.gameId, exp: from.exp.slice(), placeId: from.placeId, players: from.players.slice(), opts: Object.assign({}, from.opts), final: {}, winners: [], step: null, lastPlayers: [] };
      return;
    }
    const gid = (gameId && BH.game(gameId) ? gameId : null) || (BH.games.length === 1 ? BH.games[0].id : null);
    const last = lastSessionFor(gid), lastSame = last && last.gameId === gid ? last : null;
    const me = BH.me();
    draft = {
      date: Date.now(),
      gameId: gid,
      exp: lastSame ? lastSame.exp.slice() : [],
      placeId: (last && BH.place(last.placeId) ? last.placeId : (S().places[0] || {}).id) || null,
      players: me && !me.hidden ? [me.id] : [],                    // me first; the rest in one tap
      lastPlayers: visiblePlayers(last ? last.players : []),
      opts: {}, final: {}, winners: [],
    };
    draft.step = nextStep();
  }
  const draftCtx = () => ({ players: draft.players.length, exp: new Set(draft.exp), has: id => draft.exp.includes(id), opt: id => !!draft.opts[id] });
  const draftPast = () => !draft.editId && draft.date < Date.now() - PAST_MS;
  const localInput = ts => { const d = new Date(ts), p = n => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
  // options default to their "default" the first time they apply
  function draftOptions(g) {
    const list = BH.gameOptions(g, draftCtx());
    for (const o of list) if (!(o.id in draft.opts)) draft.opts[o.id] = !!o.default;
    return list;
  }
  // what still keeps the game from being created, or "" when it is ready
  function draftProblem() {
    { const g0 = BH.game(draft.gameId), t = draft.tally || {}, w = ((g0 && g0.scoring) || {}).wins || 3;
      if (g0 && BH.isCoop(g0) && draftPast()) {
        if (t.ok === w && t.fail === w) return `Не бывает ${w} хранилищ и ${w} тревог сразу — игра кончается раньше`;
        if (t.ok === w && draft.coop === "lose") return `${w} хранилища — это победа банды`;
        if (t.fail === w && draft.coop === "win") return `${w} тревоги — это поражение`;
      } }
    const g = BH.game(draft.gameId);
    if (!g) return "Выберите игру";
    const n = draft.players.length;
    if (n < g.players.min) return `Нужно минимум ${g.players.min} ${BH.plural(g.players.min, "игрок", "игрока", "игроков")}`;
    if (n > g.players.max) return `«${g.name}»: не больше ${g.players.max} игроков`;
    if (g.players.only && !g.players.only.includes(n)) return `«${g.name}»: ${g.teams ? g.players.only.map(k => (k === 4 ? "4 — две пары" : `${k} игрока`)).join(" или ") : `${g.players.only.join(" или ")} игрока`}`;
    return "";
  }
  function pickDraftGame(id) {
    if (draft.gameId !== id) {
      const last = lastSessionFor(id);
      draft.gameId = id; draft.opts = {};
      draft.exp = last && last.gameId === id ? last.exp.slice() : [];
      if (!draft.editId) draft.lastPlayers = visiblePlayers(last ? last.players : []);
    }
    draft.step = nextStep();
  }
  // the first step that still needs something: the game, then the players until there are as many
  // as the game is meant for (a game that allows one player still opens the list), else none
  const nextStep = () => { const g = BH.game(draft.gameId); return !g ? "game" : draftProblem() || draft.players.length < (g.players.recommendedMin || g.players.min) ? "players" : null; };
  const whenText = ts => {
    const t = BH.fmtTime(ts), day = new Date(); day.setHours(0, 0, 0, 0);
    const start = day.getTime(), prev = new Date(day); prev.setDate(prev.getDate() - 1);
    if (ts >= start && ts < start + 864e5) return "Сегодня, " + t;
    if (ts >= prev.getTime() && ts < start) return "Вчера, " + t;
    return BH.fmtDate(ts) + ", " + t;
  };
  const playsOf = (field, id) => finishedSessions().filter(s => field === "place" ? s.placeId === id : s.players.includes(id)).length;

  function viewNew() {
    if (!draft) startDraft(route().b || null);   // #/new/<game> keeps the game over a reload or Back / Forward
    const g = BH.game(draft.gameId), past = draftPast(), cnt = draft.players.length;
    let num = 0;
    // a step: its head (number or a tick when filled in, title, one line of what is chosen) and,
    // when it is the open one, its body
    const step2 = (id, title, sum, body, done) => {
      const open = draft.step === id, k = ++num;
      return `<section class="step${open ? " open" : ""}${done ? " done" : ""}" id="step-${id}">
        <button type="button" class="step-head" data-act="draft-step" data-step="${id}" aria-expanded="${open}">
          <span class="step-n">${done && !open ? I.check : k}</span>
          <span class="step-t"><b>${esc(title)}</b><span class="step-sum">${sum}</span></span>
          <span class="step-chev" aria-hidden="true">${I.down}</span>
        </button>
        ${open ? `<div class="step-body">${body}</div>` : ""}
      </section>`;
    };

    const dateSec = step2("date", "Дата игры", esc(whenText(draft.date)) + (past ? ' · <span class="warn-t">сыгранная: сразу итог</span>' : ""),
      `<div class="row"><input class="input" type="datetime-local" data-act="draft-date" value="${localInput(draft.date)}" max="${localInput(Date.now() + 86400000)}" aria-label="Дата и время игры">
        <button type="button" class="btn sm" data-act="draft-now">Сейчас</button></div>
       ${draft.editId ? "" : `<p class="small muted">Поставьте прошлую дату, чтобы записать уже сыгранную партию: без подготовки и раундов, сразу очки и победитель.</p>`}`, true);

    // game: search, most played first, a random pick that fits the players
    const ranked = gamesByPlays();
    const gameBody = draft.editId ? `<p class="small muted">Игру у созданной партии не поменять: для другой игры создайте новую партию.</p>` : `
      ${BH.games.length > 6 ? `<div class="search">${I.search}<input class="input" type="search" data-act="pick-q" data-list="games" placeholder="Найти игру" aria-label="Найти игру" autocomplete="off"></div>` : ""}
      <div class="pick-list" data-list="games">${ranked.map(({ g: x }) => `<button type="button" class="pick-row" data-act="pick-game" data-id="${esc(x.id)}" data-name="${esc(x.name.toLowerCase())}" aria-pressed="${x.id === draft.gameId}">
        ${coverOf(x, "mini")}<span class="t"><b>${esc(x.name)}</b>${meta([[IC.people, playersRange(x), "Игроков"], x.time && [IC.clock, esc(x.time), "Время партии"]], "plain")}</span>
        ${x.id === draft.gameId ? `<span class="pick-on">${I.check}</span>` : ""}</button>`).join("")}</div>
      ${BH.games.length > 1 ? `<button type="button" class="btn ghost sm" data-act="draft-random">${IC.dice}Случайная игра</button>` : ""}`;
    const expBody = g && g.expansions.length ? `<div class="label" style="margin-top:6px">Дополнения</div><div class="chips">${g.expansions.map(e => `<button class="chip" data-act="toggle-exp" data-id="${e.id}" aria-pressed="${draft.exp.includes(e.id)}">${esc(e.name)}</button>`).join("")}</div>` : "";
    const gameSum = g ? `${coverOf(g, "sum-cover")}${esc(g.name)}${draft.exp.length ? " + " + draft.exp.length + " " + BH.plural(draft.exp.length, "дополнение", "дополнения", "дополнений") : ""}` : '<span class="warn-t">Не выбрана</span>';
    const gameSec = step2("game", "Игра", gameSum, gameBody + expBody, !!g);

    // place: the usual ones first
    const places = S().places.slice().sort((a, b) => playsOf("place", b.id) - playsOf("place", a.id));
    const place = BH.place(draft.placeId);
    const placeSec = step2("place", "Место", place ? esc(place.name) : "Не указано", `<div class="chips">${places.map(p => `<button class="chip" data-act="pick-place" data-id="${p.id}" aria-pressed="${p.id === draft.placeId}">${esc(p.name)}</button>`).join("")}
        <button class="chip" data-act="pick-place" data-id="" aria-pressed="${!draft.placeId}">Не указывать</button></div>
      <form class="row" data-form="add-place" style="margin-top:10px"><input class="input" name="name" placeholder="Новое место" maxlength="40" aria-label="Новое место"><button class="btn" type="submit">Добавить</button></form>`, true);

    // players: me first, "as last time" in one tap, the regulars on top
    let playersBody = "";
    {
      const meId = BH.me() ? BH.meId() : null;
      const pool = S().players.filter(p => !p.hidden || draft.players.includes(p.id))
        .map(p => ({ p, k: playsOf("player", p.id) })).sort((a, b) => (b.p.id === meId) - (a.p.id === meId) || b.k - a.k || a.p.name.localeCompare(b.p.name, "ru"));
      const lastAdd = draft.lastPlayers.filter(id => BH.player(id) && !draft.players.includes(id));
      playersBody = `
        ${lastAdd.length ? `<button type="button" class="btn sm last-btn" data-act="draft-last-players">${I.plus}Как в прошлой партии: ${esc(lastAdd.map(id => BH.player(id).name).join(", "))}</button>` : ""}
        ${pool.length > 9 ? `<div class="search">${I.search}<input class="input" type="search" data-act="pick-q" data-list="players" placeholder="Найти игрока" aria-label="Найти игрока" autocomplete="off"></div>` : ""}
        <div class="pick-list" data-list="players">${pool.map(({ p, k }) => { const on = draft.players.includes(p.id); return `<button type="button" class="pick-row" data-act="toggle-player" data-id="${p.id}" data-name="${esc(p.name.toLowerCase())}" aria-pressed="${on}">
          <span class="pick-box" aria-hidden="true">${on ? I.check : ""}</span>${BH.avatar(p)}<span class="t"><b>${esc(p.name)}${p.id === meId ? ' <span class="badge accent">это вы</span>' : ""}</b>${meta([[IC.cards, k ? k + " " + BH.plural(k, "партия", "партии", "партий") : "ещё не играл(а)", "Сыграно партий"]], "plain")}</span></button>`; }).join("")}</div>
        <form class="row" data-form="add-player" style="margin-top:4px"><input class="input" name="name" placeholder="Новый игрок" maxlength="40" aria-label="Имя нового игрока"><button class="btn" type="submit">Добавить</button></form>
        ${g && cnt >= g.players.min && g.players.recommendedMin && cnt < g.players.recommendedMin ? `<div class="note info">${esc(g.playersNote || `По правилам ${g.name} рассчитан на ${g.players.recommendedMin} и больше игроков.`)}</div>` : ""}`;
    }
    const playersOk = !!g && !draftProblem();
    const playersSum = cnt ? `<span class="faces">${draft.players.slice(0, 5).map(id => BH.avatar(BH.player(id), "sm")).join("")}</span>${cnt} ${BH.plural(cnt, "игрок", "игрока", "игроков")}${g && !playersOk ? ` · <span class="warn-t">${esc(draftProblem())}</span>` : ""}`
      : '<span class="warn-t">Никого</span>';
    const playersSec = step2("players", "Игроки", playersSum, playersBody, playersOk && cnt >= (g.players.recommendedMin || g.players.min));

    // the seating order, clockwise: who sits after whom decides who deals (or starts) each round
    const nameOf = id => (BH.player(id) || { name: "?" }).name;
    const orderSec = cnt > 1 && !(g && g.rounds && g.rounds.leader === false) ? step2("order", "Порядок за столом", esc(draft.players.map(nameOf).join(" → ")),
      `<p class="small muted">По часовой стрелке, как сидите: от этого зависит, кто сдаёт или начинает каждый раунд.</p>
       <div>${draft.players.map((id, i) => { const p = BH.player(id) || { name: "?", color: "#888" }; return `<div class="seat"><span class="n">${i + 1}</span>${BH.avatar(p, "sm")}<span>${esc(p.name)}</span>
         <span class="mv"><button class="icon-btn" data-act="seat-up" data-i="${i}" aria-label="Выше: ${esc(p.name)}" ${i ? "" : "disabled"}>${I.up}</button><button class="icon-btn" data-act="seat-down" data-i="${i}" aria-label="Ниже: ${esc(p.name)}" ${i < cnt - 1 ? "" : "disabled"}>${I.down}</button></span></div>`; }).join("")}</div>
       <button type="button" class="btn ghost sm" data-act="seat-shuffle">${IC.dice}Рассадить случайно</button>`, true) : "";

    // the game mode: the game's options (a challenge, a harder variant…); not for a game recorded afterwards
    const opts = g && !past ? draftOptions(g) : [];
    const on = opts.filter(o => draft.opts[o.id]);
    const modeSec = opts.length ? step2("mode", "Режим игры", on.length ? esc(on.map(o => o.short || o.label).join(", ")) : "Обычная игра",
      `<div class="stack" style="gap:6px">${opts.map(o => `<label class="check" style="font-weight:500"><input type="checkbox" data-act="draft-opt" data-id="${esc(o.id)}" ${draft.opts[o.id] ? "checked" : ""}> ${esc(o.label)}</label>`).join("")}</div>`, true) : "";

    let resultSec = "";
    if (past && g && cnt && BH.isCoop(g)) {
      const t = draft.tally || {}, wins = (g.scoring && g.scoring.wins) || 3, sc = t.ok !== undefined || t.fail !== undefined ? ` · ${t.ok ?? "?"}:${t.fail ?? "?"}` : "";
      const row = (k, label) => `<div class="tally-row"><span class="label">${label}</span><div class="chips">${Array.from({ length: wins + 1 }, (_, n) => `<button class="chip" data-act="draft-tally" data-k="${k}" data-v="${n}" aria-pressed="${t[k] === n}">${n}</button>`).join("")}</div></div>`;
      resultSec = step2("result", "Итог", (draft.coop === "win" ? "Банда победила" : draft.coop === "lose" ? "Банда попалась" : "Итог — по желанию") + sc,
        `<p class="small muted">Счёт можно не вписывать. 3 хранилища — победа, 3 тревоги — поражение.</p>
        ${row("ok", "Хранилища вскрыли")}${row("fail", "Тревоги")}
        <div class="chips" style="margin-top:12px"><button class="chip" data-act="draft-coop" data-v="win" aria-pressed="${draft.coop === "win"}"><span class="won">${IC.trophy}</span>Победа банды</button><button class="chip" data-act="draft-coop" data-v="lose" aria-pressed="${draft.coop === "lose"}">Поражение</button></div>`, !!draft.coop || !!sc);
    } else if (past && g && cnt && BH.isRace(g)) {
      const wn = draft.winners.filter(id => draft.players.includes(id));
      const how = draft.raceHow, chips = ids => ids.map(id => `<button class="chip" data-act="draft-race-winner" data-id="${id}" aria-pressed="${wn.includes(id)}">${esc((BH.player(id) || { name: "?" }).name)}</button>`).join("");
      const sc = g.scoring, goalHow = sc.goalHow || "goal", countHow = sc.count && sc.count.how;
      resultSec = step2("result", "Итог", wn.length ? "Победа: " + esc(wn.map(id => (BH.player(id) || { name: "?" }).name).join(", ")) : countHow && how === countHow ? esc(sc.count.chip) : "Победитель — по желанию",
        (sc.count ? `<p class="small muted">Чем кончилась партия?</p>
        <div class="chips" style="margin-top:8px"><button class="chip" data-act="draft-race-how" data-v="${goalHow}" aria-pressed="${how === goalHow}">${esc(sc.goalChip)}</button><button class="chip" data-act="draft-race-how" data-v="${countHow}" aria-pressed="${how === countHow}">${esc(sc.count.chip)}</button></div>` : "")
        + (countHow && how === countHow ? raceRowsHTML(draft.players, g, "counts", draft.raceCounts || {}, "draft-race-count") + `<div id="race-draft-res">${raceDraftResHTML(g)}</div>`
          : `<div class="label" style="margin:12px 0 6px">${sc.count && how === goalHow ? esc(sc.goalAsk) : "Победитель"}</div><div class="chips">${chips(draft.players)}</div>`), wn.length > 0 || !!how);
    } else if (past && g && cnt && g.teams && g.teams({ players: cnt, opt: () => false, has: () => false, exp: new Set() }) && cnt === 4) {
      const pairs = [[draft.players[0], draft.players[2]], [draft.players[1], draft.players[3]]];
      const nm = sd => sd.map(id => (BH.player(id) || { name: "?" }).name).join(" и ");
      const wonPair = pairs.find(sd => sd.every(id => draft.winners.includes(id)));
      resultSec = step2("result", "Итог", wonPair ? "Победа: " + esc(nm(wonPair)) : "Очки и победитель — по желанию",
        `<p class="small muted">Пары — 1-й и 3-й, 2-й и 4-й игрок по порядку. Счёт пары — один на двоих.</p>
        ${pairs.map(sd => `<div class="seat" style="grid-template-columns:auto minmax(0,1fr) auto"><span class="faces pair-faces">${sd.map(id => BH.avatar(BH.player(id) || { name: "?", color: "#888" }, "sm")).join("")}</span><span>${esc(nm(sd))}</span>
          <input class="input score-in ph-word" type="number" inputmode="numeric" data-act="draft-final-pair" data-p="${sd.join(",")}" value="${draft.final[sd[0]] ?? ""}" placeholder="очки" aria-label="Очки: ${esc(nm(sd))}"></div>`).join("")}
        <div class="label" style="margin:12px 0 6px">Победители</div>
        <div class="chips">${pairs.map(sd => `<button class="chip" data-act="draft-winner-pair" data-p="${sd.join(",")}" aria-pressed="${sd.every(id => draft.winners.includes(id))}">${esc(nm(sd))}</button>`).join("")}</div>`, !!wonPair || draft.final[pairs[0][0]] !== undefined);
    } else if (past && g && cnt) {
      const scored = draft.players.filter(id => draft.final[id] !== undefined && draft.final[id] !== "").length;
      resultSec = step2("result", "Итог", draft.winners.length ? "Победа: " + esc(draft.winners.map(id => (BH.player(id) || { name: "?" }).name).join(", ")) : scored ? "Очки вписаны" : "Очки и победитель — по желанию",
        `<p class="small muted">Очки можно не вписывать. Победитель выберется по очкам, или отметьте его сами.</p>${g.scoring && g.scoring.tieHint ? `<p class="note info small">${esc(g.scoring.tieHint)}</p>` : ""}
        ${draft.players.map(id => { const p = BH.player(id) || { name: "?", color: "#888" }; return `<div class="seat" style="grid-template-columns:auto minmax(0,1fr) auto">${BH.avatar(p, "sm")}<span>${esc(p.name)}</span>
          <input class="input score-in ph-word" type="number" inputmode="numeric" data-act="draft-final" data-p="${id}" value="${draft.final[id] ?? ""}" placeholder="очки" aria-label="Очки: ${esc(p.name)}"></div>`; }).join("")}
        <div class="label" style="margin:12px 0 6px">Победитель</div>
        <div class="chips">${draft.players.map(id => { const p = BH.player(id) || { name: "?" }; return `<button class="chip" data-act="draft-winner" data-id="${id}" aria-pressed="${draft.winners.includes(id)}">${esc(p.name)}</button>`; }).join("")}</div>`, draft.winners.length > 0 || scored > 0);
    }

    const problem = draftProblem();
    const label = draft.editId ? "Сохранить" : past ? "Записать сыгранную партию" : "Создать партию";
    const back = draft.editId ? backLink("#/s/" + draft.editId + "/setup", "Подготовка") : backToOrigin("Отмена");
    return `<div class="stack">
      <div>${back}<div class="page-head"><div><h1>${draft.editId ? "Партия" : past ? "Сыгранная партия" : "Новая партия"}</h1></div></div></div>
      <div class="stepper">${dateSec}${gameSec}${placeSec}${playersSec}${orderSec}${modeSec}${resultSec}</div>
      <div class="sticky-foot">${problem ? `<p class="foot-hint" id="foot-hint" role="status">${esc(problem)}</p>` : ""}<button class="btn primary big block" data-act="draft-save" ${problem ? 'disabled aria-describedby="foot-hint"' : ""}>${label}</button></div>
    </div>`;
  }

  function saveDraft() {
    if (!draft) return;
    const g = BH.game(draft.gameId);
    if (!g) return;
    const opts = {};
    if (!draftPast()) for (const o of BH.gameOptions(g, draftCtx())) opts[o.id] = !!draft.opts[o.id];   // a recorded game has no options in play
    if (draft.editId) {
      const s = BH.session(draft.editId);
      if (!s) { draft = null; go("#/"); return; }
      Object.assign(s, { gameId: g.id, exp: draft.exp.slice(), placeId: draft.placeId || null, players: draft.players.slice(), opts, created: draft.date });
      if (s.first && !s.players.includes(s.first)) s.first = null;
      BH.saveNow(); draft = null;
      // came here from the setup screen: step back to it, so the history does not grow setup → edit → setup
      goReplace("#/s/" + s.id + "/setup");   // steps back to the setup screen when that is where we came from
      BH.toast("Партия обновлена");
      return;
    }
    const s = {
      id: BH.uid(), gameId: g.id, exp: draft.exp.slice(), placeId: draft.placeId || null, players: draft.players.slice(), opts,
      created: draft.date, status: "setup", setupDone: {}, first: null, rounds: [], winners: [],
    };
    if (draftPast()) {
      const final = {};
      for (const id of s.players) if (draft.final[id] !== undefined && draft.final[id] !== "") final[id] = Math.round(Number(draft.final[id])) || 0;
      let winners = BH.isCoop(g) ? (draft.coop === "win" ? s.players.slice() : []) : draft.winners.filter(id => s.players.includes(id));
      if (BH.isCoop(g) && draft.tally && (draft.tally.ok !== undefined || draft.tally.fail !== undefined)) s.tally = { ok: draft.tally.ok || 0, fail: draft.tally.fail || 0 };
      if (BH.isRace(g)) {
        const nums = (o, max) => { const c = {}; for (const id of s.players) if (o && o[id] !== undefined && o[id] !== "") c[id] = Math.max(0, Math.min(max, Math.round(Number(o[id])) || 0)); return c; };
        const sc = g.scoring, how = sc.count ? draft.raceHow || null : winners.length ? sc.goalHow || "goal" : null, counts = sc.count && how === sc.count.how ? nums(draft.raceCounts, 99) : {};
        if (Object.keys(counts).length) { const top = BH.raceResult(s.players, counts).top; winners = top.length === 1 ? top : winners.filter(id => top.includes(id)).slice(0, 1); if (!winners.length) winners = top; }
        if (how) s.race = Object.keys(counts).length ? { how, counts } : { how };
      }
      if (!BH.isCoop(g) && !winners.length && Object.keys(final).length) {
        const low = !!(g.scoring && g.scoring.lowerWins);
        const best = low ? Math.min(...Object.values(final)) : Math.max(...Object.values(final));
        winners = s.players.filter(id => final[id] === best);
      }
      Object.assign(s, { status: "finished", startedAt: draft.date, finishedAt: draft.date, final: Object.keys(final).length ? final : undefined, winners });
      S().sessions.push(s);
      S().sessions.sort((a, b) => (b.created || 0) - (a.created || 0));
      BH.saveNow(); draft = null;
      goReplace("#/s/" + s.id + "/done");
      BH.toast("Партия записана в историю");
      return;
    }
    if (!BH.setupSteps(s).length) { if (g.first) s.status = "first"; else { s.status = "playing"; s.startedAt = Date.now(); } }
    S().sessions.unshift(s);
    BH.saveNow();
    draft = null;
    goReplace("#/s/" + s.id + "/" + (s.status === "setup" ? "setup" : s.status === "first" ? "first" : "play"));
  }

  /* ---------- session screens ---------- */
  function viewSession(s, sub) {
    const g = BH.game(s.gameId);
    if (!g) return { html: notFound("Игра этой партии больше не в каталоге.") };
    const home = s.status === "setup" ? "setup" : s.status === "first" ? (g.first ? "first" : "play") : s.status === "playing" ? "play" : "done";
    if (!sub) sub = home;
    if (sub === "first" && !g.first) sub = home === "first" ? "play" : home;   // a game without a first player has no wheel
    // a screen reached by "Back" that the game has already moved past shows where the game really is:
    // a finished game is only its result, a running game no longer returns to setup, the wheel or the form
    if (s.status === "finished" && sub !== "done" && sub !== "rules") sub = "done";
    else if (s.status !== "finished" && sub === "done") sub = home;
    else if (s.status === "playing" && (sub === "setup" || sub === "edit" || (sub === "first" && s.rounds.length))) sub = "play";
    // the address names the screen really shown, so "back" checks compare like with like
    const canon = "#/s/" + s.id + "/" + sub;
    if (SCREENS.includes(sub) && location.hash !== canon) history.replaceState(history.state, "", urlOf(canon));
    if (sub === "edit") {
      if (s.status === "finished" || s.status === "playing" || s.rounds.length) return { html: notFound("Партия уже идёт — её состав больше не меняется.") };
      if (!draft || draft.editId !== s.id) startDraft(null, s);
      return { html: viewNew() };
    }
    // sized again once the fonts are in: the text may take other room with them
    if (sub === "setup") return { html: viewSetup(s, g), after: () => { fitSetup(); if (document.fonts) document.fonts.ready.then(() => { if (BH.$(".setup-card")) fitSetup(); }); } };
    if (sub === "first") return { html: viewFirst(s, g), after: () => { fitWheel(); if (document.fonts) document.fonts.ready.then(() => { if (BH.$(".wheel")) fitWheel(); }); } };
    if (sub === "play") return { html: viewPlay(s, g), after: () => BH.rulesUI.bind(main, g, { compact: true }) };
    if (sub === "rules") return { html: viewSessionRules(s, g), after: () => BH.rulesUI.bind(main, g) };
    if (sub === "done") return { html: viewDone(s, g), after: () => {
      if (cheer !== s.id) return;
      cheer = null;
      const at = BH.$(".crown") || BH.$("main h1"); if (!at) return;
      const r = at.getBoundingClientRect();
      confetti(r.left + r.width / 2, r.top + r.height / 2, (s.winners || []).map(id => (BH.player(id) || {}).color).filter(Boolean));
    } };
    return { html: notFound("Такого экрана нет.") };
  }
  // the game of a session as a card: cover, name, and its facts as chips — place, date, add-ons, the mode
  function sessionHero(s, g, isTitle) {
    const place = BH.place(s.placeId);
    const exp = s.exp.map(id => (g.expansions.find(e => e.id === id) || {}).name).filter(Boolean);
    const modes = (g.options || []).filter(o => s.opts && s.opts[o.id]);
    const name = isTitle ? `<h1 class="sess-hero-n">${esc(g.name)}</h1>` : `<b class="sess-hero-n">${esc(g.name)}</b>`;
    return `<div class="sess-hero">${coverOf(g, "mini")}<div class="sess-hero-t">${name}${meta([
      place && [IC.pin, esc(place.name), "Место"],
      [IC.cal, esc(BH.fmtDate(s.created)), "Дата"],
      ...exp.map(n => [IC.puzzle, esc(n), "Дополнение"]),
      ...modes.map(o => [IC.bolt, esc(o.short || o.label), "Режим игры", "accent"]),
    ])}</div></div>`;
  }
  const deleteBtn = `<button class="icon-btn" data-act="delete-session" aria-label="Удалить партию" title="Удалить партию">${I.trash}</button>`;

  /* setup: one step per screen — its picture, title and text fit above the button (fitSetup sizes the
     picture to the screen); the dots show every step and jump to it; swipe or ‹ to move back and forth */
  const setupPos = {};             // session id -> the id of the step on screen
  const setupAt = { sid: null, i: 0 };   // the step on screen now (index in the current steps)
  function viewSetup(s, g) {
    const steps = BH.setupSteps(s);
    if (!steps.length) return `<div class="stack">${topline(backToOrigin())}<p class="muted">Подготовка не нужна.</p><button class="btn primary big" data-act="setup-next">Дальше</button></div>`;
    let k = steps.findIndex(x => x.id === setupPos[s.id]);
    if (k < 0) { k = steps.findIndex(x => !s.setupDone[x.id]); if (k < 0) k = steps.length - 1; }
    setupAt.sid = s.id; setupAt.i = k; setupPos[s.id] = steps[k].id;
    const i = k, st = steps[i], last = i === steps.length - 1;
    const done = steps.filter(x => s.setupDone[x.id]).length, isDone = !!s.setupDone[st.id];
    const nextLabel = g.first ? g.first.label.toLowerCase() : "к игре";
    return `<div class="stack setup-screen">
      <div class="shead">
        ${topline(backToOrigin(), `<a class="btn ghost sm" href="#/s/${esc(s.id)}/edit">${I.edit}Изменить</a>${deleteBtn}`)}
        ${sessionHero(s, g)}
      </div>
      <div class="setup-head">
        <div><h1>Подготовка</h1><p class="sub">Шаг ${i + 1} из ${steps.length}${done ? `, готово ${done}` : ""}</p></div>
        <button class="sec-link" data-act="setup-next">К игре${IC.chev}</button>
      </div>
      <div class="setup-dots" role="group" aria-label="Шаги подготовки">${steps.map((x, k) => `<button type="button" class="${s.setupDone[x.id] ? "done" : ""}" data-act="setup-go" data-i="${k}" aria-current="${k === i ? "step" : "false"}" aria-label="Шаг ${k + 1}: ${esc(x.title)}${s.setupDone[x.id] ? ", готово" : ""}"></button>`).join("")}</div>
      <section class="setup-card${isDone ? " done" : ""}">
        <div class="art" data-act="art-zoom" title="Нажмите, чтобы увеличить"${BH.assets.attr(g.id, ((g.images || {}).steps || {})[st.id])}>${st.art || ""}</div>
        <div class="setup-text">
          <h2>${esc(st.title)}${isDone ? ` <button type="button" class="badge good badge-btn" data-act="setup-undo" title="Снять отметку" aria-label="Готово. Снять отметку">${I.check}готово ${I.x}</button>` : ""}</h2>
          ${textHTML(st.text, g.id)}
        </div>
      </section>
      <div class="game-bar setup-bar">
        <button class="btn big" data-act="setup-prev" ${i ? "" : "disabled"} aria-label="Предыдущий шаг">${I.back}</button>
        <button class="btn primary big" data-act="setup-done"><span class="ell">${isDone ? (last ? (g.first ? "Дальше: " + esc(nextLabel) : "К игре") : "Дальше") : last ? "Готово — " + esc(nextLabel) : "Готово, дальше"}</span></button>
      </div>
    </div>`;
  }
  // the step's picture takes the room left on the screen, so the text and the buttons stay in view
  // on a small screen a long step first makes the head compact (no facts under the game, smaller titles)
  function fitSetup() {
    const scr = BH.$(".setup-screen"), card = BH.$(".setup-card"), art = card && card.querySelector(".art");
    const r = route(), s = r.a === "s" ? BH.session(r.b) : null;
    if (!art || !scr || !s || card.classList.contains("zoomed")) return;
    const y = window.scrollY, box = card.querySelector(".setup-text");
    // the free room: the screen less the page drawn with no picture
    const room = () => { art.style.height = "0px"; return window.innerHeight - document.body.getBoundingClientRect().height; };
    const steps = BH.setupSteps(s), longest = steps.reduce((a, x) => (x.text.length + x.title.length > a.text.length + a.title.length ? x : a), steps[0]);
    // measured with the longest step in place (its text is a paragraph or a list of lines), then the step itself is back
    const keep = box.innerHTML;
    box.innerHTML = `<h2>${esc(longest.title)}</h2>${textHTML(longest.text, s.gameId)}`;
    scr.classList.remove("tight");
    if (room() < 150) scr.classList.add("tight");
    box.innerHTML = keep;
    art.style.height = Math.max(90, Math.min(Math.round(art.clientWidth * 0.75), 380, room())) + "px";
    window.scrollTo(0, y);
  }
  // the wheel takes the room left above its buttons, which come right under it in the page (not stuck to the
  // bottom: on some phones the bottom of the screen hides under the system buttons). The manual choice below may stay out of view.
  function fitWheel() {
    const wh = BH.$(".wheel"), bar = BH.$(".wheel-bar"); if (!wh || !bar) return;
    const y = window.scrollY;
    wh.style.width = "120px";
    const vv = window.visualViewport;
    const H = Math.min(window.innerHeight, document.documentElement.clientHeight || Infinity, vv ? vv.height : Infinity);
    const inset = parseFloat(getComputedStyle(document.body).paddingBottom) || 0;   // the phone's own bottom bar, if it says so
    const end = bar.getBoundingClientRect().bottom + window.scrollY;                   // where the buttons end on the page
    const max = Math.min(window.innerWidth * 0.84, 380);
    wh.style.width = Math.round(Math.max(140, Math.min(max, 120 + H - end - inset - 16))) + "px";
    window.scrollTo(0, y);
  }
  // the first player found: the name instead of the wheel
  const firstResultHTML = p => `<div class="first-res">${BH.avatar(p, "xxl")}<b class="first-name">${esc(p.name)}</b></div>`;
  const wheelButtons = (s, chosen) => chosen
    ? `<button class="btn big" data-act="spin" aria-label="Крутить ещё раз">${I.wheel}<span class="lbl-l">Крутить ещё раз</span><span class="lbl-s">Ещё раз</span></button><button class="btn primary big" data-act="start-play">${s.status === "playing" ? "Готово" : "Начать игру"}</button>`
    : `<button class="btn primary big" data-act="spin">${I.wheel}Крутить</button>`;
  // a burst of confetti from a point on the screen (none when the phone asks for less motion)
  function confetti(x0, y0, colors) {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const c = document.createElement("canvas"), dpr = Math.min(2, window.devicePixelRatio || 1), W = window.innerWidth, H = window.innerHeight;
    c.className = "confetti"; c.width = W * dpr; c.height = H * dpr; c.setAttribute("aria-hidden", "true");
    document.body.appendChild(c);
    const x = c.getContext("2d"); x.scale(dpr, dpr);
    const cols = [...colors, "#F2C230", "#E0603B", "#3B82F6", "#22C55E", "#A855F7"];
    const parts = Array.from({ length: 110 }, () => {
      const a = Math.random() * Math.PI * 2, v = 3 + Math.random() * 8;
      return { x: x0, y: y0, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 5, r: Math.random() * 3, vr: (Math.random() - .5) * .35, w: 6 + Math.random() * 6, h: 4 + Math.random() * 4, c: cols[Math.floor(Math.random() * cols.length)] };
    });
    const t0 = performance.now();
    (function frame(t) {
      const k = (t - t0) / 2000;
      x.clearRect(0, 0, W, H);
      if (k >= 1 || !c.isConnected) { c.remove(); return; }
      x.globalAlpha = Math.min(1, (1 - k) * 2.5);
      for (const p of parts) {
        p.vy += 0.22; p.vx *= 0.985; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        x.save(); x.translate(p.x, p.y); x.rotate(p.r); x.fillStyle = p.c; x.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); x.restore();
      }
      requestAnimationFrame(frame);
    })(t0);
  }
  // only a new width re-fits: a phone's address bar showing or hiding changes the height while scrolling
  let fitW = window.innerWidth;
  window.addEventListener("resize", () => { if (window.innerWidth === fitW) return; fitW = window.innerWidth; if (BH.$(".setup-card")) fitSetup(); if (BH.$(".wheel")) fitWheel(); });
  // a swipe on the step: to the left — the next step, to the right — the one before (nothing is marked done)
  let swipe = null;
  document.addEventListener("touchstart", e => {
    swipe = e.touches.length === 1 && e.target.closest && e.target.closest(".setup-card") ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
  }, { passive: true });
  document.addEventListener("touchend", e => {
    if (!swipe) return;
    const t = e.changedTouches[0], dx = t.clientX - swipe.x, dy = t.clientY - swipe.y; swipe = null;
    if (Math.abs(dx) < 60 || Math.abs(dx) < 1.5 * Math.abs(dy)) return;
    const r = route(), s = r.a === "s" ? BH.session(r.b) : null;
    if (!s || !BH.$(".setup-card") || sheet || dialog || ask) return;
    const k = setupAt.i + (dx < 0 ? 1 : -1);
    if (k < 0 || k >= BH.setupSteps(s).length) return;
    setupStep(s, k);
  }, { passive: true });
  function setupStep(s, k) {
    const steps = BH.setupSteps(s);
    if (!Number.isInteger(k) || k < 0 || k >= steps.length) return;
    setupPos[s.id] = steps[k].id; quiet(); render(); window.scrollTo(0, 0);
  }

  function viewFirst(s, g) {
    const pl = s.players.map(BH.player).filter(Boolean);
    const chosen = s.first ? BH.player(s.first) : null;
    const label = (g.first && g.first.label) || "Первый игрок";
    return `<div class="stack wheel-screen">
      <div class="shead">
        ${topline(s.status === "playing" ? backLink("#/s/" + s.id + "/play", "К игре") : backLink("#/s/" + s.id + "/setup", "Подготовка"))}
        ${sessionHero(s, g)}
      </div>
      <div class="page-head"><div><h1>${esc(label)}</h1>${g.first && g.first.hint ? `<p class="sub">${esc(g.first.hint)}</p>` : ""}</div></div>
      <section class="panel wheel-box" id="wheel-box" aria-live="polite">${chosen ? firstResultHTML(chosen) : BH.wheel.html(pl)}</section>
      <div class="wheel-bar">${wheelButtons(s, !!chosen)}</div>
      <details class="panel wheel-manual"><summary class="small" style="cursor:pointer;font-weight:600">Выбрать вручную</summary>
        <div class="chips" style="margin-top:12px">${pl.map(p => `<button class="chip" data-act="set-first" data-id="${p.id}" aria-pressed="${s.first === p.id}"><span class="dot" style="background:${p.color}"></span>${esc(p.name)}</button>`).join("")}</div>
      </details>
    </div>`;
  }

  // the rounds as a table: who dealt, each player's points (✕ bust, ★ seven numbers), the totals for a finished game
  const lowerWins = g => !!(g && g.scoring && g.scoring.lowerWins);
  function roundsTable(s, g, editable) {
    const tot = BH.totals(s), low = lowerWins(g);
    // the best of each round, marked only when the round is not all the same
    // a pair is one column (partners share the score)
    const cols = BH.sidesOf(s).map(sd => sd[0]), sideOf = id => BH.sidesOf(s).find(sd => sd[0] === id) || [id];
    const best = s.rounds.map(rd => { const v = cols.map(id => Number(rd.scores[id]) || 0); return new Set(v).size > 1 ? (low ? Math.min(...v) : Math.max(...v)) : null; });
    const lead = g && g.rounds && g.rounds.leaderLabel;
    // the legend names only the marks that are in the table (no busts or sevens in crokinole)
    const marked = k => s.rounds.some(rd => cols.some(id => ((rd.flags || {})[id] || {})[k]));
    const legend = [lead ? `Кружок у номера — ${esc(g.rounds.leaderLegend || lead.toLowerCase() + " раунда")}` : "", marked("bust") ? "✕ — перебор" : "", marked("flip7") ? "★ — 7 разных чисел" : "", best.some(b => b !== null) ? "жирным — лучший в раунде" : ""].filter(Boolean);
    return `<div class="scroll-x"><table class="hist">
      <thead><tr><th>№</th>${cols.map(id => { const ps = sideOf(id).map(x => BH.player(x) || { name: "?", color: "#888" }); const nm = ps.map(x => x.name).join(" и "); return `<th title="${esc(nm)}">${ps.length > 1 ? `<span class="pair-faces">${ps.map(x => BH.avatar(x, "sm")).join("")}</span>` : BH.avatar(ps[0], "sm")}<span class="hist-n">${esc(nm)}</span></th>`; }).join("")}</tr></thead>
      <tbody>${s.rounds.map((rd, i) => { const dealer = BH.player(rd.leader || BH.leaderAt(s, i));
        return `<tr${editable ? ` class="click" data-act="edit-round" data-i="${i}" tabindex="0"` : ""}><td class="hist-r"><span>${i + 1}</span>${lead && dealer ? `<span class="hist-d" title="${esc(lead)}: ${esc(dealer.name)}">${BH.avatar(dealer, "xs")}</span>` : ""}</td>${cols.map(id => { const f = (rd.flags || {})[id] || {}, v = Number(rd.scores[id]) || 0;
          return `<td class="${f.bust ? "bust" : f.flip7 ? "f7" : best[i] !== null && v === best[i] ? "top" : ""}">${f.bust ? "✕" + (v ? " " + BH.minus(v) : "") : (f.flip7 ? "★ " : "") + BH.minus(v)}</td>`; }).join("")}</tr>`; }).join("")}</tbody>
      ${editable ? "" : `<tfoot><tr><th>Итого</th>${cols.map(id => `<th>${tot[id]}</th>`).join("")}</tr></tfoot>`}
    </table></div>${legend.length ? `<p class="tiny muted" style="margin-top:6px">${legend.join(", ").replace(/^./, ch => ch.toUpperCase())}.</p>` : ""}`;
  }
  // per player over the rounds of one game: average, best round, busts, sevens
  function roundStats(s, g) {
    const low = lowerWins(g);
    return s.players.map(id => {
      const pts = s.rounds.map(rd => Number(rd.scores[id]) || 0), fl = s.rounds.map(rd => (rd.flags || {})[id] || {});
      return { id, avg: pts.length ? Math.round(pts.reduce((a, b) => a + b, 0) / pts.length) : 0, best: pts.length ? (low ? Math.min(...pts) : Math.max(...pts)) : 0,
        busts: fl.filter(f => f.bust).length, sevens: fl.filter(f => f.flip7).length };
    });
  }
  // a short line of a step: *word* in bold (a number, the key word); {name|word} — the game's icon «ic-name» in place of the word
  const fmtStep = (t, gid) => esc(t).replace(/\*([^*]+)\*/g, "<b>$1</b>")
    .replace(/\{([a-z0-9-]+)\|([^}]+)\}/g, (m, name, word) => gid ? `<span class="ic-inline" role="img" aria-label="${word}" title="${word}" data-asset="${gid}/ic-${name}@icon">${word}</span>` : word);
  const stepsHTML = (list, gid) => `<ul class="ph-steps">${list.map(t => `<li>${fmtStep(t, gid)}</li>`).join("")}</ul>`;
  // a text of a game: lines (\n) become a list of steps, one line stays a paragraph
  const textHTML = (t, gid) => String(t).includes("\n") ? stepsHTML(String(t).split("\n"), gid) : `<p>${fmtStep(t, gid)}</p>`;
  // what to do once the round is over: a list from the game (a function of the round, or the same every round)
  const afterOf = (g, ctx, r, last) => (typeof g.rounds.after === "function" ? g.rounds.after(ctx, r, last) : g.rounds.after) || [];
  const afterHTML = (list, gid) => list.length ? `<div class="ph-after"><span class="ph-after-h">После раунда</span>${stepsHTML(list, gid)}</div>` : "";
  /* a game scored at the end (Faraway): the rounds are only counted, with what to do in each phase;
     the fame is written in after the last round, as on the score pad */
  function viewPlayEnd(s, g) {
    const last = g.rounds.count || 8, r = s.rounds.length, over = r >= last, cur = Math.min(r + 1, last), ctx = BH.ctxOf(s);
    const phases = g.rounds.phases ? g.rounds.phases(ctx, cur, last) : [];
    return `<div class="stack">
      <div class="shead">
        ${topline(backToOrigin(), `<button class="btn finish sm" data-act="finish-menu">${I.flag}Завершить</button>`)}
        ${sessionHero(s, g, true)}
        <div class="status-row">
          <div class="stat-tile"><span class="label">Раунд</span><span class="round-no">${over ? last : cur}<small> из ${last}</small></span></div>
          <div class="stat-tile at-table"><div class="leader-t"><span class="label">За столом</span><span class="faces">${s.players.map(id => BH.avatar(BH.player(id) || { name: "?", color: "#888" }, "sm")).join("")}</span></div></div>
        </div>
      </div>
      <div class="play">
        <div class="stack">
          ${over ? `<section class="note good end-ready">${I.check}<span>Все ${last} раундов сыграны. Переверните свои Регионы и считайте славу — с последней карты к первой.</span></section>`
            : `<section class="panel"><div class="sec-h"><h2>Раунд ${cur}: что делать</h2></div><ol class="phase-list">${phases.map(p => `<li><b>${esc(p.title)}</b>${stepsHTML(p.steps || [p.text], g.id)}</li>`).join("")}</ol>${afterHTML(afterOf(g, ctx, cur, last), g.id)}</section>`}
        </div>
        <div class="stack">
          <section class="panel"><div class="sec-h"><h2>Правила</h2><a class="sec-link" href="#/s/${s.id}/rules">Все правила${IC.chev}</a></div>${BH.rulesUI.panel(g, "", { compact: true })}</section>
        </div>
      </div>
      <div class="game-bar">
        <button class="btn big" data-act="ask-open" aria-label="Спросить по правилам голосом" title="Спросить по правилам">${MIC}</button>
        ${over ? `<button class="btn primary big" data-act="end-open">${I.check}<span class="ell">Подсчёт славы</span></button>`
          : `<button class="btn primary big" data-act="round-done">${I.check}<span class="ell">Раунд ${cur} сыгран</span></button>`}
        ${r ? `<button class="btn big" data-act="undo-round" aria-label="Вернуться к раунду ${r}" title="Вернуться к раунду ${r}">${I.undo}</button>` : ""}
      </div>
    </div>`;
  }

  /* a cooperative game (The Gang): heists one after another, each ends in a cracked vault or an alarm;
     in the advanced modes the cards in play this heist, with what they change */
  const pips = (k, of, cls) => Array.from({ length: of }, (_, i) => `<i class="pip${i < k ? " " + cls : ""}"></i>`).join("");
  function viewPlayCoop(s, g) {
    const ctx = BH.ctxOf(s), H = g.heist, t = BH.coopTally(s), n = s.rounds.length + 1;
    const st = s.coop || H.start(ctx), act = H.active(st), asks = H.asks ? H.asks(ctx, st) : [];
    const slotOf = a => (a.perm ? "perm" : a.kind === "sp" ? "sp" : "ch" + (st.ch || []).indexOf(a.n));
    const cards = act.length || asks.length ? `<section class="panel heist-cards"><div class="sec-h"><h2>Карты ограбления</h2></div>
      ${act.map(a => { const d = H.cards[a.kind][a.n]; return `<div class="hc ${a.kind}">
        <button type="button" class="hc-head" data-act="coop-pick" data-kind="${a.kind}" data-slot="${slotOf(a)}" title="Другая карта">
          <span class="hc-kind">${a.kind === "sp" ? "Специалист" : a.perm ? "Испытание на всю игру" : "Испытание"}</span>
          <span class="hc-name"><b>№${a.n} ${esc(d ? d.ru : "")}</b><small>${esc(d ? d.en : "")}</small></span>${I.edit}</button>
        ${d ? stepsHTML(d.steps, g.id) : ""}</div>`; }).join("")}
      ${asks.map(q => `<button type="button" class="btn block hc-ask" data-act="coop-pick" data-kind="${q.kind}" data-slot="${q.perm ? "perm" : "new"}">${I.plus}${esc(q.label)}: какую открыли?</button>`).join("")}</section>` : "";
    const hist = s.rounds.length ? `<section class="panel"><div class="sec-h"><h2>Ограбления</h2></div><ol class="heist-hist">${s.rounds.map((rd, i) => {
      const used = rd.coop ? H.active(rd.coop).map(a => (H.cards[a.kind][a.n] || {}).ru).filter(Boolean) : [];
      return `<li class="${rd.heist === "ok" ? "ok" : "fail"}"><span class="hh-n">${i + 1}</span><b>${rd.heist === "ok" ? esc(g.scoring.okLabel) : esc(g.scoring.failLabel)}</b>${used.length ? `<small>${esc(used.join(", "))}</small>` : ""}</li>`; }).join("")}</ol></section>` : "";
    return `<div class="stack">
      <div class="shead">
        ${topline(backToOrigin(), `<button class="btn finish sm" data-act="finish-menu">${I.flag}Завершить</button>`)}
        ${sessionHero(s, g, true)}
        <div class="status-row">
          <div class="stat-tile"><span class="label">${esc(H.label)}</span><span class="round-no">${n}</span></div>
          <div class="stat-tile coop-tally">
            <span class="ct-row"><span class="label">Хранилища</span><span class="pips">${pips(t.ok, t.wins, "gold")}</span></span>
            <span class="ct-row"><span class="label">Тревоги</span><span class="pips">${pips(t.fail, t.losses, "red")}</span></span>
          </div>
        </div>
      </div>
      <div class="play">
        <div class="stack">
          ${cards}
          <section class="panel"><div class="sec-h"><h2>${esc(H.label)} ${n}: что делать</h2></div><ol class="phase-list">${H.steps(ctx, act).map(p => `<li><b>${esc(p.title)}</b>${stepsHTML(p.steps, g.id)}</li>`).join("")}</ol>${afterHTML(afterOf(g, ctx, n, 0), g.id)}</section>
          <details class="panel" ${n === 1 ? "open" : ""}><summary style="cursor:pointer;font-weight:600">Как брать фишки</summary><div class="reminder">${stepsHTML(g.rounds.reminder, g.id)}</div></details>
          ${g.ranking ? `<details class="panel"><summary style="cursor:pointer;font-weight:600">Комбинации: от сильной к слабой</summary><ol class="rank-list">${g.ranking.map(([nm, d]) => `<li><b>${esc(nm)}</b><span>${esc(d)}</span></li>`).join("")}</ol></details>` : ""}
          ${hist}
        </div>
        <div class="stack">
          <section class="panel"><div class="sec-h"><h2>Правила</h2><a class="sec-link" href="#/s/${s.id}/rules">Все правила${IC.chev}</a></div>${BH.rulesUI.panel(g, "", { compact: true })}</section>
        </div>
      </div>
      <div class="game-bar coop-bar">
        <button class="btn big" data-act="ask-open" aria-label="Спросить по правилам голосом" title="Спросить по правилам">${MIC}</button>
        <button class="btn primary big" data-act="heist" data-ok="1">${I.check}<span class="ell">${esc(g.scoring.okLabel)}</span></button>
        <button class="btn danger big" data-act="heist" data-ok="0"><span class="ell">${esc(g.scoring.failLabel)}</span></button>
        ${s.rounds.length ? `<button class="btn big" data-act="undo-round" aria-label="Отменить ограбление ${s.rounds.length}" title="Отменить ограбление ${s.rounds.length}">${I.undo}</button>` : ""}
      </div>
    </div>`;
  }

  // a magic card while its picture is not loaded: a card with a star
  const MC_PIC = `<svg viewBox="0 0 120 84" aria-hidden="true"><rect x="4" y="4" width="112" height="76" rx="10" style="fill:var(--accent-soft);stroke:var(--accent);stroke-width:3"/><path d="M60 22l6 13 14 2-10 10 2 14-12-7-12 7 2-14-10-10 14-2z" style="fill:var(--accent)"/></svg>`;
  // the window of one magic card: its picture, when to play it, what it does
  function openMagicCard(g, k) {
    const cap = t => t[0].toUpperCase() + t.slice(1);
    openDialog({ title: k.name, html: `<div class="mc-big"${k.img ? BH.assets.attr(g.id, [k.img + "@icon"]) : ""}>${k.art || MC_PIC}</div>
      ${k.when ? `<p class="mc-when">${esc(cap(k.when))}</p>` : ""}<div class="mc-does">${textHTML(cap(k.does), g.id)}</div>${k.note ? `<p class="small muted">${esc(k.note)}</p>` : ""}`,
      buttons: [{ label: "Понятно", primary: true, run: closeDialog }] });
  }
  // a race without rounds (Coconuts): the turn in short lines, the magic cards at hand, the end in one tap
  function viewPlayRace(s, g) {
    const sc = g.scoring, ctx = BH.ctxOf(s), goal = BH.raceGoal(g, s), cards = BH.raceCards(g, s);
    const reminder = typeof g.rounds.reminder === "function" ? g.rounds.reminder(ctx) : g.rounds.reminder;
    return `<div class="stack">
      <div class="shead">
        ${topline(backToOrigin(), `<button class="btn finish sm" data-act="finish-menu">${I.flag}Завершить</button>`)}
        ${sessionHero(s, g, true)}
        ${BH.player(s.first) ? `<div class="status-row" style="grid-template-columns:minmax(0,1fr)"><div class="stat-tile leader">${BH.avatar(BH.player(s.first))}<div class="leader-t"><span class="label">Начинает</span><b>${esc(BH.player(s.first).name)}</b></div></div></div>` : ""}
      </div>
      <div class="play">
        <div class="stack">
          <section class="panel"><div class="sec-h"><h2>Как идёт ход</h2></div><div class="reminder">${stepsHTML(reminder, g.id)}</div></section>
          ${cards.length ? `<section class="panel"><div class="sec-h"><h2>${esc(g.cardsTitle || "Карты")}</h2></div>
            <div class="mc-grid">${cards.map((k, i) => `<button type="button" class="mc-tile" data-act="mc-open" data-i="${i}" aria-label="${esc(k.name)}: что делать"><span class="mc-pic"${k.img ? BH.assets.attr(g.id, [k.img + "@icon"]) : ""}>${k.art || MC_PIC}</span><b>${esc(k.name)}</b>${k.tag ? `<small>${esc(k.tag)}</small>` : ""}</button>`).join("")}</div>
            ${g.cardsFoot ? `<p class="small muted mc-foot">${esc(g.cardsFoot)}</p>` : ""}</section>` : ""}
          <section class="panel"><div class="sec-h"><h2>Конец игры</h2></div>${stepsHTML(sc.end(goal), g.id)}</section>
        </div>
        <div class="stack">
          <section class="panel"><div class="sec-h"><h2>Правила</h2><a class="sec-link" href="#/s/${s.id}/rules">Все правила${IC.chev}</a></div>${BH.rulesUI.panel(g, "", { compact: true })}</section>
        </div>
      </div>
      <div class="game-bar">
        <button class="btn big" data-act="ask-open" aria-label="Спросить по правилам голосом" title="Спросить по правилам">${MIC}</button>
        <button class="btn primary big" data-act="finish-menu">${I.flag}<span class="ell">Партия окончена</span></button>
      </div>
    </div>`;
  }
  function viewDoneRace(s, g) {
    const r = s.race || {}, w = s.winners.map(BH.player).filter(Boolean), counts = r.counts || null, cups = r.cups || null;
    const dur = s.finishedAt && s.startedAt && s.finishedAt > s.startedAt ? BH.fmtDuration(s.finishedAt - s.startedAt) : null;
    const crown = `<svg class="crown" viewBox="0 0 64 64" aria-hidden="true"><path d="M8 46 L12 18 L24 32 L32 12 L40 32 L52 18 L56 46 Z" style="fill:#E3A72F;stroke:#B57E14;stroke-width:2.5;stroke-linejoin:round"/><rect x="8" y="46" width="48" height="8" rx="2" style="fill:#B57E14"/></svg>`;
    const sc = g.scoring, how = r.how && r.how === (sc.goalHow || "goal") ? sc.goalDone(BH.raceGoal(g, s)) : sc.count && r.how === sc.count.how ? sc.count.done : "Записана после игры";
    const num = (o, id) => (o && o[id] !== undefined ? o[id] : "—");
    const seat = id => s.players.indexOf(id);
    const order = [...s.players].sort((a, b) => (s.winners.includes(b) - s.winners.includes(a)) || ((cups || {})[b] || 0) - ((cups || {})[a] || 0) || ((counts || {})[b] || 0) - ((counts || {})[a] || 0) || seat(a) - seat(b));
    return `<div class="stack">
      <div class="shead">${topline(backToOrigin(), deleteBtn)}${sessionHero(s, g)}</div>
      <section class="panel podium">
        ${crown}
        <h1>${w.length ? "Победа: " + esc(w.map(p => p.name).join(" и ")) : "Партия окончена"}</h1>
        <p class="muted small">${esc(how)}</p>
      </section>
      <section class="panel"><h2 style="margin-bottom:6px">Итог</h2>
        ${counts || cups ? `<div class="scroll-x"><table class="tbl race-tbl"><thead><tr><th>Игрок</th>${cups ? "<th>Корзинки</th>" : ""}${counts ? "<th>Кокосы</th>" : ""}</tr></thead><tbody>${order.map(id => { const p = BH.player(id) || { name: "?", color: "#888" }; return `<tr><td><span class="race-who">${BH.avatar(p, "sm")}<b>${esc(p.name)}</b>${s.winners.includes(id) ? `<span class="won">${IC.trophy}</span>` : ""}</span></td>${cups ? `<td class="num">${num(cups, id)}</td>` : ""}${counts ? `<td class="num">${num(counts, id)}</td>` : ""}</tr>`; }).join("")}</tbody></table></div>`
          : `<div class="list">${order.map(id => { const p = BH.player(id) || { name: "?", color: "#888" }; return `<a class="item" href="#/players/${esc(id)}">${BH.avatar(p, "sm")}<div class="t"><b>${esc(p.name)}</b></div>${s.winners.includes(id) ? `<span class="won">${IC.trophy}</span>` : ""}</a>`; }).join("")}</div>`}
      </section>
      ${dur ? `<div class="kpis"><div class="kpi"><b>${dur}</b><span>длилась партия</span></div></div>` : ""}
      <div class="actions">
        <button class="btn primary big" data-act="rematch">${I.plus}Ещё партию теми же</button>
        ${dur ? `<button class="btn big" data-act="reopen">${I.undo}Вернуться к партии</button>` : ""}
      </div>
    </div>`;
  }

  function viewPlay(s, g) {
    if (BH.isEndScored(g)) return viewPlayEnd(s, g);
    if (BH.isCoop(g)) return viewPlayCoop(s, g);
    if (BH.isRace(g)) return viewPlayRace(s, g);
    const r = s.rounds.length, leaderId = BH.leaderAt(s, r), leader = BH.player(leaderId);
    const ctx = BH.ctxOf(s), tot = BH.totals(s), st = BH.standings(s), target = BH.targetOf(g, ctx), count = BH.roundsOf(g, ctx);
    const top = st.length && st[0].total > 0 ? st[0].total : null;
    const last = s.rounds[r - 1];
    // after a round the best come first (seating order among equal scores); before the first round — the seating order;
    // a pair is one row with one score
    const low = lowerWins(g), seat = id => s.players.indexOf(id), sides = BH.sidesOf(s);
    const order = r ? [...sides].sort((a, b) => (low ? tot[a[0]] - tot[b[0]] : tot[b[0]] - tot[a[0]]) || seat(a[0]) - seat(b[0])) : sides;
    const board = order.map(sd => {
      const ps = sd.map(id => BH.player(id) || { name: "?", color: "#888" }), p = ps[0], id = sd[0];
      const t = tot[id], pct = target ? BH.clamp(100 * t / target, 0, 100) : 0;
      const lr = last ? last.scores[id] : null, lf = last && last.flags ? last.flags[id] || {} : {};
      return `<div class="pl ${t === top ? "lead" : ""}${sd.length > 1 ? " pair" : ""}">
        ${sd.length > 1 ? `<span class="faces pair-faces">${ps.map(x => BH.avatar(x, "sm")).join("")}</span>` : BH.avatar(p)}
        <div style="min-width:0"><div class="nm"><span>${esc(ps.map(x => x.name).join(" и "))}</span></div>
          ${target ? `<div class="bar"><i style="width:${pct}%;background:${p.color}"></i></div>` : ""}</div>
        <div><div class="tot num">${t}</div><div class="last">${last ? (lf.bust ? "перебор" + (lr ? " " + BH.signed(lr) : "") : (lf.flip7 ? "Flip 7! " : "") + BH.signed(lr)) : target ? "из " + target : ""}</div></div>
      </div>`;
    }).join("");

    const hist = s.rounds.length ? `<section class="panel"><div class="spread" style="margin-bottom:6px"><h2>Раунды</h2><span class="small muted">нажмите на раунд, чтобы исправить</span></div>
      ${roundsTable(s, g, true)}</section>` : "";

    return `<div class="stack">
      <div class="shead">
        ${topline(backToOrigin(), `<button class="btn finish sm" data-act="finish-menu">${I.flag}Завершить</button>`)}
        ${sessionHero(s, g, true)}
        <div class="status-row">
          <div class="stat-tile"><span class="label">Раунд</span><span class="round-no">${r + 1}${count ? `<small> из ${Math.max(count, r + 1)}</small>` : ""}</span></div>
          ${leader ? `<div class="stat-tile leader">${BH.avatar(leader)}<div class="leader-t"><span class="label">${esc(g.rounds.leaderLabel || "Начинает")}</span><b>${esc(leader.name)}</b>${s.rounds.length ? "" : `<a class="btn sm leader-wheel" href="#/s/${esc(s.id)}/first" aria-label="${esc("Колесо: " + ((g.first && g.first.label) || "первый игрок").toLowerCase())}">${I.wheel}Колесо</a>`}</div></div>` : ""}
        </div>
      </div>
      <div class="play">
        <div class="stack">
          <div class="board">${board}</div>
          ${g.rounds.reminder ? `<details class="panel" ${r === 0 ? "open" : ""}><summary style="cursor:pointer;font-weight:600">Как идёт раунд</summary><div class="reminder">${stepsHTML(g.rounds.reminder, g.id)}${afterHTML(afterOf(g, BH.ctxOf(s), r + 1, 0), g.id)}</div></details>` : ""}
          ${hist}
        </div>
        <div class="stack">
          <section class="panel"><div class="sec-h"><h2>Правила</h2><a class="sec-link" href="#/s/${s.id}/rules">Все правила${IC.chev}</a></div>${BH.rulesUI.panel(g, "", { compact: true })}</section>
        </div>
      </div>
      <div class="game-bar">
        <button class="btn big" data-act="ask-open" aria-label="Спросить по правилам голосом" title="Спросить по правилам">${MIC}</button>
        <button class="btn primary big" data-act="new-round" aria-label="Записать раунд ${r + 1}">${I.plus}<span class="ell"><span class="lbl-l">Записать раунд</span><span class="lbl-s">Раунд</span> ${r + 1}</span></button>
        ${s.rounds.length ? `<button class="btn big" data-act="undo-round" aria-label="Отменить последний раунд" title="Отменить последний раунд">${I.undo}</button>` : ""}
      </div>
    </div>`;
  }

  function viewSessionRules(s, g) {
    return `<div class="stack">
      <div class="shead">${topline(backLink("#/s/" + s.id + "/play", "К игре"))}${sessionHero(s, g)}</div>
      <div class="page-head"><div><h1>Правила</h1></div></div>
      ${askButton(g)}
      ${BH.rulesUI.panel(g, rulesQuery)}
    </div>`;
  }

  // the result of a game scored at the end: the score pad — each card from the last to the first, the extra rows, the total
  function endPadHTML(s, g) {
    const e = g.endScore, fd = s.finalDetail;
    if (!e || !fd) return "";
    const cell = v => (v === null || v === undefined ? "—" : v);
    const tot = BH.totals(s), anyTie = s.players.some(id => fd[id] && fd[id].tie !== null && fd[id].tie !== undefined);
    const head = s.players.map(id => { const p = BH.player(id) || { name: "?", color: "#888" }; return `<th title="${esc(p.name)}">${BH.avatar(p, "sm")}<span class="hist-n">${esc(p.name)}</span></th>`; }).join("");
    const rows = Array.from({ length: e.rows }, (_, j) => e.rows - j).map(k => `<tr><td>${esc(e.rowLabel(k))}</td>${s.players.map(id => `<td>${cell(fd[id] && fd[id].cards ? fd[id].cards[k - 1] : null)}</td>`).join("")}</tr>`).join("")
      + (e.extra || []).map(x => `<tr><td>${esc(x.label)}</td>${s.players.map(id => `<td>${cell(fd[id] && fd[id][x.id])}</td>`).join("")}</tr>`).join("");
    const winTie = s.winners.length === 1 && s.players.filter(id => tot[id] === tot[s.winners[0]]).length > 1;
    return `<section class="panel"><h2 style="margin-bottom:6px">Блокнот</h2><div class="scroll-x"><table class="hist pad">
        <thead><tr><th></th>${head}</tr></thead><tbody>${rows}</tbody>
        <tfoot><tr><th>Итого</th>${s.players.map(id => `<th>${tot[id]}</th>`).join("")}</tr>${anyTie && e.tie ? `<tr><td class="small muted">${esc(e.tie.label)}</td>${s.players.map(id => `<td class="small">${cell(fd[id] && fd[id].tie)}</td>`).join("")}</tr>` : ""}</tfoot>
      </table></div><p class="tiny muted" style="margin-top:6px">Регионы — в порядке подсчёта: с последней сыгранной карты к первой.${winTie && e.tie ? ` Слава равная — победа по строке «${esc(e.tie.label)}»: меньше — выше.` : ""}</p></section>`;
  }

  function viewDoneCoop(s, g) {
    const t = BH.coopTally(s), won = s.winners.length > 0, H = g.heist;
    // a game recorded afterwards has no duration (its start and end are the same moment)
    const dur = s.finishedAt && s.startedAt && s.finishedAt > s.startedAt ? BH.fmtDuration(s.finishedAt - s.startedAt) : null;
    const crown = `<svg class="crown" viewBox="0 0 64 64" aria-hidden="true"><path d="M8 46 L12 18 L24 32 L32 12 L40 32 L52 18 L56 46 Z" style="fill:#E3A72F;stroke:#B57E14;stroke-width:2.5;stroke-linejoin:round"/><rect x="8" y="46" width="48" height="8" rx="2" style="fill:#B57E14"/></svg>`;
    const siren = `<svg class="crown" viewBox="0 0 64 64" aria-hidden="true"><path d="M18 50 a14 14 0 0 1 28 0 v4 H18z" style="fill:#D9483B;stroke:#9E2B22;stroke-width:2.5"/><rect x="12" y="54" width="40" height="6" rx="2" style="fill:#9E2B22"/><path d="M32 12v10M14 20l6 6M50 20l-6 6" style="stroke:#D9483B;stroke-width:4;stroke-linecap:round"/></svg>`;
    return `<div class="stack">
      <div class="shead">${topline(backToOrigin(), deleteBtn)}${sessionHero(s, g)}</div>
      <section class="panel podium">
        ${won ? crown : siren}
        <h1>${won ? "Банда победила!" : "Банда попалась"}</h1>
        ${s.rounds.length ? "" : `<p class="muted small">Записана после игры, без ограблений</p>`}
      </section>
      <section class="panel"><h2 style="margin-bottom:6px">Банда</h2>
        <div class="list">${s.players.map(id => { const p = BH.player(id) || { name: "?", color: "#888" }; return `<a class="item" href="#/players/${esc(id)}">${BH.avatar(p, "sm")}<div class="t"><b>${esc(p.name)}</b></div>${won ? `<span class="won">${IC.trophy}</span>` : ""}</a>`; }).join("")}</div>
      </section>
      ${s.rounds.length || s.tally ? `<div class="kpis">
          ${s.rounds.length ? `<div class="kpi"><b>${s.rounds.length}</b><span>${BH.plural(s.rounds.length, "ограбление", "ограбления", "ограблений")}</span></div>` : ""}
          <div class="kpi"><b>${t.ok} из ${t.wins}</b><span>хранилищ вскрыто</span></div>
          <div class="kpi"><b>${t.fail} из ${t.losses}</b><span>тревог</span></div>
          ${dur ? `<div class="kpi"><b>${dur}</b><span>длилась партия</span></div>` : ""}
        </div>
        ${s.rounds.length ? `<section class="panel"><h2 style="margin-bottom:6px">Ограбления</h2><ol class="heist-hist">${s.rounds.map((rd, i) => {
          const used = rd.coop ? H.active(rd.coop).map(a => (H.cards[a.kind][a.n] || {}).ru).filter(Boolean) : [];
          return `<li class="${rd.heist === "ok" ? "ok" : "fail"}"><span class="hh-n">${i + 1}</span><b>${rd.heist === "ok" ? esc(g.scoring.okLabel) : esc(g.scoring.failLabel)}</b>${used.length ? `<small>${esc(used.join(", "))}</small>` : ""}</li>`; }).join("")}</ol></section>` : ""}` : ""}
      <div class="actions">
        <button class="btn primary big" data-act="rematch">${I.plus}Ещё партию теми же</button>
        ${s.rounds.length ? `<button class="btn big" data-act="reopen">${I.undo}Вернуться к партии</button>` : ""}
      </div>
    </div>`;
  }
  function viewDone(s, g) {
    if (BH.isCoop(g)) return viewDoneCoop(s, g);
    if (BH.isRace(g)) return viewDoneRace(s, g);
    const st = BH.standings(s), w = s.winners.map(BH.player).filter(Boolean);
    const dur = s.finishedAt && s.startedAt && s.finishedAt > s.startedAt ? BH.fmtDuration(s.finishedAt - s.startedAt) : null;
    // a game of pairs: partners win together and share one line of the result
    const team = BH.isTeamGame(s), sidesW = BH.sidesOf(s).filter(sd => sd.some(id => s.winners.includes(id)));
    const sideName = sd => sd.map(id => (BH.player(id) || { name: "?" }).name).join(" и ");
    const title = team ? (sidesW.length > 1 ? "Ничья" : sidesW.length ? "Победа: " + esc(sideName(sidesW[0])) : "Партия окончена")
      : w.length > 1 ? "Ничья: " + esc(w.map(p => p.name).join(" и ")) : w.length ? "Победа: " + esc(w[0].name) : "Партия окончена";
    const hasBust = !!(g.calc && g.calc.flags && g.calc.flags.some(f => f.id === "bust"));
    const crown = `<svg class="crown" viewBox="0 0 64 64" aria-hidden="true"><path d="M8 46 L12 18 L24 32 L32 12 L40 32 L52 18 L56 46 Z" style="fill:#E3A72F;stroke:#B57E14;stroke-width:2.5;stroke-linejoin:round"/><rect x="8" y="46" width="48" height="8" rx="2" style="fill:#B57E14"/></svg>`;
    // the date and the place are on the game's card, the rounds and the time in the tiles below
    return `<div class="stack">
      <div class="shead">${topline(backToOrigin(), deleteBtn)}${sessionHero(s, g)}</div>
      <section class="panel podium">
        ${crown}
        <h1>${title}</h1>
        ${s.rounds.length || s.finalDetail ? "" : `<p class="muted small">Записана после игры, без раундов</p>`}
        ${(() => { const n = g.finishNote && g.finishNote(s); if (!n) return ""; const note = typeof n === "string" ? { text: n, ok: true } : n; return `<p class="note podium-note ${note.ok ? "good" : ""}">${note.ok ? I.check : IC.bolt}<span>${esc(note.text)}</span></p>`; })()}
      </section>
      <section class="panel"><h2 style="margin-bottom:6px">Итог</h2>
        <div class="list">${team ? (() => { const tt = BH.totals(s); return [...BH.sidesOf(s)].sort((a, b) => tt[b[0]] - tt[a[0]]).map((sd, i, arr) => `<div class="item"><span class="place-n">${i && tt[sd[0]] === tt[arr[i - 1][0]] ? 1 : i + 1}</span><span class="faces pair-faces">${sd.map(id => BH.avatar(BH.player(id) || { name: "?", color: "#888" }, "sm")).join("")}</span><div class="t"><b>${esc(sideName(sd))}</b></div>${sd.some(id => s.winners.includes(id)) ? `<span class="won">${IC.trophy}</span>` : ""}<span class="num" style="font-size:20px;font-weight:700">${tt[sd[0]]}</span></div>`).join(""); })()
          : st.map(x => { const p = BH.player(x.id) || { name: "?", color: "#888" }; return `<a class="item" href="#/players/${esc(x.id)}"><span class="place-n">${x.place}</span>${BH.avatar(p, "sm")}<div class="t"><b>${esc(p.name)}</b></div>${s.winners.includes(x.id) ? `<span class="won">${IC.trophy}</span>` : ""}<span class="num" style="font-size:20px;font-weight:700">${x.total}</span></a>`; }).join("")}</div>
      </section>
      ${BH.isEndScored(g) ? endPadHTML(s, g) : s.rounds.length ? (() => {
        const rs = roundStats(s, g), anyF7 = rs.some(x => x.sevens), allR = [], low = lowerWins(g);
        s.rounds.forEach((rd, i) => s.players.forEach(id => allR.push({ id, i, v: Number(rd.scores[id]) || 0 })));
        const top = allR.sort((a, b) => low ? a.v - b.v : b.v - a.v)[0], topP = top && BH.player(top.id);
        const busts = rs.reduce((a, x) => a + x.busts, 0), sevens = rs.reduce((a, x) => a + x.sevens, 0);
        return `<div class="kpis">
          <div class="kpi"><b>${s.rounds.length}</b><span>${BH.plural(s.rounds.length, "раунд", "раунда", "раундов")}</span></div>
          ${dur ? `<div class="kpi"><b>${dur}</b><span>длилась партия</span></div>` : ""}
          ${top && (top.v || low) && !(g.sideScore && top.v <= 2) ? `<div class="kpi"><b>${top.v}</b><span>лучший раунд${topP ? ": " + esc(team ? sideName(BH.sidesOf(s).find(sd => sd.includes(top.id)) || [top.id]) : topP.name) + ", " + (top.i + 1) + "-й" : ""}</span></div>` : ""}
          ${hasBust ? `<div class="kpi"><b>${busts}</b><span>${BH.plural(busts, "перебор", "перебора", "переборов")}</span></div>` : ""}
          ${g.sideScore ? (() => { const tw = s.rounds.reduce((a, rd) => a + BH.sidesOf(s).reduce((b, sd) => b + (Number(((((rd.detail || {})[sd[0]] || {}).sel || {}).counts || {})[20]) || 0), 0), 0); return tw ? `<div class="kpi"><b>${tw}</b><span>${BH.plural(tw, "диск", "диска", "дисков")} в центре</span></div>` : ""; })() : ""}
          ${sevens ? `<div class="kpi"><b>${sevens}</b><span>${BH.plural(sevens, "раз", "раза", "раз")} 7 разных чисел</span></div>` : ""}
        </div>
        <section class="panel"><h2 style="margin-bottom:6px">Раунды</h2>${roundsTable(s, g, false)}</section>
        ${team || !hasBust ? "" : `<section class="panel"><h2 style="margin-bottom:6px">По игрокам</h2><div class="scroll-x"><table class="tbl">
          <thead><tr><th>Игрок</th><th title="Среднее за раунд">Ср.</th><th title="Лучший раунд">Лучш.</th><th title="Переборы">✕</th>${anyF7 ? "<th>★</th>" : ""}</tr></thead>
          <tbody>${rs.map(x => { const p = BH.player(x.id) || { name: "?", color: "#888" }; return `<tr><td><span class="row">${BH.avatar(p, "sm")}${esc(p.name)}</span></td><td>${x.avg}</td><td>${x.best}</td><td>${x.busts}</td>${anyF7 ? `<td>${x.sevens}</td>` : ""}</tr>`; }).join("")}</tbody>
        </table></div><p class="tiny muted" style="margin-top:6px">Ср. — среднее за раунд, Лучш. — лучший раунд, ✕ — переборы${anyF7 ? ", ★ — 7 разных чисел" : ""}.</p></section>`}`;
      })() : ""}
      <div class="actions">
        <button class="btn primary big" data-act="rematch">${I.plus}Ещё партию теми же</button>
        ${s.rounds.length || s.finalDetail ? `<button class="btn big" data-act="reopen">${I.undo}Вернуться к партии</button>` : ""}
      </div>
    </div>`;
  }

  /* ---------- games catalogue ---------- */
  function viewGames() {
    const list = gamesByPlays(), n = BH.games.length;
    return `<div class="stack">
      <div class="page-head"><div><h1>Игры</h1><p class="sub">${n} ${BH.plural(n, "игра", "игры", "игр")} в коллекции, сначала самые играемые</p></div></div>
      ${n > 6 ? `<div class="search">${I.search}<input class="input" type="search" data-act="games-q" placeholder="По названию" aria-label="Поиск игры" autocomplete="off"></div>` : ""}
      <div class="glist">${list.map(({ g, n: k }) => `<a class="grow" href="#/games/${esc(g.id)}" data-name="${esc(g.name.toLowerCase())}">
          ${coverOf(g)}
          <span class="t"><b>${esc(g.name)}</b>${meta([[IC.people, playersRange(g), "Игроков"], g.time && [IC.clock, esc(g.time), "Время партии"]], "plain")}</span>
          <span class="grow-n${k ? "" : " zero"}" title="Сыграно партий">${IC.cards}${k ? k + " " + BH.plural(k, "партия", "партии", "партий") : "не играли"}</span>
        </a>`).join("")}</div>
      <p class="muted small" id="games-none" hidden>Ничего не нашлось.</p>
    </div>`;
  }
  /* a game's page: what it is, a new game / a question, and tabs — its statistics, its sessions, its rules */
  let gcard = { id: null, tab: "stats", period: "all" };
  function viewGame(g) {
    const fin = finishedSessions().filter(x => x.gameId === g.id);
    if (gcard.id !== g.id) gcard = { id: g.id, tab: fin.length ? "stats" : "rules", period: gcard.period, psort: gcard.psort };
    const years = [...new Set(fin.map(x => new Date(BH.sessionDate(x)).getFullYear()))].sort((a, b) => b - a);
    const opts = Object.assign({}, PERIODS); for (const y of years) opts["y" + y] = y + " год";
    if (!(gcard.period in opts)) gcard.period = "all";
    const st = BH.gameStats(g.id, fin.filter(x => inPeriod(x, gcard.period)));
    const live = S().sessions.filter(x => x.gameId === g.id && x.status !== "finished");
    const tabs = [["stats", "Статистика"], ["sessions", "Партии"], ["rules", "Правила"]];
    const period = `<label class="small muted pc-sort">Период<select class="input" data-act="gc-period" aria-label="Период">${Object.entries(opts).map(([k, v]) => `<option value="${k}" ${k === gcard.period ? "selected" : ""}>${v}</option>`).join("")}</select></label>`;
    let body;
    if (gcard.tab === "rules") body = BH.rulesUI.panel(g, "");
    else if (gcard.tab === "sessions") body = `${live.length ? `<section class="panel"><div class="sec-h"><h2>Идут сейчас</h2><span class="badge accent">${live.length}</span></div><div class="list">${live.map(sessionLine).join("")}</div></section>` : ""}
      ${fin.length ? period : ""}
      ${st.sessions.length ? `<section class="panel"><div class="list">${st.sessions.map(sessionLine).join("")}</div></section>` : `<p class="muted small">${fin.length ? "За этот период партий нет." : live.length ? "Сыгранных партий пока нет." : "В эту игру ещё не играли."}</p>`}`;
    else body = fin.length ? period + gameStatsHTML(g, st) : `<p class="muted small">В эту игру ещё не играли. Статистика появится после первой партии.</p>`;
    return `<div class="stack">
      <div class="shead">${topline(backSmart("#/games", "Игры"))}
        <div class="obj-head">${coverOf(g, "obj-cover")}
          <div class="obj-t"><h1>${esc(g.name)}</h1>${meta([
            g.publisher && [IC.building, esc(g.publisher + (g.year ? ", " + g.year : "")), "Издатель"],
            [IC.people, playersRange(g), "Игроков"],
            g.time && [IC.clock, esc(g.time), "Время партии"],
            g.age && [IC.cake, esc(g.age), "Возраст"],
          ])}</div></div></div>
      ${g.tagline ? `<p>${esc(g.tagline)}</p>` : ""}
      <div class="act-row"><button class="btn primary big" data-act="new-with" data-id="${g.id}">${I.plus}Новая партия</button><button class="btn big" data-act="ask-open" data-game="${esc(g.id)}" aria-label="Спросить по правилам голосом" title="Спросить по правилам голосом">${MIC}</button></div>
      <div class="seg pc-tabs" role="group" aria-label="Разделы игры">${tabs.map(([k, v]) => `<button type="button" data-act="gc-tab" data-tab="${k}" aria-pressed="${gcard.tab === k}">${v}</button>`).join("")}</div>
      ${body}
    </div>`;
  }
  // the orders of a players list: by wins (then the rate, then plays), by the win rate, by the best score
  const PR_SORTS = { wins: "Победы", rate: "% побед", best: "Счёт" };
  function sortPlayers(list, key, low) {
    const by = {
      wins: (a, b) => b.wins - a.wins || b.rate - a.rate || b.n - a.n,
      rate: (a, b) => b.rate - a.rate || b.wins - a.wins || b.n - a.n,
      best: (a, b) => (a.best === null) - (b.best === null) || (low ? a.best - b.best : b.best - a.best) || (low ? a.avg - b.avg : b.avg - a.avg) || b.wins - a.wins,
    }[key] || ((a, b) => b.wins - a.wins);
    return list.slice().sort(by);
  }
  // the switch of the order, right above the list (docs/ui.md: a control of a list stands at the list)
  const prSortBar = (scope, cur, keys) => `<div class="spread pr-sort"><span class="small muted">Порядок</span><div class="seg">${keys.map(k => `<button type="button" data-act="pr-sort" data-scope="${scope}" data-v="${k}" aria-pressed="${cur === k}">${PR_SORTS[k]}</button>`).join("")}</div></div>`;
  // players with their games and wins, a bar of the win rate, and (for a game) best / average score on the right
  function playersRateList(list, withScores) {
    const parties = n => n + " " + BH.plural(n, "партия", "партии", "партий");
    return list.map(e => {
      const q = BH.player(e.id); if (!q) return "";
      const pct = Math.round(100 * e.rate);
      return `<a class="item pr-row" href="#/players/${esc(q.id)}">${BH.avatar(q)}
        <div class="t"><b>${esc(q.name)}</b>${meta([[IC.cards, parties(e.n), "Партий"], [IC.trophy, e.wins + " " + BH.plural(e.wins, "победа", "победы", "побед"), "Побед", e.wins ? "win" : ""]], "plain")}
          <div class="pr-line"><div class="pr-bar" role="img" aria-label="${pct}% побед"><i style="width:${pct}%;background:${esc(q.color)}"></i></div><span class="pr-pct">${pct}%</span></div></div>
        ${withScores ? `<span class="pl-best" title="Лучший счёт · средний"><b>${e.best !== null ? e.best : "—"}</b><small>${e.avg !== null ? "ср. " + e.avg : "без очков"}</small></span>` : ""}
      </a>`;
    }).join("");
  }
  // "3,4 раунда" but "5 раундов": a fraction takes the genitive singular
  const avgWord = (n, one, few, many) => Number.isInteger(n) ? BH.plural(n, one, few, many) : few;
  function gameStatsHTML(g, st) {
    if (!st.played) return `<p class="muted small">За этот период партий нет.</p>`;
    const name = id => { const q = BH.player(id); return q ? esc(q.name) : "?"; };
    const parties = n => n + " " + BH.plural(n, "партия", "партии", "партий");
    const kpi = (v, label) => `<div class="kpi"><b>${v}</b><span>${label}</span></div>`;
    const line = (label, v) => v ? `<div class="pc-line"><span>${label}</span><b>${v}</b></div>` : "";
    const hours = ms => ms >= 3600000 ? (ms / 3600000).toFixed(1).replace(".", ",") + " ч" : BH.fmtDuration(ms);
    const top = st.players[0], place = st.favPlace && BH.place(st.favPlace.id);
    const best = st.bestScore, bestR = st.bestRound;
    return `<div class="kpis">
        ${kpi(st.played, BH.plural(st.played, "партия", "партии", "партий"))}
        ${kpi(st.players.length, BH.plural(st.players.length, "игрок", "игрока", "игроков"))}
        ${st.time ? kpi(hours(st.time), "за столом") : ""}
        ${st.avgTime ? kpi(BH.fmtDuration(st.avgTime), "в среднем партия") : ""}
        ${st.avgRounds ? kpi(String(st.avgRounds).replace(".", ","), avgWord(st.avgRounds, "раунд", "раунда", "раундов") + " в среднем") : ""}
        ${kpi(String(st.avgTable).replace(".", ","), avgWord(st.avgTable, "игрок", "игрока", "игроков") + " за столом в среднем")}
      </div>
      <section class="panel">
        <h2 style="margin-bottom:6px">Рекорды</h2>
        ${line("Лучший счёт", best && (best.v || lowerWins(g)) ? two(best.v, `${name(best.id)}, ${BH.fmtDate(best.at)}`) : "")}
        ${line("Лучший раунд", bestR ? two(bestR.v, name(bestR.id)) : "")}
        ${line("Средний счёт победителя", st.avgWin || (st.avgWin === 0 && lowerWins(g)) ? String(st.avgWin) : "")}
        ${line("Чаще всех побеждает", top && top.wins ? two(name(top.id), top.wins + " " + BH.plural(top.wins, "победа", "победы", "побед")) : "")}
        ${line("Где играют", place ? two(`<a href="#/places/${esc(place.id)}">${esc(place.name)}</a>`, parties(st.favPlace.n)) : "")}
        ${line("Первая партия", BH.fmtDate(st.first))}
        ${line("Последняя партия", BH.fmtDate(st.last))}
      </section>
      <section class="panel"><h2 style="margin-bottom:8px">Игроки</h2>${st.players.length > 1 ? prSortBar("game", gcard.psort || "wins", ["wins", "rate", "best"]) : ""}<div class="list">${playersRateList(sortPlayers(st.players, gcard.psort || "wins", lowerWins(g)), true)}</div><p class="tiny muted" style="margin-top:6px">Справа — лучший и средний счёт.</p></section>`;
  }

  /* ---------- players & places ---------- */
  let editPlayer = null, editKeep = null;   // editKeep: what was typed in the open form, kept over a redraw
  // the edit form of a player (name, colour, "this is me", hide / delete), shown on the player's card
  function playerEditForm(p) {
    const played = S().sessions.some(s => s.players.includes(p.id));
    const kept = editKeep && editKeep.id === p.id ? editKeep : null;
    return `<form class="panel stack" data-form="edit-player" data-id="${p.id}">
      <label class="field">Имя<input class="input" name="name" value="${esc(kept ? kept.name : p.name)}" maxlength="40" required></label>
      <div class="field">Цвет<div class="swatches">${BH.COLORS.map(c => `<button type="button" class="sw" style="background:${c}" data-act="pick-color" data-id="${p.id}" data-c="${c}" aria-pressed="${(kept && kept.color ? kept.color : p.color) === c}" aria-label="Цвет ${c}"></button>`).join("")}</div></div>
      <label class="check" style="font-weight:500"><input type="checkbox" name="me" ${(kept ? kept.me : BH.meId() === p.id) ? "checked" : ""}> Это я — мой профиль и статистика на главной</label>
      <div class="actions"><button class="btn primary" type="submit">Сохранить</button><button class="btn" type="button" data-act="edit-player" data-id="">Отмена</button>
        <button class="btn ghost" type="button" data-act="hide-player" data-id="${p.id}">${p.hidden ? "Вернуть в список" : played ? "Скрыть из выбора" : "Удалить"}</button></div>
    </form>`;
  }
  // a redraw replaces the page: give the keyboard focus back to the control that caused it
  const refocus = sel => { const n = BH.$(sel); if (n) n.focus({ preventScroll: true }); };
  // dark or light text on a player's colour, whichever reads better
  const inkOn = hex => { const n = parseInt(String(hex).slice(1), 16), lin = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    const L = 0.2126 * lin(n >> 16 & 255) + 0.7152 * lin(n >> 8 & 255) + 0.0722 * lin(n & 255); return L > 0.2 ? "#1E1B16" : "#FFFFFF"; };
  const STAR = '<span class="me-star" title="Это вы"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/></svg></span>';

  /* players: a grid of faces, most played first (or by name), tap one for the player's card */
  let playersSort = "plays";
  function viewPlayers() {
    const fin = finishedSessions(), meId = BH.me() ? BH.meId() : null;
    const count = id => fin.filter(s => s.players.includes(id)).length;
    const list = S().players.map(p => ({ p, n: count(p.id) }))
      .sort((a, b) => (a.p.hidden - b.p.hidden) || (playersSort === "name" ? 0 : b.n - a.n) || a.p.name.localeCompare(b.p.name, "ru"));
    const visible = S().players.filter(p => !p.hidden).length;
    return `<div class="stack">
      <div>${backSmart("#/menu", "Меню")}<div class="page-head"><div><h1>Игроки</h1><p class="sub">${visible} ${BH.plural(visible, "игрок", "игрока", "игроков")} — друзья и семья, с кем вы играете</p></div></div></div>
      ${list.length && !meId ? `<div class="note info small">Отметьте себя: откройте свою карточку, нажмите «Изменить» и поставьте галочку «Это я» — тогда на главной будет ваш профиль.</div>` : ""}
      <form class="row" data-form="add-player-page"><input class="input" name="name" placeholder="Имя нового игрока" maxlength="40" aria-label="Имя нового игрока"><button class="btn primary" type="submit">Добавить</button></form>
      ${list.length > 1 ? `<div class="spread"><span class="small muted">Порядок</span><div class="seg"><button type="button" data-act="players-sort" data-v="plays" aria-pressed="${playersSort !== "name"}">По партиям</button><button type="button" data-act="players-sort" data-v="name" aria-pressed="${playersSort === "name"}">По имени</button></div></div>` : ""}
      ${list.length > 9 ? `<div class="search">${I.search}<input class="input" type="search" data-act="players-q" placeholder="Поиск по имени" aria-label="Поиск игрока" autocomplete="off"></div>` : ""}
      ${list.length ? `<div class="pgrid">${list.map(({ p, n }) => `<a class="pcell${p.hidden ? " off" : ""}" href="#/players/${esc(p.id)}" data-name="${esc(p.name.toLowerCase())}">
          <span class="pcell-av">${BH.avatar(p, "xl")}${p.id === meId ? STAR : ""}</span>
          <b>${esc(p.name)}</b><span class="pc-n">${n ? n + " " + BH.plural(n, "партия", "партии", "партий") : "ещё не играл(а)"}</span>${p.hidden ? '<span class="badge">скрыт</span>' : ""}
        </a>`).join("")}</div><p class="muted small" id="players-none" hidden>Никого не нашлось.</p>`
        : `<p class="muted small">Пока никого. Игроков можно добавить здесь или при создании партии.</p>`}
    </div>`;
  }

  /* the player's card: totals, win rate, a period, and tabs with info, games, sessions and wins */
  let pcard = { id: null, tab: "info", sort: "plays", period: "all" };
  const PERIODS = { all: "Всё время", "30d": "Последние 30 дней", "365d": "Последние 12 месяцев" };
  function inPeriod(s, period) {
    const t = BH.sessionDate(s);
    if (period === "30d") return t >= Date.now() - 30 * 864e5;
    if (period === "365d") return t >= Date.now() - 365 * 864e5;
    if (/^y\d{4}$/.test(period)) return new Date(t).getFullYear() === Number(period.slice(1));
    return true;
  }
  function viewPlayer(p) {
    if (pcard.id !== p.id) pcard = { id: p.id, tab: "info", sort: pcard.sort, period: pcard.period };
    const fin = finishedSessions();
    const years = [...new Set(fin.map(s => new Date(BH.sessionDate(s)).getFullYear()))].sort((a, b) => b - a);
    const opts = Object.assign({}, PERIODS); for (const y of years) opts["y" + y] = y + " год";
    if (!(pcard.period in opts)) pcard.period = "all";
    const st = BH.playerStats(p.id, fin.filter(s => inPeriod(s, pcard.period)));
    const isMe = BH.meId() === p.id, pct = Math.round(100 * st.rate);
    const tabs = [["info", "Инфо"], ["games", "Игры"], ["sessions", "Партии"], ["wins", "Победы"]];
    let body = "";
    if (pcard.tab === "games") body = playerGames(st);
    else if (pcard.tab === "sessions" || pcard.tab === "wins") {
      const list = pcard.tab === "wins" ? st.sessions.filter(s => s.winners.includes(p.id)) : st.sessions;
      body = list.length ? `<section class="panel"><div class="list">${list.map(sessionLine).join("")}</div></section>`
        : `<p class="muted small">${pcard.tab === "wins" ? "Побед за этот период нет." : "Партий за этот период нет."}</p>`;
    } else body = playerInfo(p, st);
    return `<div class="stack">
      ${topline(backSmart("#/players", "Игроки"), editPlayer === p.id ? "" : `<button class="btn ghost sm" data-act="edit-player" data-id="${esc(p.id)}">${I.edit}Изменить</button>`)}
      <section class="pc-head" style="--pc:${esc(p.color)}">
        <span class="pc-av">${BH.avatar(p, "xxl")}${isMe ? STAR : ""}</span>
        <div class="pc-name"><h1>${esc(p.name)}</h1>${isMe ? '<span class="badge accent">это вы</span>' : ""}${p.hidden ? '<span class="badge">скрыт из выбора</span>' : ""}</div>
      </section>
      ${editPlayer === p.id ? playerEditForm(p) : ""}
      <section class="panel pc-sum">
        <div class="pc-top">
          <div class="pc-rate" style="--pc:${esc(p.color)};--pc-ink:${inkOn(p.color)}"><b>${pct}%</b><span>побед</span></div>
          <div class="pc-top-t">
            <label class="small muted">Период<select class="input" data-act="pc-period" aria-label="Период">${Object.entries(opts).map(([k, v]) => `<option value="${k}" ${k === pcard.period ? "selected" : ""}>${v}</option>`).join("")}</select></label>
            <span class="badge" title="Сколько игр сыграно хотя бы столько же раз">H-индекс: ${st.hIndex}</span>
          </div>
        </div>
        <div class="pc-bar" role="img" aria-label="${st.wins} ${BH.plural(st.wins, "победа", "победы", "побед")} из ${st.played} ${BH.plural(st.played, "партии", "партий", "партий")}"><i style="width:${st.played ? pct : 0}%"></i></div>
        <div class="pc-bar-t" aria-hidden="true"><span><b>${st.wins}</b> ${BH.plural(st.wins, "победа", "победы", "побед")}</span><span><b>${st.played}</b> ${BH.plural(st.played, "партия", "партии", "партий")}</span></div>
      </section>
      <div class="seg pc-tabs" role="group" aria-label="Разделы карточки">${tabs.map(([k, v]) => `<button type="button" data-act="pc-tab" data-tab="${k}" aria-pressed="${pcard.tab === k}">${v}</button>`).join("")}</div>
      ${body}
    </div>`;
  }
  function playerInfo(p, st) {
    if (!st.played) return `<p class="muted small">За этот период у игрока нет сыгранных партий.</p>`;
    const name = id => { const g = BH.game(id); return g ? g.name : id; };
    const fav = st.games.slice().sort((a, b) => b.n - a.n)[0];
    const best = st.games.filter(e => e.n >= 3 && e.wins > 0).sort((a, b) => b.rate - a.rate || b.n - a.n)[0];
    const place = st.favPlace && BH.place(st.favPlace.id);
    const kpi = (v, label) => `<div class="kpi"><b>${v}</b><span>${label}</span></div>`;
    const line = (label, v) => v ? `<div class="pc-line"><span>${label}</span><b>${v}</b></div>` : "";
    const parties = n => n + " " + BH.plural(n, "партия", "партии", "партий");
    const rivals = st.opponents.slice(0, 8).map(o => { const q = BH.player(o.id); return q ? `<a class="item" href="#/players/${esc(q.id)}">${BH.avatar(q)}<div class="t"><b>${esc(q.name)}</b>${meta([[IC.cards, parties(o.n) + " вместе", "Партий вместе"]], "plain")}</div><span class="pl-best" title="Победы: ${esc(p.name)} против ${esc(q.name)}"><b>${o.myWins} : ${o.theirWins}</b><small>победы</small></span></a>` : ""; }).join("");
    return `<div class="kpis">
        ${kpi(st.played, BH.plural(st.played, "партия", "партии", "партий"))}
        ${kpi(st.wins, BH.plural(st.wins, "победа", "победы", "побед"))}
        ${kpi(st.games.length, BH.plural(st.games.length, "игра", "игры", "игр"))}
        ${st.time ? kpi(st.time >= 3600000 ? (st.time / 3600000).toFixed(1).replace(".", ",") + " ч" : BH.fmtDuration(st.time), "за столом") : ""}
        ${kpi(st.longestStreak, "лучшая серия побед")}
        ${kpi(st.currentStreak, "побед подряд сейчас")}
      </div>
      <section class="panel">
        ${line("Первая партия", BH.fmtDate(st.first))}
        ${line("Последняя партия", BH.fmtDate(st.last))}
        ${line("Любимая игра", fav ? two(esc(name(fav.gameId)), parties(fav.n)) : "")}
        ${line("Лучше всего получается", best ? two(esc(name(best.gameId)), Math.round(100 * best.rate) + "% побед") : "")}
        ${line("Любимое место", place ? two(esc(place.name), parties(st.favPlace.n)) : "")}
      </section>
      ${rivals ? `<section class="panel"><h2 style="margin-bottom:4px">С кем играет чаще всего</h2><div class="list">${rivals}</div></section>` : ""}`;
  }
  const GAME_SORTS = { plays: "Количество партий", wins: "Победы", rate: "Процент побед", last: "Последняя партия", name: "Название" };
  function playerGames(st) {
    if (!st.games.length) return `<p class="muted small">Партий за этот период нет.</p>`;
    const nameOf = e => { const g = BH.game(e.gameId); return g ? g.name : e.gameId; };
    const by = { plays: (a, b) => b.n - a.n, wins: (a, b) => b.wins - a.wins || b.n - a.n, rate: (a, b) => b.rate - a.rate || b.n - a.n, last: (a, b) => b.last - a.last, name: () => 0 }[pcard.sort] || ((a, b) => b.n - a.n);
    const list = st.games.slice().sort((a, b) => by(a, b) || nameOf(a).localeCompare(nameOf(b), "ru"));
    return `<label class="small muted pc-sort">Сортировать<select class="input" data-act="pc-sort" aria-label="Сортировка игр">${Object.entries(GAME_SORTS).map(([k, v]) => `<option value="${k}" ${k === pcard.sort ? "selected" : ""}>${v}</option>`).join("")}</select></label>
      ${meta([[IC.dice, st.games.length + " " + BH.plural(st.games.length, "игра", "игры", "игр")], [IC.cards, st.played + " " + BH.plural(st.played, "партия", "партии", "партий")], st.time && [IC.clock, BH.fmtDuration(st.time), "За столом"]])}
      ${st.games.some(e => e.best !== null) ? `<p class="tiny muted">Справа — лучший и средний счёт.</p>` : ""}
      <div class="pc-games">${list.map((e, i) => { const g = BH.game(e.gameId); return `<a class="pc-game" href="${g ? "#/games/" + esc(g.id) : "#/games"}">
        ${coverOf(g)}
        <span class="t"><span class="pc-g1"><i class="rank">${i + 1}</i><b>${esc(nameOf(e))}</b></span>
          ${meta([[IC.trophy, e.wins + " из " + e.n + " " + BH.plural(e.n, "партии", "партий", "партий"), "Побед из сыгранных партий", e.wins ? "win" : ""], [IC.chart, Math.round(100 * e.rate) + "%", "Процент побед"]], "plain")}</span>
        ${e.best !== null ? `<span class="pl-best" title="Лучший счёт и средний"><b>${e.best}</b><small>ср. ${e.avg}</small></span>` : ""}
      </a>`; }).join("")}</div>`;
  }
  function viewPlaces() {
    const fin = finishedSessions();
    return `<div class="stack">
      <div>${backSmart("#/menu", "Меню")}<div class="page-head"><div><h1>Места</h1><p class="sub">Где вы играете — для статистики.</p></div></div></div>
      <section class="panel">
        <div class="list">${S().places.length ? S().places.slice().sort((a, b) => fin.filter(x => x.placeId === b.id).length - fin.filter(x => x.placeId === a.id).length).map(p => { const n = fin.filter(x => x.placeId === p.id).length; return `<a class="item menu-row" href="#/places/${esc(p.id)}"><span class="menu-ic">${IC.pin}</span><div class="t"><b>${esc(p.name)}</b>${meta([[IC.cards, n ? n + " " + BH.plural(n, "партия", "партии", "партий") : "ещё не играли", "Сыграно партий"]], "plain")}</div><span class="menu-chev">${IC.chev}</span></a>`; }).join("") : `<p class="muted small" style="padding:8px 0">Мест пока нет.</p>`}</div>
        <form class="row" data-form="add-place" style="margin-top:8px"><input class="input" name="name" placeholder="Новое место" maxlength="40" aria-label="Новое место"><button class="btn" type="submit">Добавить</button></form>
      </section>
    </div>`;
  }

  /* a place's page: its numbers, the games played there, the sessions; rename or delete it */
  let plcard = { id: null, tab: "stats", period: "all" }, editPlace = null;
  function viewPlace(pl) {
    const fin = finishedSessions().filter(x => x.placeId === pl.id);
    if (plcard.id !== pl.id) plcard = { id: pl.id, tab: fin.length ? "stats" : "sessions", period: plcard.period, psort: plcard.psort };
    const years = [...new Set(fin.map(x => new Date(BH.sessionDate(x)).getFullYear()))].sort((a, b) => b - a);
    const opts = Object.assign({}, PERIODS); for (const y of years) opts["y" + y] = y + " год";
    if (!(plcard.period in opts)) plcard.period = "all";
    const st = BH.placeStats(pl.id, fin.filter(x => inPeriod(x, plcard.period)));
    const live = S().sessions.filter(x => x.placeId === pl.id && x.status !== "finished");
    const used = S().sessions.some(x => x.placeId === pl.id);
    const parties = n => n + " " + BH.plural(n, "партия", "партии", "партий");
    const tabs = [["stats", "Статистика"], ["games", "Игры"], ["sessions", "Партии"]];
    const period = fin.length ? `<label class="small muted pc-sort">Период<select class="input" data-act="pl-period" aria-label="Период">${Object.entries(opts).map(([k, v]) => `<option value="${k}" ${k === plcard.period ? "selected" : ""}>${v}</option>`).join("")}</select></label>` : "";
    const none = `<p class="muted small">${fin.length ? "За этот период партий нет." : "Здесь ещё не играли."}</p>`;
    let body;
    if (plcard.tab === "games") body = period + (st.games.length ? `<div class="pc-games">${st.games.map((e, i) => { const g = BH.game(e.gameId); return `<a class="pc-game" href="${g ? "#/games/" + esc(g.id) : "#/games"}">${coverOf(g)}
        <span class="t"><span class="pc-g1"><i class="rank">${i + 1}</i><b>${esc(g ? g.name : e.gameId)}</b></span>
          ${meta([[IC.cards, parties(e.n), "Партий здесь"], [IC.cal, rowDate(e.last), "Последняя партия: " + BH.fmtDate(e.last)]], "plain")}</span></a>`; }).join("")}</div>` : none);
    else if (plcard.tab === "sessions") body = (live.length ? `<section class="panel"><div class="sec-h"><h2>Идут сейчас</h2><span class="badge accent">${live.length}</span></div><div class="list">${live.map(x => sessionLine(x, { noPlace: true })).join("")}</div></section>` : "")
      + period + (st.sessions.length ? `<section class="panel"><div class="list">${st.sessions.map(x => sessionLine(x, { noPlace: true })).join("")}</div></section>` : none);
    else body = period + (st.played ? (() => {
      const top = st.players[0], fav = st.games[0], fg = fav && BH.game(fav.gameId);
      const kpi = (v, label) => `<div class="kpi"><b>${v}</b><span>${label}</span></div>`;
      const line = (label, v) => v ? `<div class="pc-line"><span>${label}</span><b>${v}</b></div>` : "";
      const hours = ms => ms >= 3600000 ? (ms / 3600000).toFixed(1).replace(".", ",") + " ч" : BH.fmtDuration(ms);
      return `<div class="kpis">
          ${kpi(st.played, BH.plural(st.played, "партия", "партии", "партий"))}
          ${kpi(st.games.length, BH.plural(st.games.length, "игра", "игры", "игр"))}
          ${kpi(st.players.length, BH.plural(st.players.length, "игрок", "игрока", "игроков"))}
          ${st.time ? kpi(hours(st.time), "за столом") : ""}
        </div>
        <section class="panel">
          ${line("Любимая игра здесь", fav ? two(esc(fg ? fg.name : fav.gameId), parties(fav.n)) : "")}
          ${line("Чаще всех побеждает", top && top.wins ? two(esc((BH.player(top.id) || { name: "?" }).name), top.wins + " " + BH.plural(top.wins, "победа", "победы", "побед")) : "")}
          ${line("Первая партия", BH.fmtDate(st.first))}
          ${line("Последняя партия", BH.fmtDate(st.last))}
        </section>
        <section class="panel"><h2 style="margin-bottom:8px">Игроки</h2>${st.players.length > 1 ? prSortBar("place", plcard.psort || "wins", ["wins", "rate"]) : ""}<div class="list">${playersRateList(sortPlayers(st.players, plcard.psort || "wins"), false)}</div></section>`;
    })() : none);
    return `<div class="stack">
      <div class="shead">
        ${topline(backSmart("#/places", "Места"), editPlace === pl.id ? "" : `<button class="btn ghost sm" data-act="edit-place" data-id="${esc(pl.id)}">${I.edit}Изменить</button>`)}
        <section class="obj-head">
          <span class="place-ic">${IC.pin}</span>
          <div class="obj-t"><h1>${esc(pl.name)}</h1>${fin.length ? meta([[IC.cards, parties(fin.length), "Сыграно партий"]]) : `<p class="sub muted">Здесь ещё не играли</p>`}</div>
        </section>
      </div>
      ${editPlace === pl.id ? `<form class="panel stack" data-form="edit-place" data-id="${esc(pl.id)}">
          <label class="field">Название<input class="input" name="name" value="${esc(pl.name)}" maxlength="40" required></label>
          <div class="actions"><button class="btn primary" type="submit">Сохранить</button><button class="btn" type="button" data-act="edit-place" data-id="">Отмена</button>
            ${used ? `<span class="small muted">Место есть в партиях, поэтому его не удалить.</span>` : `<button class="btn ghost" type="button" data-act="del-place" data-id="${esc(pl.id)}">${I.trash}Удалить</button>`}</div>
        </form>` : ""}
      <div class="seg pc-tabs" role="group" aria-label="Разделы места">${tabs.map(([k, v]) => `<button type="button" data-act="pl-tab" data-tab="${k}" aria-pressed="${plcard.tab === k}">${v}</button>`).join("")}</div>
      ${body}
    </div>`;
  }

  /* ---------- stats ---------- */
  let statsGame = "";
  function viewStats() {
    const fin = S().sessions.filter(s => s.status === "finished" && (!statsGame || s.gameId === statsGame));
    const hours = fin.reduce((a, s) => a + (s.finishedAt && s.startedAt ? s.finishedAt - s.startedAt : 0), 0);
    const games = new Set(fin.map(s => s.gameId));
    const ppl = S().players.map(p => {
      const mine = fin.filter(s => s.players.includes(p.id));
      const wins = mine.filter(s => s.winners.includes(p.id)).length;
      const g0 = statsGame ? BH.playerStats(p.id, fin).games[0] : null, best = g0 && g0.best !== null ? g0.best : "—";   // one game: lowest wins where it should
      return { p, played: mine.length, wins, rate: mine.length ? wins / mine.length : 0, best };
    }).filter(x => x.played).sort((a, b) => b.wins - a.wins || b.rate - a.rate || b.played - a.played);
    const byGame = BH.games.map(g => ({ g, n: fin.filter(s => s.gameId === g.id).length, last: fin.filter(s => s.gameId === g.id).reduce((m, s) => Math.max(m, s.finishedAt || 0), 0) })).filter(x => x.n);
    const byPlace = [...S().places, { id: null, name: "Не указано" }].map(p => ({ p, n: fin.filter(s => (s.placeId || null) === p.id).length })).filter(x => x.n);
    const opts = `<option value="">Все игры</option>${BH.games.map(g => `<option value="${g.id}" ${g.id === statsGame ? "selected" : ""}>${esc(g.name)}</option>`).join("")}`;
    return `<div class="stack">
      <div>${backSmart("#/menu", "Меню")}<div class="page-head"><div><h1>Статистика</h1><p class="sub">По завершённым партиям.</p></div></div></div>
      <label class="small muted pc-sort">Игра<select class="input" data-act="stats-game" aria-label="Игра">${opts}</select></label>
      <div class="kpis">
        <div class="kpi"><b>${fin.length}</b><span>${BH.plural(fin.length, "партия", "партии", "партий")}</span></div>
        <div class="kpi"><b>${games.size}</b><span>${BH.plural(games.size, "игра", "игры", "игр")}</span></div>
        <div class="kpi"><b>${(hours / 3600000).toFixed(1).replace(".", ",")}</b><span>часов за столом</span></div>
        <div class="kpi"><b>${fin.reduce((a, s) => a + s.rounds.length, 0)}</b><span>раундов</span></div>
      </div>
      ${fin.length ? `
      <section class="panel"><h2 style="margin-bottom:6px">Игроки</h2><div class="scroll-x"><table class="tbl">
        <thead><tr><th>Игрок</th><th>Партий</th><th>Побед</th><th>% побед</th>${statsGame ? "<th>Лучший счёт</th>" : ""}</tr></thead>
        <tbody>${ppl.map(x => `<tr><td><span class="row">${BH.avatar(x.p, "sm")}${esc(x.p.name)}</span></td><td>${x.played}</td><td>${x.wins}</td><td>${Math.round(100 * x.rate)}%<span class="meter"><i style="width:${Math.round(100 * x.rate)}%"></i></span></td>${statsGame ? `<td>${x.best}</td>` : ""}</tr>`).join("")}</tbody></table></div></section>
      <div class="cols">
        <section class="panel"><h2 style="margin-bottom:6px">Игры</h2><table class="tbl"><thead><tr><th>Игра</th><th>Партий</th><th>Последняя</th></tr></thead>
          <tbody>${byGame.map(x => `<tr><td>${esc(x.g.name)}</td><td>${x.n}</td><td>${x.last ? BH.fmtDate(x.last) : ""}</td></tr>`).join("")}</tbody></table></section>
        <section class="panel"><h2 style="margin-bottom:6px">Места</h2><table class="tbl"><thead><tr><th>Место</th><th>Партий</th></tr></thead>
          <tbody>${byPlace.map(x => `<tr><td>${esc(x.p.name)}</td><td>${x.n}</td></tr>`).join("")}</tbody></table></section>
      </div>` : `<div class="empty">Здесь появятся победы, любимые игры и места, когда вы доиграете первую партию.</div>`}
    </div>`;
  }

  /* ---------- settings ---------- */
  // one settings section per page, reached from the menu (#/settings/sync|voice|theme|backup)
  function viewSettings(sub) {
    const st = S().settings;
    const seg = (key, val, label) => `<button type="button" data-act="set" data-k="${key}" data-v="${val}" aria-pressed="${String(st[key]) === String(val)}">${label}</button>`;
    let body = "";
    if (sub === "sync") body = viewSync();
    else if (sub === "voice") body = viewVoiceSettings();
    else if (sub === "theme") body = `<section class="panel stack"><h2>Оформление</h2>
        <div class="spread"><span>Тема</span><div class="seg">${seg("theme", "auto", "Как в системе")}${seg("theme", "light", "Светлая")}${seg("theme", "dark", "Тёмная")}</div></div>
      </section>`;
    else if (sub === "backup") body = `<section class="panel stack">
        <h2>Копия данных</h2>
        <p class="small muted">Партии и игроки всегда сохраняются на этом устройстве${BH.cloud.cfg ? " и уходят в GitHub" : ""}. Копию в файл можно сохранить на всякий случай или чтобы перенести данные без синхронизации.</p>
        <div class="actions"><button class="btn" data-act="export">Сохранить копию</button>
          <label class="btn">Загрузить из копии<input type="file" accept="application/json,.json" data-act="import" hidden></label></div>
      </section>`;
    else return viewMenu();
    return `<div class="stack"><div>${backSmart("#/menu", "Меню")}</div>${body}</div>`;
  }

  /* ---------- voice assistant: settings ---------- */
  function viewVoiceSettings() {
    const V = BH.voice, st = S().settings, ready = V.ready();
    const seg = (key, val, label) => `<button type="button" data-act="set" data-k="${key}" data-v="${val}" aria-pressed="${String(st[key]) === String(val)}">${label}</button>`;
    return `<section class="panel stack" id="voice-panel">
      <div class="spread"><h2>Голосовой помощник</h2>${ready ? '<span class="badge good">работает</span>' : '<span class="badge">не подключён</span>'}</div>
      <p class="small muted">Спросите голосом во время партии: помощник найдёт ответ в книге правил, покажет короткий ответ и цитату со страницей, а если хотите — ещё и прочитает ответ вслух. Работает через ваш Yandex Cloud и только для вас: доступ даёт синхронизация с GitHub (Меню → Синхронизация).</p>
      ${ready ? "" : `<p class="note info small">${esc(V.why())}</p>`}
      <div class="spread"><span class="small"><b>Озвучивать ответы</b><br><span class="muted">${st.speakAnswers ? "Ответ звучит вслух и виден на экране." : "Ответ только на экране — так дешевле и тише."}</span></span><div class="seg">${seg("speakAnswers", true, "Вкл")}${seg("speakAnswers", false, "Выкл")}</div></div>
      ${st.speakAnswers ? `<label class="field">Голос
        <select class="input" data-act="voice-name">${V.VOICES.map(([id, name]) => `<option value="${id}" ${id === V.voice() ? "selected" : ""}>${name}</option>`).join("")}</select></label>
      <div class="actions"><button class="btn sm" data-act="say-test">${I.speak}Проверить голос</button></div>
      ${ready ? "" : `<p class="tiny muted">Пока помощник не подключён, ответы читает голос телефона${BH.speech.supported ? (BH.speech.hasRussian ? " (русский голос найден)" : " (русского голоса в системе нет)") : " — но этот браузер не умеет читать вслух"}.</p>
        <div class="spread"><span class="small">Скорость голоса телефона</span><div class="seg">${seg("voiceRate", 0.85, "Медленно")}${seg("voiceRate", 1, "Обычно")}${seg("voiceRate", 1.2, "Быстро")}</div></div>`}` : ""}
      <details class="small"><summary style="cursor:pointer;font-weight:600">Адрес функции</summary>
        <form class="row" data-form="voice-url" style="margin-top:8px"><input class="input" name="url" value="${esc(V.url())}" placeholder="https://functions.yandexcloud.net/…" autocapitalize="off" spellcheck="false" aria-label="Адрес функции"><button class="btn sm" type="submit">Сохранить</button></form>
      </details>
    </section>`;
  }

  const MIC = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>`;
  const askButton = g => `<div class="actions"><button class="btn big" data-act="ask-open" data-game="${esc(g.id)}">${MIC}Спросить голосом</button></div>`;

  /* ---------- voice assistant: asking ---------- */
  let ask = null;   // { gameId, sid, phase: listening|thinking|answer|error, text, result, error }
  let rec = null, askCtl = null;
  function situationOf(s) {
    if (!s) return "";
    // no player names: they do not help the answer and need not leave the phone
    const g = BH.game(s.gameId);
    if (BH.isRace(g)) return `идёт игра, игроков ${s.players.length}`;
    if (BH.isEndScored(g)) { const last = g.rounds.count || 8; return `раунд ${Math.min(s.rounds.length + 1, last)} из ${last}, игроков ${s.players.length}, слава считается в конце`; }
    const tot = Object.values(BH.totals(s)), best = tot.length ? Math.max(...tot) : 0;
    return `раунд ${s.rounds.length + 1}, игроков ${s.players.length}, лучший счёт ${best}`;
  }
  function openAsk(gameId, sid) {
    BH.speech.stop();
    BH.clearToast();
    ask = { gameId, sid, phase: "idle", text: "", result: null, error: "" };
    ovOpen();
    if (!BH.voice.ready()) { ask.phase = "error"; ask.error = BH.voice.why(); renderOverlay(); return; }
    renderOverlay();
    if (BH.voice.canListen) startListening(); else { ask.phase = "type"; renderOverlay(); }
  }
  function startListening() {
    stopListening();
    ask.phase = "listening"; ask.text = ""; ask.error = "";
    renderOverlay();
    rec = BH.voice.listen({
      partial: t => { if (!ask) return; ask.text = t; const el = BH.$("#ask-heard"); if (el) el.textContent = t || "Слушаю…"; },
      error: m => { if (!ask) return; ask.phase = "type"; ask.error = m; renderOverlay(); },
      done: t => { rec = null; if (!ask || ask.phase !== "listening") return; if (t) sendAsk(t); else { ask.phase = "type"; renderOverlay(); } },
    });
  }
  function stopListening() { if (rec) { try { rec.abort(); } catch (e) {} rec = null; } }
  async function sendAsk(question) {
    question = String(question || "").trim().slice(0, 400);
    if (!question || !ask) return;
    ask.text = question; ask.phase = "thinking"; ask.error = "";
    renderOverlay();
    if (askCtl) askCtl.abort();
    const ctl = askCtl = new AbortController();
    try {
      const s = ask.sid ? BH.session(ask.sid) : null;
      const r = await BH.voice.ask(ask.gameId, question, situationOf(s), ctl.signal);
      if (!ask || ctl !== askCtl) return;
      ask.phase = "answer"; ask.result = r;
      renderOverlay();
      if (!BH.voice.speaks()) return;                  // reading aloud is off in the settings: text only
      if (r.audio) { BH.voice.remember(r.answer, r.audio); BH.voice.play(r.audio).catch(() => {}); }
      else if (r.answer) BH.speech.speak(r.answer);   // e.g. "nothing in the rules": spoken once, then from the device cache
    } catch (e) {
      if (!ask || ctl !== askCtl || (e && e.name === "AbortError")) return;
      // no connection: fall back to the cheat sheet on the device
      const g = BH.game(ask.gameId), hits = g ? BH.searchRules(g, question).slice(0, 3) : [];
      ask.phase = "error"; ask.error = e.message; ask.local = hits;
      renderOverlay();
    }
  }
  function closeAsk() { stopListening(); if (askCtl) askCtl.abort(); askCtl = null; BH.voice.stopAudio(); ask = null; renderOverlay(); }

  function askHTML() {
    const a = ask, r = a.result;
    const mic = `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>`;
    let body = "";
    if (a.phase === "listening") body = `<div class="ask-live"><span class="ask-pulse" aria-hidden="true">${mic}</span><p id="ask-heard" class="ask-heard">${esc(a.text || "Слушаю…")}</p><p class="tiny muted">Говорите спокойно, паузы не страшны. Когда закончите, нажмите «Отправить». Например: «${esc((BH.game(a.gameId) || {}).searchExample || "как считать очки?")}»</p></div>`;
    else if (a.phase === "thinking") body = `<div class="ask-live"><p class="ask-q">«${esc(a.text)}»</p><p class="muted">Ищу в правилах…</p></div>`;
    else if (a.phase === "answer") body = `<p class="ask-q">«${esc(a.text)}»</p>
        <div class="ask-answer ${r.found ? "" : "nf"}">${esc(r.answer)}</div>
        ${r.quote ? `<details class="small"><summary style="cursor:pointer;font-weight:600;color:var(--muted)">Где это в правилах${r.page ? `: стр. ${esc(r.page)}` : ""}</summary><blockquote class="ask-quote" style="margin-top:8px">${esc(r.quote)}${r.page ? `<cite>Стр. ${esc(r.page)} в книге правил</cite>` : ""}</blockquote></details>` : ""}
        ${r.ref && (BH.game(a.gameId) || { rules: [] }).rules.some(x => x.id === r.ref) ? `<button type="button" class="btn ghost sm" data-act="ask-rule" data-id="${esc(r.ref)}">${I.book}Раздел правил: ${esc(BH.game(a.gameId).rules.find(x => x.id === r.ref).title)}</button>` : ""}
        ${r.ttsError && BH.voice.speaks() ? `<p class="tiny muted">Ответ не озвучен: ${esc(r.ttsError)}</p>` : ""}
        ${r.fromDevice ? `<p class="tiny muted">Этот вопрос уже задавали — ответ сохранён, бесплатно.</p>` : ""}`;
    else if (a.phase === "error") body = `${a.text ? `<p class="ask-q">«${esc(a.text)}»</p>` : ""}<div class="note">${esc(a.error)}</div>
        ${a.local && a.local.length ? `<p class="small muted">Нашёл в шпаргалке на телефоне:</p>${a.local.map(h => h.kind === "faq" ? `<div class="qa"><b>${esc(h.title)}</b><p>${esc(h.item.a)}</p></div>` : BH.rulesUI.ruleHTML(h.item, a.text, true, BH.game(a.gameId))).join("")}` : ""}`;
    const typing = a.phase === "type" || a.phase === "answer" || (a.phase === "error" && BH.voice.ready());
    const foot = (a.phase === "listening" ? `<button class="btn big" data-act="ask-close">Отмена</button><button class="btn primary big" data-act="ask-stop">${I.check}Отправить</button>` : "") +
      (a.phase === "answer" && r.audio ? `<button class="btn big" data-act="ask-replay" aria-label="Прослушать ещё раз">${I.speak}</button>` : "") +
      (BH.voice.ready() && BH.voice.canListen && a.phase !== "listening" && a.phase !== "thinking" ? `<button class="btn primary big" data-act="ask-again">${mic}${a.phase === "answer" ? "Ещё вопрос" : "Сказать"}</button>` : "");
    return `<div class="overlay" data-act="overlay-bg"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="ask-h">
      <div class="sheet-head"><h2 id="ask-h">Вопрос по правилам</h2><button class="icon-btn" data-act="ask-close" aria-label="Закрыть">${I.x}</button></div>
      <div class="sheet-body">
        ${a.phase === "type" && a.error ? `<div class="note">${esc(a.error)}</div>` : ""}
        ${body}
        ${typing ? `<form class="row" data-form="ask"><input class="input" name="q" maxlength="400" placeholder="Или напишите вопрос" value="${a.phase === "type" ? esc(a.text) : ""}" aria-label="Вопрос"><button class="btn" type="submit">Спросить</button></form>` : ""}
      </div>
      ${foot ? `<div class="sheet-foot">${foot}</div>` : ""}
    </div></div>`;
  }

  /* ---------- sync ---------- */
  let syncMsg = "";   // result of the last connect attempt, shown under the form
  let wheelTokenBad = false;   // the token taken from «Колесо недели» was refused: ask for a new one
  function viewSync() {
    const C = BH.cloud, c = C.cfg;
    if (c) return `<section class="panel stack" id="sync-panel">
        <div class="spread"><h2>Синхронизация</h2><span class="badge good">включена</span></div>
        <p class="small">Репозиторий <b>${esc(c.owner)}/${esc(c.repo)}</b>, файл ${esc(BHSync.FILE)}. Данные зашифрованы вашим паролем.</p>
        <p class="small ${C.status.state === "error" ? "" : "muted"}" id="sync-status" role="status">${esc(C.label())}</p>
        <div class="actions"><button class="btn sm" data-act="sync-now">Синхронизировать сейчас</button><button class="btn ghost sm" data-act="sync-off">Отключить на этом устройстве</button></div>
      </section>`;
    const w = C.wheelCfg();
    const manual = `<form class="stack" data-form="sync" autocomplete="off">
        <details class="small"><summary style="cursor:pointer;font-weight:600">Как подготовить GitHub</summary>
          <ol style="margin:8px 0 0;padding-left:20px;display:flex;flex-direction:column;gap:4px">
            <li>Нужен закрытый (Private) репозиторий. Подойдёт тот же <b>koleso-data</b>, что у «Колеса недели»: данные помощника лягут в отдельный файл.</li>
            <li>Нужен токен: <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">создать на GitHub</a> (Settings → Developer settings → Personal access tokens → <b>Fine-grained tokens</b>). Repository access — <b>Only select repositories</b> → этот репозиторий, Permissions → <b>Contents: Read and write</b>, срок — например, год. Подойдёт и рабочий токен от «Колеса недели».</li>
            <li>На всех устройствах — один репозиторий и один пароль шифрования.</li>
          </ol></details>
        <label class="field">Имя на GitHub<input class="input" name="owner" required placeholder="например, PlayWithMao" value="${esc(w ? w.owner : "")}" autocapitalize="off" spellcheck="false"></label>
        <label class="field">Репозиторий<input class="input" name="repo" required value="${esc(w ? w.repo : "koleso-data")}" autocapitalize="off" spellcheck="false"></label>
        <label class="field">Токен доступа<input class="input" name="token" type="password" required placeholder="github_pat_…" autocomplete="off"></label>
        ${w && w.pass ? `<label class="check" style="font-weight:500"><input type="checkbox" name="same" data-act="sync-same" data-target="own-pass-m" checked> Тот же пароль шифрования, что в колесе</label>` : ""}
        <div class="stack" id="own-pass-m" ${w && w.pass ? "hidden" : ""}>
          <label class="field">Пароль шифрования<input class="input" name="pass" type="password" minlength="8" placeholder="не меньше 8 символов" autocomplete="new-password"></label>
          <label class="field">Повторите пароль<input class="input" name="pass2" type="password" placeholder="нужно только на первом устройстве" autocomplete="new-password"></label>
        </div>
        <div><button class="btn primary" type="submit">Подключить</button></div>
      </form>`;
    return `<section class="panel stack" id="sync-panel">
      <h2>Синхронизация</h2>
      <p class="small muted">Партии и игроки шифруются на устройстве вашим паролем и хранятся в закрытом репозитории на GitHub. Без интернета всё сохраняется на устройстве и отправляется само, когда связь появится. Так данные видны и на телефоне, и на ПК.</p>
      ${w ? `<form class="stack" data-form="sync-wheel" autocomplete="off">
          <div class="note good">На этом устройстве подключено «Колесо недели»: <b>${esc(w.owner)}/${esc(w.repo)}</b>. Можно взять это подключение — новый токен не нужен.</div>
          ${w.pass ? `<label class="check" style="font-weight:500"><input type="checkbox" name="same" data-act="sync-same" data-target="own-pass" checked> Тот же пароль шифрования, что в колесе</label>` : ""}
          <div class="stack" id="own-pass" ${w.pass ? "hidden" : ""}>
            <label class="field">Пароль шифрования для настолок<input class="input" name="pass" type="password" minlength="8" placeholder="не меньше 8 символов" autocomplete="new-password"></label>
            <label class="field">Повторите пароль<input class="input" name="pass2" type="password" placeholder="нужно только на первом устройстве" autocomplete="new-password"></label>
          </div>
          <div><button class="btn primary" type="submit">Подключить</button></div>
        </form>
        <details ${wheelTokenBad ? "open" : ""}><summary class="small" style="cursor:pointer;font-weight:600">${wheelTokenBad ? "Ввести новый токен" : "Подключить другой репозиторий или токен"}</summary><div style="margin-top:12px">${manual}</div></details>` : manual}
      <p class="small" id="sync-status" role="status">${esc(syncMsg)}</p>
      <p class="tiny muted">Токен и пароль хранятся только на этом устройстве. Пароль запомните: без него данные не расшифровать, восстановить его нельзя.</p>
    </section>`;
  }

  const CHIP = {
    ok: ["ok", '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>', "сохранено"],
    busy: ["busy", '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v4h-4"/></svg>', "отправляю"],
    pending: ["pending", '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V6M6 11l6-6 6 6"/></svg>', "ждёт связи"],
    local: ["local", '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2"/></svg>', "на телефоне"],
    error: ["error", '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 7v6M12 16.5v.5"/><circle cx="12" cy="12" r="9"/></svg>', "ошибка"],
  };
  function updateSync() {
    const C = BH.cloud, chip = document.getElementById("sync-chip");
    if (chip) {
      if (!C.cfg) chip.hidden = true;
      else {
        const st = C.status.state;
        const offline = st === "offline" || navigator.onLine === false;
        // saved on the phone and waiting for the next key moment is normal, not a problem
        const k = st === "busy" ? "busy" : st === "error" ? "error" : C.pending ? (offline ? "pending" : "local") : st === "ok" || C.status.at ? "ok" : "local";
        const [cls, icon, text] = CHIP[k];
        chip.hidden = false;
        chip.className = "sync-chip " + cls;
        chip.innerHTML = icon + "<span>" + text + "</span>";
        chip.title = C.label();
        chip.setAttribute("aria-label", "Синхронизация: " + C.label());
      }
    }
    const el = document.getElementById("sync-status");
    if (el && C.cfg) el.textContent = C.label();
  }
  BH.cloud.onChange(updateSync);
  BH.onRemoteData = news => { render(); if (news && !BH.cloud.connecting) BH.toast("Пришли изменения с другого устройства"); };

  async function connectSync(form, cfg, pass2) {
    const btn = form.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    syncMsg = "Проверяю репозиторий и пароль…";
    const el = document.getElementById("sync-status"); if (el) el.textContent = syncMsg;
    const fixWheel = cfg.fixWheel; delete cfg.fixWheel;
    try {
      const r = await BH.cloud.connect(cfg, pass2);
      const fixed = fixWheel && BH.cloud.updateWheelToken(cfg.token);
      syncMsg = ""; wheelTokenBad = false;
      render();
      BH.toast((r.firstDevice ? "Синхронизация включена, данные отправлены" : "Синхронизация включена, данные объединены") + (fixed ? ". Токен в колесе тоже обновлён" : ""));
    } catch (err) {
      syncMsg = "Не получилось: " + ((err && err.message) || String(err));
      if (err && err.code === "auth" && form.dataset.form === "sync-wheel") {
        // the wheel's own token is dead, so the wheel on this phone is not syncing either
        wheelTokenBad = true;
        syncMsg = "GitHub не принял токен из найденного подключения «Колеса недели». Если колесо у вас работает, это старая запись с его прежнего адреса, а сейчас колесо живёт на другом сайте, и его настоящее подключение отсюда не видно. Вставьте рабочий токен в форму ниже: имя и репозиторий уже подставлены.";
        render();
        return;
      }
      if (btn) btn.disabled = false;
      const e2 = document.getElementById("sync-status"); if (e2) e2.textContent = syncMsg;
    }
  }

  /* ---------- overlays: round sheet and dialogs ---------- */
  function renderOverlay() {
    if (ask && !dialog) {
      const scroll = overlayRoot.querySelector(".sheet-body"), top = scroll ? scroll.scrollTop : 0;
      overlayRoot.innerHTML = askHTML();
      const body = overlayRoot.querySelector(".sheet-body"); if (body) body.scrollTop = top;
      BH.assets.hydrate(overlayRoot);
      return;
    }
    if (dialog) {
      overlayRoot.innerHTML = `<div class="overlay" data-act="overlay-bg"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="dlg-h" style="max-width:460px">
        <div class="sheet-head"><h2 id="dlg-h">${esc(dialog.title)}</h2></div>
        <div class="sheet-body">${dialog.html || `<p>${esc(dialog.text)}</p>`}${dialog.choices ? `<div class="list dlg-choices">${dialog.choices.map((c, i) => `<button type="button" class="item dlg-choice" data-act="dlg-choice" data-i="${i}" aria-pressed="${!!c.current}"><div class="t"><b>${esc(c.label)}</b>${c.sub ? `<span class="small muted">${esc(c.sub)}</span>` : ""}</div>${c.current ? I.check : ""}</button>`).join("")}</div>` : ""}</div>
        <div class="sheet-foot" style="flex-direction:column">${dialog.buttons.map((b, i) => `<button class="btn ${b.primary ? "primary" : b.danger ? "danger" : ""} big block" data-act="dlg" data-i="${i}">${esc(b.label)}</button>`).join("")}</div>
      </div></div>`;
      const f = overlayRoot.querySelector(".btn.primary") || overlayRoot.querySelector(".btn"); if (f) f.focus();
      if (dialog.html) BH.assets.hydrate(overlayRoot);
      return;
    }
    if (!sheet) { overlayRoot.innerHTML = ""; setTimeout(ovSync, 0); return; }   // after a navigation in the same tick, ovSync sees nothing to undo
    const scroll = overlayRoot.querySelector(".sheet-body");
    const top = scroll ? scroll.scrollTop : 0;
    overlayRoot.innerHTML = sheetHTML();
    const body = overlayRoot.querySelector(".sheet-body"); if (body) body.scrollTop = top;
  }
  const openDialog = d => { dialog = d; BH.clearToast(); ovOpen(); renderOverlay(); };
  const closeDialog = () => { dialog = null; renderOverlay(); };

  /* a game counted by discs in zones for each side (crokinole): one entry per side, the round settled between the sides */
  const sideRaw = (e, Z) => (e.manual !== null && e.manual !== undefined && e.manual !== "" ? Math.max(0, Math.round(Number(e.manual)) || 0) : Z.zones.reduce((a, z) => a + z.z * (e.counts[z.z] || 0), 0));
  function openSidesSheet(s, index) {
    const editing = index !== null && index !== undefined && s.rounds[index], entries = {};
    for (const sd of BH.sidesOf(s)) {
      const d = editing && s.rounds[index].detail && s.rounds[index].detail[sd[0]];
      entries[sd[0]] = { counts: Object.assign({}, (d && d.sel && d.sel.counts) || {}), manual: d && d.manual !== null && d.manual !== undefined ? String(d.manual) : null };
    }
    sheet = { kind: "sides", sid: s.id, index: editing ? index : null, entries, open: null };
    BH.clearToast(); ovOpen(); renderOverlay();
  }
  // what the round gives: the line under the sides
  function sidesResult(s, g) {
    const ctx = BH.ctxOf(s), Z = g.sideScore, sides = BH.sidesOf(s), raws = sides.map(sd => sideRaw(sheet.entries[sd[0]], Z)), got = Z.settle(raws, ctx);
    const nm = sd => sd.map(id => (BH.player(id) || { name: "?" }).name).join(" и ");
    const winner = got[0] === got[1] ? -1 : got[0] > got[1] ? 0 : 1;
    const text = winner < 0 ? (got[0] ? `Поровну — по ${got[0]}` : "Поровну — очков никто не получает")
      : `${nm(sides[winner])} ${sides[winner].length > 1 ? "получают" : "получает"} +${got[winner]}` + (got[1 - winner] ? `, ${nm(sides[1 - winner])} +${got[1 - winner]}` : "");
    return { raws, got, text: `${raws[0]} : ${raws[1]} — ${text}` };
  }
  function sidesSheetHTML() {
    const s = BH.session(sheet.sid), g = BH.game(s.gameId), ctx = BH.ctxOf(s), Z = g.sideScore, max = Z.discs(ctx);
    const idx = sheet.index !== null ? sheet.index : s.rounds.length, sides = BH.sidesOf(s), res = sidesResult(s, g);
    const leader = BH.player(BH.leaderAt(s, idx));
    const body = sides.map((sd, i) => {
      const e = sheet.entries[sd[0]], ps = sd.map(id => BH.player(id) || { name: "?", color: "#888" });
      const used = Z.zones.reduce((a, z) => a + (e.counts[z.z] || 0), 0), typed = e.manual !== null && e.manual !== "";
      return `<div class="entry open side-entry" data-entry="${sd[0]}">
        <div class="entry-head">${ps.length > 1 ? `<span class="faces pair-faces">${ps.map(x => BH.avatar(x, "sm")).join("")}</span>` : BH.avatar(ps[0], "sm")}
          <span class="nm">${esc(ps.map(x => x.name).join(" и "))}</span>
          <input class="input score-in" type="number" inputmode="numeric" min="0" step="5" data-act="side-manual" data-p="${sd[0]}" value="${typed ? esc(e.manual) : ""}" placeholder="${res.raws[i]}" aria-label="Очки в кольцах: ${esc(ps.map(x => x.name).join(" и "))}">
        </div>
        <div class="zones${typed ? " off" : ""}">${Z.zones.map(z => { const n = e.counts[z.z] || 0; return `<div class="zone-row">
          <span class="zone-l"><b>${esc(z.label)}</b>${z.hint ? `<small>${esc(z.hint)}</small>` : ""}</span>
          <span class="cnt-step"><button type="button" class="step-btn" data-act="side-count" data-p="${sd[0]}" data-z="${z.z}" data-d="-1" ${n ? "" : "disabled"} aria-label="Меньше: ${esc(z.label)}">−</button><b class="num">${n}</b><button type="button" class="step-btn" data-act="side-count" data-p="${sd[0]}" data-z="${z.z}" data-d="1" ${used >= max ? "disabled" : ""} aria-label="Больше: ${esc(z.label)}">+</button></span>
          <span class="zone-pts num">${n * z.z}</span></div>`; }).join("")}</div>
        <p class="small muted">${typed ? "Очки вписаны вручную — диски не считаются." : `Дисков в центре и кольцах: ${used} из ${max}`}</p>
      </div>`;
    }).join("");
    return `<div class="overlay" data-act="overlay-bg"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-h">
      <div class="sheet-head"><div class="sheet-t"><h2 id="sheet-h">${sheet.index !== null ? "Исправить раунд " + (idx + 1) : "Раунд " + (idx + 1)}</h2>${leader ? `<span class="mi accent">${BH.avatar(leader, "xs")}<span>${esc((g.rounds.leaderLabel || "Начинал") + ": " + leader.name)}</span></span>` : ""}</div>
        <div class="row" style="gap:4px">${sheet.index !== null ? `<button class="icon-btn danger-ic" data-act="delete-round" aria-label="Удалить раунд" title="Удалить раунд">${I.trash}</button>` : ""}<button class="icon-btn" data-act="close-sheet" aria-label="Закрыть">${I.x}</button></div></div>
      <div class="sheet-body">
        <p class="small muted">Посчитайте диски каждой стороны в центре и кольцах. Или впишите очки справа.</p>
        ${body}
      </div>
      <div class="sheet-foot side-foot">
        <p class="side-result" id="side-result" aria-live="polite">${esc(res.text)}</p>
        <button class="btn primary big" data-act="save-round">${I.check}Сохранить</button>
      </div>
    </div></div>`;
  }
  function saveSidesRound() {
    const s = BH.session(sheet.sid), g = BH.game(s.gameId), sides = BH.sidesOf(s), res = sidesResult(s, g);
    const idx = sheet.index !== null ? sheet.index : s.rounds.length;
    const round = { at: Date.now(), leader: BH.leaderAt(s, idx), scores: {}, detail: {}, flags: {} };
    sides.forEach((sd, i) => {
      const e = sheet.entries[sd[0]], counts = {};
      for (const [k, v] of Object.entries(e.counts)) if (v) counts[k] = v;
      // stored the way normalize stores it, so a sync sees no false difference
      const sel = Object.keys(counts).length ? { picks: {}, flags: {}, counts } : { picks: {}, flags: {} };
      for (const id of sd) { round.scores[id] = res.got[i]; round.detail[id] = { sel, manual: e.manual === null || e.manual === "" ? null : Math.max(0, Math.round(Number(e.manual)) || 0) }; round.flags[id] = { bust: false, flip7: false }; }
    });
    const isNew = sheet.index === null;
    if (isNew) s.rounds.push(round); else { round.at = s.rounds[idx].at; s.rounds[idx] = round; }
    sheet = null; BH.saveNow(); afterRoundChange(s, isNew);
  }
  function openSheet(s, index) {
    const g = BH.game(s.gameId);
    if (g.sideScore) return openSidesSheet(s, index);
    const editing = index !== null && index !== undefined && s.rounds[index];
    const entries = {};
    for (const id of s.players) {
      const d = editing && s.rounds[index].detail && s.rounds[index].detail[id];
      entries[id] = d ? JSON.parse(JSON.stringify(d)) : { sel: { picks: {}, flags: {} }, manual: g.calc ? null : 0 };
      if (editing && !d) entries[id].manual = s.rounds[index].scores[id] || 0;
    }
    sheet = { sid: s.id, index: editing ? index : null, entries, open: g.calc ? s.players[0] : null };
    BH.clearToast();
    ovOpen();
    renderOverlay();
    const first = overlayRoot.querySelector(".sheet-body button, .sheet-body input"); if (first) first.focus({ preventScroll: true });
  }

  function entryResult(g, s, e) {
    const ctx = BH.ctxOf(s);
    const calc = BH.calcScore(g, e.sel, ctx);
    // a bust is 0 whatever was typed (a game may score a bust otherwise, e.g. the brutal mode of Flip 7: With A Vengeance)
    if (e.sel.flags && e.sel.flags.bust) return Object.assign({}, calc, { score: calc.bustScore !== undefined ? calc.bustScore : 0, bust: true });
    if (e.manual !== null && e.manual !== undefined && e.manual !== "") {
      const fl = e.sel.flags || {}, extra = g.calc && g.calc.flags ? g.calc.flags.filter(f => f.id !== "bust" && fl[f.id] && (!f.when || f.when(ctx))) : [];
      return { score: Math.round(Number(e.manual)) || 0, manual: true, notes: [extra.length ? "введено вручную — отметки «" + extra.map(f => f.label).join("», «") + "» не учтены, впишите итог с ними" : "введено вручную"] };
    }
    return calc;
  }

  function openEndSheet(s) {
    const g = BH.game(s.gameId), e = g.endScore, entries = {};
    const v = x => (x === null || x === undefined ? "" : String(x));
    for (const id of s.players) {
      const d = (s.finalDetail && s.finalDetail[id]) || {};
      entries[id] = { cards: Array.from({ length: e.rows }, (_, i) => v(d.cards ? d.cards[i] : null)), tie: v(d.tie) };
      for (const x of e.extra || []) entries[id][x.id] = v(d[x.id]);
    }
    sheet = { kind: "end", sid: s.id, entries, open: s.players[0] };
    BH.clearToast(); ovOpen(); renderOverlay();
  }
  const pname = id => (BH.player(id) || { name: "?" }).name;
  // a game stopped before its last round: fewer cards, so the checks of a full game do not apply
  const endOpts = (s, g) => ({ partial: s.rounds.length < ((g.rounds && g.rounds.count) || 0) });
  // the parts of the sheet that change while typing, without redrawing (the cursor stays where it is)
  function endLive() {
    const s = BH.session(sheet.sid), g = BH.game(s.gameId), e = g.endScore, res = BH.endWinners(g, s.players, sheet.entries);
    const cells = e.rows + (e.extra || []).length;
    for (const id of s.players) {
      const d = sheet.entries[id], f = BH.endFilled(g, d), probs = BH.endProblems(g, d, endOpts(s, g));
      const t = overlayRoot.querySelector(`[data-tot="${id}"]`); if (t) { t.textContent = res.totals[id]; t.classList.toggle("lead", res.winners.includes(id) && f > 0); }
      const fl = overlayRoot.querySelector(`[data-fill="${id}"]`); if (fl) fl.textContent = f < cells ? `вписано ${f} из ${cells}` : "всё вписано";
      const pr = overlayRoot.querySelector(`[data-probs="${id}"]`); if (pr) { pr.hidden = !probs.length; pr.innerHTML = probs.map(esc).join("<br>"); }
    }
    const tn = overlayRoot.querySelector("#end-tie");
    if (tn) {
      const any = s.players.some(id => BH.endFilled(g, sheet.entries[id]));
      tn.hidden = !any || !(res.tieOpen.length || res.byTie);
      tn.className = "note " + (res.byTie ? "good" : "");
      tn.textContent = res.tieOpen.length ? `Слава равная у: ${res.winners.map(pname).join(", ")}. Впишите им «${e.tie.label}» — побеждает меньшее число.`
        : res.byTie ? `Слава равная — побеждает ${res.winners.map(pname).join(", ")}: «${e.tie.label}» меньше.` : "";
    }
  }
  function endSheetHTML() {
    const s = BH.session(sheet.sid), g = BH.game(s.gameId), e = g.endScore;
    const res = BH.endWinners(g, s.players, sheet.entries), cells = e.rows + (e.extra || []).length;
    const body = s.players.map((id, i) => {
      const p = BH.player(id) || { name: "?", color: "#888" }, d = sheet.entries[id], open = sheet.open === id;
      const f = BH.endFilled(g, d), probs = BH.endProblems(g, d, endOpts(s, g));
      const row = (label, hint, key, value) => `<label class="end-row"><span class="end-l"><b>${esc(label)}</b>${hint ? `<small>${esc(hint)}</small>` : ""}</span><input class="input score-in" type="number" inputmode="numeric" min="0" step="1" data-act="end-in" data-p="${id}" data-k="${key}" value="${esc(value)}" placeholder="0" aria-label="${esc(p.name + ": " + label)}"></label>`;
      const rows = !open ? "" : Array.from({ length: e.rows }, (_, j) => e.rows - j).map(k => row(e.rowLabel(k), e.rowHint ? e.rowHint(k) : "", "c" + (k - 1), d.cards[k - 1])).join("")
        + (e.extra || []).map(x => row(x.label, x.hint, x.id, d[x.id])).join("")
        + (e.tie ? `<div class="end-tie-row">${row(e.tie.label, e.tie.hint, "tie", d.tie)}</div>` : "");
      return `<div class="entry ${open ? "open" : ""}" data-entry="${id}">
        <button type="button" class="end-head" data-act="end-entry" data-p="${id}" aria-expanded="${open}">${BH.avatar(p, "sm")}<span class="nm">${esc(p.name)}</span><span class="end-tot num${res.winners.includes(id) && f ? " lead" : ""}" data-tot="${id}">${res.totals[id]}</span></button>
        <span class="small muted" data-fill="${id}">${f < cells ? `вписано ${f} из ${cells}` : "всё вписано"}</span>
        <div class="note small" data-probs="${id}" ${probs.length ? "" : "hidden"}>${probs.map(esc).join("<br>")}</div>
        ${open ? `<div class="end-rows">${rows}</div>${i < s.players.length - 1 ? `<div class="row" style="justify-content:flex-end"><button type="button" class="btn sm" data-act="end-entry" data-p="${s.players[i + 1]}">Дальше: ${esc(pname(s.players[i + 1]))}</button></div>` : ""}` : ""}
      </div>`;
    }).join("");
    return `<div class="overlay" data-act="overlay-bg"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-h">
      <div class="sheet-head"><div class="sheet-t"><h2 id="sheet-h">Подсчёт славы</h2></div><button class="icon-btn" data-act="close-sheet" aria-label="Закрыть">${I.x}</button></div>
      <div class="sheet-body">
        <details class="note info small end-how"${s.players.some(id => BH.endFilled(g, sheet.entries[id])) ? "" : " open"}><summary>Как считать</summary><ol>${e.steps.map(t => `<li>${fmtStep(t, g.id)}</li>`).join("")}</ol></details>
        ${body}
        <div class="note" id="end-tie" hidden></div>
      </div>
      <div class="sheet-foot"><button class="btn primary big" data-act="end-save">${I.check}Записать итог</button></div>
    </div></div>`;
  }
  function saveEnd() {
    const s = BH.session(sheet.sid), g = BH.game(s.gameId), e = g.endScore;
    const probs = s.players.flatMap(id => BH.endProblems(g, sheet.entries[id], endOpts(s, g)).map(t => pname(id) + ": " + t));
    if (probs.length) { BH.toast("Исправьте: " + probs[0]); return; }
    const cells = e.rows + (e.extra || []).length, scored = s.players.filter(id => BH.endFilled(g, sheet.entries[id]) > 0);
    if (!scored.length) { BH.toast("Впишите славу хотя бы одного игрока"); return; }
    const res = BH.endWinners(g, scored, sheet.entries);
    const commit = winners => {
      const c = fresh(s), n = v => (v === "" || v === null || v === undefined ? null : Number(v));
      c.final = Object.fromEntries(scored.map(id => [id, res.totals[id]]));
      c.finalDetail = Object.fromEntries(scored.map(id => {
        const d = sheet.entries[id], o = { cards: d.cards.map(n) };
        for (const x of e.extra || []) o[x.id] = n(d[x.id]);
        if (e.tie) o.tie = n(d.tie);
        return [id, o];
      }));
      sheet = null; dialog = null;
      finish(c, winners);
    };
    const tieStep = () => {
      if (!res.tieOpen.length) return commit(res.winners);
      openDialog({ title: "Слава равная", text: `Поровну у: ${res.winners.map(pname).join(", ")}. ${g.scoring.tieNote || ""}`, buttons: [
        { label: "Вписать: " + e.tie.label.toLowerCase(), primary: true, run: () => { dialog = null; sheet.open = res.tieOpen[0]; renderOverlay(); } },
        { label: "Записать ничью", run: () => commit(res.winners) }] });
    };
    const empty = s.players.filter(id => BH.endFilled(g, sheet.entries[id]) < cells);
    if (empty.length) {
      const none = s.players.filter(id => !BH.endFilled(g, sheet.entries[id]));
      openDialog({ title: "Не всё вписано", text: `Пустые клетки у: ${empty.map(pname).join(", ")}. Пустая клетка считается нулём.${none.length ? ` У ${none.map(pname).join(", ")} не вписано ничего — без очков в статистике.` : ""}`, buttons: [
        { label: "Записать как есть", primary: true, run: () => { dialog = null; tieStep(); } },
        { label: "Дописать", run: () => { dialog = null; sheet.open = empty[0]; renderOverlay(); } }] });
      return;
    }
    tieStep();
  }

  /* the end of a race (Coconuts): the pyramid in one tap, or the coconuts in each player's cups counted */
  function openRaceEnd(s) {
    const g = BH.game(s.gameId);
    const sc = g.scoring, n = BH.raceGoal(g, s);
    openDialog({ title: sc.goalAsk, text: sc.goalText(n) + (sc.count ? " " + sc.count.hint : ""),
      choices: s.players.map(id => ({ label: pname(id), run: () => { const c = fresh(s); closeDialog(); c.race = { how: sc.goalHow || "goal" }; finish(c, [id]); } })),
      buttons: [
        ...(sc.count ? [{ label: sc.count.button, run: () => { dialog = null; openRaceSheet(s); } }] : []),
        { label: "Продолжить игру", primary: true, run: closeDialog },
        { label: "Удалить партию", danger: true, run: () => confirmDelete(s) }] });
  }
  function openRaceSheet(s) {
    sheet = { kind: "race", sid: s.id, counts: Object.fromEntries(s.players.map(id => [id, ""])), last: null };
    BH.clearToast(); ovOpen(); renderOverlay();
  }
  // who wins by the counts so far: «ready» once every count is in and a tie is settled by who played last
  function raceSheetState(s) {
    const filled = s.players.every(id => sheet.counts[id] !== "" && sheet.counts[id] !== null);
    const { best, top } = BH.raceResult(s.players, sheet.counts), last = top.includes(sheet.last) ? sheet.last : null;
    const names = ids => (ids.length > 1 ? ids.slice(0, -1).map(pname).join(", ") + " и " + pname(ids[ids.length - 1]) : ids.map(pname).join(""));
    const text = !filled ? "Впишите кокосы каждого игрока" : top.length === 1 ? `Больше всех: ${names(top)} — ${best}` : last ? `Поровну по ${best}. Победа по последнему ходу: ${pname(last)}` : `Поровну по ${best} у: ${names(top)}. Чей ход был последним?`;
    return { filled, top, winner: filled ? (top.length === 1 ? top[0] : last) : null, text };
  }
  function raceSheetHTML() {
    const s = BH.session(sheet.sid), g = BH.game(s.gameId), st = raceSheetState(s), max = g.scoring.count.max;
    return `<div class="overlay" data-act="overlay-bg"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-h">
      <div class="sheet-head"><div class="sheet-t"><h2 id="sheet-h">Кокосы кончились</h2></div><button class="icon-btn" data-act="close-sheet" aria-label="Закрыть">${I.x}</button></div>
      <div class="sheet-body">
        <p class="small muted">Посчитайте кокосы в корзинках на планшете каждого игрока.</p>
        ${raceRowsHTML(s.players, g, "counts", sheet.counts, "race-count")}
        <div id="race-tie">${raceTieHTML(st)}</div>
      </div>
      <div class="sheet-foot side-foot">
        <p class="side-result" id="race-result" aria-live="polite">${esc(st.text)}</p>
        <button class="btn primary big" data-act="race-save" ${st.winner ? "" : "disabled"}>${I.check}Записать</button>
      </div>
    </div></div>`;
  }
  function raceRowsHTML(players, g, kind, vals, act) {
    const cups = kind === "cups", max = cups ? g.scoring.goal : g.scoring.count.max, word = cups ? "Корзинки" : "Кокосы";
    return `<div class="race-row race-head"><span></span><span></span><span class="label">${word}</span></div>` + players.map(id => { const p = BH.player(id) || { name: "?", color: "#888" }; return `<div class="race-row">${BH.avatar(p, "sm")}<span class="race-nm">${esc(p.name)}</span>
      <input class="input score-in" type="number" inputmode="numeric" min="0" max="${max}" data-act="${act}" data-p="${id}" value="${esc(vals[id] ?? "")}" placeholder="—" aria-label="${word}: ${esc(p.name)}"></div>`; }).join("");
  }
  // what the numbers typed for a game played before say: who wins by them (a marked winner overrides it)
  // the coconuts of a game played before: who has the most; equal — the chips to mark who of them played last
  function raceDraftResHTML(g) {
    const counts = draft.raceCounts || {}, typed = draft.players.some(id => counts[id] !== undefined && counts[id] !== "");
    if (!typed) return "";
    const { best, top } = BH.raceResult(draft.players, counts), nm = ids => (ids.length > 1 ? ids.slice(0, -1).map(pname).join(", ") + " и " + pname(ids[ids.length - 1]) : ids.map(pname).join(""));
    if (top.length === 1) return `<p class="small race-auto">Больше всех: ${esc(nm(top))} — ${best}. Это победа.</p>`;
    return `<p class="small race-auto">Поровну по ${best}: ${esc(nm(top))}.</p><div class="label" style="margin:10px 0 6px">Чей ход был последним?</div>
      <div class="chips">${top.map(id => `<button class="chip" data-act="draft-race-winner" data-id="${id}" aria-pressed="${draft.winners.includes(id)}">${esc(pname(id))}</button>`).join("")}</div>`;
  }
  // equal counts: who of them played last wins (the rules)
  const raceTieHTML = st => (st.filled && st.top.length > 1 ? `<div class="label" style="margin:12px 0 6px">Чей ход был последним?</div><div class="chips">${st.top.map(id => `<button class="chip" data-act="race-last" data-id="${id}" aria-pressed="${sheet.last === id}">${esc(pname(id))}</button>`).join("")}</div>` : "");
  function sheetHTML() {
    if (sheet.kind === "race") return raceSheetHTML();
    if (sheet.kind === "end") return endSheetHTML();
    if (sheet.kind === "sides") return sidesSheetHTML();
    const s = BH.session(sheet.sid), g = BH.game(s.gameId), ctx = BH.ctxOf(s);
    const idx = sheet.index !== null ? sheet.index : s.rounds.length;
    const results = s.players.map(id => entryResult(g, s, sheet.entries[id]));
    const warns = g.calc && g.calc.roundWarnings ? g.calc.roundWarnings(results, s.players.map(id => sheet.entries[id].sel), ctx) : [];
    const leader = BH.player(BH.leaderAt(s, idx));
    // the player after the open one (the first when none is open): the left button of the foot
    const nextUp = g.calc ? (sheet.open ? s.players[s.players.indexOf(sheet.open) + 1] : s.players[0]) : null;
    const body = s.players.map((id, i) => {
      const p = BH.player(id) || { name: "?", color: "#888" }, e = sheet.entries[id], res = results[i];
      const open = sheet.open === id && g.calc;
      const bust = e.sel.flags && e.sel.flags.bust;
      let picker = "";
      if (open) {
        // a bust hides the cards (they stay marked and come back when the bust is taken off);
        // a group the game keeps on a bust stays (the minus cards in the brutal mode of Vengeance)
        const groups = g.calc.groups.filter(grp => !bust || (grp.keepOnBust && grp.keepOnBust(ctx)));
        const hid = bust ? `<p class="small muted bust-hid">${groups.length ? "Числа скрыты: при переборе они не считаются. Вычеты остаются — в жестоком режиме они считаются." : "Карты скрыты: при переборе они не считаются. Снимите «Перебор» — и они вернутся."}</p>` : "";
        picker = hid + (!groups.length ? "" : `<div class="picker">${groups.map(grp => {
          const mine = e.sel.picks[grp.id] || [];
          const uniq = grp.uniqueAcross && grp.uniqueAcross(ctx);
          const taken = uniq ? new Set(s.players.filter(o => o !== id).flatMap(o => (sheet.entries[o].sel.picks[grp.id] || []))) : new Set();
          const lim = BH.pickLimit(g, e.sel.picks, grp);
          const grid = grp.items.every(v => String(grp.show ? grp.show(v) : v).length <= 3);
          return `<div class="grp"><span class="label">${esc(grp.label)}${grp.max ? ` <span class="badge${lim.count >= lim.max ? " accent" : ""}">${lim.count} из ${lim.max}</span>` : ""}</span><div class="cards${grid ? " grid" : ""}">${grp.items.map(v => {
            const on = mine.includes(v);
            const dis = !on && ((lim.max && lim.count >= lim.max) || taken.has(v));
            return `<button type="button" class="card-t ${grp.style === "mod" ? "mod" : ""}" data-act="pick" data-p="${id}" data-g="${grp.id}" data-v="${esc(JSON.stringify(v))}" aria-pressed="${on}" ${dis ? "disabled" : ""} title="${taken.has(v) ? "Эта карта уже у другого игрока" : ""}">${esc(grp.show ? grp.show(v) : v)}</button>`;
          }).join("")}</div></div>`;
        }).join("")}</div>`);
      }
      const flags = g.calc && g.calc.flags ? g.calc.flags.filter(f => !f.when || f.when(ctx)).map(f => `<button type="button" class="flag" data-act="flag" data-p="${id}" data-f="${f.id}" aria-pressed="${!!(e.sel.flags && e.sel.flags[f.id])}">${esc(f.label)}</button>`).join("") : "";
      return `<div class="entry ${open ? "open" : ""}" data-entry="${id}">
        <div class="entry-head">${BH.avatar(p, "sm")}
          <button type="button" class="nm" data-act="open-entry" data-p="${id}" style="background:none;border:none;padding:0;text-align:left;cursor:${g.calc ? "pointer" : "default"}">${esc(p.name)}${res.flip7 ? ' <span class="badge good">Flip 7</span>' : ""}${res.bust ? ' <span class="badge bad">перебор</span>' : ""}</button>
          <input class="input score-in" type="number" inputmode="numeric" step="1" data-act="manual" data-p="${id}" value="${res.manual ? esc(e.manual) : ""}" placeholder="${res.score}" aria-label="Очки: ${esc(p.name)}">
        </div>
        ${g.calc ? `<div class="spread"><div class="flagrow">${flags}${open ? "" : `<button type="button" class="flag flag-open" data-act="open-entry" data-p="${id}">${IC.cards}Карты</button>`}</div><span class="notes" data-notes="${id}">${esc((res.notes || []).join("; "))}</span></div>` : ""}
        ${picker}
      </div>`;
    }).join("");
    return `<div class="overlay" data-act="overlay-bg"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-h">
      <div class="sheet-head"><div class="sheet-t"><h2 id="sheet-h">${sheet.index !== null ? "Исправить раунд " + (idx + 1) : "Раунд " + (idx + 1)}</h2>${leader ? `<span class="mi accent">${BH.avatar(leader, "xs")}<span>${esc((g.rounds.leaderLabel || "Начинал") + ": " + leader.name)}</span></span>` : ""}</div>
        <div class="row" style="gap:4px">${sheet.index !== null ? `<button class="icon-btn danger-ic" data-act="delete-round" aria-label="Удалить раунд" title="Удалить раунд">${I.trash}</button>` : ""}<button class="icon-btn" data-act="close-sheet" aria-label="Закрыть">${I.x}</button></div></div>
      <div class="sheet-body">
        ${g.calc ? `<p class="small muted">Отметьте карты — очки посчитаются. Или впишите число справа.</p>` : `<p class="small muted">Впишите очки каждого игрока за раунд.</p>`}
        ${body}
        ${warns.map(w => `<div class="note">${esc(w)}</div>`).join("")}
      </div>
      <div class="sheet-foot">
        ${nextUp ? `<button class="btn big sheet-next" data-act="open-entry" data-p="${nextUp}" title="Дальше: ${esc((BH.player(nextUp) || {}).name || "")}"><span class="sn-l">Дальше:</span><span class="ell">${esc((BH.player(nextUp) || {}).name || "")}</span>${IC.chev}</button>` : ""}
        <button class="btn primary big" data-act="save-round">${I.check}Сохранить</button>
      </div>
    </div></div>`;
  }

  function saveRound() {
    if (sheet.kind === "sides") return saveSidesRound();
    const s = BH.session(sheet.sid), g = BH.game(s.gameId);
    const idx = sheet.index !== null ? sheet.index : s.rounds.length;
    const round = { at: Date.now(), leader: BH.leaderAt(s, idx), scores: {}, detail: {}, flags: {} };
    for (const id of s.players) {
      const e = sheet.entries[id], res = entryResult(g, s, e);
      round.scores[id] = res.score;
      // stored the way normalize stores it (manual as a number), so a sync sees no false difference
      round.detail[id] = { sel: e.sel, manual: e.manual === null || e.manual === undefined || e.manual === "" ? null : Math.round(Number(e.manual)) || 0 };
      round.flags[id] = { bust: !!res.bust, flip7: !!res.flip7 };
    }
    const isNew = sheet.index === null;
    if (isNew) s.rounds.push(round); else { round.at = s.rounds[idx].at; s.rounds[idx] = round; }
    sheet = null;
    BH.saveNow();
    afterRoundChange(s, isNew);
  }

  // Called after any change to the rounds (new, edited, deleted, undone).
  // A single leader at the target always ends the game. A tie asks once per round count:
  // after "play another round" the question comes back only when a later round is still tied.
  function afterRoundChange(s, isNew) {
    s = fresh(s);
    const g = BH.game(s.gameId), end = BH.checkEnd(s);
    if (s.continueTie && (!end.over || s.rounds.length < s.continueTie)) delete s.continueTie;
    if (end.over && !end.tie) { finish(s, end.winners); return; }
    if (end.over && end.tie && !(s.continueTie && s.rounds.length <= s.continueTie)) {
      render();
      openDialog({
        title: "Ничья", text: ((g.scoring && (typeof g.scoring.tieNote === "function" ? g.scoring.tieNote(BH.ctxOf(s)) : g.scoring.tieNote)) || "Сразу несколько игроков с лучшим счётом.") + " Сейчас поровну у: " + BH.sidesOf(s).filter(sd => sd.some(id => end.winners.includes(id))).map(sd => sd.map(id => (BH.player(id) || {}).name).join(" и ")).join(", ") + ".",
        buttons: [
          { label: "Сыграть ещё раунд", primary: true, run: () => { const c = fresh(s); c.continueTie = c.rounds.length; BH.saveNow(); closeDialog(); render(); } },
          { label: "Записать ничью", run: () => { closeDialog(); finish(fresh(s), end.winners); } },
        ],
      });
      return;
    }
    render();
    if (isNew) {
      const next = BH.player(BH.leaderAt(s, s.rounds.length));
      const count = s.rounds.length;
      BH.toast(`Раунд ${count} записан${next ? ". " + (g.rounds.leaderLabel || "Начинает") + ": " + next.name : ""}`, { label: "Отменить", run: () => {
        // only while that round is still the last one and nothing else is open
        const cur = BH.session(s.id);   // the data may have been refreshed by the sync meanwhile
        if (!cur || cur.status !== "playing" || sheet || dialog || cur.rounds.length !== count) return;
        cur.rounds.pop(); BH.saveNow(); afterRoundChange(cur, false);
      } });
    }
  }

  // setup done: to the wheel of the first player, or straight into the game when the game has none (Faraway)
  function leaveSetup(s) {
    const g = BH.game(s.gameId);
    BH.speech.stop();
    if (g && !g.first) { if (s.status === "setup" || s.status === "first") { s.status = "playing"; s.startedAt = s.startedAt || Date.now(); } BH.saveNow(); goReplace("#/s/" + s.id + "/play"); return; }
    s.status = s.status === "setup" ? "first" : s.status; BH.saveNow(); goReplace("#/s/" + s.id + "/first");
  }

  function finish(s, winners) {
    s = fresh(s);
    s.status = "finished";
    s.finishedAt = Date.now();
    s.winners = winners;
    delete s.continueTie;
    BH.clearToast();
    BH.saveNow();
    if (winners && winners.length) cheer = s.id;
    goReplace("#/s/" + s.id + "/done");   // "Back" from the result must not reopen the game screen
  }

  /* ---------- events ---------- */
  document.addEventListener("click", e => {
    if (e.detail > 0 && Date.now() < quietUntil) { e.preventDefault(); e.stopPropagation(); return; }   // keyboard clicks (detail 0) pass
    const el = e.target.closest("[data-act]");
    if (!el) return;
    const act = el.dataset.act, r = route(), s = r.a === "s" ? BH.session(r.b) : null;
    if (el.tagName === "INPUT" && el.type !== "checkbox" && el.type !== "button") return;

    switch (act) {
      /* wizard */
      case "pick-game": pickDraftGame(el.dataset.id); quiet(); render(); break;
      case "draft-step": {
        const id = el.dataset.step; draft.step = draft.step === id ? null : id; quiet(); render();
        refocus('[data-act="draft-step"][data-step="' + id + '"]');
        const n = BH.$("#step-" + id); if (n && draft.step) n.scrollIntoView({ block: "nearest" });
        break;
      }
      case "draft-now": draft.date = Date.now(); render(); break;
      case "draft-random": {   // a random game from the collection that fits the players already chosen
        const n = draft.players.length, fits = BH.games.filter(x => !n || (n >= x.players.min && n <= x.players.max));
        if (!fits.length) { BH.toast(`Нет игр на ${n} ${BH.plural(n, "игрока", "игроков", "игроков")}`); break; }
        const pool = fits.filter((x, i, a) => a.length < 2 || x.id !== draft.gameId);
        const pick = pool[Math.floor(Math.random() * pool.length)];
        if (pick) { pickDraftGame(pick.id); render(); BH.toast("Случайная игра: " + pick.name); }
        break;
      }
      case "draft-last-players": {   // the seats as last time, then whoever was added on top
        const last = draft.lastPlayers.filter(id => BH.player(id));
        draft.players = last.concat(draft.players.filter(id => !last.includes(id)));
        render(); break;
      }
      case "draft-coop": draft.coop = draft.coop === el.dataset.v ? null : el.dataset.v; render(); break;
      // a race has one winner
      case "draft-race-winner": draft.winners = draft.winners.includes(el.dataset.id) ? [] : [el.dataset.id]; render(); break;
      case "draft-race-how": draft.raceHow = draft.raceHow === el.dataset.v ? null : el.dataset.v; draft.winners = []; render(); break;
      case "race-last": sheet.last = el.dataset.id; renderOverlay(); break;
      case "mc-open": { const g = s && BH.game(s.gameId), k = g && BH.raceCards(g, s)[+el.dataset.i]; if (k) openMagicCard(g, k); break; }
      case "race-save": { if (!sheet || sheet.kind !== "race") break; const rs = BH.session(sheet.sid), st = raceSheetState(rs); if (!st.winner) break;
        const counts = Object.fromEntries(rs.players.map(id => [id, Math.max(0, Math.round(Number(sheet.counts[id])) || 0)]));
        sheet = null; rs.race = { how: BH.game(rs.gameId).scoring.count.how, counts }; finish(rs, [st.winner]); break; }
      // a pair wins together: one chip for both partners
      case "draft-winner-pair": { const ids = el.dataset.p.split(","), on = ids.every(id => draft.winners.includes(id)); draft.winners = draft.winners.filter(id => !ids.includes(id)); if (!on) draft.winners.push(...ids); render(); break; }
      // the score of a recorded cooperative game: three of one kind decide the result
      case "draft-tally": {
        const t = draft.tally = draft.tally || {}, k = el.dataset.k, v = +el.dataset.v;
        if (t[k] === v) delete t[k]; else t[k] = v;
        const wins = ((BH.game(draft.gameId) || {}).scoring || {}).wins || 3;
        if (t.ok === wins) draft.coop = "win"; else if (t.fail === wins) draft.coop = "lose";
        render(); break;
      }
      case "draft-winner": { const i = draft.winners.indexOf(el.dataset.id); i >= 0 ? draft.winners.splice(i, 1) : draft.winners.push(el.dataset.id); render(); break; }
      case "draft-save": if (el.disabled || !draft) break; el.disabled = true; saveDraft(); break;   // a double tap creates one game
      case "draft-opt": break; // handled on change
      case "toggle-exp": { const i = draft.exp.indexOf(el.dataset.id); i >= 0 ? draft.exp.splice(i, 1) : draft.exp.push(el.dataset.id); render(); break; }
      case "pick-place": draft.placeId = el.dataset.id || null; draft.step = nextStep(); quiet(); render(); break;
      case "toggle-player": {
        const id = el.dataset.id, i = draft.players.indexOf(id);
        if (i >= 0) { draft.players.splice(i, 1); draft.winners = draft.winners.filter(x => x !== id); delete draft.final[id]; }   // nobody left behind in the result
        else draft.players.push(id);
        render(); break;
      }
      case "seat-shuffle": { const a = draft.players; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } render(); break; }
      case "seat-up": case "seat-down": { const i = +el.dataset.i, j = act === "seat-up" ? i - 1 : i + 1; const a = draft.players; [a[i], a[j]] = [a[j], a[i]]; render(); break; }
      case "new-with": startDraft(el.dataset.id); go("#/new/" + el.dataset.id); break;

      /* setup */
      case "setup-go": setupStep(s, Number(el.dataset.i)); break;
      case "setup-prev": setupStep(s, setupAt.i - 1); break;
      case "setup-undo": { const st = BH.setupSteps(s)[setupAt.i]; if (st) { s.setupDone[st.id] = false; BH.saveNow(); render(); refocus('[data-act="setup-done"]'); } break; }
      case "art-zoom": { const c = el.closest(".setup-card"); if (!c) break; const on = c.classList.toggle("zoomed"); if (on) el.style.height = ""; else fitSetup(); break; }
      case "setup-done": {
        const steps = BH.setupSteps(s), st = steps[setupAt.i];
        if (st && !s.setupDone[st.id]) { s.setupDone[st.id] = true; BH.saveNow(); }
        if (setupAt.i < steps.length - 1) setupStep(s, setupAt.i + 1);
        else { quiet(); leaveSetup(s); }
        break;
      }
      case "setup-next": leaveSetup(s); break;

      /* first player */
      case "spin": {
        // the button in the middle of the wheel and the one under it both spin; a second tap mid-spin does nothing
        const box = BH.$("#wheel-box"); if (!box || spinning) break;
        const ps = s.players.map(BH.player).filter(Boolean);
        const my = ++spinToken;
        spinning = true;
        // a name shown from the spin before gives way to the wheel again
        if (!box.querySelector(".wheel")) { box.innerHTML = BH.wheel.html(ps); fitWheel(); }
        BH.$$('[data-act="spin"],[data-act="start-play"],[data-act="set-first"]').forEach(b => { b.disabled = true; });
        BH.wheel.spin(box, ps.length, i => {
          spinning = false;
          if (my !== spinToken || !box.isConnected) return;   // the user picked someone else or left the screen meanwhile
          const cur = fresh(s), p = ps[i]; cur.first = p.id; BH.saveNow();
          BH.$$('[data-act="set-first"]').forEach(b => { b.disabled = false; b.setAttribute("aria-pressed", String(b.dataset.id === p.id)); });
          // confetti from the wheel, then the name takes the wheel's place with the buttons right under it
          const r = box.getBoundingClientRect();
          confetti(r.left + r.width / 2, r.top + r.height / 2, [p.color]);
          setTimeout(() => {
            if (my !== spinToken || !box.isConnected) return;
            box.innerHTML = firstResultHTML(p);
            const bar = BH.$(".wheel-bar"); if (bar) bar.innerHTML = wheelButtons(cur, true);
          }, window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 1100);
        });
        break;
      }
      case "set-first": spinToken++; s.first = el.dataset.id; BH.saveNow(); BH.wheel.reset(); render(); break;
      case "start-play":
        spinToken++;
        if (!s.first) s.first = s.players[0];
        if (s.status !== "playing") { s.status = "playing"; s.startedAt = Date.now(); }
        BH.saveNow(); BH.wheel.reset();
        // opened from the game screen ("Первый"): step back to it; from setup: the wheel leaves the history
        goReplace("#/s/" + s.id + "/play");
        break;

      /* play */
      case "new-round": openSheet(s, null); break;
      case "edit-round": openSheet(s, +el.dataset.i); break;
      case "heist": {
        const g = BH.game(s.gameId), ctx = BH.ctxOf(s), ok = el.dataset.ok === "1";
        const before = s.coop || g.heist.start(ctx);
        s.rounds.push({ at: Date.now(), scores: {}, flags: {}, detail: {}, heist: ok ? "ok" : "fail", coop: JSON.parse(JSON.stringify(before)) });
        const t = BH.coopTally(s);
        if (t.over) { s.coop = before; finish(s, t.won ? s.players.slice() : []); break; }
        s.coop = g.heist.next(ctx, before, ok);
        BH.saveNow(); quiet(); render(); window.scrollTo(0, 0);
        const n = s.rounds.length;
        BH.toast(`${g.heist.label} ${n}: ${ok ? g.scoring.okLabel.toLowerCase() : g.scoring.failLabel.toLowerCase()}`, { label: "Отменить", run: () => {
          const c = BH.session(s.id); if (!c || c.status !== "playing" || sheet || dialog || c.rounds.length !== n) return;
          const last = c.rounds.pop(); if (last && last.coop) c.coop = last.coop; BH.saveNow(); render();
        } });
        break;
      }
      // the card in a slot: one of the stack, chosen from the list (the app suggests the next one, the table may differ)
      case "coop-pick": {
        const g = BH.game(s.gameId), ctx = BH.ctxOf(s), H = g.heist, kind = el.dataset.kind, slot = el.dataset.slot;
        const st = Object.assign({ ch: [], sp: 0, perm: [], nCh: 1, nSp: 1 }, s.coop || H.start(ctx));
        const cur = slot === "perm" ? st.perm[0] : slot === "sp" ? st.sp : slot.startsWith("ch") ? st.ch[+slot.slice(2)] : 0;
        const taken = [...st.perm, ...st.ch].filter(x => x !== cur);
        openDialog({ title: kind === "sp" ? "Какой специалист?" : "Какое испытание?", text: "Номер — в углу карты.", buttons: [{ label: "Отмена", run: closeDialog }],
          choices: H.choices(ctx, kind).filter(x => kind === "sp" || !taken.includes(x)).map(x => ({ label: `№${x} ${H.cards[kind][x].ru}`, sub: H.cards[kind][x].en, current: x === cur, run: () => {
            const c = fresh(s), v = Object.assign({ ch: [], sp: 0, perm: [], nCh: 1, nSp: 1 }, c.coop || H.start(ctx));
            if (slot === "perm") v.perm = [x];
            else if (slot === "sp") { v.sp = x; v.nSp = (x % 10) + 1; }
            else if (slot === "new") { v.ch = [...v.ch, x]; v.nCh = (x % 10) + 1; }
            else { v.ch[+slot.slice(2)] = x; v.nCh = (x % 10) + 1; }
            c.coop = v; BH.saveNow(); closeDialog(); render();
          } })) });
        break;
      }
      case "round-done": {
        const last = ((BH.game(s.gameId) || {}).rounds || {}).count || 8;
        if (s.rounds.length >= last) break;
        s.rounds.push({ at: Date.now(), leader: s.players[0], scores: Object.fromEntries(s.players.map(id => [id, 0])), flags: {}, detail: {} });
        BH.saveNow(); quiet(); render(); window.scrollTo(0, 0);
        const n = s.rounds.length;
        BH.toast(n < last ? `Раунд ${n} сыгран` : `Все ${last} раундов сыграны — считайте славу`, { label: "Отменить", run: () => {
          const c = BH.session(s.id); if (!c || c.status !== "playing" || sheet || dialog || c.rounds.length !== n) return;
          c.rounds.pop(); BH.saveNow(); render();
        } });
        break;
      }
      case "end-open": openEndSheet(s); break;
      case "end-entry": sheet.open = sheet.open === el.dataset.p ? null : el.dataset.p; renderOverlay(); { const n = overlayRoot.querySelector(`[data-entry="${el.dataset.p}"]`); if (n) n.scrollIntoView({ block: "nearest" }); } break;
      case "end-save": saveEnd(); break;
      case "undo-round": { const coop = BH.isCoop(BH.game(s.gameId)), word = coop ? "ограбление" : "раунд";
        openDialog({ title: `Отменить ${word} ${s.rounds.length}?`, text: coop ? "Счётчик вернётся к ограблению " + s.rounds.length + ", карты — как были." : BH.isEndScored(BH.game(s.gameId)) ? "Счётчик вернётся к раунду " + s.rounds.length + "." : "Очки этого раунда удалятся.", buttons: [
        { label: `Отменить ${word}`, danger: true, run: () => { const c = fresh(s), last = c.rounds.pop(); if (last && last.coop) c.coop = last.coop; BH.saveNow(); dialog = null; afterRoundChange(c, false); } }, { label: "Оставить", run: closeDialog }] }); break; }
      case "finish-menu": {
        if (BH.isRace(BH.game(s.gameId))) { openRaceEnd(s); break; }
        if (BH.isCoop(BH.game(s.gameId))) {
          const t = BH.coopTally(s);
          openDialog({ title: "Завершить партию?", text: `Хранилищ ${t.ok} из ${t.wins}, тревог ${t.fail} из ${t.losses}. Партию, прерванную раньше, можно записать как победу или поражение.`, buttons: [
            { label: "Записать победу банды", run: () => { closeDialog(); finish(s, s.players.slice()); } },
            { label: "Записать поражение", run: () => { closeDialog(); finish(s, []); } },
            { label: "Удалить партию", danger: true, run: () => confirmDelete(s) },
            { label: "Продолжить игру", primary: true, run: closeDialog }] });
          break;
        }
        if (BH.isEndScored(BH.game(s.gameId))) {
          const last = BH.game(s.gameId).rounds.count || 8;
          openDialog({ title: "Завершить партию?", text: s.rounds.length >= last ? "Все раунды сыграны — впишите славу каждого игрока." : `Сыграно ${s.rounds.length} из ${last} раундов. По правилам славу считают после ${last}-го раунда, но прерванную партию тоже можно записать.`, buttons: [
            { label: "Подсчёт славы", primary: true, run: () => { dialog = null; openEndSheet(s); } },
            { label: "Удалить партию", danger: true, run: () => confirmDelete(s) },
            { label: "Продолжить игру", run: closeDialog }] });
          break;
        }
        const st = BH.standings(s), best = st.length ? st[0].total : 0, w = st.filter(x => x.total === best).map(x => x.id);
        openDialog({ title: "Завершить партию?", text: s.rounds.length ? "Победителем запишется тот, у кого сейчас больше всех очков: " + w.map(id => (BH.player(id) || {}).name).join(", ") + "." : "Ещё не записано ни одного раунда.",
          buttons: [
            ...(s.rounds.length ? [{ label: "Завершить и записать", primary: true, run: () => { closeDialog(); finish(s, w); } }] : []),
            { label: "Удалить партию", danger: true, run: () => confirmDelete(s) },
            { label: "Продолжить игру", run: closeDialog }] });
        break;
      }
      case "close-sheet": sheet = null; renderOverlay(); break;
      case "overlay-bg": if (e.target === el) { if (dialog) closeDialog(); else if (ask) closeAsk(); else { sheet = null; renderOverlay(); } } break;
      /* voice questions */
      case "ask-open": openAsk(el.dataset.game || (s && s.gameId), s ? s.id : null); break;
      case "ask-close": closeAsk(); break;
      case "ask-stop": if (rec) rec.finish(); break;
      case "ask-again": BH.voice.stopAudio(); startListening(); break;
      case "ask-replay": if (ask && ask.result && ask.result.audio) BH.voice.play(ask.result.audio).catch(() => {}); break;
      case "open-entry": sheet.open = el.dataset.p || null; renderOverlay(); { const n = overlayRoot.querySelector(`[data-entry="${el.dataset.p}"]`); if (n) n.scrollIntoView({ block: "start" }); } break;
      case "pick": {
        const en = sheet.entries[el.dataset.p], gid = el.dataset.g, v = JSON.parse(el.dataset.v);
        const arr = en.sel.picks[gid] = en.sel.picks[gid] || [];
        const i = arr.indexOf(v);
        if (i < 0) { const sg = BH.game(BH.session(sheet.sid).gameId), lim = BH.pickLimit(sg, en.sel.picks, sg.calc.groups.find(x => x.id === gid)); if (lim.max && lim.count >= lim.max) break; }
        i >= 0 ? arr.splice(i, 1) : arr.push(v);
        arr.sort((a, b) => (typeof a === "number" && typeof b === "number" ? a - b : 0));
        en.manual = null;
        renderOverlay();
        break;
      }
      case "flag": { const en = sheet.entries[el.dataset.p]; en.sel.flags[el.dataset.f] = !en.sel.flags[el.dataset.f]; if (en.sel.flags.bust) en.manual = null; renderOverlay(); break; }
      case "save-round": saveRound(); break;
      case "side-count": {
        const s = BH.session(sheet.sid), g = BH.game(s.gameId), Z = g.sideScore, e = sheet.entries[el.dataset.p], z = el.dataset.z, d = +el.dataset.d;
        const used = Z.zones.reduce((a, x) => a + (e.counts[x.z] || 0), 0);
        if (d > 0 && used >= Z.discs(BH.ctxOf(s))) break;
        e.counts[z] = Math.max(0, (e.counts[z] || 0) + d); e.manual = null;
        renderOverlay(); break;
      }
      case "delete-round": { const i = sheet.index; openDialog({ title: "Удалить раунд " + (i + 1) + "?", text: "Остальные раунды сохранятся, сдающие сдвинутся.", buttons: [
        { label: "Удалить", danger: true, run: () => { const c = fresh(s); c.rounds.splice(i, 1); c.rounds.forEach((rd, j) => { rd.leader = BH.leaderAt(c, j); }); sheet = null; dialog = null; BH.saveNow(); afterRoundChange(c, false); } }, { label: "Отмена", run: () => { dialog = null; renderOverlay(); } }] }); break; }
      case "dlg-choice": { const c = dialog && dialog.choices && dialog.choices[+el.dataset.i]; if (c) c.run(); break; }
      case "dlg": { const b = dialog && dialog.buttons[+el.dataset.i]; if (b) b.run(); break; }

      /* done */
      case "rematch": { if (el.disabled) break; el.disabled = true;   // a double tap must not create two games
        startDraft(s.gameId); Object.assign(draft, { exp: s.exp.slice(), placeId: s.placeId, players: s.players.slice(), opts: Object.assign({}, s.opts) }); saveDraft(); break; }
      case "reopen": s.status = "playing"; s.winners = []; delete s.finishedAt; delete s.race; BH.saveNow(); goReplace("#/s/" + s.id + "/play"); break;
      case "delete-session": confirmDelete(s); break;
      case "repeat": {   // home: the latest game again — the form opens filled in, nothing is created yet
        const from = BH.session(el.dataset.sid); if (!from) break;
        startDraft(from.gameId); Object.assign(draft, { exp: from.exp.slice(), placeId: from.placeId, players: visiblePlayers(from.players), lastPlayers: visiblePlayers(from.players), opts: Object.assign({}, from.opts) }); draft.step = nextStep();
        go("#/new"); break;
      }

      /* sessions calendar */
      case "cal-move": { cal.day = null; const d = new Date(cal.y, cal.m + Number(el.dataset.step), 1); cal.y = d.getFullYear(); cal.m = d.getMonth(); render(); break; }
      case "cal-today": { const d = new Date(); cal = { y: d.getFullYear(), m: d.getMonth(), day: null }; render(); break; }
      case "cal-day": { const d = Number(el.dataset.d); cal.day = cal.day === d ? null : d; render(); break; }

      /* rules */
      case "say-rule": { const g = BH.game(s ? s.gameId : r.b); if (g) BH.rulesUI.say(g, el.dataset.id); break; }
      case "goto-rule": {
        const g = BH.game(s ? s.gameId : r.b);
        let n = BH.$("details#rule-" + el.dataset.id);
        if (!n) {   // shown as a search result or in the compact panel: bring up the full rules first
          const inp = BH.$("#rules-q"); if (inp) inp.value = "";
          const out = BH.$("#rules-out"); if (out && g) { out.innerHTML = BH.rulesUI.full(g, {}); BH.assets.hydrate(out); }
          n = BH.$("details#rule-" + el.dataset.id);
        }
        if (n) { for (let p = n.parentElement; p; p = p.parentElement) if (p.matches("details.fold-sec, details.fold-grp")) p.open = true; n.open = true; n.classList.add("hit"); n.scrollIntoView({ block: "start", behavior: "smooth" }); }
        break;
      }
      case "fold-all": { const box = document.getElementById(el.dataset.in); if (box) box.querySelectorAll("details.fold, details.fold-grp").forEach(d => { d.open = el.dataset.open === "1"; }); break; }

      /* players */
      case "edit-player": editPlayer = el.dataset.id || null; editKeep = null; render(); break;
      case "pr-sort": { const v = PR_SORTS[el.dataset.v] ? el.dataset.v : "wins"; if (el.dataset.scope === "place") plcard.psort = v; else gcard.psort = v; render(); refocus(`[data-act="pr-sort"][data-v="${v}"]`); break; }
      case "players-sort": playersSort = el.dataset.v === "name" ? "name" : "plays"; render(); refocus('[data-act="players-sort"][data-v="' + playersSort + '"]'); break;
      case "gc-tab": gcard.tab = el.dataset.tab; render(); refocus('[data-act="gc-tab"][data-tab="' + gcard.tab + '"]'); break;
      case "pc-tab": pcard.tab = el.dataset.tab; render(); refocus('[data-act="pc-tab"][data-tab="' + pcard.tab + '"]'); break;
      case "pick-color": {
        const p = BH.player(el.dataset.id), f = el.closest("form");
        // the colour is applied on "Сохранить" ("Отмена" leaves the old one); the redraw keeps what was typed
        if (p && f && f.elements.name) { editKeep = { id: p.id, name: f.elements.name.value, me: !!(f.elements.me && f.elements.me.checked), color: el.dataset.c }; render(); }
        break;
      }
      case "hide-player": {
        const p = BH.player(el.dataset.id); if (!p) break;
        const used = S().sessions.some(x => x.players.includes(p.id));
        if (used) p.hidden = !p.hidden; else { S().players = S().players.filter(x => x !== p); if (BH.meId() === p.id) BH.setMe(null); }
        editPlayer = null; BH.saveNow();
        if (r.a === "players" && r.b === p.id && !BH.player(p.id)) goReplace("#/players");   // deleted from its own card
        else render();
        break;
      }
      case "del-place": {
        const id = el.dataset.id;
        if (S().sessions.some(x => x.placeId === id)) break;   // a place in the history stays
        S().places = S().places.filter(x => x.id !== id); editPlace = null; BH.saveNow();
        if (r.a === "places" && r.b === id) goReplace("#/places"); else render();
        break;
      }
      case "edit-place": editPlace = el.dataset.id || null; render(); break;
      case "pl-tab": plcard.tab = el.dataset.tab; render(); refocus('[data-act="pl-tab"][data-tab="' + plcard.tab + '"]'); break;

      /* settings */
      case "set": {
        const k = el.dataset.k; let v = el.dataset.v;
        if (k === "voiceRate") v = Number(v);
        if (k === "speakAnswers") { v = v === "true"; if (!v) { BH.voice.stopAudio(); BH.speech.stop(); } }
        S().settings[k] = v; BH.saveNow(); applyTheme(); render(); break;
      }
      case "say-test": {
        // the chosen assistant voice when it is connected (cached after the first time), else the phone's own
        const hello = "Привет! Так будут звучать ответы на вопросы по правилам.";
        if (BH.voice.ready()) BH.voice.say(hello, () => false).catch(e => BH.toast("Не получилось озвучить: " + (e.message || "ошибка")));
        else BH.speech.speak(hello);
        break;
      }
      case "export": BH.exportData(); break;
      case "reload": location.reload(); break;
      case "ask-rule": {
        const gid = ask && ask.gameId, sid = ask && ask.sid; if (!gid) break;
        stopListening(); if (askCtl) askCtl.abort(); askCtl = null; BH.voice.stopAudio(); ask = null;
        pendingRule = el.dataset.id;
        const inSession = sid && BH.session(sid), to = inSession ? "#/s/" + sid + "/rules" : "#/games/" + gid;
        if (!inSession) gcard = { id: gid, tab: "rules", period: gcard.period, psort: gcard.psort };
        // the same page: closing the sheet drops its history entry, then the page is redrawn;
        // another page takes the sheet's entry (go), so Back returns to where the question was asked
        if (normHash(location.hash) === normHash(to)) render(); else go(to);
        break;
      }
      case "nav-back": {
        const href = el.dataset.href;
        if (backIs(href)) { e.preventDefault(); history.back(); }
        break;   // otherwise the link works as a normal link
      }
      case "sync-now": BH.cloud.syncNow(); break;
      case "sync-off": openDialog({ title: "Отключить синхронизацию?", text: "Только на этом устройстве. Данные останутся и здесь, и в GitHub; изменения перестанут отправляться, пока не подключите снова.", buttons: [
        { label: "Отключить", danger: true, run: () => { BH.cloud.disconnect(); dialog = null; render(); BH.toast("Синхронизация на этом устройстве отключена"); } },
        { label: "Отмена", run: closeDialog }] }); break;
    }
  });

  document.addEventListener("change", e => {
    const el = e.target;
    const r = route(), s = r.a === "s" ? BH.session(r.b) : null;
    if (el.dataset.act === "stats-game") { statsGame = el.value; render(); }
    if (el.dataset.act === "pl-period") { plcard.period = el.value; render(); refocus('[data-act="pl-period"]'); }
    if (el.dataset.act === "gc-period") { gcard.period = el.value; render(); refocus('[data-act="gc-period"]'); }
    if (el.dataset.act === "pc-period") { pcard.period = el.value; render(); refocus('[data-act="pc-period"]'); }
    if (el.dataset.act === "pc-sort") { pcard.sort = el.value; render(); refocus('[data-act="pc-sort"]'); }
    if (el.dataset.act === "draft-date" && draft) {
      const t = new Date(el.value).getTime();
      if (Number.isFinite(t)) {
        draft.date = t;
        // typing the date part by part (PC): redraw when the field is left, not after every part
        if (document.activeElement === el && !matchMedia("(pointer: coarse)").matches) { const sum = BH.$("#step-date .step-sum"); if (sum) sum.textContent = whenText(t); }
        else render();
      }
    }
    if (el.dataset.act === "draft-opt" && draft) {
      draft.opts[el.dataset.id] = el.checked;
      const og = BH.game(draft.gameId), o = og && (og.options || []).find(x => x.id === el.dataset.id);
      if (el.checked && o && o.group) for (const x of og.options) if (x.group === o.group && x.id !== o.id) draft.opts[x.id] = false;
      render(); refocus('[data-act="draft-opt"][data-id="' + el.dataset.id + '"]'); }
    if (el.dataset.act === "voice-name") { BH.voice.setVoice(el.value); BH.toast("Голос: " + el.options[el.selectedIndex].text); }
    if (el.dataset.act === "sync-same") { const own = document.getElementById(el.dataset.target || "own-pass"); if (own) own.hidden = el.checked; }
    if (el.dataset.act === "import" && el.files && el.files[0]) {
      const file = el.files[0];
      el.value = "";
      BH.readBackup(file).then(data => {
        const n = data.sessions.length, cur = S().sessions.length;
        openDialog({ title: "Заменить данные копией?", text: `В копии ${n} ${BH.plural(n, "партия", "партии", "партий")} и ${data.players.length} ${BH.plural(data.players.length, "игрок", "игрока", "игроков")}. Сейчас на устройстве ${cur} ${BH.plural(cur, "партия", "партии", "партий")}: они заменятся копией.`, buttons: [
          { label: "Заменить", danger: true, run: () => {
            const before = S();
            BH.state = data; BH.saveNow(); dialog = null; applyTheme(); go("#/");
            BH.toast("Данные загружены из копии", { label: "Вернуть как было", run: () => { BH.state = before; BH.saveNow(); applyTheme(); render(); } });
          } },
          { label: "Отмена", run: closeDialog }] });
      }).catch(err => BH.toast("Не загрузилось: " + err.message));
    }
  });

  document.addEventListener("focusout", e => {
    const el = e.target;
    if (el && el.dataset && el.dataset.act === "draft-date" && draft && route().a === "new") setTimeout(() => { if (draft && route().a === "new") render(); }, 0);
  });

  document.addEventListener("input", e => {
    const el = e.target;
    if (el.dataset.act === "draft-final" && draft) { draft.final[el.dataset.p] = el.value; return; }
    if (el.dataset.act === "players-q") {   // players grid: filter in place
      const q = el.value.trim().toLowerCase(); let any = false;
      BH.$$(".pgrid .pcell").forEach(a => { const on = !q || a.dataset.name.includes(q); a.hidden = !on; any = any || on; });
      const none = BH.$("#players-none"); if (none) none.hidden = any;
      return;
    }
    if (el.dataset.act === "games-q") {   // games list: filter in place, no redraw while typing
      const q = el.value.trim().toLowerCase(); let any = false;
      BH.$$(".glist .grow").forEach(a => { const on = !q || a.dataset.name.includes(q); a.hidden = !on; any = any || on; });
      const none = BH.$("#games-none"); if (none) none.hidden = any;
      return;
    }
    if (el.dataset.act === "pick-q") {   // new game form: filter the games / players list in place
      const q = el.value.trim().toLowerCase(), list = BH.$('.pick-list[data-list="' + el.dataset.list + '"]');
      if (list) list.querySelectorAll(".pick-row").forEach(r => { r.hidden = !!q && !r.dataset.name.includes(q); });
      return;
    }
    if (el.dataset.act === "end-in" && sheet && sheet.kind === "end") {
      const d = sheet.entries[el.dataset.p], k = el.dataset.k;
      if (/^c\d+$/.test(k)) d.cards[Number(k.slice(1))] = el.value; else d[k] = el.value;
      endLive();
      return;
    }
    // a side's points typed instead of counted: the result line follows, nothing is redrawn (the cursor stays)
    if (el.dataset.act === "draft-final-pair" && draft) { for (const id of el.dataset.p.split(",")) { if (el.value === "") delete draft.final[id]; else draft.final[id] = el.value; } }
    if (el.dataset.act === "draft-race-count" && draft) {
      draft.raceCounts = draft.raceCounts || {}; draft.raceCounts[el.dataset.p] = el.value;
      const top = BH.raceResult(draft.players, draft.raceCounts).top; draft.winners = draft.winners.filter(id => top.includes(id));
      const res = document.getElementById("race-draft-res"); if (res) res.innerHTML = raceDraftResHTML(BH.game(draft.gameId));
      return;
    }
    if (el.dataset.act === "race-count" && sheet && sheet.kind === "race") {
      sheet.counts[el.dataset.p] = el.value;
      const rs = BH.session(sheet.sid), st = raceSheetState(rs);
      const res = overlayRoot.querySelector("#race-result"), tie = overlayRoot.querySelector("#race-tie"), btn = overlayRoot.querySelector('[data-act="race-save"]');
      if (res) res.textContent = st.text; if (tie) tie.innerHTML = raceTieHTML(st); if (btn) btn.disabled = !st.winner;
      return;
    }
    if (el.dataset.act === "side-manual" && sheet && sheet.kind === "sides") {
      const s = BH.session(sheet.sid), g = BH.game(s.gameId), e = sheet.entries[el.dataset.p];
      e.manual = el.value === "" ? null : el.value;
      const r = overlayRoot.querySelector("#side-result"); if (r) r.textContent = sidesResult(s, g).text;
      const zn = el.closest(".side-entry") && el.closest(".side-entry").querySelector(".zones"); if (zn) zn.classList.toggle("off", e.manual !== null);
    }
    if (el.dataset.act === "manual" && sheet) {
      const en = sheet.entries[el.dataset.p];
      en.manual = el.value === "" ? null : el.value;
      // typing a score means the player did not bust
      if (en.manual !== null && en.sel.flags && en.sel.flags.bust) {
        en.sel.flags.bust = false;
        const b = overlayRoot.querySelector(`[data-act="flag"][data-p="${el.dataset.p}"][data-f="bust"]`); if (b) b.setAttribute("aria-pressed", "false");
      }
      const s = BH.session(sheet.sid), g = BH.game(s.gameId);
      const res = entryResult(g, s, en);
      const n = overlayRoot.querySelector(`[data-notes="${el.dataset.p}"]`); if (n) n.textContent = (res.notes || []).join("; ");
      if (el.value === "") el.placeholder = String(res.score);
    }
  });

  document.addEventListener("submit", e => {
    const f = e.target, form = f.dataset.form;
    if (!form) return;
    e.preventDefault();
    if (form === "ask") { const q = (f.elements.q.value || "").trim(); if (q && ask) { stopListening(); sendAsk(q); } return; }
    if (form === "voice-url") {
      const u = (f.elements.url.value || "").trim();
      if (u && !/^https:\/\/functions\.yandexcloud\.net\/[A-Za-z0-9]+$/.test(u)) { BH.toast("Адрес должен быть вида https://functions.yandexcloud.net/…"); return; }
      BH.voice.setUrl(u); render(); BH.toast(u ? "Адрес сохранён" : "Адрес убран"); return;
    }
    if (form === "sync" || form === "sync-wheel") {
      const fd = new FormData(f), val = k => String(fd.get(k) || "");
      let cfg, pass2;
      if (form === "sync") {
        const w = BH.cloud.wheelCfg(), same = w && w.pass && fd.get("same") === "on";
        cfg = { owner: val("owner").trim(), repo: val("repo").trim(), token: val("token").trim(), pass: same ? w.pass : val("pass") };
        pass2 = same ? undefined : val("pass2");
        if (!cfg.owner || !cfg.repo || !cfg.token) { syncMsg = "Заполните имя, репозиторий и токен."; render(); return; }
        cfg.fixWheel = !!(w && fd.get("fixwheel") === "on" && w.owner === cfg.owner && w.repo === cfg.repo);
      } else {
        const w = BH.cloud.wheelCfg(); if (!w) return;
        const same = w.pass && fd.get("same") === "on";
        cfg = { owner: w.owner, repo: w.repo, token: w.token, pass: same ? w.pass : val("pass") };
        pass2 = same ? undefined : val("pass2");
      }
      if (cfg.pass.length < 8) { syncMsg = "Пароль шифрования — не меньше 8 символов."; const el = BH.$("#sync-status"); if (el) el.textContent = syncMsg; return; }
      connectSync(f, cfg, pass2);
      return;
    }
    const name = (f.elements.name && f.elements.name.value || "").trim();
    if (f.elements.name) f.elements.name.value = "";   // the redraw keeps typed text; this one is done
    if (form === "add-player" || form === "add-player-page") {
      if (!name) return;
      const ex = S().players.find(p => p.name.toLowerCase() === name.toLowerCase());
      const p = ex || BH.addPlayer(name);
      if (ex && ex.hidden) ex.hidden = false;
      if (form === "add-player" && draft && !draft.players.includes(p.id)) draft.players.push(p.id);
      BH.saveNow(); render();
      const inp = BH.$(`form[data-form="${form}"] input`); if (inp) inp.focus();
    } else if (form === "add-place") {
      if (!name) return;
      const p = S().places.find(x => x.name.toLowerCase() === name.toLowerCase()) || BH.addPlace(name);
      if (draft) draft.placeId = p.id;
      render();
    } else if (form === "edit-place") {
      const pl = BH.place(f.dataset.id);
      if (pl && name && !S().places.some(x => x !== pl && x.name.toLowerCase() === name.toLowerCase())) { pl.name = name.slice(0, 40); BH.saveNow(); }
      else if (pl && name) { BH.toast("Такое место уже есть"); return; }
      editPlace = null; render();
    } else if (form === "edit-player") {
      const p = BH.player(f.dataset.id);
      if (p && name) {
        p.name = name.slice(0, 40);
        if (editKeep && editKeep.id === p.id && editKeep.color) p.color = editKeep.color;
        const me = !!(f.elements.me && f.elements.me.checked);
        if (me) BH.setMe(p.id); else if (BH.meId() === p.id) BH.setMe(null);
        BH.saveNow();
      }
      editPlayer = null; editKeep = null; render();
    }
  });

  document.addEventListener("keydown", e => {
    if (e.key === "Escape") { if (dialog) closeDialog(); else if (ask) closeAsk(); else if (sheet) { sheet = null; renderOverlay(); } }
    // keep Tab inside an open sheet or dialog
    if (e.key === "Tab" && (sheet || dialog || ask)) {
      const items = BH.$$('button:not([disabled]), input:not([disabled]), [tabindex="0"]', overlayRoot).filter(x => x.offsetParent !== null);
      if (items.length) {
        const first = items[0], last = items[items.length - 1];
        if (!overlayRoot.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
        else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
    if ((e.key === "Enter" || e.key === " ") && e.target.matches && e.target.matches("tr[data-act]")) { e.preventDefault(); e.target.click(); }
  });

  window.addEventListener("hashchange", e => {
    prevHash = e.oldURL && e.oldURL.includes("#") ? "#" + e.oldURL.split("#")[1] : "";
    // a new entry (a link, or a replace): remember the screen before it; entries we step back to keep theirs
    if (!history.state || !("back" in history.state)) {
      const st = { back: carry ? carry.back : prevHash };
      // a screen of a game: where the game was opened from — kept while moving inside the game
      if (inGameFlow(location.hash)) st.origin = carry ? carry.origin : inGameFlow(prevHash) ? (curState && typeof curState.origin === "string" ? curState.origin : null) : prevHash;
      history.replaceState(st, "");
    }
    carry = null;
    // key moments for the sync: a game form or the players / settings page is left,
    // a game reaches its result, or we are back on the home screen (e.g. after a delete)
    {
      const now = route(), was = prevHash.replace(/^#\/?/, "").split("/");
      const leftForm = was[0] === "new" || (was[0] === "s" && was[2] === "edit") || was[0] === "players" || was[0] === "places" || was[0] === "settings";
      if (leftForm || now.c === "done" || now.a === "" || now.a === "sessions") BH.cloud.keyMoment();
    }
    spinToken++; spinning = false;
    if (route().a !== "settings") { syncMsg = ""; wheelTokenBad = false; }
    const rt = route();
    if (rt.a !== "new" && !(rt.a === "s" && rt.c === "edit" && draft && draft.editId === rt.b)) draft = null;
    editPlayer = null; editKeep = null; editPlace = null;   // an open player / place form closes on any move
    sheet = null; dialog = null; ovPushed = false; quiet();
    if (ask) { stopListening(); if (askCtl) askCtl.abort(); askCtl = null; ask = null; }
    render();
    window.scrollTo(0, 0);
  });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);

  /* ---------- start ---------- */
  BH.version = "0.19.2";
  applyTheme();
  // reloaded while a sheet was open: step off its history entry; a fresh start has nothing before it
  if (history.state && history.state.ov) history.back();
  else if (!history.state || !("back" in history.state)) history.replaceState({ back: null }, "");
  // a file that failed to load (e.g. a 503 while the site publishes an update) must not leave a half-working app
  if (route().a === "new") startDraft(route().b || null);
  render();
  if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol) && !/^(localhost|127\.)/.test(location.hostname)) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  // the pictures of all games, ahead of time, once the app is up (a few seconds later, not to slow the start)
  setTimeout(() => { if (BH.assets && BH.assets.loadAhead) BH.assets.loadAhead(); }, 4000);
  window.addEventListener("online", () => { if (BH.assets && BH.assets.loadAhead) BH.assets.loadAhead(); });
  BH._render = render; // for tests
})();
