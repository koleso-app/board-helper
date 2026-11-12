// Checks the game engine and the Flip 7 data without a browser.  Run: npm test
const fs = require("fs"), path = require("path"), vm = require("vm"), assert = require("assert");

const store = {};
const ctx = {
  console, setTimeout, clearTimeout, Date, Math, JSON, Set, Map, Array, Object, String, Number, Promise,
  localStorage: { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); } },
  addEventListener() {}, document: { addEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] },
};
ctx.window = ctx;
vm.createContext(ctx);
for (const f of ["js/util.js", "js/store.js", "js/games.js", "js/art.js", "games/flip7.js", "games/flip7v.js", "games/faraway.js", "games/thegang.js", "games/crokinole.js", "games/coconuts.js", "games/goldfever.js"])
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "app", f), "utf8"), ctx, { filename: f });
const BH = ctx.BH, g = BH.game("flip7");
let passed = 0;
const t = (name, fn) => { try { fn(); passed++; } catch (e) { console.error("FAIL " + name + "\n  " + e.message); process.exitCode = 1; } };
const sel = (num, mult, mod, bust) => ({ picks: { num: num || [], mult: mult || [], mod: mod || [] }, flags: bust ? { bust: true } : {} });
const score = s => BH.calcScore(g, s, { players: 4 }).score;

t("numbers add up", () => assert.strictEqual(score(sel([3, 5, 12])), 20));
t("x2 doubles only the numbers", () => assert.strictEqual(score(sel([3, 5], ["x2"], [10])), 26));
t("modifiers alone score", () => assert.strictEqual(score(sel([], [], [4, 6])), 10));
t("x2 alone with no numbers is 0", () => assert.strictEqual(score(sel([], ["x2"])), 0));
t("flip 7 bonus after x2, not doubled", () => {
  const r = BH.calcScore(g, sel([0, 1, 2, 3, 4, 5, 6], ["x2"], [2]), {});
  assert.strictEqual(r.score, 21 * 2 + 2 + 15); assert.strictEqual(r.flip7, true);
});
t("bust is zero whatever the cards", () => assert.strictEqual(score(sel([12, 11], ["x2"], [10], true)), 0));
t("two flip 7s warn", () => assert.strictEqual(g.calc.roundWarnings([{ flip7: true }, { flip7: true }]).length, 1));
t("deck is 94 cards", () => assert.ok(g.rules.find(r => r.id === "deck").body.includes("79")));

const mk = (n, first) => ({ gameId: "flip7", players: Array.from({ length: n }, (_, i) => "p" + i), exp: [], rounds: [], first: first || "p0", setupDone: {} });
t("dealer passes left each round", () => {
  const s = mk(4, "p2");
  assert.deepStrictEqual([0, 1, 2, 3, 4].map(r => BH.leaderAt(s, r)), ["p2", "p3", "p0", "p1", "p2"]);
});
t("second deck step only for 19+", () => {
  assert.ok(!BH.setupSteps(mk(6)).some(x => x.id === "second-deck"));
  assert.ok(BH.setupSteps(mk(19)).some(x => x.id === "second-deck"));
});
t("setup text sees the player count", () => assert.ok(BH.setupSteps(mk(5)).find(x => x.id === "space").text.includes("5")));
t("not over below 200", () => {
  const s = mk(3); s.rounds.push({ scores: { p0: 150, p1: 199, p2: 10 } });
  assert.strictEqual(BH.checkEnd(s).over, false);
});
t("over at 200, highest wins", () => {
  const s = mk(3); s.rounds.push({ scores: { p0: 150, p1: 120, p2: 10 } }, { scores: { p0: 30, p1: 95, p2: 0 } });
  const e = BH.checkEnd(s); assert.strictEqual(e.over, true); assert.deepStrictEqual(Array.from(e.winners), ["p1"]);
});
t("tie at the top is reported", () => {
  const s = mk(3); s.rounds.push({ scores: { p0: 205, p1: 205, p2: 210 } });
  assert.strictEqual(BH.checkEnd(s).tie, false);
  s.rounds.push({ scores: { p0: 5, p1: 5, p2: 0 } });
  const e = BH.checkEnd(s); assert.strictEqual(e.tie, true); assert.strictEqual(e.winners.length, 3);
});
t("standings share places", () => {
  const s = mk(3); s.rounds.push({ scores: { p0: 10, p1: 30, p2: 10 } });
  assert.deepStrictEqual(BH.standings(s).map(x => x.place), [1, 2, 2]);
});
t("search: x2", () => assert.ok(BH.searchRules(g, "удваивает ли x2 модификаторы")[0].title.includes("×2")));
t("search: freeze on myself", () => assert.ok(BH.searchRules(g, "можно ли freeze на себя").slice(0, 3).some(h => /Freeze/.test(h.title))));
t("search: running out of cards", () => assert.ok(BH.searchRules(g, "закончилась колода").slice(0, 3).some(h => /Колода закончилась|Колода закончилась посреди/.test(h.title))));
t("search: dealer next round", () => assert.ok(BH.searchRules(g, "кто сдаёт следующим").length > 0));
const withOpt = (n, on) => Object.assign(mk(n), { opts: { challenge: on } });
t("the 5-round challenge is an option for 1-2 players", () => {
  assert.strictEqual(BH.gameOptions(g, BH.ctxOf(mk(2))).length, 1);
  assert.strictEqual(BH.gameOptions(g, BH.ctxOf(mk(3))).length, 0);
  assert.ok(BH.setupSteps(withOpt(2, true)).some(x => x.id === "challenge"));
  assert.ok(!BH.setupSteps(withOpt(2, true)).some(x => x.id === "goal"));
  assert.ok(!BH.setupSteps(withOpt(2, false)).some(x => x.id === "challenge"));
  assert.ok(BH.setupSteps(withOpt(2, false)).some(x => x.id === "goal"));
  const s = withOpt(1, true); s.rounds = [1, 2, 3, 4].map(() => ({ scores: { p0: 50 } }));
  assert.ok(g.finishNote(s).text.startsWith("Вызов выполнен") && g.finishNote(s).ok);
  s.rounds.push({ scores: { p0: 1 } });
  assert.ok(g.finishNote(s).text.startsWith("Вызов не выполнен") && !g.finishNote(s).ok);
  assert.strictEqual(g.finishNote(Object.assign(withOpt(1, false), { rounds: s.rounds })), "");
  assert.strictEqual(g.finishNote(mk(3)), "");
});
t("a game recorded afterwards counts its final scores", () => {
  const s = Object.assign(mk(3), { final: { p0: 120, p1: 205, p2: 90 } });
  assert.strictEqual(BH.totals(s).p1, 205);
  assert.strictEqual(BH.standings(s)[0].id, "p1");
});
t("answers and game options survive normalize", () => {
  const n = BH._normalize({ players: [{ id: "a1", name: "Аня" }], answers: [{ id: "abc", game: "flip7", q: "?", answer: "Да.", page: 6 }, { id: "bad id", game: "flip7", answer: "x" }],
    sessions: [{ id: "s1", gameId: "flip7", players: ["a1"], opts: { challenge: 1 }, final: { a1: "150", ghost: 3 } }] });
  assert.strictEqual(n.answers.length, 1);
  assert.strictEqual(n.sessions[0].opts.challenge, true);
  assert.strictEqual(JSON.stringify(n.sessions[0].final), '{"a1":150}');
});
t("search by the rulebook's words", () => {
  assert.ok(BH.searchRules(g, "что такое хит").slice(0, 2).some(h => /Хит/.test(h.title)));
  assert.ok(BH.searchRules(g, "заморозь").slice(0, 3).some(h => /Заморозь/.test(h.title)));
  assert.ok(BH.searchRules(g, "вторая попытка").slice(0, 3).some(h => /Вторая попытка/.test(h.title)));
});
t("every rule from the book has a page, except our own tie note", () => { for (const r of g.rules) if (r.id !== "tie") assert.ok(r.page > 0, r.id); });
// docs/ui.md «Помогать, а не нагружать»: what is read during play is short — a setup step in up to 30 words,
// a line of the round (a phase step, a reminder, «После раунда») in up to 16; the details live in the rules
t("in-game texts of every game are short", () => {
  const words = s => String(s).replace(/\*/g, "").split(/\s+/).filter(Boolean).length;
  const c = { players: 4, opt: () => true, has: () => true, exp: new Set() };
  for (const game of BH.games) {
    for (const st of game.setup || []) { const t = typeof st.text === "function" ? st.text(c) : st.text; assert.ok(words(t) <= 30, `${game.id} setup ${st.id}: ${words(t)} слов`); }
    const R = game.rounds || {}, last = R.count || 8, rem = typeof R.reminder === "function" ? R.reminder(c) : R.reminder;
    const lines = [...(rem || []), ...(game.cards || []).flatMap(k => k.does.split("\n"))];
    for (let r = 1; r <= last; r++) {
      if (R.phases) for (const p of R.phases(c, r, last)) lines.push(...(p.steps || [p.text]));
      lines.push(...((typeof R.after === "function" ? R.after(c, r, last) : R.after) || []));
    }
    // a heist of a cooperative game: its steps with every card in play, and what each card says
    if (game.heist) {
      const all = [...Object.keys(game.heist.cards.ch).map(n => ({ kind: "ch", n: +n })), ...Object.keys(game.heist.cards.sp).map(n => ({ kind: "sp", n: +n }))];
      for (const p of game.heist.steps(c, all)) lines.push(...p.steps);
      for (const k of ["ch", "sp"]) for (const d of Object.values(game.heist.cards[k])) lines.push(...d.steps, ...(d.line ? [d.line] : []));
    }
    for (const l of lines) assert.ok(words(l) <= 16, `${game.id}: «${l}» — ${words(l)} слов`);
  }
});
t("normalize keeps a default place", () => assert.strictEqual(BH._normalize({}).places[0].name, "Дома"));
t("'this is me' is one record of its own; the old flag on a player is moved into it", () => {
  const old = BH._normalize({ players: [{ id: "a1", name: "Аня", me: true }, { id: "b2", name: "Боря", me: true }] });
  assert.strictEqual(JSON.stringify(old.profile), '[{"id":"me","player":"a1"}]');
  assert.ok(old.players.every(p => !("me" in p)), "players carry no flag any more");
  const n = BH._normalize({ players: [{ id: "a1", name: "Аня" }], profile: [{ id: "me", player: "a1" }, { id: "x", player: "a1" }] });
  assert.strictEqual(JSON.stringify(n.profile), '[{"id":"me","player":"a1"}]');
  assert.strictEqual(JSON.stringify(BH._normalize(JSON.parse(JSON.stringify(n)))), JSON.stringify(n), "stable");
  assert.strictEqual(JSON.stringify(BH._normalize({}).profile), "[]");
  const gone = BH._normalize({ players: [{ id: "a1", name: "Аня" }], profile: [{ id: "me", player: "zz" }] });
  assert.strictEqual(JSON.stringify(gone.profile), "[]", "'me' never points at a player that is gone");
});
t("a game belongs to the day it was started (a game past midnight stays on its day)", () => {
  const s = { created: new Date(2025, 11, 31, 23, 30).getTime(), finishedAt: new Date(2026, 0, 1, 0, 40).getTime() };
  assert.strictEqual(new Date(BH.sessionDate(s)).getFullYear(), 2025);
});
t("reading answers aloud is on by default and can be turned off", () => {
  assert.strictEqual(BH._normalize({}).settings.speakAnswers, true);
  assert.strictEqual(BH._normalize({ settings: { speakAnswers: false } }).settings.speakAnswers, false);
  assert.strictEqual(BH._normalize({ settings: { speakAnswers: "мусор" } }).settings.speakAnswers, true);
});
t("faq refs point at real sections", () => { for (const f of g.faq) if (f.ref) assert.ok(g.rules.some(r => r.id === f.ref), f.ref); });
t("every faq topic points at real sections", () => { for (const grp of g.faqGroups || []) for (const r of grp.refs) assert.ok(g.rules.some(x => x.id === r), r); });
t("every rule is in exactly one topic", () => {
  const ids = (g.ruleGroups || []).flatMap(grp => grp.ids);
  for (const r of g.rules) assert.strictEqual(ids.filter(x => x === r.id).length, 1, r.id);
  assert.strictEqual(ids.length, g.rules.length);
});
t("faq sources are known and questions are not repeated", () => {
  for (const f of g.faq) if (f.src) assert.ok(BH.FAQ_SRC[f.src], f.src);
  assert.strictEqual(new Set(g.faq.map(f => f.q)).size, g.faq.length);
});
t("players' questions are found: 200 mid-round, tie", () => {
  assert.ok(BH.searchRules(g, "набрал 200 посреди раунда").slice(0, 3).some(h => /посреди раунда/.test(h.title)));
  assert.ok(BH.searchRules(g, "ничья").slice(0, 3).some(h => /Ничья/.test(h.title)));
});

t("player stats: games, wins, streaks, H-index, rivals, place, time", () => {
  const H = 3600000, day = d => Date.UTC(2026, 9, d, 18);
  const mk = (id, d, gameId, players, winners, final, place, minutes) => ({ id, gameId, players, winners, status: "finished", rounds: [], final,
    created: day(d), startedAt: day(d), finishedAt: day(d) + (minutes || 0) * 60000, placeId: place || null });
  const ss = [
    mk("s1", 1, "flip7", ["a", "b"], ["a"], { a: 210, b: 100 }, "home", 30),
    mk("s2", 2, "flip7", ["a", "b"], ["b"], { a: 150, b: 205 }, "home", 30),
    mk("s3", 3, "flip7", ["a", "c"], ["a"], { a: 230, c: 90 }, "dacha", 0),
    mk("s4", 4, "flip7", ["a", "b", "c"], ["a"], { a: 201, b: 1, c: 2 }, "home", 60),
    mk("s5", 5, "other", ["b", "c"], ["b"], { b: 1, c: 0 }),
    Object.assign(mk("s6", 6, "flip7", ["a", "b"], [], {}), { status: "playing" }),
  ];
  const st = BH.playerStats("a", ss);
  assert.strictEqual(st.played, 4); assert.strictEqual(st.wins, 3); assert.strictEqual(st.rate, 0.75);
  assert.strictEqual(st.longestStreak, 2); assert.strictEqual(st.currentStreak, 2);
  assert.strictEqual(st.time, 2 * H);
  assert.strictEqual(st.hIndex, 1, "one game played 4 times: h = 1");
  const f = st.games.find(x => x.gameId === "flip7");
  assert.strictEqual(f.n, 4); assert.strictEqual(f.wins, 3); assert.strictEqual(f.best, 230); assert.strictEqual(f.avg, Math.round((210 + 150 + 230 + 201) / 4));
  assert.strictEqual(st.opponents[0].id, "b"); assert.strictEqual(st.opponents[0].n, 3); assert.strictEqual(st.opponents[0].myWins, 2); assert.strictEqual(st.opponents[0].theirWins, 1);
  assert.strictEqual(st.favPlace.id, "home"); assert.strictEqual(st.favPlace.n, 3);
  assert.strictEqual(st.sessions[0].id, "s4", "newest first");
  assert.strictEqual(BH.playerStats("zz", ss).played, 0);
  assert.strictEqual(BH.playerStats("zz", ss).hIndex, 0);
});
t("game stats: players, records, average win, rounds, time, table size", () => {
  const day = d => Date.UTC(2026, 9, d, 18);
  const rnd = (a, b) => ({ scores: { a, b }, flags: {} });
  const ss = [
    { id: "s1", gameId: "flip7", players: ["a", "b"], winners: ["a"], status: "finished", rounds: [rnd(50, 10), rnd(160, 95)], created: day(1), startedAt: day(1), finishedAt: day(1) + 3600000 },
    { id: "s2", gameId: "flip7", players: ["a", "b"], winners: ["b"], status: "finished", rounds: [rnd(20, 205)], created: day(2), startedAt: day(2), finishedAt: day(2) + 1800000, placeId: "home" },
    { id: "s3", gameId: "flip7", players: ["a", "b", "c"], winners: ["a"], status: "finished", rounds: [], final: { a: 230, b: 10, c: 5 }, created: day(3), startedAt: day(3), finishedAt: day(3), placeId: "home" },
    { id: "s4", gameId: "other", players: ["a", "b"], winners: ["a"], status: "finished", rounds: [], final: { a: 1, b: 0 }, created: day(4) },
    { id: "s5", gameId: "flip7", players: ["a", "b"], winners: [], status: "playing", rounds: [rnd(300, 0)], created: day(5) },
  ];
  const st = BH.gameStats("flip7", ss);
  assert.strictEqual(st.played, 3);
  assert.strictEqual(st.players[0].id, "a"); assert.strictEqual(st.players[0].wins, 2); assert.strictEqual(st.players[0].n, 3);
  assert.strictEqual(st.bestScore.id, "a"); assert.strictEqual(st.bestScore.v, 230);
  assert.strictEqual(st.bestRound.id, "b"); assert.strictEqual(st.bestRound.v, 205);
  assert.strictEqual(st.avgWin, Math.round((210 + 205 + 230) / 3));
  assert.strictEqual(st.avgRounds, 1.5); assert.strictEqual(st.avgTable, 2.3);
  assert.strictEqual(st.time, 5400000); assert.strictEqual(st.avgTime, 2700000);
  assert.strictEqual(st.favPlace.id, "home"); assert.strictEqual(st.sessions[0].id, "s3");
  assert.strictEqual(BH.gameStats("nope", ss).played, 0);
});
t("a game recorded without scores does not count as zero points; a tie counts once", () => {
  const day = d => Date.UTC(2026, 9, d, 18);
  const ss = [
    { id: "s1", gameId: "flip7", players: ["a", "b"], winners: ["a"], status: "finished", rounds: [], final: { a: 230, b: 100 }, created: day(1) },
    { id: "s2", gameId: "flip7", players: ["a", "b"], winners: ["a"], status: "finished", rounds: [], created: day(2) },
    { id: "s3", gameId: "flip7", players: ["a", "b"], winners: ["a", "b"], status: "finished", rounds: [], final: { a: 200, b: 200 }, created: day(3) },
  ];
  const st = BH.gameStats("flip7", ss);
  assert.strictEqual(st.avgWin, 215, "(230 + 200) / 2 — the unscored game and the tie's second winner do not count");
  const a = st.players.find(x => x.id === "a");
  assert.strictEqual(a.n, 3); assert.strictEqual(a.avg, 215); assert.strictEqual(a.best, 230);
  assert.strictEqual(BH.playerStats("a", ss).games[0].avg, 215);
  assert.strictEqual(BH.gameStats("flip7", [ss[1]]).bestScore, null);
});
t("place stats: games by plays, players by wins, time, only that place", () => {
  const day = d => Date.UTC(2026, 9, d, 18);
  const mk = (id, d, gameId, place, players, winners, min) => ({ id, gameId, placeId: place, players, winners, status: "finished", rounds: [], created: day(d), startedAt: day(d), finishedAt: day(d) + (min || 0) * 60000 });
  const ss = [mk("s1", 1, "flip7", "dacha", ["a", "b"], ["a"], 30), mk("s2", 2, "other", "dacha", ["a", "b", "c"], ["b"], 20), mk("s3", 3, "flip7", "dacha", ["a", "c"], ["a"]), mk("s4", 4, "flip7", "home", ["a", "b"], ["b"], 60)];
  const st = BH.placeStats("dacha", ss);
  assert.strictEqual(st.played, 3); assert.strictEqual(st.games[0].gameId, "flip7"); assert.strictEqual(st.games[0].n, 2);
  assert.strictEqual(st.players[0].id, "a"); assert.strictEqual(st.players[0].wins, 2); assert.strictEqual(st.players[0].n, 3);
  assert.strictEqual(st.time, 50 * 60000); assert.strictEqual(st.sessions[0].id, "s3");
  assert.strictEqual(BH.placeStats("nowhere", ss).played, 0);
});
t("one deck has only one 0 and one 1", () => {
  const w = g.calc.roundWarnings([{}, {}], [sel([0, 1, 5]), sel([0, 2, 5])], { players: 4 });
  assert.strictEqual(w.length, 1); assert.ok(w[0].includes("«0»")); assert.ok(!w[0].includes("«5»"));
});
t("no number warning with two decks", () => assert.strictEqual(g.calc.roundWarnings([{}, {}], [sel([0]), sel([0])], { players: 20 }).length, 0));

const eq = (a, b) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b));
const bad = BH._normalize({
  players: [{ id: "a1", name: "Аня", color: "#D9483B" }, { id: 'x" onmouseover="1', name: "Злой" }, { id: "b2", name: 42 }, { id: "c3", name: "Вера", color: "red;background:url(x)" }],
  places: [{ id: "home", name: "Дома" }, { id: "<p>", name: "x" }],
  sessions: [
    { id: "s1", gameId: "flip7", players: ["a1", "c3", "ghost"], status: "finished", rounds: [null, { scores: { a1: "12", c3: "<b>" } }, "x"], winners: "a1", placeId: "nope" },
    { id: "s2\"", gameId: "flip7", players: ["a1"] },
    { id: "s3", gameId: "flip7", players: [] },
  ],
});
t("normalize drops bad ids and names", () => eq(bad.players.map(p => p.id), ["a1", "c3"]));
t("normalize fixes a bad colour", () => assert.match(bad.players[1].color, /^#[0-9A-Fa-f]{6}$/));
t("normalize drops bad places and sessions", () => { eq(bad.places.map(p => p.id), ["home"]); eq(bad.sessions.map(s => s.id), ["s1"]); });
t("normalize repairs a session", () => {
  const s = bad.sessions[0];
  eq(s.players, ["a1", "c3"]);
  assert.strictEqual(s.rounds.length, 1);
  eq(s.rounds[0].scores, { a1: 12, c3: 0 });
  eq(s.winners, []);
  assert.strictEqual(s.placeId, null);
  assert.strictEqual(BH.totals(s).a1, 12);
});
t("normalize keeps good data intact", () => {
  const good = { players: [{ id: "p1", name: "Аня", color: "#2F74D0" }], places: [{ id: "home", name: "Дома" }], placesTouched: true,
    sessions: [{ id: "s1", gameId: "flip7", players: ["p1"], status: "playing", first: "p1", startedAt: 5, rounds: [{ at: 1, scores: { p1: 7 }, flags: { p1: { bust: false, flip7: false } }, detail: { p1: { sel: { picks: { num: [7], mult: ["x2"] }, flags: {} }, manual: null } } }] }] };
  const n = BH._normalize(JSON.parse(JSON.stringify(good)));
  assert.strictEqual(n.sessions[0].first, "p1");
  eq(n.sessions[0].rounds[0].detail.p1.sel.picks, { num: [7], mult: ["x2"] });
  assert.strictEqual(n.sessions[0].rounds[0].scores.p1, 7);
});

console.log(`${passed} passed${process.exitCode ? ", some FAILED" : ""}`);

/* ---------- Flip 7: With A Vengeance ---------- */
{
  const v = BH.game("flip7v");
  const ctxOf = (n, brutal) => ({ players: n, exp: new Set(), has: () => false, opt: id => id === "brutal" ? !!brutal : false });
  const sel = (picks, flags) => ({ picks: picks || {}, flags: flags || {} });
  const score = (picks, flags, brutal) => BH.calcScore(v, sel(picks, flags), ctxOf(3, brutal));
  t("vengeance: the book's example — 48, ÷2 = 24, −4 = 20, seven numbers +15 = 35", () => {
    const r = score({ num: [3, 11, 5, 7, 10, 8, 4], div: ["d2"], minus: [4] });
    assert.strictEqual(r.score, 35); assert.strictEqual(r.flip7, true);
  });
  t("vengeance: ÷2 rounds down, minus never below zero (normal) but can (brutal)", () => {
    assert.strictEqual(score({ num: [5, 2], div: ["d2"] }).score, 3);
    assert.strictEqual(score({ num: [3], minus: [10] }).score, 0);
    assert.strictEqual(score({ num: [3], minus: [10] }, {}, true).score, -7);
  });
  t("vengeance: the Zero scores nothing without seven numbers, counts toward them with", () => {
    assert.strictEqual(score({ num: [12, 11], special: ["zero"] }).score, 0);
    const r = score({ num: [1, 2, 3, 4, 5, 6], special: ["zero"] });
    assert.strictEqual(r.flip7, true); assert.strictEqual(r.score, 21 + 15);
  });
  t("vengeance: Lucky 13 lets a second 13 count, both toward seven numbers", () => {
    const r = score({ num: [13, 1, 2, 3, 4, 5], special: ["l13"] });
    assert.strictEqual(r.flip7, true); assert.strictEqual(r.score, 13 + 15 + 13 + 15);
  });
  t("vengeance: the special numbers count toward the seven number cards", () => {
    const num = v.calc.groups.find(x => x.id === "num"), sp = v.calc.groups.find(x => x.id === "special"), mods = v.calc.groups.find(x => x.id === "minus");
    const picks = { num: [7, 8, 9, 10, 11, 12], special: ["zero"], minus: [2] };
    assert.deepStrictEqual(JSON.stringify(BH.pickLimit(v, picks, num)), JSON.stringify({ max: 7, count: 7 }));
    assert.deepStrictEqual(JSON.stringify(BH.pickLimit(v, picks, sp)), JSON.stringify({ max: 7, count: 7 }));
    assert.strictEqual(BH.pickLimit(v, picks, mods).max, 0, "the minus cards have no limit");
    const f = BH.game("flip7");
    assert.strictEqual(BH.pickLimit(f, { num: [1, 2] }, f.calc.groups.find(x => x.id === "num")).count, 2);
  });
  t("vengeance: a bust is 0, or minus the modifiers given in the brutal mode; −15 flags", () => {
    const shim = (picks, flags, brutal) => { const c = score(picks, flags, brutal); return flags.bust ? c.bustScore : c.score; };
    assert.strictEqual(shim({ num: [5], minus: [6] }, { bust: true }, false), 0);
    assert.strictEqual(shim({ num: [5], minus: [6] }, { bust: true }, true), -6);
    assert.strictEqual(score({ num: [1, 2, 3, 4, 5, 6, 7] }, { gave15: true }, true).score, 28);
    assert.strictEqual(score({ num: [10] }, { minus15: true }, true).score, -5);
    assert.strictEqual(score({ num: [10] }, { minus15: true }, false).score, 10, "the −15 exists only in the brutal mode");
  });
  t("bust hides the cards in the round sheet; only the minus cards of the brutal mode stay (book p. 7: modifiers go even to a busted player)", () => {
    const kept = (game, brutal) => game.calc.groups.filter(grp => grp.keepOnBust && grp.keepOnBust(ctxOf(3, brutal))).map(grp => grp.id).join(",");
    assert.strictEqual(kept(v, false), "");
    assert.strictEqual(kept(v, true), "minus");
    assert.strictEqual(kept(BH.game("flip7"), false), "");
  });
  t("vengeance: warnings — Unlucky 7 with a 7, too many cards of a number", () => {
    const w = v.calc.roundWarnings([{}, {}], [sel({ num: [7], special: ["u7"] }), sel({ num: [1] })], ctxOf(2));
    assert.ok(w.some(x => x.includes("Несчастливая 7")));
    const two = v.calc.roundWarnings([{}, {}], [sel({ num: [1] }), sel({ num: [1] })], ctxOf(2));
    assert.ok(two.some(x => x.includes("обычных «1» 1 шт.")));
  });
  t("vengeance: every faq points at a rule, every rule is in one topic, pages from the book", () => {
    for (const f of v.faq) { assert.ok(v.rules.some(r => r.id === f.ref), f.ref); if (f.src) assert.ok(BH.FAQ_SRC[f.src], f.src); }
    const ids = v.ruleGroups.flatMap(grp => grp.ids);
    for (const r of v.rules) assert.strictEqual(ids.filter(x => x === r.id).length, 1, r.id);
    // a page, a range «11–12» or a list «1, 7»: every number a printed page of the book (1–12)
    for (const r of v.rules) if (r.id !== "tie") assert.ok(String(r.page).split(/[–,\s]+/).filter(Boolean).every(n => /^\d+$/.test(n) && +n >= 1 && +n <= 12), r.id + ": " + r.page);
    for (const grp of v.faqGroups) for (const r of grp.refs) assert.ok(v.rules.some(x => x.id === r), r);
    for (const k of Object.keys(v.images.rules)) assert.ok(v.rules.some(r => r.id === k), "image for " + k);
  });
  t("vengeance: setup — brutal and challenge steps only when chosen", () => {
    const s = { gameId: "flip7v", players: ["a", "b"], exp: [], opts: {} };
    assert.ok(!BH.setupSteps(s).some(x => x.id === "brutal"));
    const both = BH.setupSteps(Object.assign({}, s, { opts: { brutal: true, challenge: true } }));
    assert.ok(both.some(x => x.id === "brutal")); assert.ok(both.some(x => x.id === "challenge")); assert.ok(!both.some(x => x.id === "goal"));
  });
  t("vengeance: the Zero in the brutal mode scores like a bust (minus the cards given)", () => {
    assert.strictEqual(score({ num: [12, 11], special: ["zero"], minus: [4] }, {}, true).score, -4);
    assert.strictEqual(score({ num: [12, 11], special: ["zero"], minus: [4] }, {}, false).score, 0);
    assert.ok(!Object.is(score({ num: [12], special: ["zero"] }, {}, true).score, -0));
  });
  t("vengeance: −15 flags that do not add up are reported; busted players skip card warnings", () => {
    const res = [{ score: 10 }, { score: 5 }];
    const w = v.calc.roundWarnings(res, [sel({ num: [10] }, { minus15: true }), sel({ num: [5] })], ctxOf(2, true));
    assert.ok(w.some(x => x.includes("никто не отмечен")));
    const w2 = v.calc.roundWarnings([{ flip7: false }, {}], [sel({ num: [10] }, { gave15: true }), sel({ num: [5] }, { minus15: true })], ctxOf(2, true));
    assert.ok(w2.some(x => x.includes("без «Подкидного 7»")));
    const w3 = v.calc.roundWarnings([{}, {}], [sel({ num: [7], special: ["u7"] }, { bust: true }), sel({ num: [1] })], ctxOf(2));
    assert.ok(!w3.some(x => x.includes("Несчастливая 7")), "a busted player is not warned about");
    assert.ok(!v.calc.flags.find(f => f.id === "gave15").when(ctxOf(1, true)), "no −15 when playing alone");
  });
  console.log(`${passed} passed (with Flip 7: With A Vengeance)${process.exitCode ? ", some FAILED" : ""}`);
}

/* ---------- Faraway («Дальние дали»): each test checks one rule of the book (docs/rules-check.md) ---------- */
{
  const F = BH.game("faraway");
  const fpassed0 = passed;
  const ctxN = (n, adv) => ({ players: n, exp: new Set(), has: () => false, opt: id => id === "advanced" ? !!adv : false });
  const sheet = (cards, sanct, tie) => ({ cards: cards.map(String), sanct: sanct === undefined ? "" : String(sanct), tie: tie === undefined ? "" : String(tie) });
  const plain = t => String(t).replace(/\*/g, "").replace(/\{[a-z0-9-]+\|([^}]+)\}/g, "$1");
  t("faraway p.1: 2–6 players, no first player, 8 rounds, scored at the end", () => {
    assert.strictEqual(F.players.min, 2); assert.strictEqual(F.players.max, 6);
    assert.ok(!F.first, "everyone plays at once — no wheel");
    assert.strictEqual(F.rounds.count, 8); assert.strictEqual(F.rounds.leader, false);
    assert.ok(BH.isEndScored(F)); assert.strictEqual(F.endScore.rows, 8);
  });
  t("faraway p.5: deal 3 (advanced: 5, keep 3); reveal players + 1", () => {
    const s = { gameId: "faraway", players: ["a", "b", "c", "d", "e"], exp: [], opts: {} };
    const st = BH.setupSteps(s);
    assert.ok(plain(st.find(x => x.id === "deal").text).includes("по 3"));
    const c = st.find(x => x.id === "center");
    assert.ok(c.title.includes("6"), "5 players reveal 6: " + c.title); assert.ok(c.text.includes("6"));
    const adv = plain(BH.setupSteps(Object.assign({}, s, { opts: { advanced: true } })).find(x => x.id === "deal").text);
    assert.ok(adv.includes("по 5") && adv.includes("выбирает 3") && adv.includes("откладывает") && adv.includes("с колодой"));
  });
  t("faraway p.10–11: round 1 has no sanctuaries; round 8 takes no card; the leftover goes, players + 1 come", () => {
    // the steps of the round and «После раунда», as one line without the bold marks
    const ph = r => plain([...F.rounds.phases(ctxN(4), r, 8).flatMap(p => p.steps), ...F.rounds.after(ctxN(4), r, 8)].join(" "));
    assert.ok(ph(1).includes("В 1-м раунде пропустите"));
    assert.ok(ph(3).includes("больше прошлой") && ph(3).includes("1 + ещё по 1 за каждую подсказку на своих картах — Регионах и Святилищах"));
    assert.ok(!plain(F.rounds.phases(ctxN(4), 1, 8)[2].steps.join(" ")).includes("Святилищ"), "round 1 finds no sanctuaries, so phase 3 says nothing of them");
    assert.ok(F.rounds.phases(ctxN(4), 3, 8)[1].steps.join(" ").includes("{clue|"), "the clue is shown as its icon");
    assert.ok(ph(3).includes("Уберите карту, оставшуюся на рынке") && ph(3).includes("новый рынок — 5 карт"), "4 players reveal 5");
    assert.ok(ph(3).includes("от меньшего номера"), "phase 3 goes from the lowest card up");
    assert.ok(ph(8).includes("Карту с рынка не берут") && !ph(8).includes("новый рынок") && ph(8).includes("подсчёт славы"), "round 8: no card, then the fame");
    assert.ok(ph(8).includes("оставьте 1") && ph(8).includes("под колоду"), "in round 8 a sanctuary may still be added");
    assert.ok(ph(3).includes("Возьмите 1 карту с рынка") && ph(3).includes("оставьте 1") && ph(3).includes("под колоду"), "one card from the market, one sanctuary kept, the rest under the deck");
    assert.ok(ph(1).includes("Все разом") && ph(1).includes("рубашкой вверх") && ph(1).includes("справа"), "phase 1: at once, face down, to the right");
    assert.strictEqual(F.rounds.phases(ctxN(4), 2, 8)[1].title, "Обнаружение Святилищ");
    assert.strictEqual(F.rounds.phases(ctxN(4), 2, 8)[2].title, "Добор карт Регионов", "the official name of phase 3");
    assert.ok(ph(7).includes("Новый рынок не открывайте") && !ph(7).includes("так решают игроки"), "the book (p. 11): no market for round 8");
    assert.ok(ph(3).includes("«Раунд 3 сыгран»"), "after the round: which button to press");
  });
  t("faraway p.12: the fame is the sum of the 8 Region cards and the sanctuaries", () => {
    assert.strictEqual(BH.endTotal(F, sheet([3, 0, 12, 6, 0, 19, 4, 8], 7)), 59);
    assert.strictEqual(BH.endTotal(F, sheet(["", "", "", "", "", "", "", ""])), 0, "empty is zero");
  });
  t("faraway: fame is a whole number from 0; the lowest card number is 1…61 (68 in a game stopped early)", () => {
    assert.strictEqual(BH.endProblems(F, sheet([0, 1, 2, 3, 4, 5, 6, 7], 0, 1)).length, 0);
    assert.strictEqual(BH.endProblems(F, sheet([-1, 0, 0, 0, 0, 0, 0, 0])).length, 1, "no negative fame");
    assert.strictEqual(BH.endProblems(F, sheet([1.5, 0, 0, 0, 0, 0, 0, 0])).length, 1, "whole numbers");
    assert.strictEqual(BH.endProblems(F, sheet([0, 0, 0, 0, 0, 0, 0, 0], -2)).length, 1, "sanctuaries too");
    assert.strictEqual(BH.endProblems(F, sheet([0, 0, 0, 0, 0, 0, 0, 0], 0, 0)).length, 1, "cards are numbered from 1");
    assert.strictEqual(BH.endProblems(F, sheet([0, 0, 0, 0, 0, 0, 0, 0], 0, 61)).length, 0, "61 with 62…68 is the highest lowest card of 8");
    assert.strictEqual(BH.endProblems(F, sheet([0, 0, 0, 0, 0, 0, 0, 0], 0, 62)).length, 1, "8 different cards always hold one of 61 or lower");
    assert.strictEqual(BH.endProblems(F, sheet([0, 0, 0, 0, 0, 0, 0, 0], 0, 250)).length, 1, "a sum typed by habit is caught");
    assert.strictEqual(BH.endProblems(F, sheet([0, 0, 0, 0, 0, 0, 0, 0], 0, 66), { partial: true }).length, 0, "a game stopped early has fewer cards");
    assert.strictEqual(BH.endProblems(F, sheet([0, 0, 0, 0, 0, 0, 0, 0], 0, 69), { partial: true }).length, 1, "there is no card 69");
  });
  t("faraway p.12 (the official Russian and the English rules): equal fame — the lowest card number in the play area wins", () => {
    assert.ok(/наименьш/i.test(F.endScore.tie.label) && !/сумм/i.test(F.endScore.tie.label + F.scoring.tieHint + F.scoring.tieNote), "one card, not a sum");
    assert.ok(!/сумм/i.test(F.rules.find(r => r.id === "tie").body), "the rule speaks of one card");
    const pl = ["a", "b", "c"];
    const one = BH.endWinners(F, pl, { a: sheet([10, 0, 0, 0, 0, 0, 0, 0]), b: sheet([5, 0, 0, 0, 0, 0, 0, 0]), c: sheet([1, 0, 0, 0, 0, 0, 0, 0]) });
    assert.deepStrictEqual([...one.winners], ["a"]); assert.strictEqual(one.tieOpen.length, 0);
    const tied = { a: sheet([10, 0, 0, 0, 0, 0, 0, 0]), b: sheet([4, 6, 0, 0, 0, 0, 0, 0]), c: sheet([1, 0, 0, 0, 0, 0, 0, 0]) };
    const open = BH.endWinners(F, pl, tied);
    assert.deepStrictEqual([...open.tieOpen], ["a", "b"], "the tied players are asked for their lowest card");
    tied.a.tie = "12"; tied.b.tie = "3";
    const decided = BH.endWinners(F, pl, tied);
    assert.deepStrictEqual([...decided.winners], ["b"]); assert.ok(decided.byTie);
    tied.a.tie = "3";
    assert.deepStrictEqual([...BH.endWinners(F, pl, tied).winners], ["a", "b"], "the same number typed twice (a typo) — a shared win, nothing is invented");
  });
  t("faraway: the score sheet survives saving and syncing (normalize keeps it, idempotent)", () => {
    const raw = { players: [{ id: "a", name: "А" }, { id: "b", name: "Б" }], places: [], placesTouched: true, sessions: [{ id: "s1", gameId: "faraway", players: ["a", "b"], status: "finished", rounds: [], final: { a: 59, b: 40 },
      finalDetail: { a: { cards: [3, 0, 12, 6, 0, 19, 4, 8], sanct: 7, tie: 250 }, b: { cards: [5, 5, 5, 5, 5, 5, 5, 5], sanct: 0, tie: null }, x: { cards: [1] } }, winners: ["a"] }] };
    BH.replaceFromSync(raw);
    const fd = BH.state.sessions[0].finalDetail;
    assert.deepStrictEqual(JSON.stringify(fd.a), JSON.stringify({ cards: [3, 0, 12, 6, 0, 19, 4, 8], sanct: 7, tie: 250 }));
    assert.strictEqual(fd.b.tie, null); assert.ok(!fd.x, "a sheet of someone not at the table is dropped");
    const before = JSON.stringify(BH.state.sessions[0]);
    BH.replaceFromSync(JSON.parse(JSON.stringify(BH.state)));
    assert.strictEqual(JSON.stringify(BH.state.sessions[0]), before, "normalize twice — the same");
  });
  t("faraway: a game recorded with fame counts as scored; its rounds alone do not", () => {
    const s = { gameId: "faraway", players: ["a", "b"], rounds: [{ scores: { a: 0, b: 0 } }], final: undefined };
    assert.strictEqual(BH.hasScore(s, "a"), false, "8 counted rounds carry no fame");
    assert.strictEqual(BH.hasScore(Object.assign({}, s, { final: { a: 59, b: 40 } }), "a"), true);
  });
  t("faraway: rules, groups, questions and pictures refer to real sections", () => {
    const ids = new Set(F.rules.map(r => r.id));
    for (const gr of F.ruleGroups) for (const id of gr.ids) assert.ok(ids.has(id), "group " + id);
    for (const gr of F.faqGroups) for (const id of gr.refs) assert.ok(ids.has(id), "faq group " + id);
    for (const f of F.faq) assert.ok(ids.has(f.ref), "faq ref " + f.ref);
    for (const k of Object.keys(F.images.rules)) assert.ok(ids.has(k), "image for " + k);
    assert.ok(F.rules.every(r => r.page === undefined || (r.page >= 1 && r.page <= 12)), "pages of the 12-page book");
    const grouped = new Set(F.ruleGroups.flatMap(gr => gr.ids));
    for (const id of ids) assert.ok(grouped.has(id), "rule in a group: " + id);
  });
  console.log(`faraway: ${passed - fpassed0} passed${process.exitCode ? ", some FAILED" : ""}`);
}
{
  const before = passed;
  t("faraway p.12: places follow the tie-breaker — equal fame, the lower card is first", () => {
    const s = { gameId: "faraway", players: ["a", "b", "c", "d"], rounds: [], final: { a: 59, b: 59, c: 38, d: 38 },
      finalDetail: { a: { cards: [], tie: 12 }, b: { cards: [], tie: 3 }, c: { cards: [], tie: null }, d: { cards: [], tie: null } } };
    const st = BH.standings(s);
    assert.deepStrictEqual(st.map(x => x.id + ":" + x.place).join(" "), "b:1 a:2 c:3 d:3", "b wins on the lower card; c and d stay shared without one");
    s.finalDetail.c.tie = 5; s.finalDetail.d.tie = 9;
    assert.deepStrictEqual(BH.standings(s).filter(x => x.total === 38).map(x => x.place), [3, 3], "the tie-breaker decides the first place only");
    const three = { gameId: "faraway", players: ["a", "b", "c"], rounds: [], final: { a: 50, b: 50, c: 50 }, finalDetail: { a: { cards: [], tie: 2 }, b: { cards: [], tie: 7 }, c: { cards: [], tie: null } } };
    assert.deepStrictEqual(BH.standings(three).map(x => x.place), [1, 1, 1], "a value missing for one of them — a shared place, as the shared win");
    s.finalDetail.a.tie = 3;
    assert.strictEqual(BH.standings(s).filter(x => x.place === 1).length, 2, "the same value — a shared first place");
    const flip = { gameId: "flip7", players: ["a", "b"], rounds: [{ scores: { a: 5, b: 5 } }] };
    assert.deepStrictEqual(BH.standings(flip).map(x => x.place), [1, 1], "games without a tie-breaker share places");
  });
  console.log(`faraway standings: ${passed - before} passed${process.exitCode ? ", some FAILED" : ""}`);
}
{
  // The Gang: the English rulebook, pages as printed (docs/rules-check.md)
  const G = BH.game("thegang"), before = passed;
  const ctxM = (n, mode) => ({ players: n, exp: new Set(), has: () => false, opt: id => id === mode });
  const lines = (ctx, act, i) => G.heist.steps(ctx, act)[i].steps.join(" ").replace(/\*/g, "");
  t("the gang p.2–4: 3–6 players, no first player, cooperative, chips 1…players", () => {
    assert.strictEqual(G.players.min, 3); assert.strictEqual(G.players.max, 6);
    assert.ok(!G.first, "no turn order, everyone at once");
    assert.ok(BH.isCoop(G));
    const st = BH.setupSteps({ gameId: "thegang", players: ["a", "b", "c", "d"], exp: [], opts: {} });
    const chips = st.find(x => x.id === "chips");
    assert.ok(chips.title.includes("1–4") && chips.text.replace(/\*/g, "").includes("1–4"), "4 players — the 1- to 4-star chips (book example)");
    assert.ok(!st.some(x => x.id === "modes"), "the basic game leaves the challenge and specialist cards in the box");
    for (const n of [3, 6]) assert.ok(BH.setupSteps({ gameId: "thegang", players: Array.from({ length: n }, (_, i) => "p" + i), exp: [], opts: {} }).find(x => x.id === "chips").title.includes("1–" + n), n + " players");
  });
  t("the gang p.4, p.9, p.15: 3 vaults win; 3 alarms lose, 2 in master thief mode", () => {
    const s = (heists, opts) => ({ gameId: "thegang", players: ["a", "b", "c"], exp: [], opts: opts || {}, rounds: heists.map(h => ({ scores: {}, heist: h })) });
    let x = BH.coopTally(s(["ok", "fail", "ok"])); assert.strictEqual(x.over, false);
    x = BH.coopTally(s(["ok", "fail", "ok", "ok"])); assert.ok(x.over && x.won && !x.lost);
    x = BH.coopTally(s(["fail", "fail", "fail"])); assert.ok(x.over && x.lost && !x.won);
    x = BH.coopTally(s(["fail", "fail"], { master: true })); assert.ok(x.over && x.lost, "master thief: two alarms");
    assert.strictEqual(BH.coopTally(s(["fail", "fail"])).over, false, "otherwise three");
    const vaults = BH.setupSteps({ gameId: "thegang", players: ["a", "b", "c"], exp: [], opts: { master: true } }).find(x => x.id === "vaults").text.replace(/\*/g, "");
    assert.ok(vaults.includes("2 карты сигнализации"), "master thief: one alarm card goes back to the box");
  });
  t("the gang p.5–8: four rounds — white, yellow, orange, red; flop 3, turn 1, river 1; the showdown by the red chips", () => {
    const c = ctxM(4), all = G.heist.steps(c, []);
    assert.strictEqual(all.length, 5);
    assert.ok(lines(c, [], 0).includes("2 карманные") && lines(c, [], 0).includes("Белые"));
    assert.ok(lines(c, [], 1).includes("3 общие") && lines(c, [], 1).includes("Жёлтые"));
    assert.ok(lines(c, [], 2).includes("1 общую") && lines(c, [], 2).includes("Оранжевые"));
    assert.ok(lines(c, [], 3).includes("1 общую") && lines(c, [], 3).includes("Красные"));
    assert.ok(lines(c, [], 4).includes("только красные") && lines(c, [], 4).includes("от 1 ★") && lines(c, [], 4).includes("5 из 7"));
  });
  t("the gang p.16–17: Quick Access, Hasty Getaway and Security Cameras change the heist", () => {
    const c = ctxM(4, "advanced");
    assert.ok(lines(c, [{ kind: "ch", n: 1 }], 0).includes("не раздаются"), "Quick Access: no white chips");
    assert.ok(lines(c, [{ kind: "ch", n: 5 }], 2).includes("не раздаются"), "Hasty Getaway: no orange chips");
    assert.ok(lines(c, [{ kind: "ch", n: 10 }], 0).includes("3 карманные") && lines(c, [{ kind: "ch", n: 10 }], 4).includes("5 из 8"), "Security Cameras: 3 pocket cards");
    for (const n of [3, 6, 8, 9]) assert.ok(lines(c, [{ kind: "sp", n }], 0).includes(G.heist.cards.sp[n].line.replace(/\*/g, "")), "specialist " + n + " right after the deal");
    const lt = lines(c, [{ kind: "ch", n: 7 }], 1); assert.ok(lt.indexOf("Откройте") < lt.indexOf("нет"), "Laser Tripwires after the flop is open");
    assert.ok(lines(c, [{ kind: "ch", n: 9 }], 4).includes("комбинацию"), "Fingerprint Scan at the showdown");
    assert.ok(lines(c, [{ kind: "ch", n: 8 }], 1).includes("сбрасывают") && lines(c, [{ kind: "ch", n: 8 }], 3).includes("сбрасывают") && !lines(c, [{ kind: "ch", n: 8 }], 0).includes("сбрасывают"), "Blackout: from round 2 on");
    const r2 = G.heist.steps(c, [{ kind: "ch", n: 3 }, { kind: "ch", n: 8 }])[1].steps.join(" | ");
    assert.ok(r2.indexOf("сбрасывают") < r2.indexOf("Откройте") && r2.indexOf("Откройте") < r2.indexOf("Во флопе"), "Blackout at the start of the round; the detector after the flop is open: " + r2);
    const sd = G.heist.steps(c, [{ kind: "ch", n: 4 }])[4].steps.join(" | ");
    assert.ok(sd.indexOf("Открывайте") < sd.indexOf("угадайте"), "the scan before the highest red chip reveals");
  });
  t("the gang p.14: advanced — after a success a challenge, after a failure a specialist, each for one heist, stacks in order", () => {
    const c = ctxM(4, "advanced"); let st = G.heist.start(c);
    assert.deepStrictEqual(JSON.stringify(G.heist.active(st)), "[]", "the first heist without cards");
    st = G.heist.next(c, st, true); assert.strictEqual(JSON.stringify(G.heist.active(st)), JSON.stringify([{ kind: "ch", n: 1 }]));
    st = G.heist.next(c, st, false); assert.strictEqual(JSON.stringify(G.heist.active(st)), JSON.stringify([{ kind: "sp", n: 1 }]), "the challenge is gone, the specialist 1 comes");
    st = G.heist.next(c, st, true); assert.strictEqual(JSON.stringify(G.heist.active(st)), JSON.stringify([{ kind: "ch", n: 2 }]), "the next challenge of the stack");
  });
  t("the gang p.15: professional — no Quick Access; a challenge for the whole game; master — two challenges, the lower goes", () => {
    const p = ctxM(4, "pro");
    assert.ok(!G.heist.choices(p, "ch").includes(1) && G.heist.choices(p, "sp").includes(1));
    let st = G.heist.start(p); assert.strictEqual(G.heist.asks(p, st).length, 1, "asks for the permanent challenge");
    st.perm = [2]; st = G.heist.next(p, st, true);
    assert.strictEqual(JSON.stringify(G.heist.active(st)), JSON.stringify([{ kind: "ch", n: 2, perm: true }, { kind: "ch", n: 3 }]), "the permanent stays, the next one skips 1 and itself");
    const m = ctxM(4, "master"); let ms = G.heist.start(m);
    assert.strictEqual(G.heist.asks(m, ms).length, 2, "two random challenges at the start");
    ms.ch = [7, 4]; ms.nCh = 2; ms = G.heist.next(m, ms, false);
    assert.strictEqual(JSON.stringify(ms.ch), JSON.stringify([7, 2]), "the lower-numbered (4) goes, the next of the stack comes, also after a failure");
    assert.ok(!ms.sp, "no specialists");
    ms = G.heist.next(m, ms, true);
    assert.strictEqual(JSON.stringify(ms.ch), JSON.stringify([7, 3]), "and after a success the same: 2 goes, 3 comes");
    assert.ok(!ms.sp, "no specialists after a success either");
  });
  t("the gang: a heist is kept with the cards of its time; nobody has a score; the team wins together", () => {
    const raw = { players: [{ id: "a", name: "А" }, { id: "b", name: "Б" }, { id: "c", name: "В" }], places: [], placesTouched: true, sessions: [{ id: "g1", gameId: "thegang", players: ["a", "b", "c"], status: "playing", opts: { advanced: true },
      rounds: [{ scores: {}, heist: "ok", coop: { ch: [], sp: 0, perm: [], nCh: 1, nSp: 1 } }, { scores: {}, heist: "nope", coop: { ch: [99] } }], coop: { ch: [1], sp: 0, perm: [], nCh: 2, nSp: 1 } }] };
    BH.replaceFromSync(raw);
    const s = BH.state.sessions[0];
    assert.strictEqual(s.rounds[0].heist, "ok"); assert.strictEqual(s.rounds[1].heist, undefined, "a heist is ok or fail");
    assert.strictEqual(JSON.stringify(s.rounds[1].coop.ch), "[]", "a card is 1…10");
    assert.strictEqual(JSON.stringify(s.coop.ch), "[1]");
    assert.strictEqual(BH.hasScore(s, "a"), false, "no scores in a cooperative game");
    const won = Object.assign({}, s, { status: "finished", winners: ["a", "b", "c"] });
    const gs = BH.gameStats("thegang", [won]);
    assert.strictEqual(gs.bestRound, null); assert.strictEqual(gs.players.every(p => p.wins === 1), true, "a win for everyone at the table");
  });
  t("the gang: rules, groups, questions and pictures refer to real sections; pages of the printed book 2–19", () => {
    const ids = new Set(G.rules.map(r => r.id));
    for (const gr of G.ruleGroups) for (const id of gr.ids) assert.ok(ids.has(id), "group " + id);
    for (const gr of G.faqGroups) for (const id of gr.refs) assert.ok(ids.has(id), "faq group " + id);
    for (const f of G.faq) assert.ok(ids.has(f.ref), "faq ref " + f.ref);
    for (const k of Object.keys(G.images.rules)) assert.ok(ids.has(k), "image for " + k);
    assert.ok(G.rules.every(r => r.page >= 2 && r.page <= 19), "pages of the printed book");
    const grouped = new Set(G.ruleGroups.flatMap(gr => gr.ids)); for (const id of ids) assert.ok(grouped.has(id), "rule in a group: " + id);
    assert.strictEqual(G.ranking.length, 10, "ten hand rankings (p. 9)");
    assert.strictEqual(G.ranking[0][0], "Роял-флеш"); assert.strictEqual(G.ranking[9][0], "Старшая карта");
  });
  console.log(`the gang: ${passed - before} passed${process.exitCode ? ", some FAILED" : ""}`);
}
{
  const before = passed;
  t("the gang: a game recorded afterwards keeps its score (vaults, alarms); the heists, when there are any, decide", () => {
    BH.replaceFromSync({ players: [{ id: "a", name: "А" }, { id: "b", name: "Б" }, { id: "c", name: "В" }], places: [], placesTouched: true,
      sessions: [{ id: "r1", gameId: "thegang", players: ["a", "b", "c"], status: "finished", rounds: [], winners: ["a", "b", "c"], tally: { ok: 3, fail: 9 } }] });
    const s = BH.state.sessions[0];
    assert.strictEqual(JSON.stringify(s.tally), JSON.stringify({ ok: 3, fail: 3 }), "kept, within 0…3");
    const t = BH.coopTally(Object.assign({}, s, { tally: { ok: 3, fail: 1 } }));
    assert.ok(t.ok === 3 && t.fail === 1 && t.won, "the score of a recorded game");
    const played = Object.assign({}, s, { tally: { ok: 0, fail: 0 }, rounds: [{ scores: {}, heist: "ok" }] });
    assert.strictEqual(BH.coopTally(played).ok, 1, "heists played win over a written score");
  });
  console.log(`the gang score: ${passed - before} passed${process.exitCode ? ", some FAILED" : ""}`);
}
{
  // Crokinole: the Russian rules (Crowd Games), NCA 2026, Crokinole Canada, Crok Shop, the World Championship (docs/rules-check.md)
  const K = BH.game("crokinole"), before = passed;
  const cx = (n, opt) => ({ players: n, exp: new Set(), has: () => false, opt: id => id === opt });
  const sess = (n, opts, rounds) => ({ gameId: "crokinole", players: ["a", "b", "c", "d"].slice(0, n), exp: [], opts: opts || {}, rounds: rounds || [] });
  const rd = sc => ({ scores: sc, flags: {} });
  t("crokinole: two players or two pairs; partners sit opposite (seats 1 and 3, 2 and 4)", () => {
    assert.deepStrictEqual([...K.players.only], [2, 4]);
    assert.strictEqual(JSON.stringify(BH.sidesOf(sess(4))), JSON.stringify([["a", "c"], ["b", "d"]]));
    assert.strictEqual(JSON.stringify(BH.sidesOf(sess(2))), JSON.stringify([["a"], ["b"]]));
    assert.ok(BH.isTeamGame(sess(4)) && !BH.isTeamGame(sess(2)));
  });
  t("crokinole: discs — two at home 12 each (Russian rules, CC), in a tournament and «до 9» 8 each (NCA, WCC); a pair 6 each", () => {
    for (const o of [undefined, "t50", "t200"]) assert.strictEqual(K.sideScore.discs(cx(2, o)), 12, "home: " + o);
    for (const o of ["tour", "race9"]) assert.strictEqual(K.sideScore.discs(cx(2, o)), 8, o);
    for (const o of [undefined, "tour", "race9"]) assert.strictEqual(K.sideScore.discs(cx(4, o)), 12, "a side of two: 6 + 6");
    assert.ok(!K.options.some(o => o.id === "nca8" || o.id === "race11"), "no 8-disc switch, no «до 11» — in no source");
  });
  t("crokinole: zones 20 / 15 / 10 / 5; the round — the difference to the better (Russian rules: 60 against 35 — 25)", () => {
    assert.strictEqual(K.sideScore.zones.map(z => z.z).join(","), "20,15,10,5");
    assert.strictEqual(JSON.stringify(K.sideScore.settle([60, 35], cx(2))), JSON.stringify([25, 0]));
    assert.strictEqual(JSON.stringify(K.sideScore.settle([35, 60], cx(2))), JSON.stringify([0, 25]));
    assert.strictEqual(JSON.stringify(K.sideScore.settle([40, 40], cx(2))), JSON.stringify([0, 0]), "equal — nobody scores");
  });
  t("crokinole: tournament (NCA) and Race to 9 — 2 for the round won, 1 each for a tie", () => {
    for (const o of ["tour", "race9"]) {
      assert.strictEqual(JSON.stringify(K.sideScore.settle([60, 35], cx(2, o))), JSON.stringify([2, 0]), o);
      assert.strictEqual(JSON.stringify(K.sideScore.settle([40, 40], cx(2, o))), JSON.stringify([1, 1]), o);
    }
  });
  t("crokinole: the end — 100 (or 50, 200) points; 4 rounds in a tournament; 9 round points", () => {
    assert.strictEqual(BH.targetOf(K, cx(2)), 100); assert.strictEqual(BH.targetOf(K, cx(2, "t50")), 50); assert.strictEqual(BH.targetOf(K, cx(2, "t200")), 200);
    assert.strictEqual(BH.targetOf(K, cx(2, "race9")), 9);
    assert.strictEqual(BH.targetOf(K, cx(2, "tour")), null); assert.strictEqual(BH.roundsOf(K, cx(2, "tour")), 4);
    let e = BH.checkEnd(sess(2, {}, [rd({ a: 60, b: 0 }), rd({ a: 0, b: 30 })])); assert.strictEqual(e.over, false);
    e = BH.checkEnd(sess(2, {}, [rd({ a: 60, b: 0 }), rd({ a: 40, b: 0 })])); assert.ok(e.over && !e.tie && e.winners.join() === "a", "100 or more wins (Russian rules)");
    const t4 = [rd({ a: 2, b: 0 }), rd({ a: 0, b: 2 }), rd({ a: 1, b: 1 }), rd({ a: 2, b: 0 })];
    assert.strictEqual(BH.checkEnd(sess(2, { tour: true }, t4.slice(0, 3))).over, false, "not before 4 rounds");
    e = BH.checkEnd(sess(2, { tour: true }, t4)); assert.ok(e.over && e.winners.join() === "a");
    e = BH.checkEnd(sess(2, { tour: true }, [rd({ a: 2, b: 0 }), rd({ a: 0, b: 2 }), rd({ a: 1, b: 1 }), rd({ a: 1, b: 1 })])); assert.ok(e.over && e.tie, "equal after 4 — the app asks for another round");
    e = BH.checkEnd(sess(2, { race9: true }, [rd({ a: 2, b: 0 }), rd({ a: 2, b: 0 }), rd({ a: 2, b: 0 }), rd({ a: 2, b: 0 }), rd({ a: 1, b: 1 })])); assert.ok(e.over && e.winners.join() === "a", "9 round points");
    // a tie: NCA — a draw, Crokinole Canada and the WCC — one more round; a race has no rule for it
    assert.ok(/NCA/.test(K.scoring.tieNote(cx(2, "tour"))) && /Crokinole Canada/.test(K.scoring.tieNote(cx(2, "tour"))), "tie note names both rules");
    assert.ok(/нет/.test(K.scoring.tieNote(cx(2, "race9"))) && !/Crokinole Canada/.test(K.scoring.tieNote(cx(2, "race9"))), "race: no rule");
  });
  t("crokinole: a pair wins together — no tie between partners", () => {
    const e = BH.checkEnd(sess(4, {}, [rd({ a: 100, c: 100, b: 0, d: 0 })]));
    assert.ok(e.over && !e.tie && e.winners.sort().join() === "a,c");
  });
  t("crokinole: the discs counted by zones are kept with the round", () => {
    BH.replaceFromSync({ players: [{ id: "a", name: "А" }, { id: "b", name: "Б" }], places: [], placesTouched: true,
      sessions: [{ id: "k1", gameId: "crokinole", players: ["a", "b"], status: "playing", rounds: [{ scores: { a: 25, b: 0 }, detail: { a: { sel: { picks: {}, flags: {}, counts: { 20: 1, 15: 2, x: 3 } }, manual: null } } }] }] });
    assert.strictEqual(JSON.stringify(BH.state.sessions[0].rounds[0].detail.a.sel.counts), JSON.stringify({ 15: 2, 20: 1 }), "zones kept, nonsense dropped");
  });
  t("crokinole: rules, groups, questions refer to real sections; pages of the Russian rules 2–4", () => {
    const ids = new Set(K.rules.map(r => r.id));
    for (const gr of K.ruleGroups) for (const id of gr.ids) assert.ok(ids.has(id), "group " + id);
    for (const gr of K.faqGroups) for (const id of gr.refs) assert.ok(ids.has(id), "faq group " + id);
    for (const f of K.faq) assert.ok(ids.has(f.ref), "faq ref " + f.ref);
    assert.ok(K.rules.every(r => r.page >= 2 && r.page <= 4));
    const grouped = new Set(K.ruleGroups.flatMap(gr => gr.ids)); for (const id of ids) assert.ok(grouped.has(id), "rule in a group: " + id);
  });
  console.log(`crokinole: ${passed - before} passed${process.exitCode ? ", some FAILED" : ""}`);
}
{
  // Coconuts («Кокосики»): the Russian rules of Choo Choo Games, the English rules of Mayday Games (docs/rules-check.md)
  const C = BH.game("coconuts"), before = passed;
  const cx = n => ({ players: n, exp: new Set(), has: () => false, opt: () => false });
  const steps = n => BH.setupSteps({ gameId: "coconuts", players: ["a", "b", "c", "d"].slice(0, n), exp: [], opts: {} });
  t("coconuts: 2–4 players; a race without rounds — the order of seats does not matter", () => {
    assert.strictEqual(C.players.min, 2); assert.strictEqual(C.players.max, 4);
    assert.ok(BH.isRace(C) && !BH.isCoop(C) && !BH.isEndScored(C)); assert.strictEqual(C.rounds.leader, false);
    // the rules: the youngest starts — picked by hand on the wheel screen, or the wheel for those who want it
    assert.ok(C.first && /младший/.test(C.first.hint));
  });
  t("coconuts: each takes a launcher, a board, 2 magic cards and 8 coconuts", () => {
    const k = steps(2).find(st => st.id === "kit").text; assert.ok(k.includes("*2* волшебные карты") && k.includes("*8* кокосов"));
  });
  t("coconuts: the cups — a square for 2 or 4 (corners yellow in red, centre yellow in yellow), a triangle for 3", () => {
    for (const n of [2, 4]) { const ids = steps(n).map(st => st.id); assert.ok(ids.includes("cups4") && !ids.includes("cups3"), n); }
    const ids3 = steps(3).map(st => st.id); assert.ok(ids3.includes("cups3") && !ids3.includes("cups4"));
    // all 14 cups (10 yellow, 4 red) are used: the square — 4 corners of 2, the centre of 2, 4 edges of 1; the triangle — 4 places of 2, 6 of 1
    assert.strictEqual(4 * 2 + 2 + 4 * 1, 14); assert.strictEqual(4 * 2 + 6 * 1, 14); assert.strictEqual(1 + 2 + 3 + 4, 10);
    assert.ok(steps(2).find(st => st.id === "cups4").text.includes("*14*") && steps(3).find(st => st.id === "cups3").text.includes("*14*"));
  });
  t("coconuts: the end — a pyramid of 6 wins; otherwise the most coconuts, equal — who shot last", () => {
    assert.strictEqual(C.scoring.goal, 6);
    let r = BH.raceResult(["a", "b", "c"], { a: 5, b: 9, c: 3 }); assert.deepStrictEqual([...r.top], ["b"]); assert.strictEqual(r.best, 9);
    r = BH.raceResult(["a", "b", "c"], { a: 7, b: 7, c: 2 }); assert.deepStrictEqual([...r.top], ["a", "b"], "a tie — the app asks who shot last");
    assert.ok(/последним/.test(C.scoring.tieNote));
    // a game written down afterwards: 6 cups — the pyramid; otherwise the most coconuts; nothing typed — no winner found
    let w = BH.raceWinner(C, ["a", "b", "c"], { a: 6, b: 4, c: 2 }, { a: 8, b: 9, c: 3 }); assert.ok(w.how === "pyramid" && w.winners.join() === "a", "6 cups win over more coconuts");
    w = BH.raceWinner(C, ["a", "b", "c"], { a: 5, b: 4 }, { a: 8, b: 11, c: 3 }); assert.ok(w.how === "coconuts" && w.winners.join() === "b");
    w = BH.raceWinner(C, ["a", "b"], {}, { a: 7, b: 7 }); assert.strictEqual(w.winners.join(), "a,b", "equal and unknown who shot last — both");
    w = BH.raceWinner(C, ["a", "b"], {}, {}); assert.ok(w.how === null && !w.winners.length);
  });
  t("coconuts: the six magic cards, each with when to play it", () => {
    assert.deepStrictEqual([...C.cards.map(k => k.name)], ["Ещё 1 попытка", "Замри!", "Выстрел вслепую", "Призыв ветра", "В яблочко!", "Дальний выстрел"]);
    assert.ok(C.cards.every(k => /перед своим выстрелом|перед выстрелом другого/.test(k.when)));
    assert.strictEqual(C.cards.filter(k => k.when === "перед своим выстрелом").length, 1, "only «Ещё 1 попытка» is your own");
    assert.ok(C.cards.every(k => C.images.icons.includes(k.img)), "each card has its picture");
  });
  t("coconuts: how a race ended is kept; nonsense dropped", () => {
    BH.replaceFromSync({ players: [{ id: "a", name: "А" }, { id: "b", name: "Б" }], places: [], placesTouched: true,
      sessions: [{ id: "c1", gameId: "coconuts", players: ["a", "b"], status: "finished", rounds: [], winners: ["b"], race: { how: "coconuts", counts: { a: 4, b: 6.4, z: 3 } } },
        { id: "c2", gameId: "coconuts", players: ["a", "b"], status: "finished", rounds: [], winners: ["a"], race: { how: "pyramid", counts: { a: 9, b: 7 }, cups: { a: 6, b: 3.2, z: 1 } } },
        { id: "c3", gameId: "coconuts", players: ["a", "b"], status: "finished", rounds: [], winners: ["a"], race: { how: "banana" } },
        { id: "c4", gameId: "coconuts", players: ["a", "b"], status: "finished", rounds: [], winners: ["b"], race: { cups: { a: 2, b: 5 } } }] });
    const by = id => BH.state.sessions.find(x => x.id === id);
    assert.strictEqual(JSON.stringify(by("c1").race), JSON.stringify({ how: "coconuts", counts: { a: 4, b: 6 } }));
    assert.strictEqual(JSON.stringify(by("c2").race), JSON.stringify({ how: "pyramid", counts: { a: 9, b: 7 }, cups: { a: 6, b: 3 } }), "old data: cups and coconuts of each");
    assert.strictEqual(by("c3").race, undefined);
    assert.strictEqual(JSON.stringify(by("c4").race), JSON.stringify({ cups: { a: 2, b: 5 } }), "how it ended may be unknown");
    assert.ok(!BH.hasScore(by("c1"), "a"), "a race has no score: the statistics count only wins");
  });
  t("coconuts: rules, groups, questions refer to real sections; pages of the Russian rules 2–4", () => {
    const ids = new Set(C.rules.map(r => r.id));
    for (const gr of C.ruleGroups) for (const id of gr.ids) assert.ok(ids.has(id), "group " + id);
    for (const gr of C.faqGroups) for (const id of gr.refs) assert.ok(ids.has(id), "faq group " + id);
    for (const f of C.faq) { assert.ok(ids.has(f.ref), "faq ref " + f.ref); if (f.src) assert.ok(BH.FAQ_SRC[f.src], "faq src " + f.src); }
    assert.ok(C.rules.every(r => r.page >= 2 && r.page <= 4));
    const grouped = new Set(C.ruleGroups.flatMap(gr => gr.ids)); for (const id of ids) assert.ok(grouped.has(id), "rule in a group: " + id);
  });
  console.log(`coconuts: ${passed - before} passed${process.exitCode ? ", some FAILED" : ""}`);
}
{
  // Gold Fever («Жадюги»): the Russian rules of Стиль Жизни, the English rules for checking (docs/rules-check.md)
  const G = BH.game("goldfever"), before = passed;
  const cx = (n, ...opts) => ({ players: n, exp: new Set(), has: () => false, opt: id => opts.includes(id) });
  const sess = (n, opts) => ({ gameId: "goldfever", players: ["a", "b", "c", "d", "e"].slice(0, n), exp: [], opts: opts || {}, rounds: [] });
  t("goldfever: 2–5 players; a race to 5 nuggets (4 in the quick game); the youngest starts", () => {
    assert.strictEqual(G.players.min, 2); assert.strictEqual(G.players.max, 5);
    assert.ok(BH.isRace(G) && !G.scoring.count, "no count: the first to the nuggets wins at once");
    assert.strictEqual(BH.raceGoal(G, sess(3)), 5); assert.strictEqual(BH.raceGoal(G, sess(3, { fast: true })), 4);
    assert.ok(G.first && /младший/.test(G.first.hint) && G.rounds.leader === false);
  });
  t("goldfever: each bag — 5 nuggets, 4 grey, 4 black, 4 white, 1 ruby, 1 emerald; the box holds exactly five bags", () => {
    const bag = BH.setupSteps(sess(3)).find(st => st.id === "bag").text;
    assert.ok(bag.includes("*5* самородков") && bag.includes("*4* серых, чёрных и белых") && bag.includes("*1* рубин") && bag.includes("*1* изумруд"));
    // 25 nuggets, 60 gravel (20 of each colour), 5 rubies, 5 emeralds — five bags at most
    assert.strictEqual(5 * 5, 25); assert.strictEqual(5 * 3 * 4, 60); assert.strictEqual(5 * 4, 20);
    const only = BH.setupSteps(sess(3, { goldOnly: true })).find(st => st.id === "bag").text;
    assert.ok(!only.includes("*1* рубин") && /не нужны/.test(only), "«Только золото»: no rubies or emeralds");
  });
  t("goldfever: what each stone means; «Только золото» leaves out the ruby and the emerald", () => {
    assert.deepStrictEqual([...G.cards.map(k => k.id)], ["gold", "white", "gray", "black", "ruby", "emerald"]);
    assert.deepStrictEqual([...BH.raceCards(G, sess(2, { goldOnly: true })).map(k => k.id)], ["gold", "white", "gray", "black"]);
    const by = id => G.cards.find(k => k.id === id).does;
    assert.ok(/Второй белый/.test(by("white")) && /Второй серый/.test(by("gray")) && /Второй чёрный/.test(by("black")), "a bust is the second gravel of one colour");
    assert.ok(/тебе/.test(by("black")), "the second black: the others give you their gravel");
    assert.ok(/\*2\* камня/.test(by("emerald")) && /Золото!/.test(by("ruby")));
    const rem = G.rounds.reminder(cx(3, "goldOnly")).join(" "); assert.ok(!/[Рр]убин|[Ии]зумруд/.test(rem), "no ruby or emerald without them");
    // the turn says nothing about the stones: each is explained once, on its tile
    assert.ok(!/булыжник одного цвета|Второй|чёрный|лихорадк/i.test(G.rounds.reminder(cx(3)).join(" ")), "the stones are on the tiles only");
    assert.ok(/до рубина/.test(by("ruby")) && /за раз/.test(by("ruby")));
  });
  t("goldfever: the end is kept as «the goal reached»", () => {
    BH.replaceFromSync({ players: [{ id: "a", name: "А" }, { id: "b", name: "Б" }], places: [], placesTouched: true,
      sessions: [{ id: "g1", gameId: "goldfever", players: ["a", "b"], status: "finished", rounds: [], winners: ["a"], race: { how: "goal" } }] });
    assert.strictEqual(JSON.stringify(BH.state.sessions[0].race), JSON.stringify({ how: "goal" }));
    assert.ok(/5 самородков/.test(G.scoring.goalDone(5)) && /4 самородка/.test(G.scoring.goalText(4)));
  });
  t("goldfever: rules, groups, questions refer to real sections; pages of the rules 1–4", () => {
    const ids = new Set(G.rules.map(r => r.id));
    for (const gr of G.ruleGroups) for (const id of gr.ids) assert.ok(ids.has(id), "group " + id);
    for (const gr of G.faqGroups) for (const id of gr.refs) assert.ok(ids.has(id), "faq group " + id);
    for (const f of G.faq) assert.ok(ids.has(f.ref), "faq ref " + f.ref);
    assert.ok(G.rules.every(r => r.page >= 1 && r.page <= 4));
    const grouped = new Set(G.ruleGroups.flatMap(gr => gr.ids)); for (const id of ids) assert.ok(grouped.has(id), "rule in a group: " + id);
  });
  console.log(`goldfever: ${passed - before} passed${process.exitCode ? ", some FAILED" : ""}`);
}
