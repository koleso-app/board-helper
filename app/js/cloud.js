/* Sync controller: keeps this device's copy and the encrypted file on GitHub in step.
 * - Every change is saved on the device first, so nothing waits for the network.
 * - A changed device is "pending" (remembered across restarts) until a send succeeds.
 * - Sending is tried shortly after a change, when the connection comes back, when the app
 *   is opened again, and every minute while something is pending.
 * - Before sending, the copy on GitHub is read and merged record by record (sync.js). */
(function () {
  "use strict";
  const BH = window.BH, L = window.BHSync;
  const LS_CFG = "board-helper-sync", LS_PENDING = "board-helper-sync-pending", LS_LAST = "board-helper-sync-last";
  const WHEEL_CFG = "koleso-sync";   // «Колесо недели» on the same site keeps its connection here

  const read = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const write = (k, v) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} };
  const parse = t => { try { return JSON.parse(t); } catch (e) { return null; } };
  const validCfg = c => c && typeof c === "object" && c.owner && c.repo && c.token && typeof c.pass === "string" && c.pass.length >= 8;

  const C = BH.cloud = {
    cfg: validCfg(parse(read(LS_CFG))) ? parse(read(LS_CFG)) : null,
    pending: read(LS_PENDING) === "1",
    status: { state: "idle", msg: "", at: Number(read(LS_LAST)) || 0 },   // idle | busy | ok | offline | error
    listeners: [],
  };
  let busy = false, again = false, timer = null, seq = 0;

  const notify = () => { for (const f of C.listeners) try { f(); } catch (e) {} };
  C.onChange = f => C.listeners.push(f);
  const setPending = v => { C.pending = v; write(LS_PENDING, v ? "1" : null); };
  const setStatus = (state, msg) => {
    C.status = { state, msg: msg || "", at: state === "ok" ? Date.now() : C.status.at };
    if (state === "ok") write(LS_LAST, String(C.status.at));
    notify();
  };

  /* called by the store after every local change */
  C.changed = () => {
    seq++;
    setPending(true);
    notify();
    if (C.cfg) schedule(3000);
  };
  function schedule(ms) { clearTimeout(timer); timer = setTimeout(() => C.syncNow(), ms); }

  /* «Колесо недели» connection on this device, if any (same site, so the same storage) */
  C.wheelCfg = () => {
    const c = parse(read(WHEEL_CFG));
    return c && c.owner && c.repo && c.token ? { owner: String(c.owner), repo: String(c.repo), token: String(c.token), pass: typeof c.pass === "string" ? c.pass : "" } : null;
  };

  C.syncNow = async cfgOverride => {
    const c = cfgOverride || C.cfg;
    if (!c) return false;
    if (busy) { again = true; return false; }
    if (typeof navigator !== "undefined" && navigator.onLine === false) { setStatus("offline"); return false; }
    // the app asks to wait while a round is being entered or a dialog is open
    if (!cfgOverride && BH.uiBusy && BH.uiBusy()) { schedule(4000); return false; }
    busy = true; clearTimeout(timer);
    const startSeq = seq;
    setStatus("busy");
    let ok = false;
    try {
      for (let attempt = 0; attempt < 4 && !ok; attempt++) {
        const { env, sha } = await L.pull(c);
        const remote = env ? BH._normalize(await L.open(env, c.pass)) : null;
        if (remote) {
          const merged = BH._normalize(L.merge(BH.state, remote));
          if (L.stable(L.shared(merged)) !== L.stable(L.shared(BH.state))) {
            const before = L.recordMap(BH.state), after = L.recordMap(merged);
            const news = before.size !== after.size || [...after].some(([k, j]) => before.get(k) !== j);   // not just a new order
            BH.replaceFromSync(merged);
            if (BH.onRemoteData) BH.onRemoteData(news);
          }
          if (L.stable(L.shared(remote)) === L.stable(L.shared(BH.state))) { ok = true; break; }
        }
        ok = await L.push(c, await L.seal(L.shared(BH.state), c.pass, env && env.salt), sha);
      }
      if (ok) {
        if (seq === startSeq) setPending(false);     // nothing new happened while sending
        setStatus("ok");
      } else setStatus("error", "Другое устройство как раз меняет данные. Попробую ещё раз.");
    } catch (e) {
      const offline = e && (e.code === "offline" || e.code === "rate");
      setStatus(offline ? "offline" : "error", (e && e.message) || String(e));
      if (cfgOverride) { busy = false; throw e; }
    }
    busy = false;
    if (again || (C.cfg && C.pending && seq !== startSeq)) { again = false; schedule(800); }
    return ok;
  };

  /* first connection on this device: checks the repository and the password before anything is written */
  C.connect = async (cfg, pass2) => {
    await L.checkRepo(cfg);
    const probe = await L.pull(cfg);
    if (!probe.env && pass2 !== undefined && pass2 !== cfg.pass) throw new Error(pass2 ? "Пароль и повтор не совпадают." : "Это первое устройство: повторите пароль, чтобы не ошибиться в нём.");
    if (probe.env) await L.open(probe.env, cfg.pass);              // a wrong password stops here
    C.connecting = true;
    let ok;
    try { ok = await C.syncNow(cfg); } finally { C.connecting = false; }
    if (!ok) throw new Error(C.status.msg || "не получилось");
    C.cfg = cfg;
    write(LS_CFG, JSON.stringify(cfg));
    setPending(false);
    setStatus("ok");
    return { firstDevice: !probe.env };
  };
  C.disconnect = () => { C.cfg = null; clearTimeout(timer); write(LS_CFG, null); setStatus("idle"); };

  C.label = () => {
    if (!C.cfg) return "";
    const st = C.status.state;
    if (st === "busy") return "Синхронизирую…";
    if (C.pending && (st === "offline" || (typeof navigator !== "undefined" && navigator.onLine === false))) return "Нет связи — изменения сохранены на устройстве и уйдут, когда появится интернет.";
    if (st === "error") return "Ошибка: " + C.status.msg + (C.pending ? " Изменения сохранены на устройстве." : "");
    if (C.pending) return "Есть изменения, которые ещё не отправлены. Отправлю через несколько секунд.";
    if (C.status.at) { const d = new Date(C.status.at); return "Всё отправлено. Последняя синхронизация: " + BH.fmtDate(C.status.at) + ", " + BH.fmtTime(C.status.at) + "."; }
    return "Подключено.";
  };

  /* triggers */
  window.addEventListener("online", () => { if (C.cfg) C.syncNow(); else notify(); });
  window.addEventListener("offline", () => { if (C.cfg) setStatus("offline"); });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && C.cfg) C.syncNow(); });
  // while something waits: every minute; otherwise every 3 minutes, to pick up other devices' games
  let ticks = 0;
  setInterval(() => { ticks++; if (C.cfg && document.visibilityState === "visible" && (C.pending || ticks % 3 === 0)) C.syncNow(); }, 60000);
  setTimeout(() => { if (C.cfg) C.syncNow(); }, 800);
})();
