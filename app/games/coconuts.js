/* Coconuts («Кокосики», Korea Boardgames 2013; Russian edition Choo Choo Games): a dexterity race — monkey launchers,
   coconuts and cups; whoever first builds a pyramid of 6 cups on their board wins.
   Rules summarised in our own words from:
   - the Russian rules of Choo Choo Games (4 pages; page = the page of the PDF, the same as printed) — the main source;
   - the English rules of Mayday Games (2 pages) — to check against.
   They differ, and the app follows the Russian rules and names each difference in a question («спорный вопрос»):
   - the turn: RU says «clockwise» and also «to the player on your right»; EN says clockwise only;
   - the coconuts left after dealing 8 each: RU — to the supply; EN — back to the box (fewer in play with 2 or 3);
   - running out: RU — take from the supply, the supply empty — the game ends; EN — reuse any coconut not in a cup,
     the game ends when all coconuts are in cups (RU says so too at the end of its rules);
   - the age: RU 8+, EN 7+; the rules on several cards at once and on «Замри!» are only in RU.
   No rounds and no points: the play screen keeps the turn short and the magic cards at hand, and the end is recorded
   as «a pyramid» (the winner) or «the coconuts ran out» (the coconuts in each player's cups; equal — who shot last).
   Every rule the app enforces is listed in docs/rules-check.md with its source and its test. */
(function () {
  "use strict";
  const BH = window.BH, A = BH.art;

  /* ---------- the drawn schematics (when the pictures from the rules are not loaded) ---------- */
  // a cup seen from above; stacked places marked as in the rules: a single ring — a yellow cup in a red one, a double ring — two yellow
  const cup = (x, y, fill, mark) => `<circle cx="${x}" cy="${y}" r="15" style="fill:${fill};stroke:${mark ? "#22305E" : "rgba(0,0,0,.25)"};stroke-width:${mark ? 3.5 : 2}"/>` +
    (mark === 2 ? `<circle cx="${x}" cy="${y}" r="9" style="fill:none;stroke:#22305E;stroke-width:2.5"/>` : "");
  const Y = "#F6B73C", R = "#E5483B";
  const cover = A.svg(`<rect width="64" height="64" style="fill:#4FA3E0"/><path d="M8 50 Q32 24 56 50 Z" style="fill:#7CC36B"/>` +
    `<path d="M22 30 l4 14 h12 l4 -14 z" style="fill:${R}"/><path d="M27 22 l3 10 h8 l3 -10 z" style="fill:${Y}"/><circle cx="34" cy="16" r="5" style="fill:#5B3A1E"/>`, "0 0 64 64");
  const art = {
    kit: () => A.svg(A.table() + `<rect x="60" y="70" width="120" height="70" rx="8" style="fill:#7CC36B;stroke:#3F7A34;stroke-width:3"/>` +
      [90, 120, 150].map(x => `<circle cx="${x}" cy="95" r="12" style="fill:#B07A44"/>`).join("") + `<line x1="66" y1="128" x2="174" y2="128" style="stroke:${R};stroke-width:4"/>` +
      Array.from({ length: 8 }, (_, i) => `<circle cx="${205 + (i % 4) * 18}" cy="${85 + Math.floor(i / 4) * 18}" r="7" style="fill:#5B3A1E"/>`).join("") +
      `<rect x="200" y="125" width="30" height="40" rx="4" style="fill:#3FA7E0;stroke:#fff;stroke-width:2"/><rect x="236" y="125" width="30" height="40" rx="4" style="fill:#3FA7E0;stroke:#fff;stroke-width:2"/>` +
      A.label(160, 200, "катапульта · планшет · 2 карты · 8 кокосов")),
    cups4: () => A.svg(A.table() + [0, 1, 2].map(r => [0, 1, 2].map(c => { const corner = r !== 1 && c !== 1, mid = r === 1 && c === 1; return cup(124 + c * 36, 54 + r * 36, Y, corner ? 1 : mid ? 2 : 0); }).join("")).join("") +
      A.label(160, 200, "углы — жёлтая в красной, центр — жёлтая в жёлтой")),
    cups3: () => A.svg(A.table() + [[1, []], [2, [0]], [3, [1, 2]], [4, [1]]].map(([n, red], r) => Array.from({ length: n }, (_, c) => cup(160 - (n - 1) * 18 + c * 36, 40 + r * 34, Y, red.includes(c) ? 1 : 0)).join("")).join("") +
      A.label(160, 200, "4 места — жёлтая в красной")),
    goal: () => A.svg(A.table() + cup(124, 120, Y) + cup(160, 120, R) + cup(196, 120, Y) + cup(142, 88, Y) + cup(178, 88, Y) + cup(160, 56, R) +
      A.label(160, 170, "пирамида из 6 корзинок")),
  };

  // the magic cards: when each may be played and what it does (the rules, page 4)
  const cards = [
    { id: "again", img: "mc-again", name: "Ещё 1 попытка", tag: "свой ход", when: "перед своим выстрелом", does: "в этот ход — *2* выстрела подряд." },
    { id: "freeze", img: "mc-freeze", name: "Замри!", tag: "чужой ход", when: "перед выстрелом другого", does: "он *пропускает* ход.", note: "Сыграли на того же игрока и другие карты — работает только «Замри!», остальные — в коробку." },
    { id: "blind", img: "mc-blind", name: "Выстрел вслепую", tag: "чужой ход", when: "перед выстрелом другого", does: "он стреляет с *закрытыми глазами*." },
    { id: "wind", img: "mc-wind", name: "Призыв ветра", tag: "чужой ход", when: "перед выстрелом другого", does: "попробуйте *сдуть* его кокос — можно газетой или вентилятором." },
    { id: "aim", img: "mc-aim", name: "В яблочко!", tag: "чужой ход", when: "перед выстрелом другого", does: "выберите корзинку: попал в неё — забирает, иначе *ничего* не получает." },
    { id: "far", img: "mc-far", name: "Дальний выстрел", tag: "чужой ход", when: "перед выстрелом другого", does: "он отодвигает катапульту от красной линии *хотя бы на вытянутую руку*." },
  ];

  BH.registerGame({
    id: "coconuts",
    name: "Кокосики",
    altName: "Coconuts",
    publisher: "Korea Boardgames · Choo Choo Games",
    year: 2013,
    tagline: "Обезьянка-катапульта, кокос — в корзинку. Кто первым соберёт пирамиду из 6 корзинок, тот король обезьян.",
    time: "20 мин",
    age: "8+",
    players: { min: 2, max: 4 },
    cover,
    // the cover: the box from the publisher's picture, straightened; the rest — from the Russian rules (scripts/assets/coconuts-compose.mjs)
    images: {
      cover: "cover-square",
      steps: { kit: ["kit"], cups4: ["cups4"], cups3: ["cups3"], goal: ["pyramid"] },
      rules: { components: ["kit"], setup: ["cups4", "cups3"], turn: ["pyramid"], cards: ["cards"] },
      // each magic card's picture: the tiles on the play screen
      icons: ["mc-again", "mc-freeze", "mc-blind", "mc-wind", "mc-aim", "mc-far"],
    },
    expansions: [],
    source: "Правила Choo Choo Games (русские; страницы как в PDF) и английские правила Mayday Games для сверки",
    searchExample: "можно ли забрать корзинку у соперника?",
    searchWords: ["корзинка", "кокос", "карта"],

    setup: [
      { id: "kit", title: "Каждому", art: art.kit,
        text: "Обезьянка-катапульта, планшет, *2* волшебные карты и *8* кокосов.\nОстальные кокосы — *общий запас*.\nЛишние катапульты, планшеты и карты — в коробку." },
      { id: "cups4", when: c => c.players !== 3, title: "Корзинки — квадратом", art: art.cups4,
        text: "Все *14* корзинок — в центр, квадрат *3 × 3*.\nУглы — *жёлтая в красной*, центр — *жёлтая в жёлтой*, края — жёлтые.\nПланшеты — к *сторонам* квадрата." },
      { id: "cups3", when: c => c.players === 3, title: "Корзинки — треугольником", art: art.cups3,
        text: "Все *14* корзинок — в центр, треугольник из *10* мест.\nНа *4* местах — *жёлтая в красной*, как на рисунке, на остальных — жёлтая.\nПланшеты — к *сторонам* треугольника." },
      { id: "goal", title: "Цель — пирамида", art: art.goal,
        text: "Попал кокосом в корзинку — она *твоя*: ставь на пенёк планшета.\nКто первым соберёт пирамиду из *6* корзинок — победил.\nНачинает *самый младший* — или крутите колесо." },
    ],

    // the rules: the youngest starts; the wheel is there for those who want it, the youngest is picked by hand on the same screen
    first: { label: "Первый игрок", hint: "По правилам начинает самый младший — выберите его вручную или крутите колесо. Дальше ходят по часовой стрелке." },

    // no rounds: the turns go round the table until someone has a pyramid or the coconuts run out
    rounds: {
      leader: false,
      reminder: [
        "Перед выстрелом спросите: кто играет *волшебную карту*?",
        "Катапульта — у *красной линии* своего планшета.",
        "*Один* выстрел. Кокос остался в корзинке — она *твоя*, кокос в ней.",
        "*Красная* корзинка — забери, и можно стрелять *ещё раз*.",
        "Корзинка *соперника* — можно забрать себе.",
        "Промах — кокос в *общий запас*. Свои кончились — бери оттуда.",
        "Ход — следующему по *часовой* стрелке.",
      ],
    },
    cards,
    cardsTitle: "Волшебные карты",
    cardsFoot: "Нажмите на карту — что она делает. Сыгранную — в коробку.",

    // the end: a pyramid of 6 cups wins at once; the coconuts ran out — the most coconuts in one's cups, equal — who shot last
    scoring: { type: "race", goal: 6, goalHow: "pyramid",
      goalAsk: "Кто собрал пирамиду?",
      goalText: n => `Нажмите на того, кто собрал пирамиду из ${n} корзинок.`,
      goalDone: n => `Первая пирамида из ${n} корзинок`,
      goalChip: "Пирамида",
      // no pyramid, the coconuts ran out: the coconuts in each player's cups are counted
      count: { label: "Кокосов в корзинках", max: 36, how: "coconuts", chip: "Кокосы кончились", button: "Кокосы кончились — посчитать",
        hint: "Пирамиды нет, а кокосы кончились — посчитайте кокосы.", done: "Кокосы кончились — больше всех кокосов в корзинках", tieDone: "Кокосы кончились — поровну, победил ходивший последним" },
      end: n => [`Пирамида из *${n}* корзинок — победа сразу.`, "Кокосы кончились — побеждает тот, у кого больше кокосов в корзинках.", "Поровну — тот из них, кто ходил *последним*."],
      tieNote: "Поровну — побеждает тот из них, кто ходил последним." },

    options: [],

    rules: [
      { id: "goal", page: 4, title: "Цель игры", keys: "цель победа пирамида шесть корзинок король",
        body: "<p>Стреляйте кокосами из обезьянок-катапульт и забирайте корзинки, в которые попали. Кто первым построит на своём планшете пирамиду из 6 корзинок, тот и победил.</p>" },
      { id: "components", page: 2, title: "Что в коробке", keys: "состав компоненты сколько корзинок кокосов карт",
        body: "<ul><li>4 обезьянки-катапульты и 4 планшета игроков.</li><li>14 корзинок: 10 жёлтых и 4 красные.</li><li>36 кокосов.</li><li>12 волшебных карт.</li></ul>" },
      { id: "setup", page: 3, title: "Подготовка", keys: "подготовка раздать корзинки квадрат треугольник вложить",
        body: "<ul><li>Каждому — обезьянка-катапульта, планшет, 2 волшебные карты и 8 кокосов. Остальные кокосы — общий запас, остальное — в коробку.</li><li>Все корзинки — в центр стола: вдвоём и вчетвером квадратом, втроём треугольником, как на рисунке.</li><li>Некоторые корзинки вкладывают друг в друга: жёлтую в красную или жёлтую в жёлтую — как на рисунке.</li><li>Каждый ставит планшет к одной из сторон квадрата или треугольника.</li></ul>" },
      { id: "turn", page: 3, title: "Ход", keys: "ход выстрел катапульта красная линия пенёк промах",
        body: "<p>Начинает самый младший, дальше ходят по часовой стрелке, по одному ходу.</p><ol><li>Поставьте катапульту у красной линии своего планшета.</li><li>Сделайте один выстрел. Кокос попал в корзинку и не выскочил — заберите её и поставьте на свободный пенёк планшета, кокос остаётся в ней. Заняты все 3 пенька — ставьте корзинки вторым уровнем, пирамидой.</li><li>Промахнулись — кокос в общий запас.</li></ol>" },
      { id: "cups", page: 3, title: "Жёлтые и красные корзинки", keys: "жёлтая красная ещё раз выстрел",
        body: "<ul><li><b>Жёлтая</b> — просто заберите её.</li><li><b>Красная</b> — заберите и можете сразу выстрелить ещё раз.</li></ul>" },
      { id: "steal", page: 4, title: "Корзинки соперников", keys: "украсть забрать корзинку соперника чужой планшет",
        body: "<p>Попали кокосом в корзинку на планшете другого игрока — можете забрать её и поставить на свой планшет по обычным правилам.</p><p>Кокосы из взятых корзинок не вынимают до конца игры.</p>" },
      { id: "supply", page: 4, title: "Кокосы кончились", keys: "кончились кокосы запас взять",
        body: "<p>Кончились свои кокосы — берите из общего запаса: туда уходят промахи. У вас кончились кокосы, а в запасе пусто — игра окончена.</p><p>В конце правил сказано иначе: игра кончается, когда все кокосы оказались в корзинках. Как быть — в частых вопросах.</p>" },
      { id: "cards", page: 4, title: "Волшебные карты", keys: "волшебные карты когда играть сколько замри",
        body: "<ul><li>Перед каждым выстрелом спросите, не хочет ли кто-то сыграть карту.</li><li>Сыгранную карту уберите в коробку.</li><li>Можно сыграть сразу сколько угодно карт: они действуют одновременно.</li><li>Если вместе с «Замри!» на игрока сыграли другие карты, работает только «Замри!», остальные просто уходят в коробку.</li></ul>" +
          "<ul>" + cards.map(k => `<li><b>${k.name}</b> — ${k.when}: ${k.does.replace(/\*/g, "")}</li>`).join("") + "</ul>" },
      { id: "end", page: 4, title: "Конец игры", keys: "конец победа пирамида кокосы кончились ничья последним",
        body: "<ul><li>Побеждает тот, кто первым построил пирамиду из 6 корзинок.</li><li>Если все кокосы оказались в корзинках, а пирамиды нет ни у кого, побеждает тот, у кого в корзинках на планшете больше всего кокосов.</li><li>Поровну — побеждает тот из них, кто ходил последним.</li></ul>" },
    ],

    ruleGroups: [
      { title: "Игра", ids: ["goal", "components", "setup"] },
      { title: "Ход", ids: ["turn", "cups", "steal", "supply"] },
      { title: "Карты и конец", ids: ["cards", "end"] },
    ],

    faqGroups: [
      { title: "Выстрел", refs: ["turn", "cups", "steal"] },
      { title: "Карты", refs: ["cards"] },
      { title: "Кокосы и конец", refs: ["supply", "end", "setup", "goal", "components"] },
    ],

    faq: [
      { q: "Кокос попал в корзинку, но выскочил — считается?", a: "Нет. Корзинку забирают, только если кокос в ней остался.", ref: "turn", keys: "выскочил отскочил попал" },
      { q: "Как ставить корзинки на планшет?", a: "Сначала на 3 пенька, потом вторым уровнем — 2 корзинки, и сверху одна. Вместе 6 — пирамида.", ref: "turn", keys: "пенёк пирамида уровень ставить" },
      { q: "Попал в красную корзинку — что дальше?", a: "Заберите её — и можете сразу выстрелить ещё раз.", ref: "cups", keys: "красная ещё раз" },
      { q: "Можно забрать корзинку у соперника?", a: "Да: попали кокосом в корзинку на его планшете — можете забрать её и поставить на свой планшет.", ref: "steal", keys: "украсть забрать чужую соперника" },
      { q: "Кокосы из корзинок вынимают?", a: "Нет, до конца игры кокосы остаются в корзинках — даже когда корзинку забирают.", ref: "steal", keys: "вынимать кокос корзинке" },
      { q: "Кончились свои кокосы — что делать?", a: "Берите из общего запаса: туда идут промахи и лишние кокосы.", ref: "supply", keys: "кончились запас" },
      { q: "Когда кокосы кончились — это конец игры?", a: "В русских правилах — два ответа: «у вас кончились кокосы, а в запасе пусто — конец» и «конец, когда все кокосы в корзинках». В английских — только второй: стреляют, пока есть кокосы не в корзинках. Договоритесь до начала игры.", ref: "supply", src: "disputed", keys: "конец кокосы кончились запас пуст все в корзинках" },
      { q: "Лишние кокосы — в общий запас или в коробку?", a: "По русским правилам — в общий запас, по английским — в коробку: тогда в игре только по 8 кокосов на игрока, и вдвоём или втроём партия короче. Приложение подсказывает по русским правилам.", ref: "setup", src: "disputed", keys: "лишние кокосы запас коробка сколько" },
      { q: "Ход передают направо или налево?", a: "В русских правилах сказано и «по часовой стрелке», и «тому, кто сидит справа». В английских — только по часовой стрелке, то есть следующему слева. Договоритесь до начала игры.", ref: "turn", src: "disputed", keys: "направо налево справа часовой стрелке" },
      { q: "Можно сыграть несколько волшебных карт сразу?", a: "Да, сколько угодно: они действуют одновременно. Но если среди них «Замри!» — работает только она.", ref: "cards", keys: "несколько карт сразу замри" },
      { q: "«В яблочко!»: игрок попал в другую корзинку?", a: "Он ничего не получает — забрать можно только выбранную корзинку.", ref: "cards", keys: "в яблочко другую корзинку" },
      { q: "Пирамиды нет, кокосы кончились — кто победил?", a: "У кого в корзинках на планшете больше кокосов. Поровну — тот из них, кто ходил последним.", ref: "end", keys: "кокосы кончились ничья победил" },
    ],
  });
})();
