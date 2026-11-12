/* The chances to win a game played in scored rounds to a target or for a number of rounds (Flip 7, Vengeance, Crokinole).
   How: the game is played to its end many times over from where it stands now, every round drawn from the rounds that were
   really played (a bootstrap); a player's share of the wins is their chance.
   - Each player scores on their own (Flip 7): a round's score is drawn from that player's own past rounds of this game,
     mixed with everybody's in proportion to how few of their own there are (n of their own against K of the pool).
   - Two sides settle each round between them (Crokinole, g.sideScore): what each side counted on the board in a round
     (the discs by zones, or the number written in by hand) is drawn the same way, and the game's own rule settles the round
     (the difference, or 2/1/0).
   The end as the app plays it: a tournament after its rounds (a tie there is a draw, shown apart); a game to a target at the
   end of the round when someone reaches it — and on a tie at the top more rounds until one leads, as after «Сыграть ещё
   раунд» (during that extra round the chances are shown too).
   Only rounds of the same kind count (g.chances.key: Vengeance's brutal mode, Crokinole's number of discs, pairs), and only
   games of two sides or more. Not shown before MIN_ROUNDS rounds, with one side, or when the game is over.
   The rounds are drawn independently: what one player's round does to the others' (a Flip 7 ends it for everyone) is not
   seen — the numbers are an estimate, and the window says so. */
(function () {
  "use strict";
  const BH = window.BH;
  const C = BH.chances = {};
  C.SIMS = 2000; C.K = 8; C.MIN_ROUNDS = 8; C.MAX_ROUNDS = 80;
  C.EVEN = 0.04;   // closer than this is «about even»: the noise of 2000 replays is a percent or two

  // a small seeded generator: the same game in the same state gives the same numbers on every redraw
  function rng(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  const hash = str => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

  const keyOf = (g, ctx) => (g.chances && g.chances.key ? String(g.chances.key(ctx)) : "all");
  // a side's count on the board in one round, as the round sheet counts it: the number written in, or the discs by zones —
  // zones with no discs are not stored, so a side with nothing on the board has no counts at all: that is 0
  const rawOf = (g, rd, sd) => {
    const d = rd.detail && rd.detail[sd[0]];
    if (!d) return null;
    if (d.manual !== null && d.manual !== undefined && d.manual !== "") return Math.max(0, Math.round(Number(d.manual)) || 0);
    const counts = (d.sel && d.sel.counts) || {};
    return g.sideScore.zones.reduce((a, z) => a + z.z * (Number(counts[z.z]) || 0), 0);
  };

  /* what can be drawn from: per player and for everybody, from the rounds of the sessions of this game of the same kind */
  C.pools = (s, g) => {
    const ctx = BH.ctxOf(s), key = keyOf(g, ctx), own = {}, all = [];
    let rounds = 0, games = 0;
    for (const x of BH.state.sessions) {
      if (x.gameId !== s.gameId || !x.rounds || !x.rounds.length || BH.hasFinal(x)) continue;
      const sides = BH.sidesOf(x);
      if (sides.length < 2 || keyOf(g, BH.ctxOf(x)) !== key) continue;   // a solo challenge is another game
      let used = false;
      for (const rd of x.rounds) {
        let any = false;
        if (g.sideScore) {
          for (const sd of sides) {
            const v = rawOf(g, rd, sd); if (v === null) continue;
            any = true; all.push(v); for (const id of sd) (own[id] = own[id] || []).push(v);
          }
        } else {
          for (const id of x.players) {
            const v = Number(rd.scores && rd.scores[id]); if (!Number.isFinite(v)) continue;
            any = true; all.push(v); (own[id] = own[id] || []).push(v);
          }
        }
        if (any) { rounds++; used = true; }
      }
      if (used) games++;
    }
    return { own, all, rounds, games };
  };

  // one draw for a side: its own past with weight n/(n+K), otherwise anyone's (a pair's rounds are kept for both partners)
  const drawer = (pools, sd, rand) => {
    const mine = [].concat(...sd.map(id => pools.own[id] || [])), n = mine.length, w = n / sd.length / (n / sd.length + C.K);
    return () => (n && rand() < w ? mine[Math.floor(rand() * n)] : pools.all[Math.floor(rand() * pools.all.length)]);
  };

  let cache = { key: "", val: null };
  /* the chances: null when there is nothing honest to say;
     else { sides: [{ ids, p }] best first, tie: the chance of a draw (a tournament), rounds, games } */
  C.of = (s, g) => {
    g = g || BH.game(s.gameId);
    const sc = g && g.scoring;
    if (!sc || sc.type !== "rounds" || s.status !== "playing" || BH.hasFinal(s)) return null;
    const ctx = BH.ctxOf(s), target = BH.targetOf(g, ctx), count = BH.roundsOf(g, ctx);
    if (!target && !count) return null;
    const sides = BH.sidesOf(s);
    if (sides.length < 2) return null;
    // over — unless it is a tie at the target and the table plays on («Сыграть ещё раунд»)
    const end = BH.checkEnd(s), playOn = end.over && end.tie && !count && s.continueTie && s.rounds.length <= s.continueTie;
    if (end.over && !playOn) return null;
    const pools = C.pools(s, g);
    if (pools.rounds < C.MIN_ROUNDS || !pools.all.length) return null;

    const low = !!sc.lowerWins, tot = BH.totals(s), start = sides.map(sd => tot[sd[0]]);
    const key = [s.id, s.gameId, s.rounds.length, start.join(","), pools.all.length, pools.all.reduce((a, v) => a + v, 0), playOn ? 1 : 0, sides.map(sd => sd.join("+")).join(" ")].join("|");
    if (cache.key === key) return cache.val;

    const rand = rng(hash(key)), draw = sides.map(sd => drawer(pools, sd, rand));
    const wins = sides.map(() => 0);
    let ties = 0;
    const topOf = t => { const best = low ? Math.min(...t) : Math.max(...t); return t.map((v, i) => (v === best ? i : -1)).filter(i => i >= 0); };
    for (let k = 0; k < C.SIMS; k++) {
      const t = start.slice();
      let top = null;
      for (let r = s.rounds.length; r < s.rounds.length + C.MAX_ROUNDS; r++) {
        if (g.sideScore) { const got = g.sideScore.settle(draw.map(f => f()), ctx); got.forEach((v, i) => { t[i] += Number(v) || 0; }); }
        else for (let i = 0; i < t.length; i++) t[i] += draw[i]();
        // a tournament ends after its rounds; a game to a target — at the end of the round when someone reaches it,
        // with one leader (a tie at the top plays on)
        if (count) { if (r + 1 >= count) { top = topOf(t); break; } continue; }
        if (playOn || t.some(v => v >= target)) { const tp = topOf(t); if (tp.length === 1) { top = tp; break; } }
      }
      if (!top) top = topOf(t);   // the replay ran out of rounds: whoever leads then
      if (top.length === 1) wins[top[0]]++; else ties++;
    }
    const out = sides.map((ids, i) => ({ ids, p: wins[i] / C.SIMS }));
    out.sort((a, b) => b.p - a.p || s.players.indexOf(a.ids[0]) - s.players.indexOf(b.ids[0]));
    const val = { sides: out, tie: ties / C.SIMS, rounds: pools.rounds, games: pools.games };
    cache = { key, val };
    return val;
  };

  /* chances as people say them: whole percents that add up to 100 (the largest remainders get the leftover points),
     «<1%» for a chance that rounds to nothing, «>99%» for one that rounds to all */
  C.pcts = ps => {
    const raw = ps.map(p => p * 100), fl = raw.map(Math.floor);
    let left = 100 - fl.reduce((a, v) => a + v, 0);
    raw.map((v, i) => [v - fl[i], i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0 && ps[i] > 0) { fl[i]++; left--; } });
    return fl.map((v, i) => (ps[i] > 0 && v === 0 ? "<1%" : ps[i] < 1 && v === 100 ? ">99%" : v + "%"));
  };
  // the favourites: everyone within EVEN of the best
  C.favourites = ch => ch.sides.filter(sd => sd.p >= ch.sides[0].p - C.EVEN);
})();
