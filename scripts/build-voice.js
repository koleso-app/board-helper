// Builds dist/voice.zip for the Yandex Cloud function: functions/voice/index.js + rules/<game>.txt.
// Rule texts come from the local, unpublished sources/ folder (the rulebook) plus the app's own
// cheat sheet, so the model has both the book and our checked summary.  Run: node scripts/build-voice.js
const fs = require("fs"), path = require("path"), vm = require("vm"), zlib = require("zlib");
const root = path.join(__dirname, "..");
const out = path.join(root, "dist");

/* ---------- the app's cheat sheet for a game, as plain text ---------- */
function cheatSheet(gameFile) {
  const ctx = { console, Math, JSON, Set, Map, Array, Object, String, Number, localStorage: { getItem: () => null, setItem() {} }, addEventListener() {}, document: { addEventListener() {}, getElementById: () => null } };
  ctx.window = ctx; vm.createContext(ctx);
  for (const f of ["js/util.js", "js/games.js", "js/art.js", gameFile]) vm.runInContext(fs.readFileSync(path.join(root, "app", f), "utf8"), ctx);
  const g = ctx.BH.games[0];
  const plain = h => h.replace(/<li>/g, "\n- ").replace(/<\/(p|ul|ol)>/g, "\n").replace(/<[^>]+>/g, "").replace(/\n{2,}/g, "\n").trim();
  // [раздел id · стр. N]: the model names the section, the function finds the page (functions/voice)
  return { id: g.id, text: g.rules.map(r => `[раздел ${r.id}${r.page ? ` · стр. ${r.page}` : ""}] ${r.title}\n${plain(r.body)}`).join("\n\n") + "\n\nЧАСТЫЕ ВОПРОСЫ\n" + g.faq.map(f => `- ${f.ref ? `[раздел ${f.ref}] ` : ""}${f.q} ${f.a}${f.src && ctx.BH.FAQ_SRC[f.src] ? ` (${ctx.BH.FAQ_SRC[f.src]})` : ""}`).join("\n") };
}

/* ---------- the rulebook text with printed page numbers ---------- */
// printed: pdf page N carries printed page N-1 (page 1 is the cover); pdf: the page of the PDF file itself;
// plus1: pdf page N carries printed page N+1 (the file starts at printed page 2)
function rulebook(file, pages) {
  if (!file || !fs.existsSync(file)) return "";
  return fs.readFileSync(file, "utf8").replace(/\u0000/g, "").replace(/===== СТРАНИЦА (\d+) =====/g, (m, n) => (pages === "pdf" ? `[стр. ${n}]` : pages === "plus1" ? `[стр. ${+n + 1}]` : n === "1" ? "[обложка]" : `[стр. ${n - 1}]`));
}

const games = [
  { js: "games/flip7.js", book: path.join(root, "sources", "flip7-rules-ru.txt"), title: "Flip 7",
    bookNote: "основной источник; часть страниц со схемами подсчёта распознана с ошибками — там сверяйся со шпаргалкой" },
  { js: "games/flip7v.js", book: path.join(root, "sources", "flip7v-rules-en.txt"), title: "Flip 7: With A Vengeance",
    bookNote: "на английском, основной источник; отвечай по-русски и называй карты так, как в шпаргалке. Числа «x12 x8 x3…» на стр. 2–3 распознаны вперемешку — состав колоды бери из шпаргалки. Последняя страница — задняя обложка без номера" },
  { js: "games/faraway.js", book: path.join(root, "sources", "faraway-rules-ru2.txt"), title: "Дальние дали (Faraway)", pages: "pdf",
    bookNote: "официальный русский перевод («Эврикус»), основной источник; номера страниц напечатаны и совпадают со страницами PDF. Значки в книге нарисованы, поэтому часть текста неполная — виды заданий и святилища сверяй со шпаргалкой. Называй всё словами этой книги: подсказка, время исследования, игровая область, рынок карт регионов, удду, окико, золотолоз" },
  { js: "games/crokinole.js", book: path.join(root, "sources", "croki-book.txt"), title: "Крокинол", pages: "pdf",
    bookNote: "русские правила Crowd Games (стр. 1–4 — страницы PDF) и после них официальные правила NCA 2026 на английском (страницы помечены «NCA»). Варианты расходятся: число дисков, цель партии, турнир — сверяйся со шпаргалкой и называй источник" },
  { js: "games/coconuts.js", book: path.join(root, "sources", "coco-book.txt"), title: "Кокосики (Coconuts)", pages: "pdf",
    bookNote: "русские правила Choo Choo Games (стр. 1–4 — страницы PDF, номера совпадают с напечатанными), после них английские правила Mayday Games (страницы помечены «EN»). В русских правилах ход передают и «по часовой стрелке», и «тому, кто справа» — в английских только по часовой; так и говори" },
  { js: "games/goldfever.js", book: path.join(root, "sources", "gold-book.txt"), title: "Жадюги (Gold Fever)", pages: "pdf",
    bookNote: "русские правила «Стиль Жизни», переписанные с картинок PDF; номера страниц — как напечатаны (1–4)" },
  { js: "games/toybattle.js", book: path.join(root, "sources", "toy-book.txt"), title: "Битва игрушек (Toy Battle)", pages: "pdf",
    bookNote: "русские правила Choo Choo Games — два разворота по три страницы (номера страниц как в английской книге, она следом со страницами [стр. N]); в конце — памятка с эффектами воинов и особых баз по справке Board Game Arena, её нет в книгах — так и говори. Называй воинов как в шпаргалке (Кряква, Скалли, Кэп, Джамбо, Хук, XB-42, Стар, Рокси), поля — по-русски" },
  { js: "games/dobble.js", book: path.join(root, "sources", "dobble-book.txt"), title: "Доббль (Spot it!)", pages: "pdf",
    bookNote: "русские правила — пересказ магазина ig-store, переписанный с картинок PDF; номера страниц — как напечатаны (1–3); следом точные цитаты классических английских правил Spot it! (по RulesPal, без страниц)" },
  { js: "games/ribbit.js", title: "Черепашьи бега (Ribbit)" },
  { js: "games/zoo.js", book: path.join(root, "sources", "zoo-book.txt"), title: "Зоопарк (Team Zoo)", pages: "pdf",
    bookNote: "русские правила Hobby World, версия 1.0; страницы PDF совпадают с напечатанными (стр. 1 без номера, стр. 2–4 — рассказ о киперах, правила — на стр. 5–7). В конце — тексты карт какаду с фото издателя, их нет в книге: так и говори" },
  { js: "games/thegang.js", book: path.join(root, "sources", "thegang-rules-en.txt"), title: "The Gang", pages: "plus1",
    bookNote: "английская книга правил, основной источник; номера страниц — как напечатаны (файл начинается со стр. 2). Отвечай по-русски и называй всё словами шпаргалки: ограбление, фишки, карманные и общие карты, вскрытие, хранилище, сигнализация, испытания и специалисты" },
];
const files = [["index.js", fs.readFileSync(path.join(root, "functions", "voice", "index.js"))]];
for (const g of games) {
  const sheet = cheatSheet(g.js), bookText = rulebook(g.book, g.pages);
  if (g.book && !bookText) console.warn(`! нет книги правил для ${g.title}: ${g.book} — в функцию попадёт только шпаргалка`);
  const text = `ИГРА: ${g.title}\n\n` +
    (bookText ? `КНИГА ПРАВИЛ (${g.bookNote})\n${bookText}\n\n` : "") +
    `ШПАРГАЛКА (проверенный пересказ правил; номера страниц — по книге)\n${sheet.text}\n`;
  files.push([`rules/${sheet.id}.txt`, Buffer.from(text, "utf8")]);
  fs.mkdirSync(out, { recursive: true }); fs.writeFileSync(path.join(out, `rules-${sheet.id}.txt`), text);   // to look at; dist/ is not published
  console.log(`${sheet.id}: ${text.length} символов`);
}

/* ---------- minimal zip writer (deflate) ---------- */
const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function zip(entries) {
  const locals = [], centrals = []; let offset = 0;
  for (const [name, data] of entries) {
    const nameBuf = Buffer.from(name, "utf8"), comp = zlib.deflateRawSync(data, { level: 9 }), crc = crc32(data);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(0, 10); local.writeUInt32LE(crc, 14); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, comp);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(8, 10);
    central.writeUInt32LE(0, 12); central.writeUInt32LE(crc, 16); central.writeUInt32LE(comp.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "voice.zip"), zip(files));
console.log("dist/voice.zip:", fs.statSync(path.join(out, "voice.zip")).size, "байт");
