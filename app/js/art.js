/* Tiny SVG kit for setup illustrations. Schematic drawings, not the publisher's artwork:
   generic cards, decks and a table, coloured from the app theme so they work light and dark. */
(function () {
  "use strict";
  const BH = window.BH;
  const esc = BH.esc;

  const art = BH.art = {};
  art.svg = (inner, vb) => `<svg viewBox="${vb || "0 0 320 240"}" xmlns="http://www.w3.org/2000/svg" role="img" aria-hidden="true">${inner}</svg>`;

  /* one card: front with a big label, or the back (stripes) */
  art.card = o => {
    const w = o.w || 56, h = o.h || 78, x = o.x || 0, y = o.y || 0, r = o.rot || 0;
    const cx = x + w / 2, cy = y + h / 2;
    const tr = r ? ` transform="rotate(${r} ${cx} ${cy})"` : "";
    if (o.back) {
      return `<g${tr}><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="7" style="fill:${o.backColor || "#2B3A55"};stroke:var(--surface);stroke-width:2"/>
        <rect x="${x + 6}" y="${y + 6}" width="${w - 12}" height="${h - 12}" rx="4" style="fill:none;stroke:rgba(255,255,255,.35);stroke-width:1.5;stroke-dasharray:3 3"/>
        <circle cx="${cx}" cy="${cy}" r="${Math.min(w, h) / 6}" style="fill:rgba(255,255,255,.25)"/></g>`;
    }
    const fs = o.size || (String(o.label).length > 2 ? h * .3 : h * .42);
    return `<g${tr}><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="7" style="fill:${o.bg || "#FFF8EC"};stroke:${o.stroke || "rgba(0,0,0,.18)"};stroke-width:1.5"/>
      <text x="${cx}" y="${cy + fs * .36}" text-anchor="middle" style="font-family:var(--f-display);font-weight:700;font-size:${fs}px;fill:${o.color || "#1E1B16"}">${esc(o.label)}</text>
      ${o.corner ? `<text x="${x + 7}" y="${y + 14}" style="font-family:var(--f-display);font-weight:700;font-size:10px;fill:${o.color || "#1E1B16"}">${esc(o.corner)}</text>` : ""}</g>`;
  };

  /* a face-down pile */
  art.deck = (x, y, n, o) => {
    o = o || {};
    let s = "";
    for (let i = 0; i < (n || 5); i++) s += art.card({ x: x + i * 1.6, y: y - i * 1.6, w: o.w, h: o.h, back: true, backColor: o.backColor });
    return s;
  };

  art.table = () => `<rect x="10" y="10" width="300" height="220" rx="26" style="fill:var(--surface);stroke:var(--line);stroke-width:2"/>`;
  art.label = (x, y, text, anchor) => `<text x="${x}" y="${y}" text-anchor="${anchor || "middle"}" style="font-family:var(--f-ui);font-weight:600;font-size:13px;fill:var(--muted)">${esc(text)}</text>`;
  art.arrow = (x1, y1, x2, y2) => `<path d="M${x1} ${y1} L${x2} ${y2}" style="stroke:var(--accent);stroke-width:3;fill:none;stroke-linecap:round" marker-end="url(#ah)"/>`;
  art.defs = () => `<defs><marker id="ah" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" style="fill:var(--accent)"/></marker></defs>`;
  art.dashedSlot = (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w || 56}" height="${h || 78}" rx="7" style="fill:none;stroke:var(--muted);stroke-width:1.8;stroke-dasharray:5 4"/>`;
  art.person = (x, y, color) => `<g><circle cx="${x}" cy="${y}" r="11" style="fill:${color}"/><path d="M${x - 18} ${y + 30} a18 16 0 0 1 36 0z" style="fill:${color}"/></g>`;
})();
