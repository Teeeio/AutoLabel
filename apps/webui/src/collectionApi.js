/**
 * 收藏夹 API 客户端
 */

const API_BASE = import.meta.env.VITE_COMMUNITY_API_URL || "http://localhost:8787";

/**
 * 获取用户的所有收藏夹
 */
export async function getUserCollections(userId) {
  const url = new URL(`${API_BASE}/api/collections`);
  url.searchParams.set("userId", userId);

  const res = await fetch(url);

  // 检查响应状态
  if (!res.ok) {
    // 如果是 404，返回空数组（收藏夹功能可能未实现）
    if (res.status === 404) {
      console.warn('[CollectionAPI] Collections endpoint not found, returning empty array');
      return { ok: true, collections: [] };
    }
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }

  // 检查响应类型是否为 JSON
  const contentType = res.headers.get('content-type');
  if (!contentType || !contentType.includes('application/json')) {
    throw new Error(`Expected JSON response, got ${contentType}`);
  }

  const data = await res.json();
  return data;
}

/**
 * 获取所有公开收藏夹
 */
export async function getPublicCollections() {
  const res = await fetch(`${API_BASE}/api/collections/public`);

  if (!res.ok) {
    if (res.status === 404) {
      console.warn('[CollectionAPI] Public collections endpoint not found, returning empty array');
      return { ok: true, collections: [] };
    }
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }

  const contentType = res.headers.get('content-type');
  if (!contentType || !contentType.includes('application/json')) {
    throw new Error(`Expected JSON response, got ${contentType}`);
  }

  const data = await res.json();
  return data;
}

/**
 * 获取指定收藏夹详情
 */
export async function getCollectionById(collectionId, userId) {
  const url = new URL(`${API_BASE}/api/collections/${collectionId}`);
  if (userId) {
    url.searchParams.set("userId", userId);
  }

  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }

  const contentType = res.headers.get('content-type');
  if (!contentType || !contentType.includes('application/json')) {
    throw new Error(`Expected JSON response, got ${contentType}`);
  }

  const data = await res.json();
  return data;
}

/**
 * 创建新收藏夹
 */
export async function createCollection(userId, name, description = "", visibility = "private", cardIds = []) {
  const res = await fetch(`${API_BASE}/api/collections`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, name, description, visibility, cardIds })
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }

  const contentType = res.headers.get('content-type');
  if (!contentType || !contentType.includes('application/json')) {
    throw new Error(`Expected JSON response, got ${contentType}`);
  }

  const data = await res.json();
  return data;
}

/**
 * 更新收藏夹
 */
export async function updateCollection(collectionId, userId, updates) {
  const res = await fetch(`${API_BASE}/api/collections/${collectionId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, ...updates })
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }

  const contentType = res.headers.get('content-type');
  if (!contentType || !contentType.includes('application/json')) {
    throw new Error(`Expected JSON response, got ${contentType}`);
  }

  const data = await res.json();
  return data;
}

/**
 * 删除收藏夹
 */
export async function deleteCollection(collectionId, userId) {
  const url = new URL(`${API_BASE}/api/collections/${collectionId}`);
  url.searchParams.set("userId", userId);

  const res = await fetch(url, { method: "DELETE" });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }

  const contentType = res.headers.get('content-type');
  if (!contentType || !contentType.includes('application/json')) {
    throw new Error(`Expected JSON response, got ${contentType}`);
  }

  const data = await res.json();
  return data;
}
