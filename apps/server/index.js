import cors from "cors";
import crypto from "crypto";
import express from "express";
import fs from "fs";
import https from "https";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataPath = path.join(__dirname, "data.json");
const sessionPath = path.join(__dirname, "sessions.json");
const port = Number(process.env.COMMUNITY_PORT || 8787);
const sessionTtlMs = Number(process.env.COMMUNITY_SESSION_TTL_MS || 7 * 24 * 60 * 60 * 1000);

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

const seedNow = Date.now();
const seedData = {
  users: [{ id: "u-1", username: "demo", createdAt: seedNow }],
  tags: [
    {
      id: "t-1",
      name: "random-dance",
      aliases: ["rdg"],
      description: "随机舞蹈挑战相关标签。",
      creatorId: "u-1",
      visibility: "public",
      createdAt: seedNow - 86400000,
      updatedAt: seedNow - 3600000,
      favoriteCount: 3,
      useCount: 42
    },
    {
      id: "t-2",
      name: "love-live",
      aliases: ["ll"],
      description: "LoveLive 系列相关。",
      creatorId: "u-1",
      visibility: "public",
      createdAt: seedNow - 43200000,
      updatedAt: seedNow - 7200000,
      favoriteCount: 2,
      useCount: 30
    }
  ],
  favorites: {
    "u-1": ["t-1", "t-2"]
  },
  cards: []
};

const state = loadData();
const sessions = loadSessions();

function loadData() {
  if (!fs.existsSync(dataPath)) {
    fs.writeFileSync(dataPath, JSON.stringify(seedData, null, 2), "utf8");
    return structuredClone(seedData);
  }
  try {
    const raw = fs.readFileSync(dataPath, "utf8");
    const parsed = JSON.parse(raw);
    return {
      users: parsed.users || [],
      tags: parsed.tags || [],
      favorites: parsed.favorites || {},
      cards: parsed.cards || []
    };
  } catch {
    return structuredClone(seedData);
  }
}

function saveData() {
  fs.writeFileSync(dataPath, JSON.stringify(state, null, 2), "utf8");
}

function loadSessions() {
  if (!fs.existsSync(sessionPath)) {
    fs.writeFileSync(sessionPath, JSON.stringify({}), "utf8");
    return new Map();
  }
  try {
    const raw = fs.readFileSync(sessionPath, "utf8");
    const parsed = JSON.parse(raw);
    return new Map(Object.entries(parsed || {}));
  } catch {
    return new Map();
  }
}

function saveSessions() {
  fs.writeFileSync(
    sessionPath,
    JSON.stringify(Object.fromEntries(sessions), null, 2),
    "utf8"
  );
}

function cleanupSessions() {
  const now = Date.now();
  let changed = false;
  sessions.forEach((session, token) => {
    if (!session || (session.expiresAt && session.expiresAt <= now)) {
      sessions.delete(token);
      changed = true;
    }
  });
  if (changed) saveSessions();
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

function ensureUserPassword(user, password) {
  if (!user.passwordHash || !user.salt) {
    const salt = crypto.randomBytes(16).toString("hex");
    user.salt = salt;
    user.passwordHash = hashPassword(password, salt);
    saveData();
  }
}

function verifyPassword(user, password) {
  if (!user.passwordHash || !user.salt) return false;
  const hashed = hashPassword(password, user.salt);
  return crypto.timingSafeEqual(Buffer.from(hashed), Buffer.from(user.passwordHash));
}

function getUser(req) {
  const auth = req.header("authorization") || "";
  const tokenMatch = auth.match(/^Bearer\s+(.+)$/i);
  const token = tokenMatch ? tokenMatch[1] : "";
  const session = token ? sessions.get(token) : null;
  const sessionUserId = session?.userId;
  const userId = sessionUserId || req.header("x-user-id");
  if (!userId) return null;
  return state.users.find((user) => user.id === userId) || null;
}

function ensureUser(req, res) {
  const user = getUser(req);
  if (!user) {
    res.status(401).json({ ok: false, message: "未登录社区账号。" });
    return null;
  }
  return user;
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function paginate(items, page, pageSize) {
  const safePage = Math.max(1, Number(page) || 1);
  const safeSize = Math.min(100, Math.max(1, Number(pageSize) || 20));
  const start = (safePage - 1) * safeSize;
  return {
    page: safePage,
    pageSize: safeSize,
    total: items.length,
    items: items.slice(start, start + safeSize)
  };
}

function withFavorite(tag, userId) {
  const favorites = new Set(state.favorites[userId] || []);
  return { ...tag, isFavorite: favorites.has(tag.id) };
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

function fetchJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers }, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        fetchJson(response.headers.location, headers).then(resolve, reject);
        return;
      }
      if (response.statusCode && response.statusCode >= 400) {
        response.resume();
        reject(new Error(`HTTP ${response.statusCode} for ${url}`));
        return;
      }
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        try {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve(JSON.parse(text));
        } catch (err) {
          reject(err);
        }
      });
    });
    request.on("error", reject);
  });
}

app.get("/api/bili/cover", async (req, res) => {
  const bvid = String(req.query?.bvid || "").trim();
  if (!bvid) {
    res.status(400).json({ ok: false, error: "Missing bvid." });
    return;
  }
  try {
    const infoUrl = `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`;
    const data = await fetchJson(infoUrl, {
      Referer: "https://www.bilibili.com/",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    });
    res.json({
      ok: true,
      pic: data?.data?.pic || "",
      title: data?.data?.title || ""
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: "Failed to fetch cover." });
  }
});

app.get("/api/auth/session", (req, res) => {
  cleanupSessions();
  const user = getUser(req);
  res.json({ ok: true, user });
});

app.post("/api/auth/login", (req, res) => {
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");
  if (!username) {
    res.status(400).json({ ok: false, message: "请输入账号名。" });
    return;
  }
  if (!password) {
    res.status(400).json({ ok: false, message: "请输入密码。" });
    return;
  }
  const user = state.users.find(
    (item) => item.username.toLowerCase() === username.toLowerCase()
  );
  if (!user) {
    res.status(404).json({ ok: false, message: "账号不存在，请先注册。" });
    return;
  }
  if (!user.passwordHash || !user.salt) {
    ensureUserPassword(user, password);
  } else if (!verifyPassword(user, password)) {
    res.status(403).json({ ok: false, message: "账号或密码错误。" });
    return;
  }
  const token = crypto.randomBytes(24).toString("hex");
  sessions.set(token, {
    userId: user.id,
    createdAt: Date.now(),
    expiresAt: Date.now() + sessionTtlMs
  });
  saveSessions();
  res.json({ ok: true, user, token });
});

app.post("/api/auth/register", (req, res) => {
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");
  if (!username) {
    res.status(400).json({ ok: false, message: "请输入账号名。" });
    return;
  }
  if (!password || password.length < 4) {
    res.status(400).json({ ok: false, message: "密码至少 4 位。" });
    return;
  }
  const exists = state.users.some(
    (item) => item.username.toLowerCase() === username.toLowerCase()
  );
  if (exists) {
    res.status(409).json({ ok: false, message: "账号已存在。" });
    return;
  }
  const user = {
    id: `u-${Date.now()}`,
    username,
    createdAt: Date.now()
  };
  state.users.unshift(user);
  ensureUserPassword(user, password);
  saveData();
  res.json({ ok: true, user });
});

app.post("/api/auth/logout", (_req, res) => {
  const auth = _req.header("authorization") || "";
  const tokenMatch = auth.match(/^Bearer\s+(.+)$/i);
  const token = tokenMatch ? tokenMatch[1] : "";
  if (token) {
    sessions.delete(token);
    saveSessions();
  }
  res.json({ ok: true });
});

app.get("/api/tags", (req, res) => {
  const query = normalize(req.query.query);
  const sort = String(req.query.sort || "trending");
  const page = req.query.page;
  const pageSize = req.query.pageSize;
  const user = getUser(req);
  const visible = state.tags.filter((tag) => tag.visibility === "public");
  const filtered = query
    ? visible.filter((tag) => {
        const nameMatch = normalize(tag.name).includes(query);
        const aliasMatch = (tag.aliases || []).some((alias) =>
          normalize(alias).includes(query)
        );
        const descMatch = normalize(tag.description).includes(query);
        return nameMatch || aliasMatch || descMatch;
      })
    : visible;
  const sorted = [...filtered].sort((a, b) => {
    if (sort === "latest") return b.createdAt - a.createdAt;
    if (sort === "favorites") return b.favoriteCount - a.favoriteCount;
    return b.useCount - a.useCount;
  });
  const result = paginate(sorted, page, pageSize);
  const items = user
    ? result.items.map((tag) => withFavorite(tag, user.id))
    : result.items;
  res.json({ ok: true, items, total: result.total, page: result.page, pageSize: result.pageSize });
});

app.get("/api/my/tags", (req, res) => {
  const user = ensureUser(req, res);
  if (!user) return;
  const page = req.query.page;
  const pageSize = req.query.pageSize;
  const mine = state.tags.filter((tag) => tag.creatorId === user.id);
  const result = paginate(mine, page, pageSize);
  res.json({
    ok: true,
    items: result.items.map((tag) => withFavorite(tag, user.id)),
    total: result.total,
    page: result.page,
    pageSize: result.pageSize
  });
});

app.get("/api/my/favorites", (req, res) => {
  const user = ensureUser(req, res);
  if (!user) return;
  const page = req.query.page;
  const pageSize = req.query.pageSize;
  const favoriteSet = new Set(state.favorites[user.id] || []);
  const items = state.tags.filter((tag) => favoriteSet.has(tag.id));
  const result = paginate(items, page, pageSize);
  res.json({
    ok: true,
    items: result.items.map((tag) => withFavorite(tag, user.id)),
    total: result.total,
    page: result.page,
    pageSize: result.pageSize
  });
});

app.post("/api/tags", (req, res) => {
  const user = ensureUser(req, res);
  if (!user) return;
  const name = String(req.body?.name || "").trim();
  if (!name) {
    res.status(400).json({ ok: false, message: "标签名不能为空。" });
    return;
  }
  const normalizedName = normalize(name);
  if (state.tags.some((tag) => normalize(tag.name) === normalizedName)) {
    res.status(409).json({ ok: false, message: "标签名已存在。" });
    return;
  }
  const now = Date.now();
  const next = {
    id: `t-${now}`,
    name,
    aliases: Array.isArray(req.body?.aliases) ? req.body.aliases.filter(Boolean) : [],
    description: String(req.body?.description || "").trim(),
    creatorId: user.id,
    visibility: req.body?.visibility === "private" ? "private" : "public",
    createdAt: now,
    updatedAt: now,
    favoriteCount: 0,
    useCount: 0
  };
  state.tags.unshift(next);
  saveData();
  res.json({ ok: true, item: withFavorite(next, user.id) });
});

app.patch("/api/tags/:id", (req, res) => {
  const user = ensureUser(req, res);
  if (!user) return;
  const tag = state.tags.find((item) => item.id === req.params.id);
  if (!tag) {
    res.status(404).json({ ok: false, message: "标签不存在。" });
    return;
  }
  if (tag.creatorId !== user.id) {
    res.status(403).json({ ok: false, message: "无权限操作该标签。" });
    return;
  }
  if (req.body?.visibility) {
    tag.visibility = req.body.visibility === "private" ? "private" : "public";
  }
  tag.updatedAt = Date.now();
  saveData();
  res.json({ ok: true, item: withFavorite(tag, user.id) });
});

app.post("/api/favorites/:id", (req, res) => {
  const user = ensureUser(req, res);
  if (!user) return;
  const tag = state.tags.find((item) => item.id === req.params.id);
  if (!tag) {
    res.status(404).json({ ok: false, message: "标签不存在。" });
    return;
  }
  const favorites = state.favorites[user.id] || [];
  const index = favorites.indexOf(tag.id);
  if (index >= 0) {
    favorites.splice(index, 1);
    tag.favoriteCount = Math.max(0, tag.favoriteCount - 1);
    state.favorites[user.id] = favorites;
    saveData();
    res.json({ ok: true, item: withFavorite(tag, user.id), isFavorite: false });
    return;
  }
  favorites.push(tag.id);
  tag.favoriteCount += 1;
  state.favorites[user.id] = favorites;
  saveData();
  res.json({ ok: true, item: withFavorite(tag, user.id), isFavorite: true });
});

app.get("/api/cards", (req, res) => {
  const user = ensureUser(req, res);
  if (!user) return;
  const page = req.query.page;
  const pageSize = req.query.pageSize;
  const visibility = String(req.query.visibility || "all");
  const mine = state.cards.filter((card) => card.userId === user.id);
  const filtered =
    visibility === "public" || visibility === "private"
      ? mine.filter((card) => card.visibility === visibility)
      : mine;
  const result = paginate(filtered, page, pageSize);
  res.json({
    ok: true,
    items: result.items,
    total: result.total,
    page: result.page,
    pageSize: result.pageSize
  });
});

app.get("/api/cards/public", (req, res) => {
  const query = normalize(req.query.query);
  const sort = String(req.query.sort || "latest");
  const page = req.query.page;
  const pageSize = req.query.pageSize;
  const visible = state.cards.filter((card) => card.visibility === "public");
  const filtered = query
    ? visible.filter((card) => {
        const titleMatch = normalize(card.title).includes(query);
        const bvidMatch = normalize(card.bvid).includes(query);
        const notesMatch = normalize(card.notes).includes(query);
        const tagMatch = Array.isArray(card.tags)
          ? card.tags.some((tag) => normalize(tag).includes(query))
          : false;
        return titleMatch || bvidMatch || notesMatch || tagMatch;
      })
    : visible;
  const sorted = [...filtered].sort((a, b) => {
    if (sort === "oldest") return a.createdAt - b.createdAt;
    return b.createdAt - a.createdAt;
  });
  const result = paginate(sorted, page, pageSize);
  res.json({
    ok: true,
    items: result.items,
    total: result.total,
    page: result.page,
    pageSize: result.pageSize
  });
});

app.post("/api/cards", (req, res) => {
  const user = ensureUser(req, res);
  if (!user) return;
  const title = String(req.body?.title || "").trim();
  const bvid = String(req.body?.bvid || "").trim();
  if (!title) {
    res.status(400).json({ ok: false, message: "请先填写标题。" });
    return;
  }
  if (!bvid) {
    res.status(400).json({ ok: false, message: "请选择视频来源。" });
    return;
  }
  const now = Date.now();
  const toArray = (value) =>
    Array.isArray(value)
      ? value.map((item) => String(item || "").trim()).filter(Boolean)
      : [];
  const next = {
    id: `c-${now}`,
    userId: user.id,
    title,
    bvid,
    start: Number(req.body?.start) || 0,
    end: Number(req.body?.end) || 0,
    tags: toArray(req.body?.tags),
    clipTags: toArray(req.body?.clipTags),
    bpm: String(req.body?.bpm || "").trim(),
    notes: String(req.body?.notes || "").trim(),
    visibility: req.body?.visibility === "public" ? "public" : "private",
    createdAt: now,
    updatedAt: now
  };
  state.cards.unshift(next);
  saveData();
  res.json({ ok: true, item: next });
});

app.patch("/api/cards/:id", (req, res) => {
  const user = ensureUser(req, res);
  if (!user) return;
  const card = state.cards.find((item) => item.id === req.params.id);
  if (!card) {
    res.status(404).json({ ok: false, message: "卡片不存在。" });
    return;
  }
  if (card.userId !== user.id) {
    res.status(403).json({ ok: false, message: "无权限操作该卡片。" });
    return;
  }
  const toArray = (value) =>
    Array.isArray(value)
      ? value.map((item) => String(item || "").trim()).filter(Boolean)
      : null;
  if (typeof req.body?.title === "string") card.title = req.body.title.trim();
  if (typeof req.body?.bvid === "string") card.bvid = req.body.bvid.trim();
  if (Number.isFinite(Number(req.body?.start))) card.start = Number(req.body.start);
  if (Number.isFinite(Number(req.body?.end))) card.end = Number(req.body.end);
  if (req.body?.tags) {
    const tags = toArray(req.body.tags);
    if (tags) card.tags = tags;
  }
  if (req.body?.clipTags) {
    const clipTags = toArray(req.body.clipTags);
    if (clipTags) card.clipTags = clipTags;
  }
  if (typeof req.body?.bpm === "string") card.bpm = req.body.bpm.trim();
  if (typeof req.body?.notes === "string") card.notes = req.body.notes.trim();
  if (req.body?.visibility) {
    card.visibility = req.body.visibility === "public" ? "public" : "private";
  }
  card.updatedAt = Date.now();
  saveData();
  res.json({ ok: true, item: card });
});

app.delete("/api/cards/:id", (req, res) => {
  const user = ensureUser(req, res);
  if (!user) return;
  const index = state.cards.findIndex((item) => item.id === req.params.id);
  if (index < 0) {
    res.status(404).json({ ok: false, message: "卡片不存在。" });
    return;
  }
  if (state.cards[index].userId !== user.id) {
    res.status(403).json({ ok: false, message: "无权限操作该卡片。" });
    return;
  }
  state.cards.splice(index, 1);
  saveData();
  res.json({ ok: true });
});

app.listen(port, () => {
  cleanupSessions();
  console.log(`[community-server] listening on http://localhost:${port}`);
});
