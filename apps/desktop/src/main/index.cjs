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
  applyRawCookieToPartition,
  clearBilibiliSession
} = require("./auth.cjs");
const {
  checkFileExists,
  selectVideoFolder,
  scanVideoFiles,
  selectVideoFile,
  selectFile,
  getVideoMetadata,
  getVideoInfoQuick
} = require("./local-video.cjs");

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
    if (!process.env.RDG_DISABLE_DEVTOOLS) {
      mainWindow.webContents.openDevTools({ mode: "detach" });
    }
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
  const result = await runGeneration(payload, sendProgress, { sender: event.sender });
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

ipcMain.handle("auth:logout", async () => {
  await clearRawCookie();
  await clearBilibiliSession();
  return { ok: true };
});

// 本地视频IPC处理器
console.log('注册本地视频IPC处理器...');
ipcMain.handle("local-video:select-folder", async (event) => {
  console.log('收到 local-video:select-folder 调用');
  const mainWindow = BrowserWindow.fromWebContents(event.sender);
  if (!mainWindow) {
    console.log('无法获取主窗口');
    return { ok: false, error: "无法获取主窗口" };
  }
  try {
    const folderPath = await selectVideoFolder(mainWindow);
    if (!folderPath) {
      return { ok: false, error: "用户取消选择" };
    }
    console.log('选择的文件夹:', folderPath);
    return { ok: true, folderPath };
  } catch (error) {
    console.error('选择文件夹失败:', error);
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("local-video:scan-folder", async (event, folderPath) => {
  try {
    const files = await scanVideoFiles(folderPath);
    return { ok: true, files };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("local-video:select-file", async (event) => {
  const mainWindow = BrowserWindow.fromWebContents(event.sender);
  if (!mainWindow) {
    return { ok: false, error: "无法获取主窗口" };
  }
  try {
    const filePath = await selectVideoFile(mainWindow);
    if (!filePath) {
      return { ok: false, error: "用户取消选择" };
    }
    return { ok: true, filePath };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("local-video:select-file-with-filters", async (event, filters) => {
  const mainWindow = BrowserWindow.fromWebContents(event.sender);
  if (!mainWindow) {
    return { ok: false, error: "无法获取主窗口" };
  }
  try {
    const result = await selectFile(mainWindow, filters);
    return result;
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("local-video:check-exists", async (event, filePath) => {
  try {
    const exists = checkFileExists(filePath);
    return { ok: true, exists };
  } catch (error) {
    return { ok: false, error: error.message, exists: false };
  }
});

ipcMain.handle("local-video:get-metadata", async (event, filePath) => {
  try {
    const metadata = await getVideoMetadata(filePath);
    return { ok: true, metadata };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("local-video:get-info-quick", async (event, filePath) => {
  try {
    const info = await getVideoInfoQuick(filePath);
    return { ok: true, info };
  } catch (error) {
    return { ok: false, error: error.message };
  }
});

// 读取本地视频文件并返回 ArrayBuffer（用于创建 Blob URL）
ipcMain.handle("local-video:load", async (event, filePath) => {
  console.log('[IPC Handler] local-video:load 已被调用');
  try {
    console.log('[IPC] 收到 loadLocalVideo 请求:', filePath);

    if (!fs.existsSync(filePath)) {
      console.error('[IPC] 文件不存在:', filePath);
      throw new Error('文件不存在');
    }

    // 读取文件为 Buffer
    const buffer = await fs.promises.readFile(filePath);
    console.log('[IPC] 文件读取成功，大小:', buffer.length, '字节');

    // 转换为 ArrayBuffer 并返回
    // 注意：Electron 会自动处理序列化
    return buffer.buffer; // 返回 ArrayBuffer
  } catch (error) {
    console.error('[IPC] 读取视频文件失败:', error);
    throw error;
  }
});
console.log('[IPC] 注册 local-video:load handler');

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

  // 使用 protocol.handle 替代 registerFileProtocol 以获得更好的兼容性
  protocol.handle("rdg", async (request) => {
    const url = request.url;
    console.log('[后端] 收到协议请求:', url);

    // 处理本地视频: rdg://local-video/[base64-encoded-file-path]
    if (url.startsWith("rdg://local-video/")) {
      try {
        let base64Path = url.replace("rdg://local-video/", "");
        console.log('[后端] 提取的Base64字符串:', base64Path);
        console.log('[后端] Base64长度:', base64Path.length, '模4:', base64Path.length % 4);

        // 修复URL安全的Base64编码(将 - 和 _ 换回 + 和 /)
        base64Path = base64Path.replace(/-/g, '+').replace(/_/g, '/');
        console.log('[后端] 恢复标准Base64:', base64Path);

        // 添加必要的填充
        const paddingNeeded = (4 - (base64Path.length % 4)) % 4;
        console.log('[后端] 需要填充的字符数:', paddingNeeded);
        while (base64Path.length % 4) {
          base64Path += '=';
        }
        console.log('[后端] 填充后的Base64:', base64Path);

        // Base64解码后再进行URL解码(因为前端用了encodeURIComponent)
        const decodedBuffer = Buffer.from(base64Path, 'base64');
        console.log('[后端] Base64解码后Buffer长度:', decodedBuffer.length);
        console.log('[后端] Buffer前20字节:', decodedBuffer.toString('utf-8', 0, 20));

        const utf8String = decodedBuffer.toString('utf-8');
        console.log('[后端] UTF-8字符串:', utf8String);

        const filePath = decodeURIComponent(utf8String);
        console.log('[后端] URL解码后的最终路径:', filePath);

        // 验证文件是否存在
        if (!fs.existsSync(filePath)) {
          console.error('[后端] ❌ 文件不存在:', filePath);
          return new Response('File not found', {
            status: 404,
            headers: { 'Content-Type': 'text/plain' }
          });
        }

        console.log('[后端] ✅ 文件存在!');

        // 获取文件扩展名以确定MIME类型
        const ext = path.extname(filePath).toLowerCase();
        const mimeTypes = {
          '.mp4': 'video/mp4',
          '.mkv': 'video/x-matroska',
          '.avi': 'video/x-msvideo',
          '.mov': 'video/quicktime',
          '.flv': 'video/x-flv',
          '.wmv': 'video/x-ms-wmv',
          '.webm': 'video/webm',
          '.m4v': 'video/mp4'
        };

        const mimeType = mimeTypes[ext] || 'video/mp4';
        console.log('[后端] MIME类型:', mimeType);
        console.log('[后端] 读取文件并返回Response');

        // 读取文件并返回 Response
        const data = await fs.promises.readFile(filePath);
        return new Response(data, {
          headers: {
            'Content-Type': mimeType,
            'Access-Control-Allow-Origin': '*',
            'Content-Length': data.length.toString()
          }
        });
      } catch (error) {
        console.error('[后端] ❌ 处理本地视频协议时出错:', error);
        return new Response('Internal Server Error', {
          status: 500,
          headers: { 'Content-Type': 'text/plain' }
        });
      }
    }

    // 处理预览文件: rdg://preview/[filename]
    if (url.startsWith("rdg://preview/")) {
      const filename = url.replace("rdg://preview/", "");
      const filePath = path.join(previewDir, decodeURIComponent(filename));
      const data = await fs.promises.readFile(filePath);
      return new Response(data, {
        headers: { 'Content-Type': 'video/mp4' }
      });
    }

    // 默认情况
    console.error('[后端] ❌ 未知的协议请求:', url);
    return new Response('Bad Request', {
      status: 400,
      headers: { 'Content-Type': 'text/plain' }
    });
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
