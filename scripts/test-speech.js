// Speech-to-text joining, with recognizers that behave like Android Chrome and desktop Chrome.
// Run: node scripts/test-speech.js
const fs = require("fs"), path = require("path"), vm = require("vm"), assert = require("assert");
const APP = path.join(__dirname, "..", "app");

// scenario: list of runs; each run is a list of events; an event is a list of [transcript, isFinal]
function makeSR(runs) {
  let n = 0;
  return class FakeSR {
    start() {
      const run = runs[n++];
      setTimeout(() => {
        if (run) for (const ev of run) this.onresult && this.onresult({ resultIndex: 0, results: ev.map(([t, f]) => Object.assign([{ transcript: t }], { isFinal: f })) });
        else this.onerror && this.onerror({ error: "no-speech" });
        setTimeout(() => this.onend && this.onend(), 1);
      }, 1);
    }
    stop() { this._stop = true; }
    abort() {}
  };
}
function listen(runs, finishAfterRuns) {
  const ctx = { console, setTimeout, clearTimeout, Math, JSON, Array, Object, String, Number, Promise, Map, Set, localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, document: { addEventListener() {} }, addEventListener() {} };
  ctx.window = ctx;
  ctx.webkitSpeechRecognition = makeSR(runs);
  vm.createContext(ctx);
  vm.runInContext("window.BH = {};", ctx);
  vm.runInContext(fs.readFileSync(path.join(APP, "js", "voice.js"), "utf8"), ctx);
  return new Promise(resolve => {
    let partial = "", ctl = null, ends = 0;
    const SR = ctx.webkitSpeechRecognition, origStart = SR.prototype.start;
    SR.prototype.start = function () { ends++; if (ends > finishAfterRuns && ctl) ctl.finish(); return origStart.call(this); };
    ctl = ctx.BH.voice.listen({ partial: t => { partial = t; }, done: t => resolve({ text: t, partial }), error: m => resolve({ error: m }) });
  });
}

let passed = 0;
const t = async (name, f) => { try { await f(); passed++; } catch (e) { console.error("FAIL " + name + "\n  " + (e.stack || e)); process.exitCode = 1; } };
(async () => {
  await t("Android: every result repeats the phrase so far — said once, written once", async () => {
    const phrase = ["Можно", "Можно ли", "Можно ли сыграть", "Можно ли сыграть заморозить", "Можно ли сыграть заморозить на", "Можно ли сыграть заморозить на себя"];
    // Android in one run: a growing list of results, each final
    const run = phrase.map((_, i) => phrase.slice(0, i + 1).map(p => [p, true]));
    const r = await listen([run], 1);
    assert.strictEqual(r.text, "Можно ли сыграть заморозить на себя");
  });
  await t("desktop: separate pieces are joined", async () => {
    const r = await listen([[[["можно ли", true]], [["можно ли", true], ["сыграть заморозь", false]], [["можно ли", true], ["сыграть заморозь на себя", true]]]], 1);
    assert.strictEqual(r.text, "можно ли сыграть заморозь на себя");
  });
  await t("a pause between two phrases keeps both", async () => {
    const r = await listen([[[["можно ли сыграть заморозь", true]]], [[["на себя", true]]]], 2);
    assert.strictEqual(r.text, "можно ли сыграть заморозь на себя");
  });
  await t("a restart that repeats the last phrase does not double it", async () => {
    const r = await listen([[[["можно ли сыграть", true]]], [[["можно ли сыграть заморозь", true]]]], 2);
    assert.strictEqual(r.text, "можно ли сыграть заморозь");
  });
  console.log(`speech: ${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
})();
