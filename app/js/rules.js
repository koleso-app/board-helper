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
    if (!hits.length) return `<div class="note info">В шпаргалке ничего не нашлось по запросу «${esc(q)}». Попробуйте другое слово, например «перебор», «×2», «дилер», или спросите помощника голосом.</div>`;
    return hits.slice(0, 6).map(h => h.kind === "faq"
      ? `<div class="qa"><b>${mark(">" + esc(h.title) + "<", q).slice(1, -1)}</b><p>${mark(">" + esc(h.item.a) + "<", q).slice(1, -1)}${srcBadge(h.item)}</p>${h.item.ref ? `<button class="btn ghost sm" data-act="goto-rule" data-id="${esc(h.item.ref)}">Раздел правил</button>` : ""}</div>`
      : R.ruleHTML(h.item, q, true, g)).join("");
  };

  R.panel = (g, q, opts) => {
    opts = opts || {};
    return `<div class="stack">
      <div class="search">${BH.ICON.search}<input class="input" type="search" id="rules-q" value="${esc(q || "")}" placeholder="Спросите: «можно ли Freeze на себя?»" aria-label="Поиск по правилам" autocomplete="off"></div>
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
  const foldTools = which => `<div class="row"><button class="btn ghost sm" data-act="fold-all" data-in="${which}" data-open="1">Развернуть все</button><button class="btn ghost sm" data-act="fold-all" data-in="${which}" data-open="0">Свернуть</button></div>`;

  // compact: used inside the play screen's own panel, so no panels of its own.
  // full: rules first, then the players' questions, every item folds
  R.full = (g, opts) => opts.compact
    ? `<div><span class="label">Частые вопросы</span>${g.faq.slice(0, 4).map(f => `<div class="qa"><b>${esc(f.q)}</b><p>${esc(f.a)}</p></div>`).join("")}</div>`
    : `<section class="panel" id="fold-rules"><div class="spread" style="margin-bottom:4px"><h2>Правила</h2>${foldTools("fold-rules")}</div>
        ${g.source ? `<p class="tiny muted" style="margin-bottom:6px">Пересказ своими словами по книге: ${esc(g.source)}. Страницы — как напечатаны в книге.</p>` : ""}
        ${g.rules.map(r => R.ruleFold(r, g)).join("")}</section>
      ${g.faq.length ? `<section class="panel" id="fold-faq"><div class="spread" style="margin-bottom:4px"><h2>Частые вопросы <span class="badge">${g.faq.length}</span></h2>${foldTools("fold-faq")}</div>
        ${faqGrouped(g)}</section>` : ""}`;

  /* the game may sort its questions into topics by the rule they point at; the rest go last */
  function faqGrouped(g) {
    const items = g.faq.map((f, i) => [f, i]);
    if (!g.faqGroups || !g.faqGroups.length) return items.map(([f, i]) => R.faqFold(f, i)).join("");
    const used = new Set(), html = [];
    const block = (title, list) => { if (list.length) html.push(`<h3 class="faq-group">${esc(title)}</h3>` + list.map(([f, i]) => R.faqFold(f, i)).join("")); };
    for (const grp of g.faqGroups) {
      const list = items.filter(([f, i]) => !used.has(i) && grp.refs.includes(f.ref));
      list.forEach(([, i]) => used.add(i));
      block(grp.title, list);
    }
    block("Другое", items.filter(([, i]) => !used.has(i)));
    return html.join("");
  }

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
