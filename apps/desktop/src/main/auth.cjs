const { BrowserWindow, app, session } = require("electron");
const fs = require("fs");
const path = require("path");

const BILI_PARTITION = "persist:bili";

function getCookieFilePath() {
  return path.join(app.getPath("userData"), "bilibili_cookies.txt");
}

function getRawCookiePath() {
  return path.join(app.getPath("userData"), "bilibili_cookie_raw.txt");
}

function toNetscapeCookieLine(cookie) {
  const domain = cookie.domain || "";
  const includeSubdomains = domain.startsWith(".") ? "TRUE" : "FALSE";
  const cookiePath = cookie.path || "/";
  const secure = cookie.secure ? "TRUE" : "FALSE";
  const expires = cookie.expirationDate ? Math.floor(cookie.expirationDate) : 0;
  return [domain, includeSubdomains, cookiePath, secure, expires, cookie.name, cookie.value].join("\t");
}

async function writeCookiesFile(cookies) {
  const header = "# Netscape HTTP Cookie File";
  const lines = cookies.map(toNetscapeCookieLine);
  const content = [header, ...lines].join("\n");
  const filePath = getCookieFilePath();
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, content, "utf8");
  return filePath;
}

async function setRawCookie(cookieText) {
  const filePath = getRawCookiePath();
  const normalized = (cookieText || "").trim().replace(/\r?\n/g, " ");
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  await fs.promises.writeFile(filePath, normalized, "utf8");
  await applyRawCookieToPartition(normalized);
  return filePath;
}

async function getRawCookie() {
  const filePath = getRawCookiePath();
  if (!fs.existsSync(filePath)) return "";
  return fs.promises.readFile(filePath, "utf8");
}

async function clearRawCookie() {
  const filePath = getRawCookiePath();
  if (fs.existsSync(filePath)) {
    await fs.promises.unlink(filePath);
  }
  const cookieFilePath = getCookieFilePath();
  if (fs.existsSync(cookieFilePath)) {
    await fs.promises.unlink(cookieFilePath);
  }
  return true;
}

async function clearBilibiliSession() {
  const store = session.fromPartition(BILI_PARTITION);
  try {
    await store.clearStorageData({
      storages: ["cookies", "localstorage", "cachestorage", "indexdb"],
      origins: ["https://www.bilibili.com", "https://passport.bilibili.com"]
    });
  } catch {
    await store.clearStorageData({ storages: ["cookies"] });
  }
}

async function getBilibiliCookies(store) {
  const cookies = await store.cookies.get({ domain: ".bilibili.com" });
  if (cookies.length === 0) {
    return store.cookies.get({ domain: "bilibili.com" });
  }
  return cookies;
}

async function applyRawCookieToPartition(rawCookie) {
  const normalized = (rawCookie || "").trim();
  if (!normalized) return;
  const store = session.fromPartition(BILI_PARTITION);
  const existing = await Promise.all([
    store.cookies.get({ domain: ".bilibili.com" }),
    store.cookies.get({ domain: "bilibili.com" })
  ]);
  const existingByName = new Map();
  existing.flat().forEach((cookie) => {
    if (!existingByName.has(cookie.name)) {
      existingByName.set(cookie.name, cookie);
    }
  });
  const pairs = normalized.split(";").map((part) => part.trim()).filter(Boolean);
  await Promise.all(
    pairs.map(async (pair) => {
      const index = pair.indexOf("=");
      if (index <= 0) return Promise.resolve();
      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1).trim();
      if (!name) return Promise.resolve();
      const current = existingByName.get(name);
      if (current?.httpOnly) return Promise.resolve();
      try {
        await store.cookies.set({
          url: "https://www.bilibili.com/",
          domain: ".bilibili.com",
          path: "/",
          name,
          value
        });
      } catch (err) {
        const message = String(err?.message || "");
        if (message.includes("EXCLUDE_OVERWRITE_HTTP_ONLY")) return;
        throw err;
      }
    })
  );
}

async function loginWithQr() {
  const partition = BILI_PARTITION;
  const loginWindow = new BrowserWindow({
    width: 860,
    height: 720,
    webPreferences: {
      partition
    }
  });

  const store = session.fromPartition(partition);
  await loginWindow.loadURL("https://passport.bilibili.com/login");

  return new Promise((resolve, reject) => {
    const timer = setInterval(async () => {
      try {
        const cookies = await getBilibiliCookies(store);
        const hasSess = cookies.some((cookie) => cookie.name === "SESSDATA");
        if (hasSess) {
          clearInterval(timer);
          const filePath = await writeCookiesFile(cookies);
          const rawCookie = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
          await setRawCookie(rawCookie);
          if (!loginWindow.isDestroyed()) loginWindow.close();
          resolve({ ok: true, cookiePath: filePath });
        }
      } catch (err) {
        clearInterval(timer);
        reject(err);
      }
    }, 1200);

    loginWindow.on("closed", () => {
      clearInterval(timer);
      resolve({ ok: false, cancelled: true });
    });
  });
}

async function getAuthStatus() {
  const filePath = getCookieFilePath();
  const exists = fs.existsSync(filePath);
  if (!exists) {
    return { ok: true, cookiePath: "" };
  }
  const store = session.fromPartition(BILI_PARTITION);
  const cookies = await getBilibiliCookies(store);
  const sess = cookies.find((cookie) => cookie.name === "SESSDATA");
  if (!sess) {
    return { ok: true, cookiePath: "" };
  }
  if (sess.expirationDate && sess.expirationDate <= Date.now() / 1000) {
    return { ok: true, cookiePath: "" };
  }
  return { ok: true, cookiePath: filePath };
}

module.exports = {
  loginWithQr,
  getAuthStatus,
  getCookieFilePath,
  setRawCookie,
  getRawCookie,
  clearRawCookie,
  applyRawCookieToPartition,
  clearBilibiliSession
};

