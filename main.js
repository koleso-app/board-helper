// Помощник настолок — the PC program: one window around app/. Data lives in the window's
// localStorage inside the program's own folder (%APPDATA%\BoardHelper).
const { app, BrowserWindow, Menu, shell, nativeTheme, session } = require("electron");
const path = require("path");

app.setName("BoardHelper");
app.setAppUserModelId("com.yomigo.board-helper");

// Developer self-check: BH_SMOKE=<dir> opens the app with throwaway data, saves a screenshot, quits.
const SMOKE = process.env.BH_SMOKE;
if (SMOKE) app.setPath("userData", path.join(app.getPath("temp"), "bh-smoke-" + Date.now()));

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
let win = null;
const INDEX = require("url").pathToFileURL(path.join(__dirname, "app", "index.html")).href;

function createWindow() {
  win = new BrowserWindow({
    width: 1180, height: 820, minWidth: 380, minHeight: 560,
    title: "Помощник настолок",
    icon: path.join(__dirname, "app", "icons", "icon.png"),
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#15130F" : "#F4EFE6",
    autoHideMenuBar: true,
    show: !SMOKE,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, "app", "index.html"));
  // links to the web open in the normal browser, never inside the program
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: "deny" }; });
  // only the app's own page may load in the window (a file dropped onto it must not replace the app)
  win.webContents.on("will-navigate", (e, url) => {
    if (url.split("#")[0].split("?")[0] === INDEX) return;
    e.preventDefault();
    if (/^https?:/i.test(url)) shell.openExternal(url);
  });
  win.webContents.on("before-input-event", (_e, input) => {
    if (input.type === "keyDown" && (input.key === "F12" || (input.control && input.shift && input.key.toLowerCase() === "i"))) win.webContents.toggleDevTools();
  });
  if (SMOKE) win.webContents.once("did-finish-load", () => setTimeout(async () => {
    const fs = require("fs");
    fs.mkdirSync(SMOKE, { recursive: true });
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(SMOKE, "home.png"), img.toPNG());
    app.quit();
  }, 1500));
}

app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(() => {
  if (!gotLock) return;
  // nothing is granted yet; the microphone will be allowed here when voice questions arrive
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, cb) => cb(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  createWindow();
});
app.on("window-all-closed", () => app.quit());
