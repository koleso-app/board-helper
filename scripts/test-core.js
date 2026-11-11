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
for (const f of ["js/util.js", "js/store.js", "js/games.js", "js/art.js", "games/flip7.js", "games/flip7v.js"])
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
  t("vengeance: a bust is 0, or minus the modifiers given in the brutal mode; −15 flags", () => {
    const shim = (picks, flags, brutal) => { const c = score(picks, flags, brutal); return flags.bust ? c.bustScore : c.score; };
    assert.strictEqual(shim({ num: [5], minus: [6] }, { bust: true }, false), 0);
    assert.strictEqual(shim({ num: [5], minus: [6] }, { bust: true }, true), -6);
    assert.strictEqual(score({ num: [1, 2, 3, 4, 5, 6, 7] }, { gave15: true }, true).score, 28);
    assert.strictEqual(score({ num: [10] }, { minus15: true }, true).score, -5);
    assert.strictEqual(score({ num: [10] }, { minus15: true }, false).score, 10, "the −15 exists only in the brutal mode");
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
    for (const r of v.rules) if (r.id !== "tie") assert.ok(r.page > 0 && r.page <= 12, r.id);
    for (const grp of v.faqGroups) for (const r of grp.refs) assert.ok(v.rules.some(x => x.id === r), r);
    for (const k of Object.keys(v.images.rules)) assert.ok(v.rules.some(r => r.id === k), "image for " + k);
  });
  t("vengeance: setup — brutal and challenge steps only when chosen", () => {
    const s = { gameId: "flip7v", players: ["a", "b"], exp: [], opts: {} };
    assert.ok(!BH.setupSteps(s).some(x => x.id === "brutal"));
    assert.ok(BH.setupSteps(Object.assign({}, s, { opts: { brutal: true, challenge: true } })).some(x => x.id === "brutal" || x.id === "challenge"));
  });
  console.log(`${passed} passed (with Flip 7: With A Vengeance)${process.exitCode ? ", some FAILED" : ""}`);
}
