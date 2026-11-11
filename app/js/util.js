/* Small helpers shared by every module. Everything hangs off window.BH. */
(function () {
  "use strict";
  const BH = window.BH = window.BH || {};

  BH.uid = () => Date.now().toString(36).slice(-4) + Math.random().toString(36).slice(2, 8);
  BH.esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  BH.$ = (sel, root) => (root || document).querySelector(sel);
  BH.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  BH.clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // Player colours: distinct on both themes, white initials readable on each.
  BH.COLORS = ["#D9483B", "#2F74D0", "#22995A", "#D9A21B", "#8A4FD3", "#E07B2E", "#0F9A9A", "#D6458F", "#7A5A44", "#5F6B78"];

  const MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
  BH.fmtDate = ts => { const d = new Date(ts); return d.getDate() + " " + MONTHS[d.getMonth()] + (d.getFullYear() !== new Date().getFullYear() ? " " + d.getFullYear() : ""); };
  // numbers with a real minus sign: −6, and with a sign either way: +12 / −6
  BH.minus = n => (Number(n) < 0 ? "−" + Math.abs(Number(n)) : String(n));
  BH.signed = n => (Number(n) < 0 ? "−" + Math.abs(Number(n)) : "+" + Number(n));
  BH.fmtTime = ts => { const d = new Date(ts); return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); };
  BH.fmtDuration = ms => { const m = Math.round(ms / 60000); if (m < 1) return "меньше минуты"; if (m < 60) return m + " мин"; const h = Math.floor(m / 60), r = m % 60; return h + " ч" + (r ? " " + r + " мин" : ""); };

  // Russian plural: plural(5, "раунд", "раунда", "раундов") -> "раундов"
  BH.plural = (n, one, few, many) => {
    const a = Math.abs(n) % 100, b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
  };

  BH.initials = name => {
    const parts = String(name || "?").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    return (parts.length > 1 ? parts[0][0] + parts[1][0] : parts[0].slice(0, 2)).toUpperCase();
  };
  BH.avatar = (p, cls) => `<span class="avatar ${cls || ""}" style="background:${BH.esc(p ? p.color : "#888")}" aria-hidden="true">${BH.esc(BH.initials(p ? p.name : "?"))}</span>`;

  BH.ICON = {
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
    up: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>',
    down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
    x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    speak: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v4h4l5 4V6L8 10H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>',
    stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
    book: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5z"/><path d="M4 5.5v16"/></svg>',
    search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/></svg>',
    undo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/></svg>',
    edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4z"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    wheel: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17M3.5 12h17M6 6l12 12M18 6L6 18"/></svg>',
    flag: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></svg>',
    trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
    gear: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/></svg>',
  };

  let toastTimer = null;
  BH.clearToast = () => { clearTimeout(toastTimer); const r = document.getElementById("toast-root"); if (r) r.innerHTML = ""; };
  BH.toast = (text, action) => {
    const root = document.getElementById("toast-root");
    if (!root) return;
    clearTimeout(toastTimer);
    root.innerHTML = `<div class="toast"><span>${BH.esc(text)}</span>${action ? `<button type="button">${BH.esc(action.label)}</button>` : ""}</div>`;
    if (action) root.querySelector("button").addEventListener("click", () => { root.innerHTML = ""; action.run(); });
    toastTimer = setTimeout(() => { root.innerHTML = ""; }, action ? 6000 : 3200);
  };
})();
