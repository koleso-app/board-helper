/* Game registry and the generic game engine: setup steps, who leads each round, totals, end of game.
   A game is a plain object (see games/flip7.js for the full shape). Nothing here knows any one game. */
(function () {
  "use strict";
  const BH = window.BH;
  BH.games = [];

  BH.registerGame = def => {
    if (!def || !def.id) throw new Error("game needs an id");
    def.expansions = def.expansions || [];
    def.setup = def.setup || [];
    def.rules = def.rules || [];
    def.faq = def.faq || [];
    def.players = Object.assign({ min: 1, max: 12 }, def.players || {});
    BH.games = BH.games.filter(g => g.id !== def.id).concat(def);
  };
  BH.game = id => BH.games.find(g => g.id === id) || null;

  /* where a FAQ answer comes from, when it is not the rulebook itself */
  BH.FAQ_SRC = { author: "ответ автора игры", players: "так решают игроки", disputed: "спорный вопрос", house: "домашнее правило" };

  /* context handed to a game's conditions: how many players, which expansions */
  BH.ctxOf = s => ({ players: s.players.length, exp: new Set(s.exp), has: id => s.exp.includes(id), opt: id => !!(s.opts && s.opts[id]) });

  /* game options offered when creating a game (e.g. Flip 7's solo challenge): the ones that apply now */
  BH.gameOptions = (g, ctx) => (g.options || []).filter(o => !o.when || o.when(ctx));

  /* totals: from the rounds, or the final scores typed in for a game recorded afterwards */
  BH.hasFinal = s => !!(s.final && Object.keys(s.final).length);

  BH.setupSteps = s => {
    const g = BH.game(s.gameId); if (!g) return [];
    const ctx = BH.ctxOf(s);
    return g.setup.filter(st => !st.when || st.when(ctx)).map(st => Object.assign({}, st, {
      text: typeof st.text === "function" ? st.text(ctx) : st.text,
      art: typeof st.art === "function" ? st.art(ctx) : st.art,
    }));
  };

  /* seat index of the player who leads round r (0-based), counting from the chosen first player */
  BH.leaderIndex = (s, r) => {
    const g = BH.game(s.gameId), n = s.players.length;
    const first = Math.max(0, s.players.indexOf(s.first));
    const rot = (g && g.rounds && g.rounds.rotate) || "left";
    if (rot === "none") return first;
    return (first + r) % n;
  };
  BH.leaderAt = (s, r) => s.players[BH.leaderIndex(s, r)];

  BH.totals = s => {
    const t = Object.fromEntries(s.players.map(id => [id, 0]));
    if (BH.hasFinal(s)) { for (const id of s.players) t[id] = Number(s.final[id]) || 0; return t; }
    for (const r of s.rounds) for (const id of s.players) t[id] += Number(r.scores[id]) || 0;
    return t;
  };

  /* players sorted best first, with shared places for equal totals */
  BH.standings = s => {
    const g = BH.game(s.gameId), t = BH.totals(s), high = !(g && g.scoring && g.scoring.lowerWins);
    const list = s.players.map((id, seat) => ({ id, seat, total: t[id] }));
    list.sort((a, b) => (high ? b.total - a.total : a.total - b.total) || a.seat - b.seat);
    let place = 0, prev = null;
    list.forEach((x, i) => { if (prev === null || x.total !== prev) { place = i + 1; prev = x.total; } x.place = place; });
    return list;
  };

  /* after a round: is the game over, and who won? */
  BH.checkEnd = s => {
    const g = BH.game(s.gameId);
    const sc = (g && g.scoring) || {};
    if (sc.type !== "rounds" || !sc.target) return { over: false };
    const st = BH.standings(s);
    const reached = st.some(x => x.total >= sc.target);
    if (!reached) return { over: false };
    const best = st[0].total;
    const winners = st.filter(x => x.total === best).map(x => x.id);
    return { over: true, winners, tie: winners.length > 1 };
  };

  /* ---------- round calculator: generic card picker, the game supplies groups and compute() ---------- */
  BH.emptySel = () => ({ picks: {}, flags: {} });
  BH.calcScore = (g, sel, ctx) => {
    if (!g.calc) return { score: 0, notes: [] };
    return g.calc.compute(sel || BH.emptySel(), ctx);
  };

  /* simple text search over a game's rules and questions (the base for asking by voice later) */
  const STOP = new Set("а в во и или к ко на над не ни о об от по под при про с со у за из до для что как ли же бы это если то там тут мне меня мой моя я ты он она мы вы они его её их можно нужно надо ли когда где какой какая какие сколько".split(" "));
  BH.stem = w => {
    w = w.toLowerCase().replace(/ё/g, "е");
    if (/^[0-9×x+]+$/.test(w)) return w;
    return w.length > 5 ? w.slice(0, Math.max(4, w.length - 2)) : w;
  };
  BH.tokens = text => String(text || "").toLowerCase().replace(/ё/g, "е").split(/[^a-zа-я0-9×+]+/i).filter(w => w && !STOP.has(w)).map(BH.stem);
  BH.searchRules = (g, query) => {
    const q = BH.tokens(query);
    if (!q.length) return [];
    const docs = [
      ...g.rules.map(r => ({ kind: "rule", id: r.id, title: r.title, text: r.body.replace(/<[^>]+>/g, " "), keys: r.keys || "", item: r })),
      ...g.faq.map((f, i) => ({ kind: "faq", id: "faq-" + i, title: f.q, text: f.a, keys: f.keys || "", item: f })),
    ];
    const out = [];
    for (const d of docs) {
      const title = BH.tokens(d.title + " " + d.keys), body = BH.tokens(d.text);
      let score = 0;
      for (const w of q) {
        if (title.some(t => t.startsWith(w) || w.startsWith(t))) score += 3;
        if (body.some(t => t.startsWith(w) || w.startsWith(t))) score += 1;
      }
      if (score) out.push(Object.assign({ score }, d));
    }
    return out.sort((a, b) => b.score - a.score);
  };
})();
