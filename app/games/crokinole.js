/* Crokinole («Крокинол»): a traditional flicking game on a round board. Rules summarised in our own words from three
   sources that differ in their variants:
   - the Russian rules of the Crowd Games edition (4 pages; page = the page of the PDF) — the words and the home game:
     2 players with 12 discs each or 2 pairs with 6 discs each, a game to 100 points (or as agreed), the round's difference;
   - the official rules of the National Crokinole Association (NCA, ratified May 6, 2026) — the tournament game:
     a game of 4 rounds, 2 points for a round won and 1 each for a tie; singles with 8 discs each (the WCC too);
   - the rules of Crokinole Canada (crokinole.ca) — traditional and tournament scoring, a tie-breaker round after 4 rounds;
   - the rules of Crok Shop (crok.shop/blogs/news/crokinole-rules) — «Race to 9»: the round points of the NCA, the first to 9 wins;
     it names no number of discs, so the app takes the NCA's 8;
   - the World Crokinole Championship (worldcrokinole.com) — a game of 4 rounds, a 5th round on a tie.
   The NCA has no tie-breaker: a tied game stays tied. Crokinole Canada and the WCC play one more round.
   Every rule the app enforces is listed in docs/rules-check.md with its source and its test. */
(function () {
  "use strict";
  const BH = window.BH, A = BH.art;

  /* ---------- the drawn schematics ---------- */
  const board = (cx, cy, r) => `<g>
    <circle cx="${cx}" cy="${cy}" r="${r}" style="fill:#E9D3A8;stroke:#8A5A2B;stroke-width:5"/>
    <circle cx="${cx}" cy="${cy}" r="${r * 0.86}" style="fill:none;stroke:#3A2A1A;stroke-width:1.6"/>
    <circle cx="${cx}" cy="${cy}" r="${r * 0.6}" style="fill:none;stroke:#3A2A1A;stroke-width:1.6"/>
    <circle cx="${cx}" cy="${cy}" r="${r * 0.33}" style="fill:none;stroke:#3A2A1A;stroke-width:1.6"/>
    ${Array.from({ length: 8 }, (_, i) => { const a = i * Math.PI / 4 + Math.PI / 8; return `<circle cx="${(cx + r * 0.33 * Math.cos(a)).toFixed(1)}" cy="${(cy + r * 0.33 * Math.sin(a)).toFixed(1)}" r="${r * 0.025}" style="fill:#3A2A1A"/>`; }).join("")}
    <circle cx="${cx}" cy="${cy}" r="${r * 0.06}" style="fill:#3A2A1A"/>
    <path d="M${cx - r * 0.86 * 0.707} ${cy - r * 0.86 * 0.707}L${cx - r * 0.6 * 0.707} ${cy - r * 0.6 * 0.707}M${cx + r * 0.86 * 0.707} ${cy - r * 0.86 * 0.707}L${cx + r * 0.6 * 0.707} ${cy - r * 0.6 * 0.707}M${cx - r * 0.86 * 0.707} ${cy + r * 0.86 * 0.707}L${cx - r * 0.6 * 0.707} ${cy + r * 0.6 * 0.707}M${cx + r * 0.86 * 0.707} ${cy + r * 0.86 * 0.707}L${cx + r * 0.6 * 0.707} ${cy + r * 0.6 * 0.707}" style="stroke:#3A2A1A;stroke-width:1.6"/>
  </g>`;
  const disc = (x, y, col) => `<circle cx="${x}" cy="${y}" r="7" style="fill:${col};stroke:rgba(0,0,0,.35);stroke-width:1.5"/>`;
  const cover = A.svg(`<rect width="64" height="64" style="fill:#5B3A1E"/>` + board(32, 32, 27) + disc(22, 26, "#D9483B") + disc(40, 38, "#1F2A44"), "0 0 64 64");
  const art = {
    board: () => A.svg(board(160, 112, 96) + A.label(160, 230, "центр 20 · кольца 15, 10, 5")),
    discs: c => {
      const four = c.players === 4, n = four ? 6 : discs(c);
      let s = board(160, 112, 70);
      const row = (y, col, k) => { let o = ""; for (let i = 0; i < k; i++) o += disc(40 + i * 20, y, col); return o; };
      s += four ? row(206, "#D9483B", 6) + row(222, "#1F2A44", 6) : row(206, "#D9483B", Math.min(n, 12)) + row(222, "#1F2A44", Math.min(n, 12));
      return A.svg(s, "0 0 320 240");
    },
    goal: c => A.svg(A.table() + `<text x="160" y="118" text-anchor="middle" style="font-family:var(--f-display);font-weight:700;font-size:44px;fill:var(--accent)">${c.opt("tour") ? "4 раунда" : c.opt("race9") ? "до 9" : (c.opt("t50") ? 50 : c.opt("t200") ? 200 : 100)}</text>` + A.label(160, 170, c.opt("tour") || c.opt("race9") ? "2 очка за раунд, ничья — по 1" : "за раунд — только разница")),
  };

  // the target and the kind of scoring (one of a group: none chosen — to 100 points)
  const tour = c => c.opt("tour");
  // round points as in a tournament (2 / 1 / 0), the game to 9 of them (Crok Shop: «Race to 9»)
  const race = c => (c.opt("race9") ? 9 : 0);
  const roundPoints = c => tour(c) || !!race(c);
  const target = c => (tour(c) ? null : race(c) || (c.opt("t50") ? 50 : c.opt("t200") ? 200 : 100));
  // discs of one side: a pair 6 each — 12; a player alone — 8 in the tournament and «до 9» (NCA, WCC), 12 at home (Russian rules, CC)
  const discs = c => (c.players === 4 ? 12 : roundPoints(c) ? 8 : 12);

  BH.registerGame({
    id: "crokinole",
    name: "Крокинол",
    altName: "Crokinole",
    publisher: "Канада, с 1876 года",
    year: 1876,
    tagline: "Щелчком пальца — к центру доски, чужие диски — в кювет. Вдвоём или пара на пару.",
    players: { min: 2, max: 4, only: [2, 4] },
    cover,
    // from the Russian rules of the Crowd Games edition (scripts/assets/crokinole-compose.mjs)
    images: { cover: "cover-square", steps: { board: ["board"] }, rules: { board: ["board"], scoring: ["board"] } },
    expansions: [],
    source: "Правила Crowd Games (русские), официальные правила NCA (2026), правила Crokinole Canada и Crok Shop, чемпионат мира",
    searchExample: "что если диск на линии?",
    searchWords: ["линия", "центр", "кювет"],

    // four players are two pairs: partners sit opposite each other (seats 1 and 3, 2 and 4)
    teams: c => c.players === 4,

    setup: [
      { id: "board", title: "Доска", art: art.board,
        text: "Доску — на ровный стол: в игре её *не двигают*.\nДиски скользят плохо — натрите доску и диски *полиролью*." },
      { id: "discs", title: c => (c.players === 4 ? "Две пары, по 6 дисков" : `По ${discs(c)} дисков`), art: art.discs,
        text: c => c.players === 4
          ? "Партнёры садятся *напротив* друг друга.\nПары — 1-й и 3-й, 2-й и 4-й игрок по порядку за столом.\nКаждому — *6* дисков цвета своей пары."
          : `Садитесь *напротив* друг друга.\nКаждому — *${discs(c)}* дисков своего цвета.` },
      { id: "goal", title: c => (tour(c) ? "Турнир: 4 раунда" : race(c) ? `До ${race(c)} очков за раунды` : `Партия до ${target(c)}`), art: art.goal,
        text: c => tour(c)
          ? "Победа в раунде — *2* очка, ничья — по *1*.\nПартия — *4* раунда."
          : race(c) ? `Победа в раунде — *2* очка, ничья — по *1*.\nПартия — до *${race(c)}* таких очков.`
          : `За раунд очки получает только *лучший* — разницу.\nПартия — до *${target(c)}* очков.` },
    ],

    first: { label: "Первый игрок", hint: "Он щёлкает первым в первом раунде. Следующий раунд начинает игрок слева." },

    rounds: {
      leaderLabel: "Начинает",
      leaderLegend: "кто начинал раунд",   // the legend under the rounds table
      rotate: "left",
      reminder: [
        "По часовой стрелке, по *1* диску за ход.",
        "Диск — на линии удара *своего* квадранта, щелчок пальцем.",
        "Есть чужие диски — *задень* хотя бы один.",
        "Чужих нет — твой или задетый свой диск должен остаться в кольце *15*.",
        "Не вышло — свой диск и задетые свои — в *кювет*.",
        "Диск целиком в центре — *в сторону*: 20 очков.",
      ],
      after: c => [
        "Посчитайте диски в кольцах — кнопка «Раунд» внизу.",
        roundPoints(c) ? "Победа в раунде — *2*, ничья — по *1*." : "Очки получает только лучший — *разницу*.",
        "Следующий раунд начинает игрок *слева*.",
      ],
    },

    // a round: discs counted by zones for each side, then the round is settled between the sides
    // the chances to win: rounds of the same number of discs, singles apart from pairs
    chances: { key: c => (c.players === 4 ? "pairs" : "solo") + discs(c),
      note: "Приложение 2000 раз доигрывает партию с подсчётами на доске, какие обычно бывают у каждой стороны. Это прикидка: как лягут диски, оно не знает." },
    scoring: { type: "rounds", target, roundsCount: c => (tour(c) ? 4 : null),
      tieNote: c => (race(c) ? "В правилах этого случая нет — можно сыграть ещё раунд." : "По правилам NCA это ничья, по правилам Crokinole Canada и на чемпионате мира играют ещё раунд.") },
    sideScore: {
      zones: [{ z: 20, label: "Центр", hint: "вынутые за раунд" }, { z: 15, label: "Кольцо 15" }, { z: 10, label: "Кольцо 10" }, { z: 5, label: "Кольцо 5" }],
      discs,
      // the round between two sides: tournament — 2 for the better, 1 each for a tie; otherwise the better gets the difference
      settle: (raws, c) => {
        const [a, b] = raws;
        if (roundPoints(c)) return a > b ? [2, 0] : a < b ? [0, 2] : [1, 1];
        return a > b ? [a - b, 0] : [0, b - a];
      },
    },

    options: [
      { id: "t50", group: "goal", label: "Партия до 50 очков", short: "до 50", default: false },
      { id: "t200", group: "goal", label: "Партия до 200 очков", short: "до 200", default: false },
      { id: "tour", group: "goal", label: "Турнир: 4 раунда, победа в раунде — 2 очка", short: "турнир", default: false },
      { id: "race9", group: "goal", label: "До 9 очков за раунды, 2 за победу — Race to 9", short: "до 9 за раунды", default: false },
    ],

    rules: [
      { id: "goal", page: 2, title: "Цель игры", keys: "цель победа сколько очков 100 щелчок",
        body: "<p>Щелчком пальца посылайте свои диски ближе к центру доски и выбивайте чужие. Очки считают в конце каждого раунда.</p><ul><li><b>Дома</b> — партия до 100 очков. Можно договориться до 50, 200 или любого числа.</li><li><b>Турнир NCA</b> — партия из 4 раундов, за раунд — 2 очка победителю или по 1 при ничьей.</li></ul>" },
      { id: "board", page: 2, title: "Доска", keys: "доска центр кольца столбики кювет линия удара квадрант",
        body: "<ul><li><b>Центр</b> — отверстие посередине: 20 очков.</li><li><b>Кольцо 15</b> — внутреннее, до столбиков.</li><li><b>Кольцо 10</b> — среднее, за столбиками.</li><li><b>Кольцо 5</b> — внешнее, до линии удара.</li><li><b>Кювет</b> — желоб у борта: там диски вне игры, 0 очков.</li><li>Внешнее кольцо поделено на 4 <b>квадранта</b> — по одному на игрока.</li></ul>" },
      { id: "players", page: 2, title: "Вдвоём и вчетвером", keys: "двое четверо пары команда партнёры диски сколько",
        body: "<ul><li><b>Вдвоём</b> — напротив друг друга, у каждого свой цвет. Дома (партия до 100) — по 12 дисков: так в русских правилах и у Crokinole Canada. В турнире — по 8: так по правилам NCA (2026) и на чемпионате мира. «До 9» играют с подсчётом NCA, число дисков Crok Shop не называет — в приложении тоже по 8.</li><li><b>Вчетвером</b> — две пары. Партнёры сидят напротив, играют одним цветом, у каждого по 6 дисков. Все диски цвета пары — общие.</li></ul><p>Если начинает пара, партнёры сами решают, кто из них щёлкнет первым (правила NCA).</p><p>Игру втроём ни один из источников не описывает.</p>" },
      { id: "shot", page: 3, title: "Щелчок", keys: "щелчок как бить линия удара квадрант палец толкать",
        body: "<ul><li>Ходят по часовой стрелке, по одному диску.</li><li>Диск кладут на <b>линию удара</b> своего квадранта — хотя бы наполовину внутри квадранта.</li><li>По диску щёлкают пальцем. Толкать нельзя, приспособления нельзя.</li><li>Ждите, пока остановятся диски прошлого хода.</li></ul><p>Если все согласны, диск может выступать за линии квадранта — лишь бы касался своей линии удара.</p>" },
      { id: "no-hiding", page: 3, title: "Чужих дисков нет: целься в центр", keys: "нет дисков соперника прятаться кольцо 15 столбики",
        body: "<p>Если на доске нет чужих дисков, ваш диск должен остановиться в кольце 15 или хотя бы касаться его линии. Попал в центр — диск в сторону, 20 очков.</p><p>Если от удара ваши диски сдвинулись и хотя бы один в кольце 15 или в центре — все остаются. Если все вне кольца 15 — они уходят в кювет. Так нельзя «прятаться» за столбиками.</p>" },
      { id: "hit", page: 3, title: "Чужие диски есть: задень", keys: "попасть задеть диск соперника рикошет столбик промах",
        body: "<p>Если на доске есть диски соперника, нужно задеть хотя бы один: прямо, рикошетом от столбика или через свой диск.</p><p>Промах — ваш диск и все задетые свои уходят в кювет, даже если какой-то из них упал в центр.</p>" },
      { id: "twenty", page: 3, title: "Центр — 20 очков", keys: "центр двадцать 20 отверстие вынуть сторону",
        body: "<p>Диск считается в центре, только если он целиком в отверстии и лежит ровно. Его сразу вынимают и откладывают на виду — очки за него считают в конце раунда.</p><p>Если удар был неправильным, 20 этого удара не считаются.</p>" },
      { id: "ditch", page: 3, title: "Кювет и вылеты", keys: "кювет вылетел линия удара вернулся отскочил борт",
        body: "<ul><li>Диск в кювете — вне игры до конца раунда, очков не даёт.</li><li>После каждого удара диски на линии удара и за ней — в кювет.</li><li>Диск коснулся линии удара и сам вернулся, ни во что не ударившись, — он в игре.</li><li>Диск отскочил от борта или дисков в кювете и вернулся — он вне игры, но сдвинутые им диски остаются, а 20 считаются.</li></ul>" },
      { id: "conduct", page: 3, title: "Как сидеть и не мешать", keys: "двигать доску стул вставать мешать касаться",
        body: "<ul><li>Доску после начала партии не двигают.</li><li>Стул не двигают, не встают и не приподнимаются.</li><li>В чужой ход доску не трогают и не мешают.</li></ul><p>Правила NCA строже: при ударе хоть частью сидеть на стуле, доски касаться только рукой, которой бьют.</p>" },
      { id: "scoring", page: 4, title: "Подсчёт очков", keys: "подсчёт очки линия касается меньше разница раунд",
        body: "<ul><li>Раунд кончается, когда сыграны все диски.</li><li>Центр — 20 за каждый отложенный диск, кольцо 15 — 15, кольцо 10 — 10, кольцо 5 — 5, кювет — 0.</li><li>Диск касается линии — считается кольцо с меньшими очками.</li></ul><p><b>Дома:</b> из большего счёта вычтите меньший, разницу получает лучший. Пример из правил: 60 против 35 — лучший получает 25.</p><p><b>Турнир NCA:</b> лучший получает 2 очка, при ничьей — по 1.</p>" },
      { id: "end", page: 4, title: "Конец партии", keys: "конец партии победа 100 четыре раунда ничья",
        body: "<ul><li><b>Дома:</b> побеждает тот, у кого набралось 100 очков или больше (или договорённое число).</li><li><b>Турнир:</b> после 4 раундов побеждает тот, у кого больше очков. Поровну — по правилам NCA это ничья, по правилам Crokinole Canada и на чемпионате мира играют ещё раунд.</li></ul><p><b>До 9 очков за раунды</b> (Race to 9, правила Crok Shop): 2 очка за победу в раунде, 1 за ничью, кто первым набрал 9 — победил. Набрали поровну — в правилах этого случая нет.</p>" },
      { id: "next-round", page: 4, title: "Новый раунд", keys: "новый раунд кто начинает слева первый",
        body: "<p>Все забирают свои диски. Первым ходит игрок слева от того, кто начинал прошлый раунд.</p>" },
    ],

    ruleGroups: [
      { title: "Доска и игроки", ids: ["goal", "board", "players"] },
      { title: "Ход", ids: ["shot", "no-hiding", "hit", "twenty", "ditch", "conduct"] },
      { title: "Очки и конец", ids: ["scoring", "end", "next-round"] },
    ],

    faqGroups: [
      { title: "Очки", refs: ["scoring", "twenty", "end"] },
      { title: "Ход", refs: ["shot", "no-hiding", "hit", "ditch", "conduct"] },
      { title: "Игроки", refs: ["players", "next-round", "goal", "board"] },
    ],

    faq: [
      { q: "Диск лежит на линии — какое кольцо?", a: "То, что даёт меньше очков. Смотрят, лежит ли нижний край диска на линии, а не как кажется сверху.", ref: "scoring", keys: "линия касается кольцо меньше" },
      { q: "Диск навис над центром, но не упал — сколько очков?", a: "Это не 20: диск остаётся на доске. Он касается кольца 15 — значит, 15 очков.", ref: "twenty", keys: "навис центр не упал завис" },
      { q: "Что если на доске нет чужих дисков?", a: "Ваш диск должен остановиться в кольце 15 или касаться его линии. Иначе он уходит в кювет.", ref: "no-hiding", keys: "нет дисков соперника" },
      { q: "Считается ли рикошет от столбика?", a: "Да. Задеть чужой диск можно прямо, рикошетом от столбика или через свой диск.", ref: "hit", keys: "рикошет столбик попадание" },
      { q: "Промахнулся по чужому диску, но свой упал в центр — считается?", a: "Нет. При промахе ваш диск и все задетые свои уходят в кювет, даже из центра.", ref: "hit", keys: "промах центр считается" },
      { q: "Сколько очков получают за раунд?", a: "Дома — только лучший и только разницу: 60 против 35 — это 25. В турнире NCA — 2 очка победителю раунда, по 1 при ничьей.", ref: "scoring", keys: "сколько очков разница раунд" },
      { q: "Кто начинает следующий раунд?", a: "Игрок слева от того, кто начинал прошлый.", ref: "next-round", keys: "кто начинает раунд" },
      { q: "Сколько дисков у каждого?", a: "Вдвоём дома (до 100) — по 12. В турнире и «до 9» — по 8, как по правилам NCA и на чемпионате мира. Вчетвером всегда по 6, у пары 12 одного цвета.", ref: "players", keys: "сколько дисков" },
      { q: "Можно ли играть втроём?", a: "Ни один из источников не описывает игру втроём: только вдвоём или две пары.", ref: "players", keys: "втроём три игрока" },
      { q: "Играть до 9 или 11 очков — это по правилам?", a: "До 9 — да: «Race to 9» описан в правилах магазина Crok Shop: 2 очка за раунд, 1 за ничью, кто первым набрал 9 — победил. До 11 нет ни в одном источнике. У NCA и на чемпионате мира партия — 4 раунда.", ref: "end", keys: "до 9 до 11 гонка race" },
      { q: "Диск закатился под доску — что делать?", a: "В русских правилах этого нет. По правилам NCA доску двигают только в конце раунда, а до тех пор бьют уже сыгранным диском, предупредив соперника.", ref: "conduct", keys: "под доску потерялся" },
    ],
  });
})();
