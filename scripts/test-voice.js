// Checks the voice function with fake GitHub / AI Studio / SpeechKit.  Run: node scripts/test-voice.js
const assert = require("assert"), path = require("path"), fs = require("fs");
process.env.ALLOWED_REPO = "Owner/koleso-data";
process.env.FOLDER_ID = "folder1";
const calls = [];
global.fetch = async (url, init) => {
  calls.push({ url, init });
  const json = (status, body) => ({ status, ok: status < 300, json: async () => body, text: async () => JSON.stringify(body) });
  if (url.startsWith("https://api.github.com/repos/")) {
    if (global.ghDown) return json(502, {});
    const good = /^Bearer good_token_/.test(init.headers.Authorization);
    return good ? json(200, { private: true, full_name: "Owner/koleso-data" }) : json(401, {});
  }
  if (url.includes("/v1/chat/completions")) {
    const body = JSON.parse(init.body);
    assert.ok(body.messages[0].content.includes("ЗАМОРОЗЬ"), "rules reach the model");
    assert.strictEqual(body.model, "gpt://folder1/aliceai-llm-flash");
    return json(200, { choices: [{ message: { content: '{"answer":"Да, можно сыграть на себя.","quote":"Карты действий можно использовать на любого активного игрока, включая самого себя.","page":6,"found":true}' } }] });
  }
  if (url.includes("utteranceSynthesis")) {
    const a = Buffer.from("ID3-part1").toString("base64"), b = Buffer.from("-part2").toString("base64");
    return { status: 200, ok: true, text: async () => JSON.stringify({ result: { audioChunk: { data: a } } }) + "\n" + JSON.stringify({ result: { audioChunk: { data: b } } }) + "\n" };
  }
  return json(404, {});
};

// the function reads rules/<game>.txt next to itself; use the built zip's text if present
const fnDir = path.join(__dirname, "..", "functions", "voice"), rulesDir = path.join(fnDir, "rules");
fs.mkdirSync(rulesDir, { recursive: true });
fs.writeFileSync(path.join(rulesDir, "flip7.txt"), "[стр. 6] ЗАМОРОЗЬ! Карты действий можно использовать на любого активного игрока, включая самого себя.");
const fn = require(path.join(fnDir, "index.js"));
const ctx = { token: { access_token: "iam-token" } };
const call = (body, headers) => fn.handler({ httpMethod: "POST", headers: Object.assign({ Origin: "https://koleso-app.github.io" }, headers), body: JSON.stringify(body) }, ctx);
const gh = { owner: "Owner", repo: "koleso-data", token: "good_token_0123456789" };

let passed = 0;
const t = async (name, f) => { try { await f(); passed++; } catch (e) { console.error("FAIL " + name + "\n  " + (e.stack || e)); process.exitCode = 1; } };
(async () => {
  await t("preflight answers with CORS for the app", async () => {
    const r = await fn.handler({ httpMethod: "OPTIONS", headers: { Origin: "https://koleso-app.github.io" } }, ctx);
    assert.strictEqual(r.statusCode, 204); assert.strictEqual(r.headers["Access-Control-Allow-Origin"], "https://koleso-app.github.io");
  });
  await t("a stranger without the token is refused before any paid call", async () => {
    const n = calls.length;
    const r = await call({ action: "ask", game: "flip7", question: "можно ли заморозь на себя?", gh: { owner: "Owner", repo: "koleso-data", token: "stolen_or_wrong_token_xx" } });
    assert.strictEqual(r.statusCode, 403);
    assert.ok(calls.slice(n).every(c => c.url.startsWith("https://api.github.com")), "no AI calls");
  });
  await t("another repository does not count", async () => {
    const r = await call({ action: "ask", game: "flip7", question: "?", gh: Object.assign({}, gh, { repo: "other" }) });
    assert.strictEqual(r.statusCode, 403);
  });
  await t("the owner gets an answer with quote, page and audio", async () => {
    const r = await call({ action: "ask", game: "flip7", question: "Можно ли сыграть заморозь на себя?", gh });
    assert.strictEqual(r.statusCode, 200);
    const b = JSON.parse(r.body);
    assert.strictEqual(b.page, 6); assert.ok(b.quote.includes("включая самого себя")); assert.strictEqual(b.found, true);
    assert.strictEqual(Buffer.from(b.audio, "base64").toString(), "ID3-part1-part2");
  });
  await t("the token check is remembered (one GitHub call per half hour)", async () => {
    const n = calls.filter(c => c.url.startsWith("https://api.github.com")).length;
    await call({ action: "tts", text: "Привет", gh });
    assert.strictEqual(calls.filter(c => c.url.startsWith("https://api.github.com")).length, n);
  });
  await t("text to speech", async () => {
    const r = await call({ action: "tts", text: "Шаг 1. Соберите колоду.", gh, voice: "dasha" });
    assert.strictEqual(r.statusCode, 200);
    const tts = JSON.parse(calls[calls.length - 1].init.body);
    assert.deepStrictEqual(tts.hints, [{ voice: "dasha" }, { role: "friendly" }]);
    assert.strictEqual(tts.outputAudioSpec.containerAudio.containerAudioType, "MP3");
  });
  await t("limits: long question and unknown game", async () => {
    assert.strictEqual((await call({ action: "ask", game: "flip7", question: "x".repeat(401), gh })).statusCode, 400);
    assert.strictEqual((await call({ action: "ask", game: "nope", question: "x", gh })).statusCode, 404);
    assert.strictEqual((await call({ action: "tts", text: "x".repeat(1201), gh })).statusCode, 400);
  });
  await t("a junk token is remembered: the second try does not even reach GitHub", async () => {
    const bad = { owner: "Owner", repo: "koleso-data", token: "junk_token_abcdefghijklmnop" };
    await call({ action: "tts", text: "x", gh: bad });
    const n = calls.length;
    const r = await call({ action: "tts", text: "x", gh: bad });
    assert.strictEqual(r.statusCode, 403); assert.strictEqual(calls.length, n);
  });
  await t("spaces around the token are refused: one token cannot pose as many", async () => {
    const n = calls.length;
    for (const tok of [" good_token_0123456789", "good_token_0123456789\t", "good_token_0123456789 "]) {
      const r = await call({ action: "tts", text: "x", gh: Object.assign({}, gh, { token: tok }) });
      assert.strictEqual(r.statusCode, 403);
    }
    assert.strictEqual(calls.length, n, "not even GitHub is asked");
  });
  await t("GitHub being down does not lock the owner out", async () => {
    const gh3 = Object.assign({}, gh, { token: "good_token_second_device" });
    global.ghDown = true;
    assert.strictEqual((await call({ action: "tts", text: "x", gh: gh3 })).statusCode, 503);
    global.ghDown = false;
    assert.strictEqual((await call({ action: "tts", text: "x", gh: gh3 })).statusCode, 200);
  });
  await t("a daily cap stops spending even with a valid token", async () => {
    const gh2 = { owner: "Owner", repo: "koleso-data", token: "good_token_0123456789" };
    let last;
    for (let i = 0; i < 160; i++) last = await call({ action: "ask", game: "flip7", question: "можно ли заморозь на себя?", gh: gh2, speak: false });
    assert.strictEqual(last.statusCode, 429);
    assert.match(JSON.parse(last.body).error.message, /лимит/);
  });
  await t("a model reply that is not clean JSON still gives an answer", async () => {
    const p = fn._test.parseAnswer('Вот ответ: {"answer":"Нет.","quote":"","page":null,"found":true}');
    assert.strictEqual(p.answer, "Нет.");
    assert.strictEqual(fn._test.parseAnswer("Просто текст").answer, "Просто текст");
    const nf = fn._test.parseAnswer('{"answer":"found=false, в правилах нет информации","quote":"x","page":3,"found":false}');
    assert.strictEqual(nf.answer, "В правилах об этом ничего не сказано."); assert.strictEqual(nf.quote, ""); assert.strictEqual(nf.page, null);
    assert.strictEqual(fn._test.parseAnswer('{"answer":"Да, можно. found=true","quote":"q","page":6,"found":true}').answer, "Да, можно.");
    const empty = fn._test.parseAnswer('{"answer":null,"found":false}');
    assert.strictEqual(empty.found, false); assert.strictEqual(empty.answer, "В правилах об этом ничего не сказано.");
    assert.strictEqual(fn._test.parseAnswer('{"answer":"Нет данных","found":"false"}').found, false);
  });
  fs.rmSync(rulesDir, { recursive: true, force: true });
  console.log(`voice: ${passed} passed${process.exitCode ? ", some FAILED" : ""}`);
})();
