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
for (const f of ["js/util.js", "js/store.js", "js/games.js", "js/art.js", "games/flip7.js"])
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
  assert.ok(g.finishNote(s).startsWith("Вызов выполнен"));
  s.rounds.push({ scores: { p0: 1 } });
  assert.ok(g.finishNote(s).startsWith("Вызов не выполнен"));
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
t("faq refs point at real sections", () => { for (const f of g.faq) if (f.ref) assert.ok(g.rules.some(r => r.id === f.ref), f.ref); });
t("every faq topic points at real sections", () => { for (const grp of g.faqGroups || []) for (const r of grp.refs) assert.ok(g.rules.some(x => x.id === r), r); });
t("faq sources are known and questions are not repeated", () => {
  for (const f of g.faq) if (f.src) assert.ok(BH.FAQ_SRC[f.src], f.src);
  assert.strictEqual(new Set(g.faq.map(f => f.q)).size, g.faq.length);
});
t("players' questions are found: 200 mid-round, tie", () => {
  assert.ok(BH.searchRules(g, "набрал 200 посреди раунда").slice(0, 3).some(h => /посреди раунда/.test(h.title)));
  assert.ok(BH.searchRules(g, "ничья").slice(0, 3).some(h => /Ничья/.test(h.title)));
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
