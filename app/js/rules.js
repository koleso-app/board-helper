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

  R.ruleHTML = (r, q, hit) => `<section class="rule ${hit ? "hit" : ""}" id="rule-${esc(r.id)}">
      <div class="spread"><h3>${esc(r.title)}</h3>${BH.speech.supported ? `<button class="icon-btn" data-act="say-rule" data-id="${esc(r.id)}" aria-label="Прочитать вслух: ${esc(r.title)}" title="Прочитать вслух">${BH.ICON.speak}</button>` : ""}</div>
      ${mark("<div>" + r.body + "</div>", q || "")}
    </section>`;

  R.results = (g, q) => {
    const hits = BH.searchRules(g, q);
    if (!hits.length) return `<div class="note info">В шпаргалке ничего не нашлось по запросу «${esc(q)}». Попробуйте другое слово: например, «перебор», «×2», «сдающий». Поиск в интернете появится следующим шагом.</div>`;
    return hits.slice(0, 6).map(h => h.kind === "faq"
      ? `<div class="qa"><b>${mark(">" + esc(h.title) + "<", q).slice(1, -1)}</b><p>${mark(">" + esc(h.item.a) + "<", q).slice(1, -1)}</p>${h.item.ref ? `<button class="btn ghost sm" data-act="goto-rule" data-id="${esc(h.item.ref)}">Раздел правил</button>` : ""}</div>`
      : R.ruleHTML(h.item, q, true)).join("");
  };

  R.panel = (g, q, opts) => {
    opts = opts || {};
    return `<div class="stack">
      <div class="search">${BH.ICON.search}<input class="input" type="search" id="rules-q" value="${esc(q || "")}" placeholder="Спросите: «можно ли Freeze на себя?»" aria-label="Поиск по правилам" autocomplete="off"></div>
      <div id="rules-out">${q ? R.results(g, q) : R.full(g, opts)}</div>
    </div>`;
  };

  // compact: used inside the play screen's own panel, so no panels of its own
  R.full = (g, opts) => opts.compact
    ? `<div><span class="label">Частые вопросы</span>${g.faq.slice(0, 4).map(f => `<div class="qa"><b>${esc(f.q)}</b><p>${esc(f.a)}</p></div>`).join("")}</div>`
    : `${g.faq.length ? `<section class="panel"><div class="spread" style="margin-bottom:4px"><h2>Частые вопросы</h2><span class="badge">${g.faq.length}</span></div>
      ${g.faq.map(f => `<div class="qa"><b>${esc(f.q)}</b><p>${esc(f.a)}</p></div>`).join("")}</section>` : ""}
    <section class="panel"><h2 style="margin-bottom:4px">Правила кратко</h2>${g.rules.map(r => R.ruleHTML(r, "")).join("")}</section>`;

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
      t = setTimeout(() => { const q = input.value.trim(); out.innerHTML = q ? R.results(g, q) : R.full(g, opts || {}); }, 120);
    });
  };
})();
