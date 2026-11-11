/* The "who starts" wheel: one sector per player in their colour; the pointer sits at the top.
   The winner is drawn first (crypto random), then the disc turns so that sector stops under the pointer. */
(function () {
  "use strict";
  const BH = window.BH;
  const W = BH.wheel = {};
  const R = 150, C = 160;

  const pt = (r, a) => [(C + r * Math.sin(a)).toFixed(2), (C - r * Math.cos(a)).toFixed(2)];
  function sector(a0, a1) {
    const [x0, y0] = pt(R, a0), [x1, y1] = pt(R, a1);
    const large = a1 - a0 > Math.PI ? 1 : 0;
    return `M${C} ${C} L${x0} ${y0} A${R} ${R} 0 ${large} 1 ${x1} ${y1} Z`;
  }

  W.html = players => {
    const n = players.length, step = Math.PI * 2 / n;
    let s = "";
    players.forEach((p, i) => {
      const a0 = i * step, a1 = (i + 1) * step, mid = (a0 + a1) / 2;
      s += n === 1 ? `<circle cx="${C}" cy="${C}" r="${R}" style="fill:${p.color}"/>` : `<path d="${sector(a0, a1)}" style="fill:${p.color};stroke:var(--surface);stroke-width:3"/>`;
      // the name runs along the radius, from the hub outwards
      const deg = mid * 180 / Math.PI;
      const name = p.name.length > 11 ? p.name.slice(0, 10) + "…" : p.name;
      const fs = n > 8 ? 13 : 16;
      // on the left half the label is turned the other way so it never reads upside down
      const left = deg > 180;
      s += `<text transform="rotate(${(left ? deg + 90 : deg - 90).toFixed(2)} ${C} ${C})" x="${left ? C - R + 14 : C + R - 14}" y="${C + fs * .35}" text-anchor="${left ? "start" : "end"}"
        style="font-family:var(--f-ui);font-weight:700;font-size:${fs}px;fill:#fff;paint-order:stroke;stroke:rgba(0,0,0,.25);stroke-width:2px">${BH.esc(name)}</text>`;
    });
    return `<div class="wheel">
      <svg class="disc" viewBox="0 0 320 320" role="img" aria-label="Колесо с игроками" style="transform:rotate(${turned}deg)">${s}<circle cx="${C}" cy="${C}" r="${R}" style="fill:none;stroke:var(--ink);stroke-width:4"/></svg>
      <svg class="pointer" viewBox="0 0 34 40" aria-hidden="true"><path d="M17 38 L3 6 Q17 -2 31 6 Z" style="fill:var(--accent);stroke:var(--surface);stroke-width:2.5"/></svg>
      <div class="hub" aria-hidden="true"></div>
    </div>`;
  };

  function randomIndex(n) {
    const a = new Uint32Array(1);
    (window.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : (a[0] = Math.floor(Math.random() * 2 ** 32));
    return a[0] % n;
  }

  let turned = 0; // degrees, kept between spins so the disc never jumps back
  W.reset = () => { turned = 0; };
  W.spin = (root, n, done) => {
    const disc = root.querySelector("svg.disc");
    if (!disc || n < 1) return;
    const win = randomIndex(n), step = 360 / n;
    const jitter = (Math.random() - .5) * step * .7;            // not always dead centre
    const centre = (win + .5) * step + jitter;
    const current = ((turned % 360) + 360) % 360;
    let delta = (360 - centre) - current;                      // bring that angle under the pointer
    delta = ((delta % 360) + 360) % 360;
    turned += 360 * 5 + delta;
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let finished = false;
    const finish = () => { if (finished) return; finished = true; done(win); };
    disc.addEventListener("transitionend", finish, { once: true });
    setTimeout(finish, reduce ? 60 : 4600);
    requestAnimationFrame(() => { disc.style.transform = `rotate(${turned}deg)`; });
  };
})();
