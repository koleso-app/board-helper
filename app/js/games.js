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
  BH.FAQ_SRC = { author: "ответ автора игры", publisher: "ответ издателя", players: "так решают игроки", disputed: "спорный вопрос", house: "домашнее правило" };

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
      title: typeof st.title === "function" ? st.title(ctx) : st.title,
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

  /* everything the player card shows, from the finished games the player took part in.
     sessions: the games to count (already narrowed to a period by the caller). */
  // the day a game was played: when it was started (as on the calendar and in the lists)
  BH.sessionDate = s => s.created || s.finishedAt || 0;
  // a player's score counts only where it was kept: rounds were played, or it was written in afterwards
  BH.isEndScored = g => !!(g && g.scoring && g.scoring.type === "end");
  // a cooperative game: the rounds are heists (ok or not), nobody has a score; the team wins or loses together
  BH.isCoop = g => !!(g && g.scoring && g.scoring.type === "coop");
  BH.hasScore = (s, id) => (!BH.isEndScored(BH.game(s.gameId)) && !BH.isCoop(BH.game(s.gameId)) && s.rounds.length > 0) || !!(s.final && s.final[id] !== undefined);
  // heists so far, and how many make the end: wins (vaults) and losses (alarms) from the game and its mode
  BH.coopTally = s => {
    const g = BH.game(s.gameId), sc = (g && g.scoring) || {}, ctx = BH.ctxOf(s);
    const kept = !s.rounds.length && s.tally;   // a game recorded afterwards with its score
    const ok = kept ? s.tally.ok : s.rounds.filter(r => r.heist === "ok").length, fail = kept ? s.tally.fail : s.rounds.filter(r => r.heist === "fail").length;
    const wins = sc.wins || 3, losses = typeof sc.losses === "function" ? sc.losses(ctx) : sc.losses || 3;
    return { ok, fail, wins, losses, won: ok >= wins, lost: fail >= losses, over: ok >= wins || fail >= losses };
  };
  BH.playerStats = (pid, sessions) => {
    const mine = (sessions || []).filter(s => s.status === "finished" && s.players.includes(pid)).sort((a, b) => BH.sessionDate(a) - BH.sessionDate(b));
    const isWin = s => s.winners.includes(pid);
    const dur = s => (s.finishedAt && s.startedAt && s.finishedAt > s.startedAt ? s.finishedAt - s.startedAt : 0);
    const games = new Map(), opp = new Map(), places = new Map();
    let longest = 0, run = 0;
    for (const s of mine) {
      const g = BH.game(s.gameId), lower = !!(g && g.scoring && g.scoring.lowerWins);
      const e = games.get(s.gameId) || { gameId: s.gameId, n: 0, wins: 0, time: 0, sum: 0, scored: 0, best: null, last: 0 };
      e.n++; e.time += dur(s); e.last = Math.max(e.last, BH.sessionDate(s));
      if (isWin(s)) e.wins++;
      if (BH.hasScore(s, pid)) {
        const score = BH.totals(s)[pid];
        e.sum += score; e.scored++;
        if (e.best === null || (lower ? score < e.best : score > e.best)) e.best = score;
      }
      games.set(s.gameId, e);
      for (const o of s.players) if (o !== pid) {
        const x = opp.get(o) || { id: o, n: 0, myWins: 0, theirWins: 0 };
        x.n++; if (isWin(s)) x.myWins++; if (s.winners.includes(o)) x.theirWins++;
        opp.set(o, x);
      }
      if (s.placeId && BH.place(s.placeId)) places.set(s.placeId, (places.get(s.placeId) || 0) + 1);
      run = isWin(s) ? run + 1 : 0; longest = Math.max(longest, run);
    }
    let current = 0; for (let i = mine.length - 1; i >= 0 && isWin(mine[i]); i--) current++;
    const list = [...games.values()].map(e => Object.assign(e, { avg: e.scored ? Math.round(e.sum / e.scored) : null, rate: e.n ? e.wins / e.n : 0 }));
    // H-index: h games played at least h times each
    const counts = list.map(e => e.n).sort((a, b) => b - a);
    let h = 0; while (h < counts.length && counts[h] >= h + 1) h++;
    const wins = mine.filter(isWin).length;
    const favPlace = [...places.entries()].sort((a, b) => b[1] - a[1])[0];
    return {
      played: mine.length, wins, rate: mine.length ? wins / mine.length : 0,
      time: mine.reduce((a, s) => a + dur(s), 0), hIndex: h, longestStreak: longest, currentStreak: current,
      games: list, opponents: [...opp.values()].sort((a, b) => b.n - a.n || b.myWins - a.myWins),
      favPlace: favPlace ? { id: favPlace[0], n: favPlace[1] } : null,
      first: mine.length ? BH.sessionDate(mine[0]) : 0, last: mine.length ? BH.sessionDate(mine[mine.length - 1]) : 0,
      sessions: mine.slice().reverse(),
    };
  };

  /* everything the game's page shows about its finished sessions (already narrowed to a period) */
  BH.gameStats = (gameId, sessions) => {
    const g = BH.game(gameId), low = !!(g && g.scoring && g.scoring.lowerWins);
    const better = (a, b) => (low ? a < b : a > b);
    const mine = (sessions || []).filter(s => s.status === "finished" && s.gameId === gameId).sort((a, b) => BH.sessionDate(a) - BH.sessionDate(b));
    const dur = s => (s.finishedAt && s.startedAt && s.finishedAt > s.startedAt ? s.finishedAt - s.startedAt : 0);
    const people = new Map(), places = new Map();
    let bestScore = null, bestRound = null, winSum = 0, winN = 0, rounds = 0, withRounds = 0, seats = 0;
    for (const s of mine) {
      const t = BH.totals(s);
      seats += s.players.length;
      for (const id of s.players) {
        const e = people.get(id) || { id, n: 0, wins: 0, sum: 0, scored: 0, best: null };
        e.n++; if (s.winners.includes(id)) e.wins++;
        if (BH.hasScore(s, id)) {
          e.sum += t[id]; e.scored++;
          if (e.best === null || better(t[id], e.best)) e.best = t[id];
          if (!bestScore || better(t[id], bestScore.v)) bestScore = { id, v: t[id], sid: s.id, at: BH.sessionDate(s) };
        }
        people.set(id, e);
      }
      // one number per game: the winners' score (a tie counts once)
      const ws = s.winners.filter(id => BH.hasScore(s, id));
      if (ws.length) { winSum += ws.reduce((a, id) => a + t[id], 0) / ws.length; winN++; }
      if (s.rounds.length && !BH.isEndScored(g)) {
        withRounds++; rounds += s.rounds.length;
        if (!BH.isCoop(g)) s.rounds.forEach((rd, i) => s.players.forEach(id => {
          const v = Number(rd.scores[id]) || 0;
          if (!bestRound || better(v, bestRound.v)) bestRound = { id, v, sid: s.id, round: i + 1 };
        }));
      }
      if (s.placeId && BH.place(s.placeId)) places.set(s.placeId, (places.get(s.placeId) || 0) + 1);
    }
    const timed = mine.filter(dur), time = timed.reduce((a, s) => a + dur(s), 0);
    const list = [...people.values()].map(e => Object.assign(e, { rate: e.n ? e.wins / e.n : 0, avg: e.scored ? Math.round(e.sum / e.scored) : null }))
      .sort((a, b) => b.wins - a.wins || b.rate - a.rate || b.n - a.n);
    const fav = [...places.entries()].sort((a, b) => b[1] - a[1])[0];
    return {
      played: mine.length, players: list, bestScore, bestRound,
      avgWin: winN ? Math.round(winSum / winN) : null,
      time, avgTime: timed.length ? Math.round(time / timed.length) : 0,
      avgRounds: withRounds ? Math.round(10 * rounds / withRounds) / 10 : 0,
      avgTable: mine.length ? Math.round(10 * seats / mine.length) / 10 : 0,
      favPlace: fav ? { id: fav[0], n: fav[1] } : null,
      first: mine.length ? BH.sessionDate(mine[0]) : 0, last: mine.length ? BH.sessionDate(mine[mine.length - 1]) : 0,
      sessions: mine.slice().reverse(),
    };
  };

  /* everything a place's page shows about the finished sessions played there (narrowed to a period) */
  BH.placeStats = (placeId, sessions) => {
    const mine = (sessions || []).filter(s => s.status === "finished" && s.placeId === placeId).sort((a, b) => BH.sessionDate(a) - BH.sessionDate(b));
    const dur = s => (s.finishedAt && s.startedAt && s.finishedAt > s.startedAt ? s.finishedAt - s.startedAt : 0);
    const games = new Map(), people = new Map();
    for (const s of mine) {
      const e = games.get(s.gameId) || { gameId: s.gameId, n: 0, last: 0 };
      e.n++; e.last = Math.max(e.last, BH.sessionDate(s)); games.set(s.gameId, e);
      for (const id of s.players) {
        const x = people.get(id) || { id, n: 0, wins: 0 };
        x.n++; if (s.winners.includes(id)) x.wins++; people.set(id, x);
      }
    }
    return {
      played: mine.length,
      games: [...games.values()].sort((a, b) => b.n - a.n || b.last - a.last),
      players: [...people.values()].map(x => Object.assign(x, { rate: x.n ? x.wins / x.n : 0 })).sort((a, b) => b.wins - a.wins || b.rate - a.rate || b.n - a.n),
      time: mine.reduce((a, s) => a + dur(s), 0),
      first: mine.length ? BH.sessionDate(mine[0]) : 0, last: mine.length ? BH.sessionDate(mine[mine.length - 1]) : 0,
      sessions: mine.slice().reverse(),
    };
  };

  /* players sorted best first, with shared places for equal totals */
  // a game with a tie-breaker (Faraway: the lowest card number in the play area) uses it for the first place only
  // (the book decides the winner with it), and only when every player sharing that place has the value
  BH.standings = s => {
    const g = BH.game(s.gameId), t = BH.totals(s), high = !(g && g.scoring && g.scoring.lowerWins);
    const useTb = BH.isEndScored(g) && g.endScore && g.endScore.tie && s.finalDetail;
    const tbOf = id => { const d = useTb && s.finalDetail[id]; return d && Number.isInteger(d.tie) ? d.tie : null; };
    const list = s.players.map((id, seat) => ({ id, seat, total: t[id], tb: tbOf(id) }));
    list.sort((a, b) => (high ? b.total - a.total : a.total - b.total) || a.seat - b.seat);
    const topN = list.filter(x => list.length && x.total === list[0].total).length;
    const split = useTb && topN > 1 && list.slice(0, topN).every(x => x.tb !== null);
    if (split) list.splice(0, topN, ...list.slice(0, topN).sort((a, b) => a.tb - b.tb || a.seat - b.seat));
    let place = 0, prev = null;
    list.forEach((x, i) => {
      const apart = split && i < topN && prev && x.tb !== prev.tb;
      if (prev === null || x.total !== prev.total || apart) place = i + 1;
      x.place = place; prev = x;
    });
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

  /* ---------- scoring at the end (g.endScore): rows (the cards, last to first), extra rows, the tie-breaker ----------
     a sheet: { cards: [fame of the 1st…Nth card played], <extra id>: fame, tie: the tie-breaker value } — empty is null */
  const intOrNull = v => (v === "" || v === null || v === undefined ? null : Number(v));
  BH.endTotal = (g, d) => {
    const e = g.endScore; if (!e || !d) return 0;
    const cells = (d.cards || []).slice(0, e.rows).concat((e.extra || []).map(x => d[x.id]));
    return cells.reduce((a, v) => a + (Number.isFinite(intOrNull(v)) ? intOrNull(v) : 0), 0);
  };
  // what in a sheet breaks the rules: fame is a whole number from 0; the tie-breaker within its range
  BH.endProblems = (g, d, o) => {
    const e = g.endScore, out = []; if (!e || !d) return out;
    const bad = v => { const n = intOrNull(v); return n !== null && (!Number.isInteger(n) || n < 0 || n > e.max); };
    (d.cards || []).slice(0, e.rows).forEach((v, i) => { if (bad(v)) out.push(`${e.rowLabel(i + 1)}: слава — целое число от 0 до ${e.max}`); });
    for (const x of e.extra || []) if (bad(d[x.id])) out.push(`${x.label}: слава — целое число от 0 до ${e.max}`);
    const t = intOrNull(d.tie);
    const tmin = o && o.partial ? 1 : e.tie && e.tie.min, tmax = e.tie && (o && o.partial && e.tie.partialMax ? e.tie.partialMax : e.tie.max);
    if (e.tie && t !== null && (!Number.isInteger(t) || t < tmin || t > tmax)) out.push(`${e.tie.label}: от ${tmin} до ${tmax}`);
    return out;
  };
  BH.endFilled = (g, d) => { const e = g.endScore; if (!e || !d) return 0; return (d.cards || []).slice(0, e.rows).concat((e.extra || []).map(x => d[x.id])).filter(v => intOrNull(v) !== null).length; };
  // who won: the most fame; equal fame — the lowest tie-breaker value (Faraway: the lowest card number).
  // tieOpen: the players still tied for lack of the value, so the app can ask for it
  BH.endWinners = (g, players, sheets) => {
    const tot = Object.fromEntries(players.map(id => [id, BH.endTotal(g, sheets[id])]));
    const best = Math.max(...players.map(id => tot[id]));
    let top = players.filter(id => tot[id] === best);
    if (top.length < 2 || !(g.endScore && g.endScore.tie)) return { winners: top, totals: tot, tieOpen: [] };
    const tv = id => intOrNull(sheets[id] && sheets[id].tie);
    const missing = top.filter(id => tv(id) === null);
    if (missing.length) return { winners: top, totals: tot, tieOpen: missing };
    const low = Math.min(...top.map(tv));
    return { winners: top.filter(id => tv(id) === low), totals: tot, tieOpen: [], byTie: true };
  };

  /* ---------- round calculator: generic card picker, the game supplies groups and compute() ---------- */
  BH.emptySel = () => ({ picks: {}, flags: {} });
  // how many cards of a limited kind are picked: groups with the same pool share one max
  // (Flip 7: With A Vengeance — the numbers and the special numbers, seven in all)
  BH.pickLimit = (g, picks, grp) => {
    const pool = grp.pool || grp.id, groups = g.calc.groups.filter(x => (x.pool || x.id) === pool);
    return { max: (groups.find(x => x.max) || {}).max || 0, count: groups.reduce((n, x) => n + ((picks || {})[x.id] || []).length, 0) };
  };

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
  BH.tokens = text => String(text || "").toLowerCase().replace(/ё/g, "е").split(/[^a-zа-я0-9×÷+]+/i).filter(w => w && !STOP.has(w)).map(BH.stem);
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
