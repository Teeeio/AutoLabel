import cors from "cors";
import crypto from "crypto";
import express from "express";
import fs from "fs";
import https from "https";
import path from "path";
import { fileURLToPath } from "url";
import { generateCVId } from "./utils/idGenerator.js";
import { generateNewCollectionId } from "./utils/collectionIdGenerator.js";

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
      description: "Random dance challenge tags.",
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
      description: "LoveLive related tags.",
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
  cards: [],
  // CV号计数器
  cardIdCounter: 0,
  // 收藏夹
  collections: []
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
      cards: parsed.cards || [],
      cardIdCounter: parsed.cardIdCounter || 0,
      collections: (parsed.collections || []).map(col => ({
        ...col,
        isDefault: col.isDefault || false // 确保旧数据也有isDefault字段
      }))
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
    res.status(401).json({ ok: false, message: "Not logged in." });
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
    res.status(400).json({ ok: false, message: "Invalid request." });
    return;
  }
  if (!password) {
    res.status(400).json({ ok: false, message: "Invalid request." });
    return;
  }
  const user = state.users.find(
    (item) => item.username.toLowerCase() === username.toLowerCase()
  );
  if (!user) {
    res.status(404).json({ ok: false, message: "Not found." });
    return;
  }
  if (!user.passwordHash || !user.salt) {
    ensureUserPassword(user, password);
  } else if (!verifyPassword(user, password)) {
    res.status(403).json({ ok: false, message: "Forbidden." });
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
    res.status(400).json({ ok: false, message: "Invalid request." });
    return;
  }
  if (!password || password.length < 4) {
    res.status(400).json({ ok: false, message: "Invalid request." });
    return;
  }
  const exists = state.users.some(
    (item) => item.username.toLowerCase() === username.toLowerCase()
  );
  if (exists) {
    res.status(409).json({ ok: false, message: "Conflict." });
    return;
  }
  const user = {
    id: `u-${Date.now()}`,
    username,
    createdAt: Date.now()
  };
  state.users.unshift(user);
  ensureUserPassword(user, password);

  // 自动创建默认收藏夹
  const defaultCollection = {
    id: generateNewCollectionId(),
    userId: user.id,
    name: "默认收藏夹",
    description: "我的默认收藏夹",
    visibility: "private",
    cardIds: [],
    isDefault: true, // 标记为默认收藏夹
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  state.collections.push(defaultCollection);

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
    res.status(400).json({ ok: false, message: "Invalid request." });
    return;
  }
  const normalizedName = normalize(name);
  if (state.tags.some((tag) => normalize(tag.name) === normalizedName)) {
    res.status(409).json({ ok: false, message: "Conflict." });
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
    res.status(404).json({ ok: false, message: "Not found." });
    return;
  }
  if (tag.creatorId !== user.id) {
    res.status(403).json({ ok: false, message: "Forbidden." });
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
    res.status(404).json({ ok: false, message: "Not found." });
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

// 卡片收藏 API
app.post("/api/card-favorites/:cardId", (req, res) => {
  const user = ensureUser(req, res);
  if (!user) return;

  const card = state.cards.find((item) => item.id === req.params.cardId);
  if (!card) {
    res.status(404).json({ ok: false, message: "Card not found." });
    return;
  }

  // 初始化用户的卡片收藏列表
  if (!state.cardFavorites) {
    state.cardFavorites = {};
  }
  if (!state.cardFavorites[user.id]) {
    state.cardFavorites[user.id] = [];
  }

  const favorites = state.cardFavorites[user.id];
  const index = favorites.indexOf(card.id);

  if (index >= 0) {
    // 取消收藏
    favorites.splice(index, 1);
    saveData();
    res.json({ ok: true, isFavorite: false });
    return;
  }

  // 添加收藏
  favorites.push(card.id);
  saveData();
  res.json({ ok: true, isFavorite: true });
});

app.get("/api/my/card-favorites", (req, res) => {
  const user = ensureUser(req, res);
  if (!user) return;

  const favoriteCardIds = state.cardFavorites?.[user.id] || [];
  const favoriteCards = state.cards.filter((card) => favoriteCardIds.includes(card.id));

  res.json({
    ok: true,
    items: favoriteCards
  });
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

  const source = String(req.body?.source || "").trim() || "bilibili";

  // 拒绝存储本地来源的卡片
  if (source === "local") {
    res.status(403).json({
      ok: false,
      message: "本地来源的卡片不能上传到服务器。请在本地设备管理。"
    });
    return;
  }

  const title = String(req.body?.title || "").trim();
  const bvid = String(req.body?.bvid || "").trim();

  if (!title) {
    res.status(400).json({ ok: false, message: "Invalid request." });
    return;
  }

  if (!bvid) {
    res.status(400).json({ ok: false, message: "B站视频ID不能为空。" });
    return;
  }

  const now = Date.now();
  const toArray = (value) =>
    Array.isArray(value)
      ? value.map((item) => String(item || "").trim()).filter(Boolean)
      : [];

  // 生成CV号
  const cvId = generateCVId(state.cardIdCounter);
  state.cardIdCounter++;

  const next = {
    id: cvId,
    userId: user.id,
    title,
    source: "bilibili", // 强制为 bilibili
    bvid,
    aid: Number(req.body?.aid) || 0,
    cid: Number(req.body?.cid) || 0,
    localPath: "", // 清空本地路径
    start: Number(req.body?.start) || 0,
    end: Number(req.body?.end) || 0,
    tags: toArray(req.body?.tags),
    clipTags: toArray(req.body?.clipTags),
    bpm: String(req.body?.bpm || "").trim(),
    notes: String(req.body?.notes || "").trim(),
    visibility: req.body?.visibility === "public" ? "public" : "private",
    localDuration: 0,
    localFileSize: 0,
    localWidth: 0,
    localHeight: 0,
    localFps: 0, // B站卡片不存储fps
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
    res.status(404).json({ ok: false, message: "Not found." });
    return;
  }
  if (card.userId !== user.id) {
    res.status(403).json({ ok: false, message: "Forbidden." });
    return;
  }

  // 不允许将服务器卡片的来源改为本地
  if (req.body?.source === "local") {
    res.status(403).json({
      ok: false,
      message: "不能将B站卡片修改为本地来源。"
    });
    return;
  }

  const toArray = (value) =>
    Array.isArray(value)
      ? value.map((item) => String(item || "").trim()).filter(Boolean)
      : null;

  if (typeof req.body?.title === "string") card.title = req.body.title.trim();
  if (typeof req.body?.bvid === "string") card.bvid = req.body.bvid.trim();
  if (Number.isFinite(Number(req.body?.aid))) card.aid = Number(req.body.aid);
  if (Number.isFinite(Number(req.body?.cid))) card.cid = Number(req.body.cid);
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
    res.status(404).json({ ok: false, message: "Not found." });
    return;
  }
  if (state.cards[index].userId !== user.id) {
    res.status(403).json({ ok: false, message: "Forbidden." });
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

// ==================== 收藏夹 API ====================

/**
 * GET /api/collections
 * 获取用户的所有收藏夹
 */
app.get("/api/collections", (req, res) => {
  const userId = req.query.userId;
  if (!userId) {
    return res.status(400).json({ ok: false, message: "缺少userId参数" });
  }

  const userCollections = state.collections.filter(c => c.userId === userId);
  res.json({ ok: true, collections: userCollections });
});

/**
 * GET /api/collections/public
 * 获取所有公开收藏夹
 */
app.get("/api/collections/public", (req, res) => {
  const publicCollections = state.collections.filter(c => c.visibility === "public");

  // 为每个收藏夹附加创建者用户名
  const collectionsWithCreator = publicCollections.map(collection => {
    const creator = state.users.find(u => u.id === collection.userId);
    return {
      ...collection,
      creatorUsername: creator?.username || "未知用户"
    };
  });

  res.json({ ok: true, collections: collectionsWithCreator });
});

/**
 * GET /api/collections/:id
 * 获取指定收藏夹详情
 */
app.get("/api/collections/:id", (req, res) => {
  const { id } = req.params;
  const collection = state.collections.find(c => c.id === id);

  if (!collection) {
    return res.status(404).json({ ok: false, message: "收藏夹不存在" });
  }

  // 如果是私有收藏夹，验证访问权限
  if (collection.visibility === "private") {
    const userId = req.query.userId;
    if (collection.userId !== userId) {
      return res.status(403).json({ ok: false, message: "无权访问此收藏夹" });
    }
  }

  // 获取收藏夹中的完整卡片数据
  const cards = state.cards.filter(card => collection.cardIds.includes(card.id));

  // 获取创建者信息
  const creator = state.users.find(u => u.id === collection.userId);

  res.json({
    ok: true,
    collection: {
      ...collection,
      creatorUsername: creator?.username || "未知用户",
      cards
    }
  });
});

/**
 * POST /api/collections
 * 创建新收藏夹
 */
app.post("/api/collections", (req, res) => {
  const { userId, name, description, visibility, cardIds } = req.body;

  if (!userId || !name) {
    return res.status(400).json({ ok: false, message: "缺少必要参数：userId 或 name" });
  }

  // 验证用户存在
  const user = state.users.find(u => u.id === userId);
  if (!user) {
    return res.status(400).json({ ok: false, message: "用户不存在" });
  }

  const now = Date.now();
  const newCollection = {
    id: generateNewCollectionId(),
    userId,
    name: name.trim(),
    description: description?.trim() || "",
    visibility: visibility || "private",
    cardIds: cardIds || [],
    createdAt: now,
    updatedAt: now
  };

  state.collections.push(newCollection);
  saveData();

  res.json({ ok: true, collection: newCollection });
});

/**
 * PATCH /api/collections/:id
 * 更新收藏夹
 */
app.patch("/api/collections/:id", (req, res) => {
  const { id } = req.params;
  const { userId, name, description, visibility, cardIds } = req.body;

  const collection = state.collections.find(c => c.id === id);
  if (!collection) {
    return res.status(404).json({ ok: false, message: "收藏夹不存在" });
  }

  // 验证权限：只有创建者可以修改
  if (collection.userId !== userId) {
    return res.status(403).json({ ok: false, message: "无权修改此收藏夹" });
  }

  // 默认收藏夹的限制
  if (collection.isDefault) {
    // 默认收藏夹不能改名称和可见性
    if (name !== undefined && name.trim() !== "默认收藏夹") {
      return res.status(400).json({ ok: false, message: "默认收藏夹不能修改名称" });
    }
    if (visibility !== undefined && visibility !== "private") {
      return res.status(400).json({ ok: false, message: "默认收藏夹只能为私有" });
    }
  }

  // 更新字段
  if (name !== undefined && !collection.isDefault) collection.name = name.trim();
  if (description !== undefined) collection.description = description.trim();
  if (visibility !== undefined && !collection.isDefault) collection.visibility = visibility;
  if (cardIds !== undefined) collection.cardIds = cardIds;
  collection.updatedAt = Date.now();

  saveData();

  res.json({ ok: true, collection });
});

/**
 * DELETE /api/collections/:id
 * 删除收藏夹
 */
app.delete("/api/collections/:id", (req, res) => {
  const { id } = req.params;
  const { userId } = req.query;

  const collectionIndex = state.collections.findIndex(c => c.id === id);
  if (collectionIndex === -1) {
    return res.status(404).json({ ok: false, message: "收藏夹不存在" });
  }

  const collection = state.collections[collectionIndex];

  // 验证权限：只有创建者可以删除
  if (collection.userId !== userId) {
    return res.status(403).json({ ok: false, message: "无权删除此收藏夹" });
  }

  // 默认收藏夹不能删除
  if (collection.isDefault) {
    return res.status(400).json({ ok: false, message: "默认收藏夹不能删除" });
  }

  state.collections.splice(collectionIndex, 1);
  saveData();

  res.json({ ok: true, message: "收藏夹已删除" });
});











