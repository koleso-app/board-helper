/* Помощник настолок — screens and navigation.
   Routes (hash): #/  #/new  #/s/<id>/setup|first|play|rules|done  #/games  #/games/<id>  #/players  #/stats  #/settings */
(function () {
  "use strict";
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
  const go = h => { if (location.hash === h) render(); else location.hash = h; };
  // same, but the current screen is dropped from the history: "back" will not return to it
  // (used after a game is created, so "back" cannot bring up the form and create it twice)
  const goReplace = h => { if (location.hash === h) render(); else location.replace(location.pathname + location.search + h); };
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
  let showAllDone = false;    // home: show every finished game, not only the latest

  function confirmDelete(s) {
    openDialog({ title: "Удалить партию?", text: "Она пропадёт из истории и статистики. Это нельзя отменить.", buttons: [
      { label: "Удалить", danger: true, run: () => { S().sessions = S().sessions.filter(x => x !== s); BH.saveNow(); dialog = null; go("#/"); } },
      { label: "Отмена", run: closeDialog }] });
  }

  function render() {
    const r = route();
    let html = "", nav = "home", inGame = false, after = null;
    try {
      if (r.a === "" ) html = viewHome();
      else if (r.a === "new") { html = viewNew(); nav = "home"; inGame = true; }
      else if (r.a === "s") {
        const s = BH.session(r.b);
        if (!s) html = notFound("Партия не найдена. Возможно, её удалили.");
        else {
          inGame = r.c !== "done";
          const res = viewSession(s, r.c);
          html = res.html; after = res.after;
        }
      }
      else if (r.a === "games" && r.b) { const g = BH.game(r.b); nav = "games"; if (g) { html = viewGame(g); after = () => BH.rulesUI.bind(main, g); } else html = notFound("Такой игры нет в каталоге."); }
      else if (r.a === "games") { html = viewGames(); nav = "games"; }
      else if (r.a === "players") { html = viewPlayers(); nav = "players"; }
      else if (r.a === "stats") { html = viewStats(); nav = "stats"; }
      else if (r.a === "settings") { html = viewSettings(); nav = ""; }
      else html = notFound("Такой страницы нет.");
    } catch (e) {
      console.error(e);
      html = `<div class="note">Что-то пошло не так: ${esc(e.message)}. <a href="#/">На главную</a></div>`;
    }
    main.innerHTML = html;
    document.body.classList.toggle("in-game", inGame);
    BH.$$("[data-nav]").forEach(a => { if (a.dataset.nav === nav) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
    if (after) after();
    renderOverlay();
    updateSync();
    BH.assets.hydrate(main);
  }
  // the sync waits while the user is in the middle of something
  let spinning = false;
  BH.uiBusy = () => {
    const a = document.activeElement;
    const typing = a && a.matches && a.matches("main input:not([type=checkbox]), main textarea") && a.value;   // half-typed text would be lost by a redraw
    return !!(sheet || dialog || ask || spinning || typing);
  };
  const notFound = text => `<div class="empty"><p>${esc(text)}</p><p style="margin-top:12px"><a class="btn" href="#/">На главную</a></p></div>`;
  const backLink = (href, text) => `<a class="back" href="${href}">${I.back}<span>${esc(text)}</span></a>`;

  /* ---------- home ---------- */
  function sessionLine(s) {
    const g = BH.game(s.gameId), pl = s.players.map(BH.player).filter(Boolean);
    const place = BH.place(s.placeId);
    let status = "";
    if (s.status === "setup") status = '<span class="badge warn">подготовка</span>';
    else if (s.status === "first") status = '<span class="badge warn">выбор первого</span>';
    else if (s.status === "playing") status = `<span class="badge accent">раунд ${s.rounds.length + 1}</span>`;
    else {
      const w = s.winners.map(BH.player).filter(Boolean).map(p => p.name);
      status = w.length ? `<span class="badge good">${w.length > 1 ? "ничья: " : "победа: "}${esc(w.join(", "))}</span>` : "";
    }
    return `<a class="item" href="#/s/${s.id}">
      <div class="faces">${pl.slice(0, 4).map(p => BH.avatar(p, "sm")).join("")}</div>
      <div class="t"><b>${esc(g ? g.name : s.gameId)}</b><span>${BH.fmtDate(s.created)}${place ? " · " + esc(place.name) : ""} · ${pl.length} ${BH.plural(pl.length, "игрок", "игрока", "игроков")}</span></div>
      ${status}
    </a>`;
  }

  function viewHome() {
    const live = S().sessions.filter(s => s.status !== "finished");
    const done = S().sessions.filter(s => s.status === "finished").sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0));
    const deco = `<svg class="deco" viewBox="0 0 100 100" aria-hidden="true"><rect x="8" y="20" width="44" height="62" rx="7" transform="rotate(-14 30 51)" fill="currentColor"/><rect x="46" y="16" width="44" height="62" rx="7" transform="rotate(12 68 47)" fill="currentColor"/></svg>`;
    return `<div class="stack">
      <section class="hero">
        ${deco}
        <h1>Во что играем?</h1>
        <p>Выберите игру, игроков и место. Приложение покажет, что разложить, выберет первого игрока и будет вести раунды и очки.</p>
        <a class="btn big" href="#/new">${I.plus}Новая партия</a>
      </section>
      ${live.length ? `<section class="panel"><div class="spread" style="margin-bottom:4px"><h2>Идут сейчас</h2></div><div class="list">${live.map(sessionLine).join("")}</div></section>` : ""}
      <section class="panel">
        <div class="spread" style="margin-bottom:4px"><h2>Сыгранные партии</h2>${done.length ? `<a class="small" href="#/stats">Статистика</a>` : ""}</div>
        ${done.length ? `<div class="list">${done.slice(0, showAllDone ? done.length : 12).map(sessionLine).join("")}</div>
          ${!showAllDone && done.length > 12 ? `<button class="btn ghost sm" data-act="show-all">Показать все ${done.length}</button>` : ""}` : `<p class="muted small" style="padding:8px 0">Пока пусто. Первая сыгранная партия появится здесь.</p>`}
      </section>
      <div class="row" style="justify-content:flex-end"><a class="btn ghost sm" href="#/settings">${I.gear}Настройки и копия данных</a></div>
    </div>`;
  }

  /* ---------- new game: one page with sections (date, game, expansions, place, players) ----------
     The same page edits a game that has not started yet (#/s/<id>/edit). A date in the past turns it
     into "record a game you already played": final scores and the winner, straight to the history. */
  const PAST_MS = 3 * 3600 * 1000;
  function startDraft(gameId, from) {
    if (from) {
      draft = { editId: from.id, date: from.created, gameId: from.gameId, exp: from.exp.slice(), placeId: from.placeId, players: from.players.slice(), opts: Object.assign({}, from.opts), final: {}, winners: [], pickGame: false };
      return;
    }
    const last = S().sessions[0];
    const lastSame = gameId ? S().sessions.find(s => s.gameId === gameId) : null;
    const src = lastSame || last;
    const gid = gameId || (src && BH.game(src.gameId) ? src.gameId : (BH.games.length === 1 ? BH.games[0].id : null));
    draft = {
      date: Date.now(),
      gameId: gid,
      exp: lastSame ? lastSame.exp.slice() : [],
      placeId: (src && BH.place(src.placeId) ? src.placeId : (S().places[0] || {}).id) || null,
      players: src ? src.players.filter(id => { const p = BH.player(id); return p && !p.hidden; }) : [],
      opts: {}, final: {}, winners: [], pickGame: !gid, gameQuery: "",
    };
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

  function viewNew() {
    if (!draft) startDraft();
    const g = BH.game(draft.gameId);
    const past = draftPast();
    let n = 0;
    const sec = (title, sub, body) => `<section class="panel form-sec"><div class="sec-head"><span class="sec-n">${++n}</span><div><h2>${esc(title)}</h2>${sub ? `<p class="small muted">${sub}</p>` : ""}</div></div>${body}</section>`;

    const dateSec = sec("Дата игры", past ? "Партия в прошлом: запишете сразу итог, без подготовки и раундов." : "", `<input class="input" type="datetime-local" data-act="draft-date" value="${localInput(draft.date)}" max="${localInput(Date.now() + 86400000)}" aria-label="Дата и время игры">`);

    let gameBody;
    if (g && !draft.pickGame) {
      gameBody = `<div class="row"><span class="game-mini"${BH.assets.cover(g)}>${g.cover || ""}</span><div class="grow"><b>${esc(g.name)}</b><div class="small muted">от ${esc(g.players.recommendedMin || g.players.min)} игроков · ${esc(g.time || "")}</div></div>${draft.editId ? "" : `<button class="btn sm" data-act="change-game">Изменить</button>`}</div>`;
    } else {
      const q = (draft.gameQuery || "").toLowerCase();
      const list = BH.games.filter(x => !q || x.name.toLowerCase().includes(q));
      gameBody = `${BH.games.length > 6 ? `<div class="search">${I.search}<input class="input" data-act="game-q" value="${esc(draft.gameQuery || "")}" placeholder="Найти игру" aria-label="Найти игру"></div>` : ""}
        <div class="games" style="margin-top:8px">${list.map(x => `<button class="game" data-act="pick-game" data-id="${x.id}" aria-pressed="${x.id === draft.gameId}">
          <span class="cover"${BH.assets.cover(x)}>${x.cover || ""}</span><span><b>${esc(x.name)}</b><span>от ${esc(x.players.recommendedMin || x.players.min)} игроков · ${esc(x.time || "")}</span></span></button>`).join("")}</div>`;
    }
    const gameSec = sec("Игра", "", gameBody);

    const expSec = g && g.expansions.length ? sec("Дополнения", "От них зависят подготовка и правила. Без отметок — базовая игра.",
      `<div class="chips">${g.expansions.map(e => `<button class="chip" data-act="toggle-exp" data-id="${e.id}" aria-pressed="${draft.exp.includes(e.id)}">${esc(e.name)}</button>`).join("")}</div>`) : "";

    const placeSec = sec("Место", "", `<div class="chips">${S().places.map(p => `<button class="chip" data-act="pick-place" data-id="${p.id}" aria-pressed="${p.id === draft.placeId}">${esc(p.name)}</button>`).join("")}
        <button class="chip" data-act="pick-place" data-id="" aria-pressed="${!draft.placeId}">Не указывать</button></div>
      <form class="row" data-form="add-place" style="margin-top:10px"><input class="input" name="name" placeholder="Новое место: у Саши, в клубе…" maxlength="40" aria-label="Новое место"><button class="btn" type="submit">Добавить</button></form>`);

    let playersBody = "", ok = !!g;
    if (g) {
      const pmin = g.players.min, pmax = g.players.max, cnt = draft.players.length;
      const pool = S().players.filter(p => !p.hidden || draft.players.includes(p.id));
      const opts = draftOptions(g);
      playersBody = `<div class="chips">${pool.map(p => `<button class="chip" data-act="toggle-player" data-id="${p.id}" aria-pressed="${draft.players.includes(p.id)}"><span class="dot" style="background:${p.color}"></span>${esc(p.name)}</button>`).join("")}</div>
        <form class="row" data-form="add-player" style="margin-top:10px"><input class="input" name="name" placeholder="Имя нового игрока" maxlength="40" aria-label="Имя нового игрока"><button class="btn" type="submit">Добавить</button></form>
        ${cnt ? `<div style="margin-top:10px"><div class="label" style="margin-bottom:2px">За столом, по часовой стрелке</div>${draft.players.map((id, i) => { const p = BH.player(id) || { name: "?", color: "#888" }; return `<div class="seat"><span class="n">${i + 1}</span>${BH.avatar(p, "sm")}<span>${esc(p.name)}</span>
            <span class="mv"><button class="icon-btn" data-act="seat-up" data-i="${i}" aria-label="Выше" ${i ? "" : "disabled"}>${I.up}</button><button class="icon-btn" data-act="seat-down" data-i="${i}" aria-label="Ниже" ${i < cnt - 1 ? "" : "disabled"}>${I.down}</button><button class="icon-btn" data-act="toggle-player" data-id="${id}" aria-label="Убрать">${I.x}</button></span></div>`; }).join("")}</div>` : ""}
        ${cnt && cnt < pmin ? `<div class="note" style="margin-top:10px">Для ${esc(g.name)} нужно минимум ${pmin} ${BH.plural(pmin, "игрок", "игрока", "игроков")}.</div>` : ""}
        ${cnt >= pmin && g.players.recommendedMin && cnt < g.players.recommendedMin ? `<div class="note info" style="margin-top:10px">${esc(g.playersNote || `По правилам ${g.name} рассчитан на ${g.players.recommendedMin} и больше игроков.`)}</div>` : ""}
        ${cnt > pmax ? `<div class="note" style="margin-top:10px">Для ${esc(g.name)} не больше ${pmax} игроков.</div>` : ""}
        ${!past && opts.length ? `<div class="stack" style="margin-top:12px;gap:6px">${opts.map(o => `<label class="check" style="font-weight:500"><input type="checkbox" data-act="draft-opt" data-id="${esc(o.id)}" ${draft.opts[o.id] ? "checked" : ""}> ${esc(o.label)}</label>`).join("")}</div>` : ""}`;
      ok = cnt >= pmin && cnt <= pmax;
    }
    const playersSec = sec("Игроки", "", playersBody);

    let resultSec = "";
    if (past && g && draft.players.length) {
      resultSec = sec("Итог", "Очки можно не вписывать. Победитель выберется по очкам, или отметьте его сами.",
        `${draft.players.map(id => { const p = BH.player(id) || { name: "?", color: "#888" }; return `<div class="seat" style="grid-template-columns:auto minmax(0,1fr) auto">${BH.avatar(p, "sm")}<span>${esc(p.name)}</span>
          <input class="input score-in" type="number" inputmode="numeric" data-act="draft-final" data-p="${id}" value="${draft.final[id] ?? ""}" placeholder="очки" aria-label="Очки: ${esc(p.name)}"></div>`; }).join("")}
        <div class="label" style="margin:12px 0 6px">Победитель</div>
        <div class="chips">${draft.players.map(id => { const p = BH.player(id) || { name: "?" }; return `<button class="chip" data-act="draft-winner" data-id="${id}" aria-pressed="${draft.winners.includes(id)}">${esc(p.name)}</button>`; }).join("")}</div>`);
    }

    const label = draft.editId ? "Сохранить" : past ? "Записать сыгранную партию" : "Создать партию";
    const back = draft.editId ? backLink("#/s/" + draft.editId + "/setup", "Подготовка") : backLink("#/", "Отмена");
    return `<div class="stack">
      <div>${back}<div class="page-head"><div><h1>${draft.editId ? "Партия" : past ? "Сыгранная партия" : "Новая партия"}</h1></div></div></div>
      ${dateSec}${gameSec}${expSec}${placeSec}${playersSec}${resultSec}
      <div class="sticky-foot"><button class="btn primary big block" data-act="draft-save" ${ok ? "" : "disabled"}>${label}</button></div>
    </div>`;
  }

  function saveDraft() {
    const g = BH.game(draft.gameId);
    if (!g) return;
    const opts = {};
    for (const o of BH.gameOptions(g, draftCtx())) opts[o.id] = !!draft.opts[o.id];
    if (draft.editId) {
      const s = BH.session(draft.editId);
      if (!s) { draft = null; go("#/"); return; }
      Object.assign(s, { gameId: g.id, exp: draft.exp.slice(), placeId: draft.placeId || null, players: draft.players.slice(), opts, created: draft.date });
      if (s.first && !s.players.includes(s.first)) s.first = null;
      BH.saveNow(); draft = null;
      // came here from the setup screen: step back to it, so the history does not grow setup → edit → setup
      if (prevHash === "#/s/" + s.id + "/setup") history.back(); else goReplace("#/s/" + s.id + "/setup");
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
        const best = Math.max(...Object.values(final));
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
    if (!sub) sub = s.status === "setup" ? "setup" : s.status === "first" ? "first" : s.status === "playing" ? "play" : "done";
    if (sub === "edit") {
      if (s.status === "finished" || s.rounds.length) return { html: notFound("Партия уже идёт — её состав больше не меняется.") };
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
      <div class="scroll-x"><table class="hist"><thead><tr><th>№</th>${s.players.map(id => `<th>${esc((BH.player(id) || {}).name || "?")}</th>`).join("")}</tr></thead>
      <tbody>${s.rounds.map((rd, i) => `<tr class="click" data-act="edit-round" data-i="${i}" tabindex="0"><td>${i + 1}</td>${s.players.map(id => { const f = (rd.flags || {})[id] || {}; return `<td class="${f.bust ? "bust" : f.flip7 ? "f7" : ""}">${f.bust ? "✕" : rd.scores[id]}</td>`; }).join("")}</tr>`).join("")}</tbody></table></div></section>` : "";

    return `<div class="stack">
      <div>${backLink("#/", "Партии")}
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
      <div>${backLink("#/", "Партии")}</div>
      <section class="panel podium">
        ${crown}
        ${sessionTitle(s, g)}
        <h1>${w.length > 1 ? "Ничья: " + esc(w.map(p => p.name).join(" и ")) : w.length ? "Победа: " + esc(w[0].name) : "Партия окончена"}</h1>
        <p class="muted">${s.rounds.length ? `${s.rounds.length} ${BH.plural(s.rounds.length, "раунд", "раунда", "раундов")}` : "записана после игры"}${dur && s.rounds.length ? " · " + dur : ""} · ${BH.fmtDate(s.created)}${place ? " · " + esc(place.name) : ""}</p>
        ${g.finishNote && g.finishNote(s) ? `<p class="badge ${s.rounds.length < 5 ? "good" : "warn"}" style="font-size:14px;padding:6px 12px">${esc(g.finishNote(s))}</p>` : ""}
      </section>
      <section class="panel"><h2 style="margin-bottom:6px">Итог</h2>
        <div class="list">${st.map(x => { const p = BH.player(x.id) || { name: "?", color: "#888" }; return `<div class="item"><span class="place-n">${x.place}</span>${BH.avatar(p, "sm")}<div class="t"><b>${esc(p.name)}</b></div><span class="num" style="font-size:20px;font-weight:700">${x.total}</span></div>`; }).join("")}</div>
      </section>
      <div class="actions">
        <button class="btn primary big" data-act="rematch">${I.plus}Ещё партию теми же</button>
        ${s.rounds.length ? `<button class="btn big" data-act="reopen">Вернуться к партии</button>` : ""}
        <button class="btn ghost big" data-act="delete-session">${I.trash}Удалить</button>
      </div>
    </div>`;
  }

  /* ---------- games catalogue ---------- */
  function viewGames() {
    return `<div class="stack">
      <div class="page-head"><div><h1>Игры</h1><p class="sub">Подготовка, правила и подсчёт очков для каждой игры.</p></div></div>
      <div class="games">${BH.games.map(g => {
        const n = S().sessions.filter(s => s.gameId === g.id && s.status === "finished").length;
        return `<a class="game" href="#/games/${g.id}"><span class="cover"${BH.assets.cover(g)}>${g.cover || ""}</span><span><b>${esc(g.name)}</b><span>${n ? n + " " + BH.plural(n, "партия", "партии", "партий") : "ещё не играли"} · ${esc(g.time || "")}</span></span></a>`;
      }).join("")}</div>
      <div class="note info">Каталог будет расти: следующая на очереди — «Ики» с дополнением. Для новой игры понадобятся её правила, чтобы составить подготовку и шпаргалку.</div>
    </div>`;
  }
  function viewGame(g) {
    return `<div class="stack">
      <div>${backLink("#/games", "Игры")}
        <div class="game" style="cursor:default;border:none;padding:0;background:none"><span class="cover" style="width:80px;height:80px"${BH.assets.cover(g)}>${g.cover || ""}</span>
          <span><h1>${esc(g.name)}</h1><span>${esc(g.publisher || "")}${g.year ? ", " + g.year : ""} · от ${g.players.recommendedMin || g.players.min} игроков · ${esc(g.time || "")} · ${esc(g.age || "")}</span></span></div></div>
      ${g.tagline ? `<p>${esc(g.tagline)}</p>` : ""}
      <div class="actions"><button class="btn primary big" data-act="new-with" data-id="${g.id}">${I.plus}Новая партия</button>${askButton(g, true)}</div>
      ${BH.rulesUI.panel(g, "")}
    </div>`;
  }

  /* ---------- players & places ---------- */
  let editPlayer = null;
  function viewPlayers() {
    const fin = S().sessions.filter(s => s.status === "finished");
    const all = S().players;
    const row = p => {
      const played = fin.filter(s => s.players.includes(p.id)).length, wins = fin.filter(s => s.winners.includes(p.id)).length;
      if (editPlayer === p.id) {
        return `<form class="panel stack" data-form="edit-player" data-id="${p.id}" style="margin:8px 0">
          <label class="field">Имя<input class="input" name="name" value="${esc(p.name)}" maxlength="40" required></label>
          <div class="field">Цвет<div class="swatches">${BH.COLORS.map(c => `<button type="button" class="sw" style="background:${c}" data-act="pick-color" data-id="${p.id}" data-c="${c}" aria-pressed="${p.color === c}" aria-label="Цвет ${c}"></button>`).join("")}</div></div>
          <div class="actions"><button class="btn primary" type="submit">Сохранить</button><button class="btn" type="button" data-act="edit-player" data-id="">Отмена</button>
            <button class="btn ghost" type="button" data-act="hide-player" data-id="${p.id}">${p.hidden ? "Вернуть в список" : played ? "Скрыть из выбора" : "Удалить"}</button></div>
        </form>`;
      }
      return `<div class="item" style="${p.hidden ? "opacity:.55" : ""}">${BH.avatar(p)}<div class="t"><b>${esc(p.name)}</b><span>${played ? `${played} ${BH.plural(played, "партия", "партии", "партий")} · ${wins} ${BH.plural(wins, "победа", "победы", "побед")}` : "ещё не играл(а)"}${p.hidden ? " · скрыт" : ""}</span></div>
        <button class="icon-btn" data-act="edit-player" data-id="${p.id}" aria-label="Изменить ${esc(p.name)}">${I.edit}</button></div>`;
    };
    return `<div class="stack">
      <div class="page-head"><div><h1>Игроки</h1><p class="sub">Друзья и семья, с кем вы играете.</p></div></div>
      <section class="panel">
        <form class="row" data-form="add-player-page" style="margin-bottom:6px"><input class="input" name="name" placeholder="Имя игрока" maxlength="40" aria-label="Имя игрока"><button class="btn primary" type="submit">Добавить</button></form>
        <div class="list">${all.length ? all.map(row).join("") : `<p class="muted small" style="padding:8px 0">Пока никого. Игроков можно добавить и при создании партии.</p>`}</div>
      </section>
      <section class="panel">
        <h2 style="margin-bottom:6px">Места</h2>
        <div class="list">${S().places.map(p => { const n = fin.filter(s => s.placeId === p.id).length; return `<div class="item"><div class="t"><b>${esc(p.name)}</b><span>${n} ${BH.plural(n, "партия", "партии", "партий")}</span></div>${n ? "" : `<button class="icon-btn" data-act="del-place" data-id="${p.id}" aria-label="Удалить место ${esc(p.name)}">${I.trash}</button>`}</div>`; }).join("")}</div>
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
      const best = mine.reduce((m, s) => Math.max(m, BH.totals(s)[p.id] || 0), 0);
      return { p, played: mine.length, wins, rate: mine.length ? wins / mine.length : 0, best };
    }).filter(x => x.played).sort((a, b) => b.wins - a.wins || b.rate - a.rate || b.played - a.played);
    const byGame = BH.games.map(g => ({ g, n: fin.filter(s => s.gameId === g.id).length, last: fin.filter(s => s.gameId === g.id).reduce((m, s) => Math.max(m, s.finishedAt || 0), 0) })).filter(x => x.n);
    const byPlace = [...S().places, { id: null, name: "Не указано" }].map(p => ({ p, n: fin.filter(s => (s.placeId || null) === p.id).length })).filter(x => x.n);
    const opts = `<option value="">Все игры</option>${BH.games.map(g => `<option value="${g.id}" ${g.id === statsGame ? "selected" : ""}>${esc(g.name)}</option>`).join("")}`;
    return `<div class="stack">
      <div class="page-head"><div><h1>Статистика</h1><p class="sub">По завершённым партиям.</p></div>
        <select class="input" style="width:auto" data-act="stats-game" aria-label="Игра">${opts}</select></div>
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
  function viewSettings() {
    const st = S().settings;
    const seg = (key, val, label) => `<button type="button" data-act="set" data-k="${key}" data-v="${val}" aria-pressed="${String(st[key]) === String(val)}">${label}</button>`;
    return `<div class="stack">
      <div>${backLink("#/", "Партии")}<div class="page-head"><div><h1>Настройки</h1><p class="sub">Версия ${esc(BH.version)}</p></div></div></div>
      ${viewSync()}
      ${viewVoiceSettings()}
      <section class="panel stack">
        <div class="spread"><span>Тема</span><div class="seg">${seg("theme", "auto", "Как в системе")}${seg("theme", "light", "Светлая")}${seg("theme", "dark", "Тёмная")}</div></div>
      </section>
      <section class="panel stack">
        <h2>Копия данных</h2>
        <p class="small muted">Партии и игроки всегда сохраняются на этом устройстве${BH.cloud.cfg ? " и уходят в GitHub" : ""}. Копию в файл можно сохранить на всякий случай или чтобы перенести данные без синхронизации.</p>
        <div class="actions"><button class="btn" data-act="export">Сохранить копию</button>
          <label class="btn">Загрузить из копии<input type="file" accept="application/json,.json" data-act="import" hidden></label></div>
      </section>
      <p class="tiny muted">Помощник настолок ${esc(BH.version || "")} · правила в приложении пересказаны своими словами, полные правила — в книге правил игры.</p>
    </div>`;
  }

  /* ---------- voice assistant: settings ---------- */
  function viewVoiceSettings() {
    const V = BH.voice, st = S().settings, ready = V.ready();
    const seg = (key, val, label) => `<button type="button" data-act="set" data-k="${key}" data-v="${val}" aria-pressed="${String(st[key]) === String(val)}">${label}</button>`;
    return `<section class="panel stack" id="voice-panel">
      <div class="spread"><h2>Голосовой помощник</h2>${ready ? '<span class="badge good">работает</span>' : '<span class="badge">не подключён</span>'}</div>
      <p class="small muted">Спросите голосом во время партии: помощник найдёт ответ в книге правил, покажет цитату со страницей и прочитает ответ живым голосом. Работает через ваш Yandex Cloud и только для вас: доступ даёт подключённая выше синхронизация.</p>
      ${ready ? "" : `<p class="note info small">${esc(V.why())}</p>`}
      <label class="field">Голос
        <select class="input" data-act="voice-name">${V.VOICES.map(([id, name]) => `<option value="${id}" ${id === V.voice() ? "selected" : ""}>${name}</option>`).join("")}</select></label>
      <div class="actions"><button class="btn sm" data-act="say-test">${I.speak}Проверить голос</button></div>
      ${ready ? "" : `<p class="tiny muted">Пока помощник не подключён, ответы читает голос телефона${BH.speech.supported ? (BH.speech.hasRussian ? " (русский голос найден)" : " (русского голоса в системе нет)") : " — но этот браузер не умеет читать вслух"}.</p>
        <div class="spread"><span class="small">Скорость голоса телефона</span><div class="seg">${seg("voiceRate", 0.85, "Медленно")}${seg("voiceRate", 1, "Обычно")}${seg("voiceRate", 1.2, "Быстро")}</div></div>`}
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
    const g = BH.game(s.gameId), lead = BH.player(BH.leaderAt(s, s.rounds.length));
    return `раунд ${s.rounds.length + 1}, игроков ${s.players.length}${lead && g && g.rounds ? ", " + (g.rounds.leaderLabel || "ходит") + ": " + lead.name : ""}`;
  }
  function openAsk(gameId, sid) {
    BH.speech.stop();
    BH.clearToast();
    ask = { gameId, sid, phase: "idle", text: "", result: null, error: "" };
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
        ${r.ttsError ? `<p class="tiny muted">Ответ не озвучен: ${esc(r.ttsError)}</p>` : ""}
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
    error: ["error", '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 7v6M12 16.5v.5"/><circle cx="12" cy="12" r="9"/></svg>', "ошибка"],
  };
  function updateSync() {
    const C = BH.cloud, chip = document.getElementById("sync-chip");
    if (chip) {
      if (!C.cfg) chip.hidden = true;
      else {
        const st = C.status.state;
        const k = st === "busy" ? "busy" : st === "error" ? "error" : C.pending ? "pending" : st === "ok" || C.status.at ? "ok" : "pending";
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
    if (!sheet) { overlayRoot.innerHTML = ""; return; }
    const scroll = overlayRoot.querySelector(".sheet-body");
    const top = scroll ? scroll.scrollTop : 0;
    overlayRoot.innerHTML = sheetHTML();
    const body = overlayRoot.querySelector(".sheet-body"); if (body) body.scrollTop = top;
  }
  const openDialog = d => { dialog = d; BH.clearToast(); renderOverlay(); };
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
      round.detail[id] = e;
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
    const g = BH.game(s.gameId), end = BH.checkEnd(s);
    if (s.continueTie && (!end.over || s.rounds.length < s.continueTie)) delete s.continueTie;
    if (end.over && !end.tie) { finish(s, end.winners); return; }
    if (end.over && end.tie && !(s.continueTie && s.rounds.length <= s.continueTie)) {
      render();
      openDialog({
        title: "Ничья", text: ((g.scoring && g.scoring.tieNote) || "Сразу несколько игроков с лучшим счётом.") + " Сейчас поровну у: " + end.winners.map(id => (BH.player(id) || {}).name).join(", ") + ".",
        buttons: [
          { label: "Сыграть ещё раунд", primary: true, run: () => { s.continueTie = s.rounds.length; BH.saveNow(); closeDialog(); render(); } },
          { label: "Записать ничью", run: () => { closeDialog(); finish(s, end.winners); } },
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
    s.status = "finished";
    s.finishedAt = Date.now();
    s.winners = winners;
    delete s.continueTie;
    BH.clearToast();
    BH.saveNow();
    go("#/s/" + s.id + "/done");
  }

  /* ---------- events ---------- */
  document.addEventListener("click", e => {
    const el = e.target.closest("[data-act]");
    if (!el) return;
    const act = el.dataset.act, r = route(), s = r.a === "s" ? BH.session(r.b) : null;
    if (el.tagName === "INPUT" && el.type !== "checkbox" && el.type !== "button") return;

    switch (act) {
      /* wizard */
      case "pick-game": draft.gameId = el.dataset.id; draft.exp = []; draft.opts = {}; draft.pickGame = false; render(); break;
      case "change-game": draft.pickGame = true; render(); break;
      case "draft-winner": { const i = draft.winners.indexOf(el.dataset.id); i >= 0 ? draft.winners.splice(i, 1) : draft.winners.push(el.dataset.id); render(); break; }
      case "draft-save": saveDraft(); break;
      case "draft-opt": break; // handled on change
      case "toggle-exp": { const i = draft.exp.indexOf(el.dataset.id); i >= 0 ? draft.exp.splice(i, 1) : draft.exp.push(el.dataset.id); render(); break; }
      case "pick-place": draft.placeId = el.dataset.id || null; render(); break;
      case "toggle-player": { const i = draft.players.indexOf(el.dataset.id); i >= 0 ? draft.players.splice(i, 1) : draft.players.push(el.dataset.id); render(); break; }
      case "seat-up": case "seat-down": { const i = +el.dataset.i, j = act === "seat-up" ? i - 1 : i + 1; const a = draft.players; [a[i], a[j]] = [a[j], a[i]]; render(); break; }
      case "new-with": startDraft(el.dataset.id); go("#/new"); break;

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
      case "setup-next": BH.speech.stop(); s.status = s.status === "setup" ? "first" : s.status; BH.saveNow(); go("#/s/" + s.id + "/first"); break;

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
          s.first = pl[i]; BH.saveNow();
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
        BH.saveNow(); BH.wheel.reset(); go("#/s/" + s.id + "/play"); break;

      /* play */
      case "new-round": openSheet(s, null); break;
      case "edit-round": openSheet(s, +el.dataset.i); break;
      case "undo-round": openDialog({ title: "Отменить раунд " + s.rounds.length + "?", text: "Очки этого раунда удалятся.", buttons: [
        { label: "Отменить раунд", danger: true, run: () => { s.rounds.pop(); BH.saveNow(); dialog = null; afterRoundChange(s, false); } }, { label: "Оставить", run: closeDialog }] }); break;
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
        { label: "Удалить", danger: true, run: () => { s.rounds.splice(i, 1); sheet = null; dialog = null; BH.saveNow(); afterRoundChange(s, false); } }, { label: "Отмена", run: () => { dialog = null; renderOverlay(); } }] }); break; }
      case "dlg": { const b = dialog && dialog.buttons[+el.dataset.i]; if (b) b.run(); break; }

      /* done */
      case "rematch": { startDraft(s.gameId); Object.assign(draft, { exp: s.exp.slice(), placeId: s.placeId, players: s.players.slice(), opts: Object.assign({}, s.opts) }); saveDraft(); break; }
      case "reopen": s.status = "playing"; s.winners = []; delete s.finishedAt; BH.saveNow(); go("#/s/" + s.id + "/play"); break;
      case "delete-session": confirmDelete(s); break;
      case "show-all": showAllDone = true; render(); break;

      /* rules */
      case "say-rule": { const g = BH.game(s ? s.gameId : r.b); if (g) BH.rulesUI.say(g, el.dataset.id); break; }
      case "goto-rule": { const g = BH.game(s ? s.gameId : r.b); const inp = BH.$("#rules-q"); if (inp) { inp.value = ""; } const out = BH.$("#rules-out"); if (out && g) { out.innerHTML = BH.rulesUI.full(g, {}); const n = BH.$("#rule-" + el.dataset.id); if (n) { n.classList.add("hit"); n.scrollIntoView({ block: "center", behavior: "smooth" }); } } break; }

      /* players */
      case "edit-player": editPlayer = el.dataset.id || null; render(); break;
      case "pick-color": { const p = BH.player(el.dataset.id); if (p) { p.color = el.dataset.c; BH.save(); render(); } break; }
      case "hide-player": {
        const p = BH.player(el.dataset.id); if (!p) break;
        const used = S().sessions.some(x => x.players.includes(p.id));
        if (used) p.hidden = !p.hidden; else S().players = S().players.filter(x => x !== p);
        editPlayer = null; BH.saveNow(); render(); break;
      }
      case "del-place": S().places = S().places.filter(x => x.id !== el.dataset.id); BH.saveNow(); render(); break;

      /* settings */
      case "set": { const k = el.dataset.k; let v = el.dataset.v; if (k === "voiceRate") v = Number(v); S().settings[k] = v; BH.saveNow(); applyTheme(); render(); break; }
      case "say-test": BH.speech.speak("Привет! Я буду читать подготовку к игре и правила."); break;
      case "export": BH.exportData(); break;
      case "reload": location.reload(); break;
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
    if (el.dataset.act === "draft-date" && draft) { const t = new Date(el.value).getTime(); if (Number.isFinite(t)) { draft.date = t; render(); } }
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

  document.addEventListener("input", e => {
    const el = e.target;
    if (el.dataset.act === "draft-final" && draft) { draft.final[el.dataset.p] = el.value; return; }
    if (el.dataset.act === "game-q" && draft) {
      draft.gameQuery = el.value;
      const pos = el.selectionStart; render();
      const inp = BH.$('[data-act="game-q"]'); if (inp) { inp.focus(); try { inp.setSelectionRange(pos, pos); } catch (e) {} }
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
      const p = BH.player(f.dataset.id); if (p && name) { p.name = name.slice(0, 40); BH.saveNow(); }
      editPlayer = null; render();
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
    // key moments for the sync: a game form or the players / settings page is left,
    // a game reaches its result, or we are back on the home screen (e.g. after a delete)
    {
      const now = route(), was = prevHash.replace(/^#\/?/, "").split("/");
      const leftForm = was[0] === "new" || (was[0] === "s" && was[2] === "edit") || was[0] === "players" || was[0] === "settings";
      if (leftForm || now.c === "done" || now.a === "") BH.cloud.keyMoment();
    }
    spinToken++; spinning = false;
    if (route().a !== "settings") { syncMsg = ""; wheelTokenBad = false; }
    const rt = route();
    if (rt.a !== "new" && !(rt.a === "s" && rt.c === "edit" && draft && draft.editId === rt.b)) draft = null;
    if (route().a !== "") showAllDone = false;
    if (route().a !== "players") editPlayer = null;
    sheet = null; dialog = null;
    if (ask) { stopListening(); if (askCtl) askCtl.abort(); askCtl = null; ask = null; }
    render();
    window.scrollTo(0, 0);
  });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);

  /* ---------- start ---------- */
  BH.version = "0.6.1";
  applyTheme();
  // a file that failed to load (e.g. a 503 while the site publishes an update) must not leave a half-working app
  const missing = [["игры", BH.games && BH.games.length], ["правила", BH.rulesUI], ["колесо", BH.wheel], ["синхронизация", window.BHSync && BH.cloud], ["голос", BH.voice], ["картинки", BH.assets]].filter(x => !x[1]).map(x => x[0]);
  if (missing.length) {
    main.innerHTML = `<div class="empty"><p>Не все части приложения загрузились (${esc(missing.join(", "))}). Обычно это бывает, когда сайт как раз обновляется.</p><p style="margin-top:12px"><button class="btn primary big" data-act="reload">Обновить</button></p></div>`;
    return;
  }
  if (route().a === "new") startDraft();
  render();
  if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol) && !/^(localhost|127\.)/.test(location.hostname)) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  BH._render = render; // for tests
})();
