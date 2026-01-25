const baseUrl =
  import.meta.env.VITE_COMMUNITY_API_URL || "http://localhost:8787";

function getToken() {
  return localStorage.getItem("communityToken") || "";
}

function setToken(value) {
  if (value) {
    localStorage.setItem("communityToken", value);
  } else {
    localStorage.removeItem("communityToken");
  }
}

async function request(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };
  const token = getToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers
  });
  const data = await response.json().catch(() => ({}));
  return data;
}

export async function getSession() {
  return request("/api/auth/session");
}

export async function login({ username, password }) {
  const result = await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password })
  });
  if (result.ok && result.token) {
    setToken(result.token);
  }
  return result;
}

export async function register({ username, password }) {
  return request("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ username, password })
  });
}

export async function logout() {
  setToken("");
  return request("/api/auth/logout", { method: "POST" });
}

export async function searchTags({ query = "", sort = "trending" } = {}) {
  const params = new URLSearchParams();
  if (query) params.set("query", query);
  if (sort) params.set("sort", sort);
  return request(`/api/tags?${params.toString()}`);
}

export async function getMyTags() {
  return request("/api/my/tags");
}

export async function getFavorites() {
  return request("/api/my/favorites");
}

export async function getCards({ visibility = "all" } = {}) {
  const params = new URLSearchParams();
  if (visibility) params.set("visibility", visibility);
  return request(`/api/cards?${params.toString()}`);
}

export async function searchCardsPublic({ query = "", sort = "latest" } = {}) {
  const params = new URLSearchParams();
  if (query) params.set("query", query);
  if (sort) params.set("sort", sort);
  return request(`/api/cards/public?${params.toString()}`);
}

export async function getBiliCover({ bvid }) {
  const params = new URLSearchParams();
  if (bvid) params.set("bvid", bvid);
  return request(`/api/bili/cover?${params.toString()}`);
}

export async function createTag({ name, aliases = [], description = "", visibility = "public" }) {
  return request("/api/tags", {
    method: "POST",
    body: JSON.stringify({ name, aliases, description, visibility })
  });
}

export async function updateTagVisibility(tagId, visibility) {
  return request(`/api/tags/${tagId}`, {
    method: "PATCH",
    body: JSON.stringify({ visibility })
  });
}

export async function toggleFavorite(tagId) {
  return request(`/api/favorites/${tagId}`, { method: "POST" });
}

export async function toggleCardFavorite(cardId) {
  return request(`/api/card-favorites/${cardId}`, { method: "POST" });
}

export async function getCardFavorites() {
  return request("/api/my/card-favorites");
}

export async function createCard(payload) {
  return request("/api/cards", {
    method: "POST",
    body: JSON.stringify(payload || {})
  });
}

export async function updateCard(cardId, payload) {
  return request(`/api/cards/${cardId}`, {
    method: "PATCH",
    body: JSON.stringify(payload || {})
  });
}

export async function deleteCard(cardId) {
  return request(`/api/cards/${cardId}`, { method: "DELETE" });
}

export async function getTagSets() {
  return { ok: true, items: [] };
}
