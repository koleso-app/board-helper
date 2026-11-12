/* Rules cheat sheet: the game's sections and questions, a search box and "read aloud".
   Search is local and instant; later the voice question and the internet fallback plug in here. */
(function () {
  "use strict";
  const BH = window.BH, esc = BH.esc;
  const R = BH.rulesUI = {};

  function mark(html, query) {
    const words = BH.tokens(query).filter(w => w.length >= 2);
    if (!words.length) return html;
    // only touch text between tags
    return html.replace(/>([^<]+)</g, (m, text) => ">" + text.replace(/[A-Za-zА-Яа-яЁё0-9×+]+/g, w => {
      const s = BH.stem(w);
      return words.some(q => s.startsWith(q) || q.startsWith(s)) ? `<mark>${w}</mark>` : w;
    }) + "<");
  }
  const plain = html => html.replace(/<li>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

  R.ruleHTML = (r, q, hit, g) => `<section class="rule ${hit ? "hit" : ""}" id="rule-${esc(r.id)}">
      <div class="spread"><h3>${esc(r.title)}${r.page ? ` <span class="badge" title="Страница в книге правил">стр. ${esc(r.page)}</span>` : ""}</h3></div>
      ${mark("<div>" + r.body + "</div>", q || "")}
      ${g && g.images && g.images.rules && g.images.rules[r.id] ? `<div class="rule-img"${BH.assets.attr(g.id, g.images.rules[r.id])}></div>` : ""}
    </section>`;

  R.results = (g, q) => {
    const hits = BH.searchRules(g, q);
    if (!hits.length) return `<div class="note info">В правилах и частых вопросах ничего не нашлось по запросу «${esc(q)}». Попробуйте другое слово, например ${(g.searchWords || ["перебор", "дилер"]).map(w => "«" + esc(w) + "»").join(", ")}, или спросите помощника голосом.</div>`;
    return hits.slice(0, 6).map(h => h.kind === "faq"
      ? `<div class="qa"><b>${mark(">" + esc(h.title) + "<", q).slice(1, -1)}</b><p>${mark(">" + esc(h.item.a) + "<", q).slice(1, -1)}${srcBadge(h.item)}</p>${h.item.ref ? `<button class="btn ghost sm" data-act="goto-rule" data-id="${esc(h.item.ref)}">Раздел правил</button>` : ""}</div>`
      : R.ruleHTML(h.item, q, true, g)).join("");
  };

  R.panel = (g, q, opts) => {
    opts = opts || {};
    return `<div class="stack">
      <div class="search">${BH.ICON.search}<input class="input" type="search" id="rules-q" value="${esc(q || "")}" placeholder="Найти в правилах" aria-label="Поиск по правилам" autocomplete="off"></div>
      <p class="tiny muted search-ex">Например: «${esc(g.searchExample || "как считать очки?")}»</p>
      <div id="rules-out">${q ? R.results(g, q) : R.full(g, opts)}</div>
    </div>`;
  };

  /* a rule as a collapsible section: the title (and page) always visible, the text on tap */
  R.ruleFold = (r, g) => `<details class="fold" id="rule-${esc(r.id)}">
      <summary><span class="fold-t">${esc(r.title)}</span>${r.page ? `<span class="badge" title="Страница в книге правил">стр. ${esc(r.page)}</span>` : ""}</summary>
      <div class="fold-body">${r.body}${g && g.images && g.images.rules && g.images.rules[r.id] ? `<div class="rule-img"${BH.assets.attr(g.id, g.images.rules[r.id])}></div>` : ""}</div>
    </details>`;
  const srcBadge = f => f.src && BH.FAQ_SRC[f.src] ? ` <span class="badge${f.src === "disputed" || f.src === "house" ? " warn" : ""}">${BH.FAQ_SRC[f.src]}</span>` : "";
  R.faqFold = (f, i) => `<details class="fold" id="faq-${i}">
      <summary><span class="fold-t">${esc(f.q)}</span></summary>
      <div class="fold-body"><p>${esc(f.a)}${srcBadge(f)}</p>${f.ref ? `<button class="btn ghost sm" data-act="goto-rule" data-id="${esc(f.ref)}">Раздел правил</button>` : ""}</div>
    </details>`;
  // "Развернуть все" / "Свернуть" act on the topics and the items in them
  const foldTools = which =>`<div class="row"><button class="btn ghost sm" data-act="fold-all" data-in="${which}" data-open="1">Развернуть все</button><button class="btn ghost sm" data-act="fold-all" data-in="${which}" data-open="0">Свернуть</button></div>`;

  // compact: used inside the play screen's own panel, so no panels of its own.
  // full: rules first, then the players' questions, every item folds
  R.full = (g, opts) => opts.compact
    ? `<div><span class="label">Частые вопросы</span>${g.faq.slice(0, 4).map(f => `<div class="qa"><b>${esc(f.q)}</b><p>${esc(f.a)}</p></div>`).join("")}</div>`
    : section("fold-rules", `Правила <span class="badge">${g.rules.length}</span>`,
        (g.source ? `<p class="tiny muted" style="margin-bottom:6px">Пересказ своими словами по книге: ${esc(g.source)}. Страницы — как напечатаны в книге.</p>` : "") +
        grouped("fold-rules", g.rules, g.ruleGroups, (grp, r) => grp.ids.includes(r.id), r => R.ruleFold(r, g),
          // inside a topic the rules follow the topic's own order
          (grp, list) => list.sort((x, y) => grp.ids.indexOf(x[0].id) - grp.ids.indexOf(y[0].id))))
      + (g.faq.length ? section("fold-faq", `Частые вопросы <span class="badge">${g.faq.length}</span>`,
        grouped("fold-faq", g.faq, g.faqGroups, (grp, f) => grp.refs.includes(f.ref), (f, i) => R.faqFold(f, i))) : "");

  /* a whole part of the page (rules, questions) folds too; the phone remembers which ones were closed */
  const SEC_KEY = "board-helper-closed-sections";
  const closedSecs = () => { try { return JSON.parse(localStorage.getItem(SEC_KEY) || "[]"); } catch (e) { return []; } };
  R.rememberSection = d => {
    try {
      const set = new Set(closedSecs());
      if (d.open) set.delete(d.id); else set.add(d.id);
      localStorage.setItem(SEC_KEY, JSON.stringify([...set]));
    } catch (e) { /* private mode: just don't remember */ }
  };
  const section = (id, title, body) => `<details class="panel fold-sec" id="${id}"${closedSecs().includes(id) ? "" : " open"}>
      <summary><h2>${title}</h2></summary>
      <div class="fold-sec-body">${foldTools(id)}${body}</div>
    </details>`;

  /* items sorted into topics given by the game (each topic folds too); whatever fits no topic goes last */
  function grouped(secId, all, groups, fits, one, order) {
    const items = all.map((x, i) => [x, i]);
    if (!groups || !groups.length) return items.map(([x, i]) => one(x, i)).join("");
    const used = new Set(), html = [], closed = closedSecs();
    const block = (title, list, n) => {
      if (!list.length) return;
      const id = `${secId}-g${n}`;
      html.push(`<details class="fold-grp" id="${id}"${closed.includes(id) ? "" : " open"}>
        <summary><span class="fold-t">${esc(title)}</span><span class="badge">${list.length}</span></summary>
        <div class="fold-grp-body">${list.map(([x, i]) => one(x, i)).join("")}</div></details>`);
    };
    groups.forEach((grp, n) => {
      let list = items.filter(([x, i]) => !used.has(i) && fits(grp, x));
      list.forEach(([, i]) => used.add(i));
      if (order) list = order(grp, list);
      block(grp.title, list, n);
    });
    block("Другое", items.filter(([, i]) => !used.has(i)), "x");
    return html.join("");
  }

  // "toggle" does not bubble, so listen while it travels down
  document.addEventListener("toggle", e => { const d = e.target; if (d && d.matches && d.matches("details.fold-sec, details.fold-grp")) R.rememberSection(d); }, true);

  R.say = (g, id) => {
    const r = g.rules.find(x => x.id === id);
    if (r) BH.speech.speak(r.title + ". " + plain(r.body));
  };

  /* wires a rules panel that is already in the DOM */
  R.bind = (root, g, opts) => {
    const input = root.querySelector("#rules-q"), out = root.querySelector("#rules-out");
    if (!input || !out) return;
    let t = null;
    input.addEventListener("input", () => {
      clearTimeout(t);
      t = setTimeout(() => { const q = input.value.trim(); out.innerHTML = q ? R.results(g, q) : R.full(g, opts || {}); BH.assets.hydrate(out); }, 120);
    });
  };
})();
