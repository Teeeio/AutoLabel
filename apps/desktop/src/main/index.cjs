const { app, BrowserWindow, ipcMain, session, protocol, webContents } = require("electron");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { runGeneration } = require("./generator.cjs");
const {
  getVideoInfo,
  resolvePreviewUrl,
  prefetchPreviewChunks,
  getDashInfo,
  fetchDashSegment
} = require("./preview.cjs");
const {
  getAuthStatus,
  getCookieFilePath,
  loginWithQr,
  setRawCookie,
  getRawCookie,
  clearRawCookie,
  applyRawCookieToPartition
} = require("./auth.cjs");

protocol.registerSchemesAsPrivileged([
  {
    scheme: "rdg",
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true }
  }
]);

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

const isDev = !!process.env.VITE_DEV_SERVER_URL;
const registeredWebviews = new Set();
const FRAME_INJECT_SCRIPT = `
(() => {
  const keepSel = "#bilibili-player > div > div > div.bpx-player-primary-area > div.bpx-player-video-area";
  const ancestorClass = "rdg-keep-ancestor";
  const targetClass = "rdg-keep-target";
  const rootClass = "rdg-keep-mode";

  const apply = () => {
    const keep = document.querySelector(keepSel);
    if (!keep) return false;

    let node = keep;
    while (node) {
      if (node.classList) node.classList.add(ancestorClass);
      node = node.parentElement;
    }
    keep.classList.add(targetClass);
    document.documentElement.classList.add(rootClass);

    if (!document.getElementById("rdg-keep-style")) {
      const style = document.createElement("style");
      style.id = "rdg-keep-style";
      style.textContent = \`
        html, body {
          margin: 0;
          width: 100%;
          height: 100%;
          background: #000;
          overflow: hidden;
        }
        html.\${rootClass} body * {
          visibility: hidden !important;
          pointer-events: none !important;
        }
        html.\${rootClass} .\${ancestorClass} {
          visibility: visible !important;
        }
        html.\${rootClass} .\${targetClass},
        html.\${rootClass} .\${targetClass} * {
          visibility: visible !important;
          pointer-events: auto !important;
        }
        html.\${rootClass} .\${targetClass} {
          position: fixed !important;
          inset: 0 !important;
          width: 100% !important;
          height: 100% !important;
          background: #000 !important;
        }
      \`;
      document.head.appendChild(style);
    }
    return true;
  };

  if (apply()) return;
  const observer = new MutationObserver(() => {
    if (apply()) observer.disconnect();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  setTimeout(() => {
    if (apply()) observer.disconnect();
  }, 5000);
})();
`;

function injectIntoFrames(wc) {
  if (!wc || (typeof wc.isDestroyed === "function" && wc.isDestroyed())) return;
  if (!wc.mainFrame) return;
  const frames = [wc.mainFrame, ...wc.mainFrame.frames];
  frames.forEach((frame) => {
    if (!frame) return;
    if (typeof frame.isDestroyed === "function" && frame.isDestroyed()) return;
    frame.executeJavaScript(FRAME_INJECT_SCRIPT, true).catch(() => {});
  });
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true
    }
  });

  if (isDev) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    const indexHtml = path.join(__dirname, "..", "..", "..", "webui", "dist", "index.html");
    mainWindow.loadFile(indexHtml);
  }
}

function configureMediaHeaders() {
  const ses = session.defaultSession;
  if (!ses) return;
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const url = details.url || "";
    if (url.includes("bilivideo.com") || url.includes("bilibili.com")) {
      details.requestHeaders["Referer"] = "https://www.bilibili.com/";
      details.requestHeaders["Origin"] = "https://www.bilibili.com";
    }
    callback({ requestHeaders: details.requestHeaders });
  });
}

ipcMain.handle("generator:run", async (event, payload) => {
  const sendProgress = (data) => event.sender.send("generator:progress", data);
  const result = await runGeneration(payload, sendProgress);
  return {
    ...result,
    payload
  };
});

ipcMain.handle("preview:resolve", async (_event, payload) => {
  const cookiePath = getCookieFilePath();
  const rawCookie = await getRawCookie();
  const result = await resolvePreviewUrl({ ...payload, cookiePath, rawCookie });
  return result;
});

ipcMain.handle("preview:info", async (_event, payload) => {
  const cookiePath = getCookieFilePath();
  const rawCookie = await getRawCookie();
  const result = await getVideoInfo({ ...payload, cookiePath, rawCookie });
  return result;
});

ipcMain.handle("preview:prefetch", async (_event, payload) => {
  const cookiePath = getCookieFilePath();
  const rawCookie = await getRawCookie();
  const result = await prefetchPreviewChunks({ ...payload, cookiePath, rawCookie });
  return result;
});

ipcMain.handle("preview:dash:info", async (_event, payload) => {
  const cookiePath = getCookieFilePath();
  const rawCookie = await getRawCookie();
  const result = await getDashInfo({ ...payload, cookiePath, rawCookie });
  return result;
});

ipcMain.handle("preview:dash:segment", async (_event, payload) => {
  const cookiePath = getCookieFilePath();
  const rawCookie = await getRawCookie();
  const buffer = await fetchDashSegment({ ...payload, cookiePath, rawCookie });
  return buffer;
});

ipcMain.handle("auth:status", async () => {
  return getAuthStatus();
});

ipcMain.handle("auth:login", async () => {
  return loginWithQr();
});

ipcMain.handle("auth:cookie:get", async () => {
  const rawCookie = await getRawCookie();
  return { ok: true, rawCookie };
});

ipcMain.handle("auth:cookie:set", async (_event, payload) => {
  const filePath = await setRawCookie(payload?.rawCookie || "");
  return { ok: true, filePath };
});

ipcMain.handle("auth:cookie:clear", async () => {
  await clearRawCookie();
  return { ok: true };
});

ipcMain.on("env:bilibili-preload", (event) => {
  event.returnValue = pathToFileURL(path.join(__dirname, "bilibili-preload.cjs")).toString();
});

ipcMain.on("env:bilibili-page-preload", (event) => {
  event.returnValue = pathToFileURL(path.join(__dirname, "bilibili-page-preload.cjs")).toString();
});

ipcMain.on("webview:register", (_event, payload) => {
  const id = payload?.id;
  if (!Number.isFinite(id)) return;
  if (registeredWebviews.has(id)) return;
  const wc = webContents.fromId(id);
  if (!wc) return;
  registeredWebviews.add(id);
  const trigger = () => injectIntoFrames(wc);
  wc.on("dom-ready", trigger);
  wc.on("did-frame-finish-load", trigger);
  wc.on("did-navigate", trigger);
  wc.on("did-navigate-in-page", trigger);
  wc.on("destroyed", () => registeredWebviews.delete(id));
  injectIntoFrames(wc);
});

app.whenReady().then(() => {
  const previewDir = path.join(app.getPath("userData"), "preview");
  if (!fs.existsSync(previewDir)) {
    fs.mkdirSync(previewDir, { recursive: true });
  }
  const envCookie = (process.env.RDG_BILI_COOKIE || "").trim();
  const hydrateCookies = envCookie
    ? setRawCookie(envCookie)
    : getRawCookie().then((rawCookie) => applyRawCookieToPartition(rawCookie));
  hydrateCookies.catch(() => {});
  protocol.registerFileProtocol("rdg", (request, callback) => {
    const url = request.url.replace("rdg://preview/", "");
    const filePath = path.join(previewDir, decodeURIComponent(url));
    callback({ path: filePath });
  });
  configureMediaHeaders();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
