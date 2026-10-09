const {
  app,
  BrowserWindow,
  Menu,
  dialog,
  shell,
  session,
  systemPreferences,
} = require("electron");
const { ownedFrame, allowRequest } = require("./media-permissions.cjs");
const { imageContextMenu } = require("./context-menu.cjs");
const { fork } = require("node:child_process");
const {
  mkdirSync,
  createWriteStream,
  readFileSync,
  writeFileSync,
} = require("node:fs");
const { randomBytes } = require("node:crypto");
const path = require("node:path");

app.setName("AutoPPT");
// Test instances can have an isolated profile; never bundle somebody's projects.
if (process.env.AUTOPPT_DESKTOP_PROFILE)
  app.setPath("userData", path.resolve(process.env.AUTOPPT_DESKTOP_PROFILE));
const root = path.resolve(__dirname, "..");
const dataDir = path.join(app.getPath("userData"), "workspace");
const portFile = path.join(app.getPath("userData"), "local-port.json");
let backend,
  window,
  origin,
  quitting = false,
  checkingQuit = false;
const token = randomBytes(32).toString("hex");
const ownedURL = (url) => {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
};
const external = (url) => {
  if (/^https?:\/\//.test(url)) shell.openExternal(url);
};

function startBackend() {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const log = createWriteStream(
    path.join(app.getPath("userData"), "server.log"),
    { flags: "a", mode: 0o600 },
  );
  const env = { ...process.env };
  let savedPort = 0;
  try {
    const value = JSON.parse(readFileSync(portFile, "utf8")).port;
    if (Number.isInteger(value) && value >= 1024 && value <= 65535)
      savedPort = value;
  } catch {
    /* The first launch gets a free port from the OS. */
  }
  // Desktop always uses personal settings, regardless of the launching shell.
  for (const name of Object.keys(env))
    if (name.startsWith("AUTOPPT_") || name.startsWith("OPENAI_"))
      delete env[name];
  Object.assign(env, {
    NODE_ENV: "production",
    ELECTRON_RUN_AS_NODE: "1",
    PORT: String(savedPort),
    AUTOPPT_DATA_DIR: dataDir,
    AUTOPPT_DESKTOP_TOKEN: token,
  });
  backend = fork(path.join(root, "server/index.mjs"), [], {
    cwd: root,
    env,
    execArgv: [],
    silent: true,
  });
  backend.stdout.pipe(log, { end: false });
  backend.stderr.pipe(log, { end: false });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("本机工作区启动超时。")),
      30000,
    );
    backend.once("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    backend.on("message", (message) => {
      if (message.type !== "ready") return;
      clearTimeout(timer);
      origin = `http://127.0.0.1:${message.port}`;
      // Stable origin preserves drafts and UI preferences across app restarts.
      writeFileSync(portFile, JSON.stringify({ port: message.port }), {
        mode: 0o600,
      });
      resolve();
    });
    backend.once("exit", (code) => {
      clearTimeout(timer);
      log.end();
      if (!origin) reject(new Error(`本机工作区启动失败（${code}）。`));
      else if (!quitting) {
        dialog.showErrorBox(
          "工作区已停止",
          "请重新打开 AutoPPT。已保存的内容仍在本机。",
        );
        quitting = true;
        app.quit();
      }
    });
  });
}
function showWindow() {
  if (window && !window.isDestroyed()) {
    window.show();
    window.focus();
    return;
  }
  window = new BrowserWindow({
    title: "AutoPPT",
    width: 1360,
    height: 900,
    minWidth: 960,
    minHeight: 680,
    backgroundColor: "#f6f5f1",
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  window.once("ready-to-show", () => window.show());
  window.webContents.on("context-menu", (_event, params) => {
    const items = imageContextMenu(window.webContents, params, ownedURL);
    if (items.length) Menu.buildFromTemplate(items).popup({ window });
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (!ownedURL(url)) {
      event.preventDefault();
      external(url);
    }
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (ownedURL(url) && new URL(url).pathname.startsWith("/intro/"))
      window.webContents.executeJavaScript("location.hash = 'intro'");
    else if (ownedURL(url)) window.loadURL(url);
    else external(url);
    return { action: "deny" };
  });
  window.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      window.hide();
    }
  });
  window.loadURL(origin);
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    if (origin) showWindow();
  });
  app.on("activate", () => {
    if (origin) showWindow();
  });
  app
    .whenReady()
    .then(async () => {
      await startBackend();
      let microphoneGranted = false;
      session.defaultSession.setPermissionRequestHandler(
        async (web, permission, callback, details) => {
          if (!allowRequest(origin, web, permission, details))
            return callback(false);
          if (permission === "fullscreen") return callback(true);
          try {
            microphoneGranted =
              process.platform !== "darwin" ||
              (await systemPreferences.askForMediaAccess("microphone"));
            callback(microphoneGranted);
          } catch {
            callback(false);
          }
        },
      );
      session.defaultSession.setPermissionCheckHandler(
        (web, permission, requestingOrigin, details) =>
          ownedFrame(origin, web, details) &&
          ownedURL(requestingOrigin) &&
          (permission === "fullscreen" ||
            (permission === "media" &&
              details.mediaType === "audio" &&
              microphoneGranted)),
      );
      session.defaultSession.webRequest.onBeforeSendHeaders(
        (details, callback) => {
          // Only this app's own loopback service receives its per-launch secret.
          if (ownedURL(details.url))
            details.requestHeaders["X-AutoPPT-Desktop"] = token;
          callback({ requestHeaders: details.requestHeaders });
        },
      );
      const navigate = (route) => {
        showWindow();
        window.webContents.executeJavaScript(
          `location.hash = ${JSON.stringify(route)}`,
        );
      };
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([
          {
            label: "AutoPPT",
            submenu: [
              { role: "about", label: "关于 AutoPPT" },
              {
                label: "设置…",
                accelerator: "CmdOrCtrl+,",
                click: () => navigate("settings"),
              },
              { label: "打开工作区", click: showWindow },
              { label: "打开数据文件夹", click: () => shell.openPath(dataDir) },
              { type: "separator" },
              { role: "hide", label: "隐藏 AutoPPT" },
              { role: "quit", label: "退出 AutoPPT" },
            ],
          },
          {
            label: "编辑",
            submenu: [
              { role: "undo" },
              { role: "redo" },
              { type: "separator" },
              { role: "cut" },
              { role: "copy" },
              { role: "paste" },
              { role: "selectAll" },
            ],
          },
          {
            label: "显示",
            submenu: [
              { label: "我的演讲", click: () => navigate("projects") },
              {
                label: "风格库",
                click: () => navigate("styles"),
              },
              {
                label: "返回上一页",
                accelerator: "CmdOrCtrl+[",
                click: () => window.webContents.navigationHistory.goBack(),
              },
              { role: "reload", label: "刷新" },
              { role: "resetZoom" },
              { role: "zoomIn" },
              { role: "zoomOut" },
              { role: "togglefullscreen" },
            ],
          },
          { role: "windowMenu", label: "窗口" },
          {
            role: "help",
            label: "帮助",
            submenu: [
              { label: "AutoPPT 使用帮助", click: () => navigate("help") },
              { label: "产品介绍", click: () => navigate("intro") },
            ],
          },
        ]),
      );
      showWindow();
    })
    .catch((e) => {
      dialog.showErrorBox(
        "AutoPPT 无法启动",
        `${e.message}\n日志位于 ${app.getPath("userData")}/server.log`,
      );
      quitting = true;
      app.quit();
    });
  app.on("before-quit", (event) => {
    if (quitting) return;
    event.preventDefault();
    if (checkingQuit) return;
    checkingQuit = true;
    (async () => {
      let busy = true;
      try {
        const response = await fetch(origin + "/api/desktop/status", {
          headers: { "X-AutoPPT-Desktop": token },
          signal: AbortSignal.timeout(3000),
        });
        const data = await response.json();
        busy = data.activeJobs > 0;
      } catch {
        /* Confirm before a potentially interrupting shutdown. */
      }
      if (busy) {
        const result = await dialog.showMessageBox({
          type: "question",
          message: "退出会中断尚未完成的制作任务。",
          detail: "已保存内容会保留。也可以关闭窗口，让任务继续在后台运行。",
          buttons: ["继续制作", "退出 App"],
          defaultId: 0,
          cancelId: 0,
        });
        if (result.response !== 1) return;
      }
      quitting = true;
      app.quit();
    })().finally(() => {
      checkingQuit = false;
    });
  });
  app.on("will-quit", () => {
    backend?.kill();
  });
}
