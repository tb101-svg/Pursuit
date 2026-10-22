// Pursuit's desktop shell. It starts the app's server (the standalone Next
// build in resources/server) with Electron's own Node, then shows it in a
// window. Closing the window keeps Pursuit in the tray so email keeps
// syncing; Quit from the tray stops everything.

const { app, BrowserWindow, Menu, Tray, dialog, nativeImage, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

const PREFERRED_PORT = 47100;
const ALLOWED_HOSTS = ["login.microsoftonline.com", "login.live.com", "accounts.google.com"]; // sign-in pages stay in the window

let server = null;
let win = null;
let tray = null;
let url = null;
let quitting = false;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => show());
  app.whenReady().then(start);
}

const serverDir = () => (app.isPackaged ? path.join(process.resourcesPath, "server") : path.join(__dirname, "..", "dist-desktop", "server"));
const dataDir = () => path.join(app.getPath("userData"), "data");
const iconPath = () => path.join(serverDir(), "public", "icons", "icon-192.png");

/** Optional settings file (data/pursuit.env, KEY=value lines) for things like MICROSOFT_CLIENT_ID. */
function readEnvFile() {
  const file = path.join(dataDir(), "pursuit.env");
  const env = {};
  if (!fs.existsSync(file)) return env;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return env;
}

/** The usual port if it's free (so links and the Claude connection stay the same), else any free one. */
function pickPort() {
  const tryPort = (port) =>
    new Promise((resolve) => {
      const s = net.createServer();
      s.once("error", () => resolve(null));
      s.listen(port, "127.0.0.1", () => s.close(() => resolve(port)));
    });
  return tryPort(PREFERRED_PORT).then((p) =>
    p ??
    new Promise((resolve) => {
      const s = net.createServer();
      s.listen(0, "127.0.0.1", () => {
        const { port } = s.address();
        s.close(() => resolve(port));
      });
    }),
  );
}

function waitForServer(target, ms = 60_000) {
  const until = Date.now() + ms;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      http
        .get(target, (res) => {
          res.resume();
          resolve();
        })
        .on("error", () => (Date.now() > until ? reject(new Error("Pursuit's server didn't start.")) : setTimeout(attempt, 300)));
    };
    attempt();
  });
}

function startServer(port) {
  fs.mkdirSync(path.join(dataDir(), "logs"), { recursive: true });
  const log = fs.createWriteStream(path.join(dataDir(), "logs", "server.log"), { flags: "a" });
  log.write(`\n--- ${new Date().toISOString()} starting on port ${port}\n`);
  server = spawn(process.execPath, [path.join(serverDir(), "server.js")], {
    cwd: serverDir(),
    windowsHide: true,
    env: {
      ...process.env,
      ...readEnvFile(),
      // Run Electron's binary as plain Node; child processes (transcription) inherit this too.
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      PURSUIT_DATA_DIR: dataDir(),
    },
  });
  server.stdout.pipe(log);
  server.stderr.pipe(log);
  server.on("exit", (code) => {
    server = null;
    if (!quitting) {
      dialog.showErrorBox("Pursuit stopped", `Pursuit's server stopped unexpectedly (code ${code}). Details are in:\n${path.join(dataDir(), "logs", "server.log")}`);
      app.quit();
    }
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 380,
    minHeight: 560,
    title: "Pursuit",
    icon: iconPath(),
    backgroundColor: "#0b0d12",
    autoHideMenuBar: true,
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  // Links to other sites open in the normal browser.
  const isInternal = (target) => {
    try {
      const u = new URL(target);
      return u.origin === new URL(url).origin || ALLOWED_HOSTS.includes(u.hostname);
    } catch {
      return false;
    }
  };
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:/.test(target)) shell.openExternal(target);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, target) => {
    if (url && !isInternal(target)) {
      event.preventDefault();
      shell.openExternal(target);
    }
  });
  win.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      win.hide();
    }
  });
  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(LOADING_PAGE)}`);
}

function show() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(iconPath()).resize({ width: 16, height: 16 }));
  tray.setToolTip("Pursuit");
  const menu = () =>
    Menu.buildFromTemplate([
      { label: "Open Pursuit", click: show },
      { type: "separator" },
      {
        label: "Start Pursuit when I sign in",
        type: "checkbox",
        checked: app.getLoginItemSettings().openAtLogin,
        click: (item) => {
          app.setLoginItemSettings({ openAtLogin: item.checked, args: ["--hidden"] });
          tray.setContextMenu(menu());
        },
      },
      { label: "Open data folder", click: () => shell.openPath(dataDir()) },
      { type: "separator" },
      { label: "Quit Pursuit", click: () => app.quit() },
    ]);
  tray.setContextMenu(menu());
  tray.on("click", show);
}

async function start() {
  Menu.setApplicationMenu(null);
  createWindow();
  createTray();
  if (!process.argv.includes("--hidden")) win.once("ready-to-show", () => win.show());
  try {
    const port = await pickPort();
    url = `http://127.0.0.1:${port}`;
    startServer(port);
    await waitForServer(`${url}/manifest.webmanifest`);
    await win.loadURL(url);
  } catch (err) {
    dialog.showErrorBox("Pursuit couldn't start", `${err.message}\n\nDetails are in:\n${path.join(dataDir(), "logs", "server.log")}`);
    app.quit();
    return;
  }
  checkForUpdates();
}

/** Updates come from the release feed set in electron-builder's publish settings; without one, this does nothing. */
function checkForUpdates() {
  if (!app.isPackaged || !fs.existsSync(path.join(process.resourcesPath, "app-update.yml"))) return;
  try {
    const { autoUpdater } = require("electron-updater");
    autoUpdater.checkForUpdatesAndNotify().catch(() => undefined);
  } catch {
    // Updates are optional; never block the app on them.
  }
}

app.on("before-quit", () => {
  quitting = true;
  if (server) server.kill();
});
app.on("window-all-closed", () => {
  // Stay in the tray.
});

const LOADING_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>Pursuit</title>
<style>html,body{height:100%;margin:0;background:#0b0d12;color:#e8eaf0;font:15px system-ui,sans-serif}
body{display:flex;align-items:center;justify-content:center;flex-direction:column;gap:14px}
.dot{width:10px;height:10px;border-radius:50%;background:#6e8bff;animation:p 1s ease-in-out infinite alternate}
@keyframes p{from{opacity:.25}to{opacity:1}}</style></head>
<body><div class="dot"></div><div>Starting Pursuit…</div></body></html>`;
