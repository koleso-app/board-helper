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
  function render() {
    const r = route();
    let html = "", nav = "home", inGame = false, after = null;
    try {
      if (r.a === "" ) html = viewHome();
      else if (r.a === "new") { html = viewNew(); nav = "sessions"; inGame = true; }
      else if (r.a === "sessions") { html = viewSessions(); nav = "sessions"; }
      else if (r.a === "menu") { html = viewMenu(); nav = "menu"; }
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
    if (after) after();
    renderOverlay();
    updateSync();
    BH.assets.hydrate(main);
    curState = history.state;
  }
  // the sync waits while the user is in the middle of something
  let spinning = false;
  BH.uiBusy = () => {
    const a = document.activeElement;
    const typing = a && a.matches && a.matches("main input:not([type=checkbox]), main textarea") && a.value;   // half-typed text would be lost by a redraw
    return !!(sheet || dialog || ask || spinning || typing);
  };
  const notFound = text => `<div class="empty"><p>${esc(text)}</p><p style="margin-top:12px"><a class="btn" href="#/">На главную</a></p></div>`;
  // a back link to the previous screen steps back in the history instead of adding an entry,
  // so the phone's Back button does not bring the left screen up again
  const backLink = (href, text) => `<a class="back" href="${href}" data-act="nav-back" data-href="${href}">${I.back}<span>${esc(text)}</span></a>`;
  // a game session can be opened from the home screen, the sessions calendar or a game's page:
  // its back link leads to where it was opened from (remembered in the history), home otherwise
  function originOf() {
    const b = originState() || backOf(), seg = b ? normHash(b).replace(/^#\/?/, "").split("/") : [];
    if (seg[0] === "sessions") return { href: b, label: "Партии" };
    if (seg[0] === "games") { const g = seg[1] && BH.game(seg[1]); return { href: b, label: g ? g.name : "Игры" }; }
    if (seg[0] === "players") { const q = seg[1] && BH.player(seg[1]); return { href: b, label: q ? q.name : "Игроки" }; }
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
      if (seg[0] === "players" && !seg[1]) return backLink(b, "Игроки");
      if (seg[0] === "players" && seg[1] && route().a === "players" && route().b && seg[1] !== route().b) { const q = BH.player(seg[1]); if (q) return backLink(b, q.name); }
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
  };
  const MONTHS_NOM = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
  const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];
  const shortDate = ts => { const d = new Date(ts); return d.getDate() + " " + MONTHS_SHORT[d.getMonth()]; };
  const finishedSessions = () => S().sessions.filter(s => s.status === "finished");
  // the whole collection, most played first (then by name)
  function gamesByPlays() {
    const fin = finishedSessions();
    return BH.games.map(g => ({ g, n: fin.filter(s => s.gameId === g.id).length })).sort((a, b) => b.n - a.n || a.g.name.localeCompare(b.g.name, "ru"));
  }
  const coverOf = (g, cls) => `<span class="cover ${cls || ""}"${g ? BH.assets.cover(g) : ""}>${(g && g.cover) || ""}</span>`;

  // one game as a tall card (home shelves): cover, optional count, name, a line under it
  function gameCard(g, o) {
    o = o || {};
    return `<a class="gcard" href="#/games/${esc(g.id)}">
      ${coverOf(g, "gcard-img")}
      ${o.count ? `<span class="gcard-count" title="Партий">${IC.people}${o.count}</span>` : ""}
      <span class="gcard-t"><b>${esc(g.name)}</b>${o.meta ? `<span class="gcard-meta">${o.meta}</span>` : ""}</span>
    </a>`;
  }

  // everyone at the table as small faces: the winners first with a cup, then the others
  function tablePeople(s) {
    const finished = s.status === "finished";
    const w = finished ? s.winners.map(BH.player).filter(Boolean) : [];
    const rest = s.players.filter(id => !finished || !s.winners.includes(id)).map(BH.player).filter(Boolean);
    const faces = list => list.slice(0, 6).map(p => BH.avatar(p, "sm")).join("") + (list.length > 6 ? `<span class="more">+${list.length - 6}</span>` : "");
    const names = list => esc(list.map(p => p.name).join(", "));
    return `<div class="sl-people">
      ${w.length ? `<span class="sl-win" title="${w.length > 1 ? "Ничья" : "Победа"}: ${names(w)}">${IC.trophy}<span class="faces">${faces(w)}</span></span>` : ""}
      ${rest.length ? `<span class="sl-rest" title="${finished ? "Играли" : "За столом"}: ${names(rest)}">${IC.people}<span class="faces">${faces(rest)}</span></span>` : ""}
    </div>`;
  }
  // one game session as a list row: cover, game, date · place, who played (and who won), the stage of a game still going
  function sessionLine(s) {
    const g = BH.game(s.gameId), place = BH.place(s.placeId);
    let right = "";
    if (s.status === "setup") right = '<span class="badge warn">подготовка</span>';
    else if (s.status === "first") right = '<span class="badge warn">выбор первого</span>';
    else if (s.status === "playing") right = `<span class="badge accent">раунд ${s.rounds.length + 1}</span>`;
    return `<a class="item sline" href="#/s/${s.id}">
      ${coverOf(g, "mini")}
      <div class="t"><b>${esc(g ? g.name : s.gameId)}</b><span>${BH.fmtDate(s.created)}${place ? " · " + esc(place.name) : ""}</span>${tablePeople(s)}</div>
      ${right}
    </a>`;
  }
  // one finished session as a tall card (home): cover, a cup when I won it, game, players, date
  function sessionCard(s, meId) {
    const g = BH.game(s.gameId);
    const won = meId && s.winners.includes(meId);
    return `<a class="gcard" href="#/s/${esc(s.id)}">
      ${coverOf(g, "gcard-img")}
      ${won ? `<span class="gcard-win" title="Вы победили">${IC.trophy}</span>` : ""}
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
          <div class="profile-stats"><span>${IC.dice}${nGames} ${BH.plural(nGames, "игра", "игры", "игр")}</span><span>${IC.people}${mine.length} ${BH.plural(mine.length, "партия", "партии", "партий")}</span></div>
          ${me ? "" : `<span class="small profile-hint">Отметьте себя в игроках — галочка «Это я»</span>`}
        </div>
      </a>
      ${live.length ? `<section class="panel"><h2 style="margin-bottom:4px">Идут сейчас</h2><div class="list">${live.map(sessionLine).join("")}</div></section>` : ""}
      <section>
        <h2 class="shelf-h">Последние партии</h2>
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
        <h2 class="shelf-h">${top.length > 1 ? top.length + " наиболее играемых" : "Самая играемая"}</h2>
        <div class="hscroll">${top.map(x => gameCard(x.g, { count: x.n })).join("")}</div>
      </section>` : ""}
      <section>
        <h2 class="shelf-h">Полка позора${shelf.length ? ` (${shelf.length} ${BH.plural(shelf.length, "игра", "игры", "игр")})` : ""}</h2>
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
    const per = {}; for (const s of inMonth) per[dayOf(s)] = (per[dayOf(s)] || 0) + 1;
    const thisMonth = cal.y === now.getFullYear() && cal.m === now.getMonth();
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push('<span class="cal-d off" aria-hidden="true"></span>');
    for (let d = 1; d <= days; d++) {
      const n = per[d] || 0;
      cells.push(`<button class="cal-d${thisMonth && d === now.getDate() ? " today" : ""}" data-act="cal-day" data-d="${d}" aria-pressed="${cal.day === d}" aria-label="${d} ${MONTHS_SHORT[cal.m]}${n ? ", " + n + " " + BH.plural(n, "партия", "партии", "партий") : ""}"><span>${d}</span><i class="dots">${"<b></b>".repeat(Math.min(n, 4))}</i></button>`);
    }
    const shown = cal.day ? inMonth.filter(s => dayOf(s) === cal.day) : inMonth;
    const live = S().sessions.filter(s => s.status !== "finished");
    return `<div class="stack">
      <div class="page-head"><div><h1>Партии</h1><p class="sub">Сыграно: ${finishedSessions().length} ${BH.plural(finishedSessions().length, "партия", "партии", "партий")}</p></div><a class="btn primary" href="#/new">${I.plus}Новая партия</a></div>
      ${live.length ? `<section class="panel"><h2 style="margin-bottom:4px">Идут сейчас</h2><div class="list">${live.map(sessionLine).join("")}</div></section>` : ""}
      <section class="panel cal">
        <div class="cal-head"><button class="icon-btn" data-act="cal-move" data-step="-1" aria-label="Предыдущий месяц">${I.back}</button>
          <b>${MONTHS_NOM[cal.m]} ${cal.y}</b>
          <button class="icon-btn cal-next" data-act="cal-move" data-step="1" aria-label="Следующий месяц">${I.back}</button></div>
        <div class="cal-grid cal-wd">${["пн", "вт", "ср", "чт", "пт", "сб", "вс"].map(x => `<span>${x}</span>`).join("")}</div>
        <div class="cal-grid">${cells.join("")}</div>
        ${thisMonth ? "" : `<div style="text-align:center;margin-top:6px"><button class="btn ghost sm" data-act="cal-today">К сегодняшнему дню</button></div>`}
      </section>
      <section class="panel">
        <div class="spread" style="margin-bottom:4px"><h2>${cal.day ? `${cal.day} ${MONTHS_SHORT[cal.m]}` : `За ${MONTHS_NOM[cal.m]}`}</h2>${cal.day ? `<button class="btn ghost sm" data-act="cal-day" data-d="${cal.day}">Весь месяц</button>` : ""}</div>
        ${shown.length ? `<div class="list">${shown.map(sessionLine).join("")}</div>` : `<p class="muted small" style="padding:8px 0">${cal.day ? "В этот день партий нет." : "В этом месяце партий нет."}</p>`}
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
        ${row("#/players", IC.people, "Игроки", `${nP} ${BH.plural(nP, "игрок", "игрока", "игроков")}${me ? " · это вы: " + esc(me.name) : " · отметьте себя"}`)}
        ${row("#/places", IC.pin, "Места", `${nPl} ${BH.plural(nPl, "место", "места", "мест")}`)}
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
    const g = BH.game(draft.gameId);
    if (!g) return "Выберите игру";
    const n = draft.players.length;
    if (n < g.players.min) return `Нужно минимум ${g.players.min} ${BH.plural(g.players.min, "игрок", "игрока", "игроков")}`;
    if (n > g.players.max) return `Для ${g.name} не больше ${g.players.max} игроков`;
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
      <div class="pick-list" data-list="games">${ranked.map(({ g: x, n: k }) => `<button type="button" class="pick-row" data-act="pick-game" data-id="${esc(x.id)}" data-name="${esc(x.name.toLowerCase())}" aria-pressed="${x.id === draft.gameId}">
        ${coverOf(x, "mini")}<span class="t"><b>${esc(x.name)}</b><span>${k ? k + " " + BH.plural(k, "партия", "партии", "партий") + " · " : ""}${x.players.min === x.players.max ? x.players.min : x.players.min + "–" + x.players.max} ${BH.plural(x.players.max, "игрок", "игрока", "игроков")} · ${esc(x.time || "")}</span></span>
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
      <form class="row" data-form="add-place" style="margin-top:10px"><input class="input" name="name" placeholder="Новое место: у Саши, в клубе…" maxlength="40" aria-label="Новое место"><button class="btn" type="submit">Добавить</button></form>`, true);

    // players: me first, "as last time" in one tap, the regulars on top, then the seating order
    let playersBody = "";
    {
      const meId = BH.me() ? BH.meId() : null;
      const pool = S().players.filter(p => !p.hidden || draft.players.includes(p.id))
        .map(p => ({ p, k: playsOf("player", p.id) })).sort((a, b) => (b.p.id === meId) - (a.p.id === meId) || b.k - a.k || a.p.name.localeCompare(b.p.name, "ru"));
      const lastAdd = draft.lastPlayers.filter(id => BH.player(id) && !draft.players.includes(id));
      const opts = g ? draftOptions(g) : [];
      playersBody = `
        ${lastAdd.length ? `<button type="button" class="btn sm last-btn" data-act="draft-last-players">${I.plus}Как в прошлой партии: ${esc(lastAdd.map(id => BH.player(id).name).join(", "))}</button>` : ""}
        ${pool.length > 9 ? `<div class="search">${I.search}<input class="input" type="search" data-act="pick-q" data-list="players" placeholder="Найти игрока" aria-label="Найти игрока" autocomplete="off"></div>` : ""}
        <div class="pick-list" data-list="players">${pool.map(({ p, k }) => { const on = draft.players.includes(p.id); return `<button type="button" class="pick-row" data-act="toggle-player" data-id="${p.id}" data-name="${esc(p.name.toLowerCase())}" aria-pressed="${on}">
          <span class="pick-box" aria-hidden="true">${on ? I.check : ""}</span>${BH.avatar(p)}<span class="t"><b>${esc(p.name)}</b><span>${p.id === meId ? "это вы · " : ""}${k ? k + " " + BH.plural(k, "партия", "партии", "партий") : "ещё не играл(а)"}</span></span></button>`; }).join("")}</div>
        <form class="row" data-form="add-player" style="margin-top:4px"><input class="input" name="name" placeholder="Новый игрок" maxlength="40" aria-label="Имя нового игрока"><button class="btn" type="submit">Добавить</button></form>
        ${cnt > 1 ? `<div><div class="label" style="margin:8px 0 2px">За столом, по часовой стрелке</div>${draft.players.map((id, i) => { const p = BH.player(id) || { name: "?", color: "#888" }; return `<div class="seat"><span class="n">${i + 1}</span>${BH.avatar(p, "sm")}<span>${esc(p.name)}</span>
            <span class="mv"><button class="icon-btn" data-act="seat-up" data-i="${i}" aria-label="Выше" ${i ? "" : "disabled"}>${I.up}</button><button class="icon-btn" data-act="seat-down" data-i="${i}" aria-label="Ниже" ${i < cnt - 1 ? "" : "disabled"}>${I.down}</button></span></div>`; }).join("")}</div>` : ""}
        ${g && cnt >= g.players.min && g.players.recommendedMin && cnt < g.players.recommendedMin ? `<div class="note info">${esc(g.playersNote || `По правилам ${g.name} рассчитан на ${g.players.recommendedMin} и больше игроков.`)}</div>` : ""}
        ${!past && opts.length ? `<div class="stack" style="gap:6px">${opts.map(o => `<label class="check" style="font-weight:500"><input type="checkbox" data-act="draft-opt" data-id="${esc(o.id)}" ${draft.opts[o.id] ? "checked" : ""}> ${esc(o.label)}</label>`).join("")}</div>` : ""}`;
    }
    const playersOk = !!g && !draftProblem();
    const playersSum = cnt ? `<span class="faces">${draft.players.slice(0, 5).map(id => BH.avatar(BH.player(id), "sm")).join("")}</span>${cnt} ${BH.plural(cnt, "игрок", "игрока", "игроков")}${g && !playersOk ? ` · <span class="warn-t">${esc(draftProblem())}</span>` : ""}`
      : '<span class="warn-t">Никого</span>';
    const playersSec = step2("players", "Игроки", playersSum, playersBody, playersOk && cnt >= (g.players.recommendedMin || g.players.min));

    let resultSec = "";
    if (past && g && cnt) {
      const scored = draft.players.filter(id => draft.final[id] !== undefined && draft.final[id] !== "").length;
      resultSec = step2("result", "Итог", draft.winners.length ? "Победа: " + esc(draft.winners.map(id => (BH.player(id) || { name: "?" }).name).join(", ")) : scored ? "Очки вписаны" : "Очки и победитель — по желанию",
        `<p class="small muted">Очки можно не вписывать. Победитель выберется по очкам, или отметьте его сами.</p>
        ${draft.players.map(id => { const p = BH.player(id) || { name: "?", color: "#888" }; return `<div class="seat" style="grid-template-columns:auto minmax(0,1fr) auto">${BH.avatar(p, "sm")}<span>${esc(p.name)}</span>
          <input class="input score-in" type="number" inputmode="numeric" data-act="draft-final" data-p="${id}" value="${draft.final[id] ?? ""}" placeholder="очки" aria-label="Очки: ${esc(p.name)}"></div>`; }).join("")}
        <div class="label" style="margin:12px 0 6px">Победитель</div>
        <div class="chips">${draft.players.map(id => { const p = BH.player(id) || { name: "?" }; return `<button class="chip" data-act="draft-winner" data-id="${id}" aria-pressed="${draft.winners.includes(id)}">${esc(p.name)}</button>`; }).join("")}</div>`, draft.winners.length > 0 || scored > 0);
    }

    const problem = draftProblem();
    const label = draft.editId ? "Сохранить" : past ? "Записать сыгранную партию" : "Создать партию";
    const back = draft.editId ? backLink("#/s/" + draft.editId + "/setup", "Подготовка") : backToOrigin("Отмена");
    return `<div class="stack">
      <div>${back}<div class="page-head"><div><h1>${draft.editId ? "Партия" : past ? "Сыгранная партия" : "Новая партия"}</h1></div></div></div>
      <div class="stepper">${dateSec}${gameSec}${placeSec}${playersSec}${resultSec}</div>
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
      let winners = draft.winners.filter(id => s.players.includes(id));
      if (!winners.length && Object.keys(final).length) {
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
    if (!BH.setupSteps(s).length) s.status = "first";
    S().sessions.unshift(s);
    BH.saveNow();
    draft = null;
    goReplace("#/s/" + s.id + "/" + (s.status === "setup" ? "setup" : "first"));
  }

  /* ---------- session screens ---------- */
  function viewSession(s, sub) {
    const g = BH.game(s.gameId);
    if (!g) return { html: notFound("Игра этой партии больше не в каталоге.") };
    const home = s.status === "setup" ? "setup" : s.status === "first" ? "first" : s.status === "playing" ? "play" : "done";
    if (!sub) sub = home;
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
    if (sub === "setup") return { html: viewSetup(s, g) };
    if (sub === "first") return { html: viewFirst(s, g) };
    if (sub === "play") return { html: viewPlay(s, g), after: () => BH.rulesUI.bind(main, g, { compact: true }) };
    if (sub === "rules") return { html: viewSessionRules(s, g), after: () => BH.rulesUI.bind(main, g) };
    if (sub === "done") return { html: viewDone(s, g) };
    return { html: notFound("Такого экрана нет.") };
  }
  const sessionTitle = (s, g) => {
    const place = BH.place(s.placeId);
    const exp = s.exp.map(id => (g.expansions.find(e => e.id === id) || {}).name).filter(Boolean);
    return `<span class="label">${esc(g.name)}${exp.length ? " + " + esc(exp.join(", ")) : ""}${place ? " · " + esc(place.name) : ""}</span>`;
  };

  function viewSetup(s, g) {
    const steps = BH.setupSteps(s);
    const done = steps.filter(st => s.setupDone[st.id]).length;
    const speakAll = "";   // voice is only for players' questions
    return `<div class="stack">
      <div>${backLink("#/s/" + s.id + "/edit", "Игра, место, игроки")}
        <div class="page-head"><div>${sessionTitle(s, g)}<h1>Подготовка</h1><p class="sub">${done} из ${steps.length} готово</p></div><div class="row">${speakAll}<button class="icon-btn" data-act="delete-session" aria-label="Удалить партию" title="Удалить партию">${I.trash}</button></div></div></div>
      <div class="progress" aria-hidden="true"><i style="width:${steps.length ? 100 * done / steps.length : 100}%"></i></div>
      ${steps.map((st, i) => `<section class="panel setup-step ${s.setupDone[st.id] ? "done" : ""}" id="step-${esc(st.id)}">
          <div class="art"${BH.assets.attr(g.id, ((g.images || {}).steps || {})[st.id])}>${st.art || ""}</div>
          <div class="body">
            <span class="label">Шаг ${i + 1}</span>
            <h2>${esc(st.title)}</h2>
            <p>${esc(st.text)}</p>
            <div class="row wrap">
              <label class="check"><input type="checkbox" data-act="setup-check" data-id="${esc(st.id)}" ${s.setupDone[st.id] ? "checked" : ""}> Готово</label>
            </div>
          </div>
        </section>`).join("")}
      <div class="sticky-foot"><button class="btn primary big block" data-act="setup-next">${I.wheel}${esc(g.first ? "Дальше: " + g.first.label.toLowerCase() : "Начать игру")}</button></div>
    </div>`;
  }

  function viewFirst(s, g) {
    const pl = s.players.map(BH.player).filter(Boolean);
    const chosen = s.first ? BH.player(s.first) : null;
    const label = (g.first && g.first.label) || "Первый игрок";
    return `<div class="stack">
      <div>${s.status === "playing" ? backLink("#/s/" + s.id + "/play", "К игре") : backLink("#/s/" + s.id + "/setup", "Подготовка")}
        <div class="page-head"><div>${sessionTitle(s, g)}<h1>${esc(label)}</h1>${g.first && g.first.hint ? `<p class="sub">${esc(g.first.hint)}</p>` : ""}</div></div></div>
      <section class="panel wheel-box">
        ${BH.wheel.html(pl)}
        <div class="wheel-result" id="wheel-result" aria-live="polite">${chosen ? esc(chosen.name) : ""}</div>
        <div class="actions" style="justify-content:center">
          <button class="btn ${chosen ? "" : "primary"} big" data-act="spin">${I.wheel}${chosen ? "Крутить ещё раз" : "Крутить"}</button>
          ${chosen ? `<button class="btn primary big" data-act="start-play">${s.status === "playing" ? "Готово" : "Начать игру"}</button>` : ""}
        </div>
      </section>
      <details class="panel"><summary class="small" style="cursor:pointer;font-weight:600">Выбрать вручную</summary>
        <div class="chips" style="margin-top:12px">${pl.map(p => `<button class="chip" data-act="set-first" data-id="${p.id}" aria-pressed="${s.first === p.id}"><span class="dot" style="background:${p.color}"></span>${esc(p.name)}</button>`).join("")}</div>
      </details>
    </div>`;
  }

  // the rounds as a table: who dealt, each player's points (✕ bust, ★ seven numbers), the totals for a finished game
  function roundsTable(s, g, editable) {
    const tot = BH.totals(s), best = s.rounds.map(rd => Math.max(...s.players.map(id => Number(rd.scores[id]) || 0)));
    const lead = g && g.rounds && g.rounds.leaderLabel;
    return `<div class="scroll-x"><table class="hist">
      <thead><tr><th>№</th>${s.players.map(id => { const p = BH.player(id) || { name: "?", color: "#888" }; return `<th title="${esc(p.name)}">${BH.avatar(p, "sm")}<span class="hist-n">${esc(p.name)}</span></th>`; }).join("")}</tr></thead>
      <tbody>${s.rounds.map((rd, i) => { const dealer = BH.player(rd.leader || BH.leaderAt(s, i));
        return `<tr${editable ? ` class="click" data-act="edit-round" data-i="${i}" tabindex="0"` : ""}><td class="hist-r"><span>${i + 1}</span>${lead && dealer ? `<span class="hist-d" title="${esc(lead)}: ${esc(dealer.name)}" style="background:${esc(dealer.color)}"></span>` : ""}</td>${s.players.map(id => { const f = (rd.flags || {})[id] || {}, v = Number(rd.scores[id]) || 0;
          return `<td class="${f.bust ? "bust" : f.flip7 ? "f7" : v && v === best[i] ? "top" : ""}">${f.bust ? "✕" : (f.flip7 ? "★ " : "") + v}</td>`; }).join("")}</tr>`; }).join("")}</tbody>
      ${editable ? "" : `<tfoot><tr><th>Итого</th>${s.players.map(id => `<th>${tot[id]}</th>`).join("")}</tr></tfoot>`}
    </table></div>${lead ? `<p class="tiny muted" style="margin-top:6px">Цветная точка у номера — ${esc(lead.toLowerCase())} раунда. ✕ — перебор, ★ — 7 разных чисел, жирным — лучший в раунде.</p>` : ""}`;
  }
  // per player over the rounds of one game: average, best round, busts, sevens
  function roundStats(s) {
    return s.players.map(id => {
      const pts = s.rounds.map(rd => Number(rd.scores[id]) || 0), fl = s.rounds.map(rd => (rd.flags || {})[id] || {});
      return { id, avg: pts.length ? Math.round(pts.reduce((a, b) => a + b, 0) / pts.length) : 0, best: pts.length ? Math.max(...pts) : 0,
        busts: fl.filter(f => f.bust).length, sevens: fl.filter(f => f.flip7).length };
    });
  }
  function viewPlay(s, g) {
    const r = s.rounds.length, leaderId = BH.leaderAt(s, r), leader = BH.player(leaderId);
    const tot = BH.totals(s), st = BH.standings(s), target = g.scoring && g.scoring.target;
    const top = st.length && st[0].total > 0 ? st[0].total : null;
    const last = s.rounds[r - 1];
    const board = s.players.map(id => {
      const p = BH.player(id) || { name: "?", color: "#888" };
      const t = tot[id], pct = target ? BH.clamp(100 * t / target, 0, 100) : 0;
      const lr = last ? last.scores[id] : null, lf = last && last.flags ? last.flags[id] || {} : {};
      return `<div class="pl ${t === top ? "lead" : ""}">
        ${BH.avatar(p)}
        <div style="min-width:0"><div class="nm"><span>${esc(p.name)}</span>${id === leaderId ? `<span class="badge accent">${esc(g.rounds.leaderLabel || "ходит")}</span>` : ""}</div>
          ${target ? `<div class="bar"><i style="width:${pct}%;background:${p.color}"></i></div>` : ""}</div>
        <div><div class="tot num">${t}</div><div class="last">${last ? (lf.bust ? "перебор" : (lf.flip7 ? "Flip 7! " : "") + "+" + lr) : target ? "из " + target : ""}</div></div>
      </div>`;
    }).join("");

    const hist = s.rounds.length ? `<section class="panel"><div class="spread" style="margin-bottom:6px"><h2>Раунды</h2><span class="small muted">нажмите на раунд, чтобы исправить</span></div>
      ${roundsTable(s, g, true)}</section>` : "";

    return `<div class="stack">
      <div>${backToOrigin()}
        <div class="spread">${sessionTitle(s, g)}<div class="row">${s.rounds.length ? "" : `<a class="btn ghost sm" href="#/s/${esc(s.id)}/first">${I.wheel}Первый</a>`}<button class="btn ghost sm" data-act="finish-menu">${I.flag}Завершить</button></div></div>
        <div class="round-head" style="margin-top:6px">
          <div><span class="label">Раунд</span><div class="round-no">${r + 1}</div></div>
          ${leader ? `<div class="leader">${BH.avatar(leader, "sm")}<div><span class="label">${esc(g.rounds.leaderLabel || "Начинает")}</span><div style="font-weight:600">${esc(leader.name)}</div></div></div>` : ""}
        </div>
      </div>
      <div class="play">
        <div class="stack">
          <div class="board">${board}</div>
          ${g.rounds.reminder ? `<details class="panel" ${r === 0 ? "open" : ""}><summary style="cursor:pointer;font-weight:600">Как идёт раунд</summary><ul class="reminder" style="margin:10px 0 0;padding-left:20px">${g.rounds.reminder.map(t => `<li>${esc(t)}</li>`).join("")}</ul></details>` : ""}
          ${hist}
        </div>
        <div class="stack">
          <section class="panel"><div class="spread" style="margin-bottom:10px"><h2>Правила</h2><a class="btn ghost sm" href="#/s/${s.id}/rules">${I.book}Все правила</a></div>${BH.rulesUI.panel(g, "", { compact: true })}</section>
        </div>
      </div>
      <div class="game-bar">
        <button class="btn big" data-act="ask-open" aria-label="Спросить по правилам голосом" title="Спросить по правилам">${MIC}</button>
        <button class="btn primary big" data-act="new-round">${I.plus}Записать раунд ${r + 1}</button>
        ${s.rounds.length ? `<button class="btn big" data-act="undo-round" aria-label="Отменить последний раунд" title="Отменить последний раунд">${I.undo}</button>` : ""}
      </div>
    </div>`;
  }

  function viewSessionRules(s, g) {
    return `<div class="stack">
      <div>${backLink("#/s/" + s.id + "/play", "К игре")}<div class="page-head"><div>${sessionTitle(s, g)}<h1>Правила</h1></div></div></div>
      ${askButton(g)}
      ${BH.rulesUI.panel(g, rulesQuery)}
    </div>`;
  }

  function viewDone(s, g) {
    const st = BH.standings(s), w = s.winners.map(BH.player).filter(Boolean);
    const dur = s.finishedAt && s.startedAt ? BH.fmtDuration(s.finishedAt - s.startedAt) : null;
    const place = BH.place(s.placeId);
    const crown = `<svg class="crown" viewBox="0 0 64 64" aria-hidden="true"><path d="M8 46 L12 18 L24 32 L32 12 L40 32 L52 18 L56 46 Z" style="fill:#E3A72F;stroke:#B57E14;stroke-width:2.5;stroke-linejoin:round"/><rect x="8" y="46" width="48" height="8" rx="2" style="fill:#B57E14"/></svg>`;
    return `<div class="stack">
      <div>${backToOrigin()}</div>
      <section class="panel podium">
        ${crown}
        ${sessionTitle(s, g)}
        <h1>${w.length > 1 ? "Ничья: " + esc(w.map(p => p.name).join(" и ")) : w.length ? "Победа: " + esc(w[0].name) : "Партия окончена"}</h1>
        <p class="muted">${s.rounds.length ? `${s.rounds.length} ${BH.plural(s.rounds.length, "раунд", "раунда", "раундов")}` : "записана после игры"}${dur && s.rounds.length ? " · " + dur : ""} · ${BH.fmtDate(s.created)}${place ? " · " + esc(place.name) : ""}</p>
        ${(() => { const n = g.finishNote && g.finishNote(s); if (!n) return ""; const note = typeof n === "string" ? { text: n, ok: true } : n; return `<p class="badge ${note.ok ? "good" : "warn"}" style="font-size:14px;padding:6px 12px">${esc(note.text)}</p>`; })()}
      </section>
      <section class="panel"><h2 style="margin-bottom:6px">Итог</h2>
        <div class="list">${st.map(x => { const p = BH.player(x.id) || { name: "?", color: "#888" }; return `<a class="item" href="#/players/${esc(x.id)}"><span class="place-n">${x.place}</span>${BH.avatar(p, "sm")}<div class="t"><b>${esc(p.name)}</b></div>${s.winners.includes(x.id) ? `<span class="won">${IC.trophy}</span>` : ""}<span class="num" style="font-size:20px;font-weight:700">${x.total}</span></a>`; }).join("")}</div>
      </section>
      ${s.rounds.length ? (() => {
        const rs = roundStats(s), anyF7 = rs.some(x => x.sevens), allR = [];
        s.rounds.forEach((rd, i) => s.players.forEach(id => allR.push({ id, i, v: Number(rd.scores[id]) || 0 })));
        const top = allR.sort((a, b) => b.v - a.v)[0], topP = top && BH.player(top.id);
        const busts = rs.reduce((a, x) => a + x.busts, 0), sevens = rs.reduce((a, x) => a + x.sevens, 0);
        return `<div class="kpis">
          <div class="kpi"><b>${s.rounds.length}</b><span>${BH.plural(s.rounds.length, "раунд", "раунда", "раундов")}</span></div>
          ${dur ? `<div class="kpi"><b>${dur}</b><span>длилась партия</span></div>` : ""}
          ${top && top.v ? `<div class="kpi"><b>${top.v}</b><span>лучший раунд${topP ? ": " + esc(topP.name) + ", " + (top.i + 1) + "-й" : ""}</span></div>` : ""}
          <div class="kpi"><b>${busts}</b><span>${BH.plural(busts, "перебор", "перебора", "переборов")}</span></div>
          ${sevens ? `<div class="kpi"><b>${sevens}</b><span>раз 7 разных чисел</span></div>` : ""}
        </div>
        <section class="panel"><h2 style="margin-bottom:6px">Раунды</h2>${roundsTable(s, g, false)}</section>
        <section class="panel"><h2 style="margin-bottom:6px">По игрокам</h2><div class="scroll-x"><table class="tbl">
          <thead><tr><th>Игрок</th><th title="Среднее за раунд">Ср.</th><th title="Лучший раунд">Макс.</th><th title="Переборы">✕</th>${anyF7 ? "<th>★</th>" : ""}</tr></thead>
          <tbody>${rs.map(x => { const p = BH.player(x.id) || { name: "?", color: "#888" }; return `<tr><td><span class="row">${BH.avatar(p, "sm")}${esc(p.name)}</span></td><td>${x.avg}</td><td>${x.best}</td><td>${x.busts}</td>${anyF7 ? `<td>${x.sevens}</td>` : ""}</tr>`; }).join("")}</tbody>
        </table></div><p class="tiny muted" style="margin-top:6px">Ср. — среднее за раунд, Макс. — лучший раунд, ✕ — переборы${anyF7 ? ", ★ — 7 разных чисел" : ""}.</p></section>`;
      })() : ""}
      <div class="actions">
        <button class="btn primary big" data-act="rematch">${I.plus}Ещё партию теми же</button>
        ${s.rounds.length ? `<button class="btn big" data-act="reopen">Вернуться к партии</button>` : ""}
        <button class="btn ghost big" data-act="delete-session">${I.trash}Удалить</button>
      </div>
    </div>`;
  }

  /* ---------- games catalogue ---------- */
  function viewGames() {
    const list = gamesByPlays(), n = BH.games.length;
    return `<div class="stack">
      <div class="page-head"><div><h1>Игры</h1><p class="sub">${n} ${BH.plural(n, "игра", "игры", "игр")} в коллекции · сначала самые играемые</p></div></div>
      ${n > 6 ? `<div class="search">${I.search}<input class="input" type="search" data-act="games-q" placeholder="По названию" aria-label="Поиск игры" autocomplete="off"></div>` : ""}
      <div class="glist">${list.map(({ g, n: k }) => `<a class="grow" href="#/games/${esc(g.id)}" data-name="${esc(g.name.toLowerCase())}">
          ${coverOf(g)}
          <span class="t"><b>${esc(g.name)}</b><span>${k ? k + " " + BH.plural(k, "партия", "партии", "партий") : "ещё не играли"}${g.time ? " · " + esc(g.time) : ""}</span></span>
          ${k ? `<span class="grow-n" title="Партий">${IC.people}${k}</span>` : ""}
        </a>`).join("")}</div>
      <p class="muted small" id="games-none" hidden>Ничего не нашлось.</p>
    </div>`;
  }
  function viewGame(g) {
    return `<div class="stack">
      <div>${backSmart("#/games", "Игры")}
        <div class="game" style="cursor:default;border:none;padding:0;background:none"><span class="cover" style="width:80px;height:80px"${BH.assets.cover(g)}>${g.cover || ""}</span>
          <span><h1>${esc(g.name)}</h1><span>${esc(g.publisher || "")}${g.year ? ", " + g.year : ""} · от ${g.players.recommendedMin || g.players.min} игроков · ${esc(g.time || "")} · ${esc(g.age || "")}</span></span></div></div>
      ${g.tagline ? `<p>${esc(g.tagline)}</p>` : ""}
      <div class="actions"><button class="btn primary big" data-act="new-with" data-id="${g.id}">${I.plus}Новая партия</button>${askButton(g, true)}</div>
      ${BH.rulesUI.panel(g, "")}
    </div>`;
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
      <div>${backSmart("#/menu", "Меню")}<div class="page-head"><div><h1>Игроки</h1><p class="sub">${visible} ${BH.plural(visible, "игрок", "игрока", "игроков")} · друзья и семья, с кем вы играете</p></div>
        ${list.length > 1 ? `<button class="btn ghost sm" data-act="players-sort">${playersSort === "name" ? "По числу партий" : "По имени А–Я"}</button>` : ""}</div></div>
      ${list.length && !meId ? `<div class="note info small">Отметьте себя: откройте свою карточку, нажмите «Изменить» и поставьте галочку «Это я» — тогда на главной будет ваш профиль.</div>` : ""}
      <form class="row" data-form="add-player-page"><input class="input" name="name" placeholder="Имя нового игрока" maxlength="40" aria-label="Имя нового игрока"><button class="btn primary" type="submit">Добавить</button></form>
      ${list.length > 9 ? `<div class="search">${I.search}<input class="input" type="search" data-act="players-q" placeholder="Поиск по имени" aria-label="Поиск игрока" autocomplete="off"></div>` : ""}
      ${list.length ? `<div class="pgrid">${list.map(({ p, n }) => `<a class="pcell${p.hidden ? " off" : ""}" href="#/players/${esc(p.id)}" data-name="${esc(p.name.toLowerCase())}">
          <span class="pcell-av">${BH.avatar(p, "xl")}${p.id === meId ? STAR : ""}</span>
          <b>${esc(p.name)}</b><span>${n ? n + " " + BH.plural(n, "партия", "партии", "партий") : "ещё не играл(а)"}${p.hidden ? " · скрыт" : ""}</span>
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
      <div>${backSmart("#/players", "Игроки")}</div>
      <section class="pc-head" style="--pc:${esc(p.color)}">
        <span class="pc-av">${BH.avatar(p, "xxl")}${isMe ? STAR : ""}</span>
        <div class="pc-name"><h1>${esc(p.name)}</h1>${isMe ? '<span class="badge accent">это вы</span>' : ""}${p.hidden ? '<span class="badge">скрыт из выбора</span>' : ""}</div>
        ${editPlayer === p.id ? "" : `<button class="btn ghost sm" data-act="edit-player" data-id="${esc(p.id)}">${I.edit}Изменить</button>`}
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
    const rivals = st.opponents.slice(0, 8).map(o => { const q = BH.player(o.id); return q ? `<a class="item" href="#/players/${esc(q.id)}">${BH.avatar(q)}<div class="t"><b>${esc(q.name)}</b><span>${parties(o.n)} вместе · побед: ${o.myWins} против ${o.theirWins}</span></div></a>` : ""; }).join("");
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
        ${line("Любимая игра", fav ? esc(name(fav.gameId)) + " · " + parties(fav.n) : "")}
        ${line("Лучше всего получается", best ? esc(name(best.gameId)) + " · " + Math.round(100 * best.rate) + "% побед" : "")}
        ${line("Любимое место", place ? esc(place.name) + " · " + parties(st.favPlace.n) : "")}
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
      <p class="small muted" style="text-align:center">Всего: ${st.games.length} ${BH.plural(st.games.length, "игра", "игры", "игр")} · ${st.played} ${BH.plural(st.played, "партия", "партии", "партий")}${st.time ? " · " + BH.fmtDuration(st.time) : ""}</p>
      <div class="pc-games">${list.map((e, i) => { const g = BH.game(e.gameId); return `<a class="pc-game" href="${g ? "#/games/" + esc(g.id) : "#/games"}">
        ${coverOf(g)}
        <span class="t"><span class="pc-g1"><i class="rank">${i + 1}</i><b>${esc(nameOf(e))}</b><span class="badge">${e.n} ${BH.plural(e.n, "партия", "партии", "партий")}</span></span>
          <span class="pc-g2"><span>${IC.trophy}${e.wins} · ${Math.round(100 * e.rate)}%</span>${e.time ? `<span>${BH.fmtDuration(e.time)}</span>` : ""}<span class="pc-avg">ср. ${e.avg} · лучший ${e.best}</span></span></span>
      </a>`; }).join("")}</div>`;
  }
  function viewPlaces() {
    const fin = finishedSessions();
    return `<div class="stack">
      <div>${backSmart("#/menu", "Меню")}<div class="page-head"><div><h1>Места</h1><p class="sub">Где вы играете — для статистики.</p></div></div></div>
      <section class="panel">
        <div class="list">${S().places.length ? S().places.map(p => { const n = fin.filter(s => s.placeId === p.id).length; return `<div class="item"><div class="t"><b>${esc(p.name)}</b><span>${n ? n + " " + BH.plural(n, "партия", "партии", "партий") : "ещё не играли"}</span></div>${n ? "" : `<button class="icon-btn" data-act="del-place" data-id="${p.id}" aria-label="Удалить место ${esc(p.name)}">${I.trash}</button>`}</div>`; }).join("") : `<p class="muted small" style="padding:8px 0">Мест пока нет.</p>`}</div>
        <form class="row" data-form="add-place" style="margin-top:8px"><input class="input" name="name" placeholder="Новое место" maxlength="40" aria-label="Новое место"><button class="btn" type="submit">Добавить</button></form>
      </section>
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
      const g0 = statsGame ? BH.playerStats(p.id, fin).games[0] : null, best = g0 ? g0.best : 0;   // one game: lowest wins where it should
      return { p, played: mine.length, wins, rate: mine.length ? wins / mine.length : 0, best };
    }).filter(x => x.played).sort((a, b) => b.wins - a.wins || b.rate - a.rate || b.played - a.played);
    const byGame = BH.games.map(g => ({ g, n: fin.filter(s => s.gameId === g.id).length, last: fin.filter(s => s.gameId === g.id).reduce((m, s) => Math.max(m, s.finishedAt || 0), 0) })).filter(x => x.n);
    const byPlace = [...S().places, { id: null, name: "Не указано" }].map(p => ({ p, n: fin.filter(s => (s.placeId || null) === p.id).length })).filter(x => x.n);
    const opts = `<option value="">Все игры</option>${BH.games.map(g => `<option value="${g.id}" ${g.id === statsGame ? "selected" : ""}>${esc(g.name)}</option>`).join("")}`;
    return `<div class="stack">
      <div>${backSmart("#/menu", "Меню")}<div class="page-head"><div><h1>Статистика</h1><p class="sub">По завершённым партиям.</p></div>
        <select class="input" style="width:auto" data-act="stats-game" aria-label="Игра">${opts}</select></div></div>
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
  const askButton = (g, inline) => `${inline ? "" : '<div class="actions">'}<button class="btn big" data-act="ask-open" data-game="${esc(g.id)}">${MIC}Спросить голосом</button>${inline ? "" : "</div>"}`;

  /* ---------- voice assistant: asking ---------- */
  let ask = null;   // { gameId, sid, phase: listening|thinking|answer|error, text, result, error }
  let rec = null, askCtl = null;
  function situationOf(s) {
    if (!s) return "";
    // no player names: they do not help the answer and need not leave the phone
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
    if (a.phase === "listening") body = `<div class="ask-live"><span class="ask-pulse" aria-hidden="true">${mic}</span><p id="ask-heard" class="ask-heard">${esc(a.text || "Слушаю…")}</p><p class="tiny muted">Говорите спокойно, паузы не страшны. Когда закончите, нажмите «Отправить». Например: «можно ли сыграть заморозь на себя?»</p></div>`;
    else if (a.phase === "thinking") body = `<div class="ask-live"><p class="ask-q">«${esc(a.text)}»</p><p class="muted">Ищу в правилах…</p></div>`;
    else if (a.phase === "answer") body = `<p class="ask-q">«${esc(a.text)}»</p>
        <div class="ask-answer ${r.found ? "" : "nf"}">${esc(r.answer)}</div>
        ${r.quote ? `<details class="small"><summary style="cursor:pointer;font-weight:600;color:var(--muted)">Где это в правилах${r.page ? `: стр. ${esc(r.page)}` : ""}</summary><blockquote class="ask-quote" style="margin-top:8px">${esc(r.quote)}${r.page ? `<cite>Книга правил, стр. ${esc(r.page)}</cite>` : ""}</blockquote></details>` : ""}
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
        <div class="sheet-body"><p>${esc(dialog.text)}</p></div>
        <div class="sheet-foot" style="flex-direction:column">${dialog.buttons.map((b, i) => `<button class="btn ${b.primary ? "primary" : b.danger ? "danger" : ""} big block" data-act="dlg" data-i="${i}">${esc(b.label)}</button>`).join("")}</div>
      </div></div>`;
      const f = overlayRoot.querySelector(".btn.primary") || overlayRoot.querySelector(".btn"); if (f) f.focus();
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

  function openSheet(s, index) {
    const g = BH.game(s.gameId);
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
    if (e.sel.flags && e.sel.flags.bust) return Object.assign({}, calc, { score: 0, bust: true });   // a bust is 0 whatever was typed
    if (e.manual !== null && e.manual !== undefined && e.manual !== "") return { score: Math.round(Number(e.manual)) || 0, manual: true, notes: ["введено вручную"] };
    return calc;
  }

  function sheetHTML() {
    const s = BH.session(sheet.sid), g = BH.game(s.gameId), ctx = BH.ctxOf(s);
    const idx = sheet.index !== null ? sheet.index : s.rounds.length;
    const results = s.players.map(id => entryResult(g, s, sheet.entries[id]));
    const warns = g.calc && g.calc.roundWarnings ? g.calc.roundWarnings(results, s.players.map(id => sheet.entries[id].sel), ctx) : [];
    const leader = BH.player(BH.leaderAt(s, idx));
    const body = s.players.map((id, i) => {
      const p = BH.player(id) || { name: "?", color: "#888" }, e = sheet.entries[id], res = results[i];
      const open = sheet.open === id && g.calc;
      const bust = e.sel.flags && e.sel.flags.bust;
      let picker = "";
      if (open) {
        picker = `<div class="picker" ${bust ? 'style="opacity:.45"' : ""}>${g.calc.groups.map(grp => {
          const mine = e.sel.picks[grp.id] || [];
          const uniq = grp.uniqueAcross && grp.uniqueAcross(ctx);
          const taken = uniq ? new Set(s.players.filter(o => o !== id).flatMap(o => (sheet.entries[o].sel.picks[grp.id] || []))) : new Set();
          return `<div class="grp"><span class="label">${esc(grp.label)}${grp.max ? ` · ${mine.length} из ${grp.max}` : ""}</span><div class="cards">${grp.items.map(v => {
            const on = mine.includes(v);
            const dis = !on && ((grp.max && mine.length >= grp.max) || taken.has(v));
            return `<button type="button" class="card-t ${grp.style === "mod" ? "mod" : ""}" data-act="pick" data-p="${id}" data-g="${grp.id}" data-v="${esc(JSON.stringify(v))}" aria-pressed="${on}" ${dis ? "disabled" : ""} title="${taken.has(v) ? "Эта карта уже у другого игрока" : ""}">${esc(grp.show ? grp.show(v) : v)}</button>`;
          }).join("")}</div></div>`;
        }).join("")}</div>`;
      }
      const flags = g.calc && g.calc.flags ? g.calc.flags.map(f => `<button type="button" class="flag" data-act="flag" data-p="${id}" data-f="${f.id}" aria-pressed="${!!(e.sel.flags && e.sel.flags[f.id])}">${esc(f.label)}</button>`).join("") : "";
      return `<div class="entry ${open ? "open" : ""}" data-entry="${id}">
        <div class="entry-head">${BH.avatar(p, "sm")}
          <button type="button" class="nm" data-act="open-entry" data-p="${id}" style="background:none;border:none;padding:0;text-align:left;cursor:${g.calc ? "pointer" : "default"}">${esc(p.name)}${res.flip7 ? ' <span class="badge good">Flip 7</span>' : ""}${res.bust ? ' <span class="badge bad">перебор</span>' : ""}</button>
          <input class="input score-in" type="number" inputmode="numeric" step="1" data-act="manual" data-p="${id}" value="${res.manual ? esc(e.manual) : ""}" placeholder="${res.score}" aria-label="Очки: ${esc(p.name)}">
        </div>
        ${g.calc ? `<div class="spread"><div class="flagrow">${flags}${open ? "" : `<button type="button" class="flag" data-act="open-entry" data-p="${id}">Карты</button>`}</div><span class="notes" data-notes="${id}">${esc((res.notes || []).join("; "))}</span></div>` : ""}
        ${picker}
        ${open ? `<div class="row" style="justify-content:flex-end">${i < s.players.length - 1 ? `<button type="button" class="btn sm" data-act="open-entry" data-p="${s.players[i + 1]}">Дальше: ${esc((BH.player(s.players[i + 1]) || {}).name || "")}</button>` : `<button type="button" class="btn sm" data-act="open-entry" data-p="">Свернуть</button>`}</div>` : ""}
      </div>`;
    }).join("");
    return `<div class="overlay" data-act="overlay-bg"><div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-h">
      <div class="sheet-head"><div><span class="label">${leader ? esc((g.rounds.leaderLabel || "Начинал") + ": " + leader.name) : ""}</span><h2 id="sheet-h">${sheet.index !== null ? "Исправить раунд " + (idx + 1) : "Раунд " + (idx + 1)}</h2></div>
        <button class="icon-btn" data-act="close-sheet" aria-label="Закрыть">${I.x}</button></div>
      <div class="sheet-body">
        ${g.calc ? `<p class="small muted">Отметьте карты каждого игрока, и приложение посчитает очки. Можно и просто вписать число справа.</p>` : `<p class="small muted">Впишите очки каждого игрока за раунд.</p>`}
        ${body}
        ${warns.map(w => `<div class="note">${esc(w)}</div>`).join("")}
      </div>
      <div class="sheet-foot">
        ${sheet.index !== null ? `<button class="btn danger" data-act="delete-round">${I.trash}Удалить</button>` : ""}
        <button class="btn primary big" data-act="save-round">${I.check}Сохранить раунд</button>
      </div>
    </div></div>`;
  }

  function saveRound() {
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
        title: "Ничья", text: ((g.scoring && g.scoring.tieNote) || "Сразу несколько игроков с лучшим счётом.") + " Сейчас поровну у: " + end.winners.map(id => (BH.player(id) || {}).name).join(", ") + ".",
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

  function finish(s, winners) {
    s = fresh(s);
    s.status = "finished";
    s.finishedAt = Date.now();
    s.winners = winners;
    delete s.continueTie;
    BH.clearToast();
    BH.saveNow();
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
      case "seat-up": case "seat-down": { const i = +el.dataset.i, j = act === "seat-up" ? i - 1 : i + 1; const a = draft.players; [a[i], a[j]] = [a[j], a[i]]; render(); break; }
      case "new-with": startDraft(el.dataset.id); go("#/new/" + el.dataset.id); break;

      /* setup */
      case "setup-check": break; // handled on change
      case "say-step": { const st = BH.setupSteps(s).find(x => x.id === el.dataset.id); if (st) BH.speech.speak(st.title + ". " + st.text); break; }
      case "say-setup": {
        if (BH.speech.speaking) { BH.speech.stop(); render(); break; }
        const st = BH.setupSteps(s).filter(x => !s.setupDone[x.id]);
        const list = st.length ? st : BH.setupSteps(s);
        BH.speech.speak(list.map((x, i) => "Шаг " + (i + 1) + ". " + x.title + ". " + x.text).join(" "), () => render());
        render();
        break;
      }
      case "setup-next": BH.speech.stop(); s.status = s.status === "setup" ? "first" : s.status; BH.saveNow(); goReplace("#/s/" + s.id + "/first"); break;

      /* first player */
      case "spin": {
        const pl = s.players;
        el.disabled = true;
        const res = BH.$("#wheel-result"); if (res) res.textContent = "Крутится…";
        const my = ++spinToken;
        spinning = true;
        BH.$$('[data-act="start-play"],[data-act="set-first"]').forEach(b => { b.disabled = true; });
        BH.wheel.spin(main, pl.length, i => {
          spinning = false;
          if (my !== spinToken) return;            // the user picked someone else or left the screen meanwhile
          BH.$$('[data-act="start-play"],[data-act="set-first"]').forEach(b => { b.disabled = false; });
          const cur = fresh(s); cur.first = pl[i]; BH.saveNow();
          const p = BH.player(pl[i]);
          // re-render only the controls, keep the disc where it stopped
          if (res) res.textContent = p ? p.name : "";
          el.disabled = false;
          el.classList.remove("primary");
          el.innerHTML = I.wheel + "Крутить ещё раз";
          if (!BH.$('[data-act="start-play"]')) el.insertAdjacentHTML("afterend", `<button class="btn primary big" data-act="start-play">${s.status === "playing" ? "Готово" : "Начать игру"}</button>`);
          BH.$$('[data-act="set-first"]').forEach(b => b.setAttribute("aria-pressed", String(b.dataset.id === s.first)));
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
      case "undo-round": openDialog({ title: "Отменить раунд " + s.rounds.length + "?", text: "Очки этого раунда удалятся.", buttons: [
        { label: "Отменить раунд", danger: true, run: () => { const c = fresh(s); c.rounds.pop(); BH.saveNow(); dialog = null; afterRoundChange(c, false); } }, { label: "Оставить", run: closeDialog }] }); break;
      case "finish-menu": {
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
      case "open-entry": sheet.open = el.dataset.p || null; renderOverlay(); { const n = overlayRoot.querySelector(`[data-entry="${el.dataset.p}"]`); if (n) n.scrollIntoView({ block: "nearest" }); } break;
      case "pick": {
        const en = sheet.entries[el.dataset.p], gid = el.dataset.g, v = JSON.parse(el.dataset.v);
        const arr = en.sel.picks[gid] = en.sel.picks[gid] || [];
        const i = arr.indexOf(v); i >= 0 ? arr.splice(i, 1) : arr.push(v);
        arr.sort((a, b) => (typeof a === "number" && typeof b === "number" ? a - b : 0));
        en.manual = null;
        renderOverlay();
        break;
      }
      case "flag": { const en = sheet.entries[el.dataset.p]; en.sel.flags[el.dataset.f] = !en.sel.flags[el.dataset.f]; if (en.sel.flags.bust) en.manual = null; renderOverlay(); break; }
      case "save-round": saveRound(); break;
      case "delete-round": { const i = sheet.index; openDialog({ title: "Удалить раунд " + (i + 1) + "?", text: "Остальные раунды сохранятся, сдающие сдвинутся.", buttons: [
        { label: "Удалить", danger: true, run: () => { const c = fresh(s); c.rounds.splice(i, 1); sheet = null; dialog = null; BH.saveNow(); afterRoundChange(c, false); } }, { label: "Отмена", run: () => { dialog = null; renderOverlay(); } }] }); break; }
      case "dlg": { const b = dialog && dialog.buttons[+el.dataset.i]; if (b) b.run(); break; }

      /* done */
      case "rematch": { if (el.disabled) break; el.disabled = true;   // a double tap must not create two games
        startDraft(s.gameId); Object.assign(draft, { exp: s.exp.slice(), placeId: s.placeId, players: s.players.slice(), opts: Object.assign({}, s.opts) }); saveDraft(); break; }
      case "reopen": s.status = "playing"; s.winners = []; delete s.finishedAt; BH.saveNow(); goReplace("#/s/" + s.id + "/play"); break;
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
      case "players-sort": playersSort = playersSort === "name" ? "plays" : "name"; render(); break;
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
      case "del-place": S().places = S().places.filter(x => x.id !== el.dataset.id); BH.saveNow(); render(); break;

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
    if (el.dataset.act === "setup-check" && s) {
      s.setupDone[el.dataset.id] = el.checked; BH.saveNow();
      const card = el.closest(".setup-step"); if (card) card.classList.toggle("done", el.checked);
      const steps = BH.setupSteps(s), done = steps.filter(x => s.setupDone[x.id]).length;
      const bar = BH.$(".progress > i"); if (bar) bar.style.width = (100 * done / steps.length) + "%";
      const sub = BH.$(".page-head .sub"); if (sub) sub.textContent = `${done} из ${steps.length} готово`;
      if (el.checked) { const nx = steps.find(x => !s.setupDone[x.id]); const n = nx && BH.$("#step-" + nx.id); if (n) n.scrollIntoView({ block: "center", behavior: "smooth" }); }
    }
    if (el.dataset.act === "stats-game") { statsGame = el.value; render(); }
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
    if (el.dataset.act === "draft-opt" && draft) { draft.opts[el.dataset.id] = el.checked; }
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
    editPlayer = null; editKeep = null;   // an open player form closes on any move
    sheet = null; dialog = null; ovPushed = false; quiet();
    if (ask) { stopListening(); if (askCtl) askCtl.abort(); askCtl = null; ask = null; }
    render();
    window.scrollTo(0, 0);
  });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);

  /* ---------- start ---------- */
  BH.version = "0.11.0";
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
  BH._render = render; // for tests
})();
