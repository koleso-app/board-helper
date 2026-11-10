/* Помощник настолок — voice function for Yandex Cloud Functions (Node.js 22).
 *
 * POST { action: "ask", game, question, gh: { owner, repo, token }, voice? }
 *   -> { answer, quote, page, found, audio (base64 mp3 | null) }
 * POST { action: "tts", text, gh, voice? } -> { audio }
 *
 * Who may use it: only a caller holding a working GitHub token for the private repository
 * named in ALLOWED_REPO (the owner's encrypted-data repo). Anyone who copies the public app
 * gets 403, so nobody else can spend the owner's money.
 * Keys: none stored. The function runs under its service account; Yandex hands it an IAM
 * token in context.token. Needs roles ai.languageModels.user and ai.speechkit-tts.user.
 * Rulebooks are bundled into the deployed zip from the local sources/ folder (never published).
 */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ENV = {
  allowedRepo: (process.env.ALLOWED_REPO || "").toLowerCase(),
  folder: process.env.FOLDER_ID || "",
  model: process.env.MODEL || "aliceai-llm-flash",
  voice: process.env.VOICE || "marina",
  role: process.env.VOICE_ROLE || "friendly",
  allowOrigin: process.env.ALLOW_ORIGIN || "https://koleso-app.github.io",
};
const LIMITS = { question: 400, tts: 1200, answerTokens: 700 };
const NOT_FOUND = "В правилах об этом ничего не сказано.";   // spoken by the app from its own cache, not paid again
const VOICES = { marina: ["neutral", "friendly", "whisper"], dasha: ["neutral", "good", "friendly"], jane: ["neutral", "good"], julia: ["neutral", "strict"], lera: ["neutral", "friendly"], masha: ["good", "strict", "friendly"], omazh: ["neutral"], filipp: [], ermil: ["neutral", "good"], zahar: ["neutral", "good"], alexander: ["neutral", "good"], kirill: ["neutral", "good"], anton: ["neutral", "good"] };

/* ---------- http helpers ---------- */
function cors(origin) {
  const ok = origin && (origin === ENV.allowOrigin || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin));
  return {
    "Access-Control-Allow-Origin": ok ? origin : ENV.allowOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "3600",
    Vary: "Origin",
  };
}
const reply = (status, obj, origin) => ({ statusCode: status, headers: Object.assign({ "Content-Type": "application/json; charset=utf-8" }, cors(origin)), body: JSON.stringify(obj) });
const fail = (status, code, message, origin) => reply(status, { error: { code, message } }, origin);

/* ---------- who is calling: a working token for the owner's private repo ---------- */
const authCache = new Map();     // sha256(token) -> trusted until (short, so a revoked token stops soon)
const deniedCache = new Map();   // sha256(token) -> refused until (junk tokens do not hammer GitHub)
const usage = new Map();         // sha256(token) + day + kind -> count (a cap on spending even with a leaked token)
const DAILY = { ask: Number(process.env.DAILY_ASKS) || 150, tts: Number(process.env.DAILY_TTS) || 300 };
const forbidden = () => Object.assign(new Error("Нет доступа"), { status: 403, code: "forbidden" });
async function checkCaller(gh) {
  if (!ENV.allowedRepo) throw Object.assign(new Error("Функция не настроена: нет ALLOWED_REPO"), { status: 500, code: "config" });
  if (!gh || typeof gh.token !== "string" || gh.token.length < 20 || gh.token.length > 255) throw forbidden();
  const repo = `${gh.owner || ""}/${gh.repo || ""}`.toLowerCase();
  if (repo !== ENV.allowedRepo) throw forbidden();
  const key = crypto.createHash("sha256").update(gh.token).digest("hex");
  const now = Date.now();
  if ((deniedCache.get(key) || 0) > now) throw forbidden();
  if ((authCache.get(key) || 0) > now) return key;
  const res = await fetch(`https://api.github.com/repos/${ENV.allowedRepo}`, {
    headers: { Authorization: "Bearer " + gh.token.trim(), Accept: "application/vnd.github+json", "User-Agent": "board-helper-voice" },
  });
  const info = res.ok ? await res.json() : null;
  if (!info || !info.private || String(info.full_name).toLowerCase() !== ENV.allowedRepo) {
    deniedCache.set(key, now + 5 * 60 * 1000);
    if (deniedCache.size > 5000) deniedCache.clear();
    throw forbidden();
  }
  authCache.set(key, now + 10 * 60 * 1000);
  return key;
}
// counts one use; over the daily cap -> 429 (per running instance: a safety net, with a budget alert in the cloud as the real cap)
function spend(key, kind) {
  const day = new Date().toISOString().slice(0, 10), k = key + "|" + day + "|" + kind, n = (usage.get(k) || 0) + 1;
  if (n > DAILY[kind]) throw Object.assign(new Error("Сегодняшний лимит помощника исчерпан. Завтра снова заработает."), { status: 429, code: "quota" });
  usage.set(k, n);
  if (usage.size > 1000) for (const old of [...usage.keys()].filter(x => !x.includes("|" + day + "|"))) usage.delete(old);
}

/* ---------- rulebooks bundled next to this file: rules/<game>.txt ---------- */
const books = new Map();
function book(game) {
  if (!/^[a-z0-9-]{1,40}$/.test(game || "")) return null;
  if (!books.has(game)) {
    const file = path.join(__dirname, "rules", game + ".txt");
    books.set(game, fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null);
  }
  return books.get(game);
}

/* ---------- Yandex AI Studio: chat completions (OpenAI-compatible) ---------- */
async function askModel(iam, rules, question, extra, game) {
  const system = [
    "Ты — судья по правилам настольной игры. Отвечаешь игрокам прямо во время партии.",
    "Ниже база знаний по игре: КНИГА ПРАВИЛ, ШПАРГАЛКА (проверенный пересказ) и ЧАСТЫЕ ВОПРОСЫ игроков с ответами.",
    "Отвечай по всей базе. Если в книге прямого ответа нет, но вопрос разобран в шпаргалке или частых вопросах — ответь по ним, это found=true (можно коротко сказать, что в книге это не описано, и что принято делать).",
    "Делай очевидные выводы из правил: например, если у нескольких игроков 200 и больше, побеждает тот, у кого больше очков.",
    "found=false — только если ни один раздел базы не помогает ответить. Не выдумывай правил, которых нет в базе.",
    "Ответ — по-русски, не длиннее 200 символов (1–2 коротких предложения), чтобы его было удобно прослушать. Без markdown и списков.",
    "quote — точная дословная цитата (до 300 символов), на которой основан ответ. Бери её из раздела КНИГА ПРАВИЛ; из ШПАРГАЛКИ — только если в книге этого нет. page — номер страницы из ближайшей пометки [стр. N] перед цитатой, иначе null.",
    "Если ответа в правилах нет: found=false, answer — одна фраза для игрока, например «В правилах об этом ничего не сказано.», quote — пустая строка.",
    "Верни только JSON вида {\"answer\": string, \"quote\": string, \"page\": number|null, \"found\": boolean}.",
    "",
    rules,
  ].join("\n");
  const user = (extra ? "Ситуация за столом: " + extra + "\n" : "") + "Вопрос: " + question;
  const res = await fetch("https://ai.api.cloud.yandex.net/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: "Bearer " + iam, "Content-Type": "application/json", "x-folder-id": ENV.folder, "OpenAI-Project": ENV.folder },
    body: JSON.stringify({
      model: `gpt://${ENV.folder}/${ENV.model}`,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      temperature: 0.1,
      max_completion_tokens: LIMITS.answerTokens,
      response_format: { type: "json_object" },
      // note: prompt_cache_key is rejected here ("Unsupported parameter"), so it is not sent
    }),
  });
  const text = await res.text();
  if (!res.ok) throw Object.assign(new Error("Нейросеть ответила ошибкой " + res.status + ": " + text.slice(0, 300)), { status: 502, code: "llm" });
  let content = "";
  try { content = JSON.parse(text).choices[0].message.content || ""; } catch (e) { throw Object.assign(new Error("Непонятный ответ нейросети"), { status: 502, code: "llm" }); }
  return parseAnswer(content);
}
function parseAnswer(content) {
  const m = String(content).match(/\{[\s\S]*\}/);
  let j = null;
  try { j = JSON.parse(m ? m[0] : content); } catch (e) {}
  if (!j || typeof j.answer !== "string") return { answer: String(content).trim().slice(0, 600), quote: "", page: null, found: true };
  const page = Number.isInteger(j.page) && j.page > 0 && j.page < 500 ? j.page : null;
  const found = j.found !== false;
  // models sometimes echo the JSON fields into the sentence ("found=false, ...")
  let answer = j.answer.replace(/\b(found|quote|page)\s*[=:]\s*\S+[,.;]?\s*/gi, "").trim();
  if (!found || !answer) answer = NOT_FOUND;
  return { answer: answer.slice(0, 600), quote: found ? String(j.quote || "").trim().slice(0, 400) : "", page: found ? page : null, found };
}

/* ---------- SpeechKit v3: text -> mp3 ---------- */
async function speak(iam, text, voice) {
  const v = VOICES[voice] ? voice : ENV.voice;
  const roles = VOICES[v] || [];
  const hints = [{ voice: v }];
  const role = roles.includes(ENV.role) ? ENV.role : roles[0];
  if (role) hints.push({ role });
  const res = await fetch("https://tts.api.cloud.yandex.net/tts/v3/utteranceSynthesis", {
    method: "POST",
    headers: { Authorization: "Bearer " + iam, "Content-Type": "application/json", "x-folder-id": ENV.folder },
    body: JSON.stringify({ text, hints, outputAudioSpec: { containerAudio: { containerAudioType: "MP3" } }, loudnessNormalizationType: "LUFS", unsafeMode: text.length > 250 }),
  });
  const body = await res.text();
  if (!res.ok) throw Object.assign(new Error("Синтез речи ответил ошибкой " + res.status + ": " + body.slice(0, 300)), { status: 502, code: "tts" });
  // the answer is a stream of JSON objects, one audio chunk each
  const parts = [];
  for (const line of body.split(/\r?\n/)) {
    const s = line.trim(); if (!s) continue;
    try { const d = JSON.parse(s); const c = d.result && d.result.audioChunk && d.result.audioChunk.data; if (c) parts.push(Buffer.from(c, "base64")); } catch (e) {}
  }
  if (!parts.length) throw Object.assign(new Error("Синтез речи вернул пустой звук"), { status: 502, code: "tts" });
  return Buffer.concat(parts).toString("base64");
}

/* ---------- entry point ---------- */
module.exports.handler = async function (event, context) {
  const origin = (event.headers && (event.headers.Origin || event.headers.origin)) || "";
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors(origin), body: "" };
  if (event.httpMethod !== "POST") return fail(405, "method", "Только POST", origin);
  let req;
  try { req = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString("utf8") : event.body || "{}"); }
  catch (e) { return fail(400, "bad_json", "Тело запроса — не JSON", origin); }
  try {
    const who = await checkCaller(req.gh);
    const iam = context && context.token && context.token.access_token;
    if (!iam) return fail(500, "config", "У функции нет сервисного аккаунта", origin);
    if (req.action === "tts") {
      const text = String(req.text || "").trim();
      if (!text || text.length > LIMITS.tts) return fail(400, "text", "Текст пустой или слишком длинный", origin);
      spend(who, "tts");
      return reply(200, { audio: await speak(iam, text, req.voice) }, origin);
    }
    if (req.action === "ask") {
      const question = String(req.question || "").trim();
      if (!question || question.length > LIMITS.question) return fail(400, "question", "Вопрос пустой или слишком длинный", origin);
      const rules = book(req.game);
      if (!rules) return fail(404, "no_rules", "Для этой игры правила ещё не загружены", origin);
      spend(who, "ask");
      const extra = String(req.situation || "").slice(0, 300);
      const a = await askModel(iam, rules, question, extra, req.game);
      let audio = null;
      if (req.speak !== false && a.answer && a.found) { try { audio = await speak(iam, a.answer.slice(0, LIMITS.tts), req.voice); } catch (e) { a.ttsError = e.message; } }
      return reply(200, Object.assign(a, { audio }), origin);
    }
    return fail(400, "action", "Неизвестное действие", origin);
  } catch (e) {
    return fail(e.status || 500, e.code || "error", e.message || String(e), origin);
  }
};
module.exports._test = { parseAnswer, checkCaller, authCache, ENV };
