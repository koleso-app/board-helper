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
for (const f of ["js/util.js", "js/store.js", "js/games.js", "js/art.js", "games/flip7.js", "games/flip7v.js", "games/faraway.js"])
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
  t("faraway p.1: 2–6 players, no first player, 8 rounds, scored at the end", () => {
    assert.strictEqual(F.players.min, 2); assert.strictEqual(F.players.max, 6);
    assert.ok(!F.first, "everyone plays at once — no wheel");
    assert.strictEqual(F.rounds.count, 8); assert.strictEqual(F.rounds.leader, false);
    assert.ok(BH.isEndScored(F)); assert.strictEqual(F.endScore.rows, 8);
  });
  t("faraway p.5: deal 3 (advanced: 5, keep 3); reveal players + 1", () => {
    const s = { gameId: "faraway", players: ["a", "b", "c", "d", "e"], exp: [], opts: {} };
    const st = BH.setupSteps(s);
    assert.ok(st.find(x => x.id === "deal").text.includes("по 3"));
    const c = st.find(x => x.id === "center");
    assert.ok(c.title.includes("6"), "5 players reveal 6: " + c.title); assert.ok(c.text.includes("6"));
    const adv = BH.setupSteps(Object.assign({}, s, { opts: { advanced: true } })).find(x => x.id === "deal").text;
    assert.ok(adv.includes("по 5") && adv.includes("выбирает 3") && adv.includes("откладывает") && adv.includes("с колодой"));
  });
  t("faraway p.10–11: round 1 has no sanctuaries; round 8 takes no card; the leftover goes, players + 1 come", () => {
    const ph = r => F.rounds.phases(ctxN(4), r, 8).map(p => p.text).join(" ");
    assert.ok(ph(1).includes("В первом раунде Святилищ нет"));
    assert.ok(ph(3).includes("1 карту Святилища") && ph(3).includes("за каждую подсказку") && ph(3).includes("игровой области"));
    assert.ok(ph(3).includes("уберите из игры") && ph(3).includes("новый рынок — 5 карт"), "4 players reveal 5");
    assert.ok(ph(3).includes("наименьшего номера"), "phase 3 goes from the lowest card up");
    assert.ok(ph(8).includes("Новую карту Региона не берите") && !ph(8).includes("откройте"));
    assert.ok(ph(8).includes("добавляет одно") && ph(8).includes("под колоду"), "in round 8 a sanctuary may still be added");
    assert.ok(ph(3).includes("добавляет одно") && ph(3).includes("под колоду") && ph(3).includes("действует сразу"), "one sanctuary kept, it works at once, the rest under the deck");
    assert.ok(ph(1).includes("одновременно") && ph(1).includes("рубашкой вверх") && ph(1).includes("справа"), "phase 1: at once, face down, to the right");
    assert.strictEqual(F.rounds.phases(ctxN(4), 2, 8)[1].title, "Обнаружение Святилищ");
    assert.strictEqual(F.rounds.phases(ctxN(4), 2, 8)[2].title, "Добор карт Регионов", "the official name of phase 3");
    assert.ok(ph(7).includes("Новый рынок не открывайте") && !ph(7).includes("так решают игроки"), "the book (p. 11): no market for round 8");
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
