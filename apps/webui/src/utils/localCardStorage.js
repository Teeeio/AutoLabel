/**
 * 本地卡片存储工具
 * 用于在用户本地设备存储所有卡片(B站来源 + 本地来源)
 * 服务器仅备份B站卡片用于跨设备同步
 */

const LOCAL_CARDS_KEY = 'rdg_local_cards';
const LOCAL_CARDS_VERSION = '1.0';

/**
 * 从 localStorage 加载本地卡片
 */
export function loadLocalCards() {
  try {
    const raw = localStorage.getItem(LOCAL_CARDS_KEY);
    if (!raw) return [];

    const data = JSON.parse(raw);

    // 版本检查
    if (data.version !== LOCAL_CARDS_VERSION) {
      console.warn('[LocalCardStorage] Version mismatch, migrating...');
      return migrateLocalCards(data);
    }

    return data.cards || [];
  } catch (err) {
    console.error('[LocalCardStorage] Failed to load local cards:', err);
    return [];
  }
}

/**
 * 保存卡片到 localStorage
 * @param {Array} cards - 所有卡片数组(B站 + 本地)
 */
export function saveLocalCards(cards) {
  try {
    const data = {
      version: LOCAL_CARDS_VERSION,
      timestamp: Date.now(),
      cards: cards.map(card => ({
        ...card,
        // 确保必要字段存在
        id: card.id || `local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        source: card.source || 'bilibili',
        visibility: card.source === 'local' ? 'private' : card.visibility,
        createdAt: card.createdAt || Date.now(),
        updatedAt: card.updatedAt || Date.now()
      }))
    };

    localStorage.setItem(LOCAL_CARDS_KEY, JSON.stringify(data));
    return true;
  } catch (err) {
    console.error('[LocalCardStorage] Failed to save local cards:', err);
    return false;
  }
}

/**
 * 添加单个卡片到本地存储
 * @param {Object} card - 卡片对象
 */
export function addLocalCard(card) {
  const cards = loadLocalCards();

  // 检查是否已存在
  const existingIndex = cards.findIndex(c => c.id === card.id);
  if (existingIndex >= 0) {
    // 更新现有卡片
    cards[existingIndex] = {
      ...cards[existingIndex],
      ...card,
      updatedAt: Date.now()
    };
  } else {
    // 添加新卡片
    cards.unshift({
      ...card,
      id: card.id || `local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
  }

  saveLocalCards(cards);
  return cards;
}

/**
 * 更新本地存储中的卡片
 * @param {string} cardId - 卡片ID
 * @param {Object} updates - 要更新的字段
 */
export function updateLocalCard(cardId, updates) {
  const cards = loadLocalCards();
  const index = cards.findIndex(c => c.id === cardId);

  if (index < 0) {
    console.warn('[LocalCardStorage] Card not found:', cardId);
    return null;
  }

  cards[index] = {
    ...cards[index],
    ...updates,
    id: cardId, // 确保ID不被修改
    updatedAt: Date.now()
  };

  saveLocalCards(cards);
  return cards[index];
}

/**
 * 删除本地存储中的卡片
 * @param {string} cardId - 卡片ID
 */
export function deleteLocalCard(cardId) {
  const cards = loadLocalCards();
  const filtered = cards.filter(c => c.id !== cardId);

  if (filtered.length === cards.length) {
    console.warn('[LocalCardStorage] Card not found for deletion:', cardId);
    return false;
  }

  saveLocalCards(filtered);
  return true;
}

/**
 * 清空所有本地卡片
 */
export function clearLocalCards() {
  try {
    localStorage.removeItem(LOCAL_CARDS_KEY);
    return true;
  } catch (err) {
    console.error('[LocalCardStorage] Failed to clear local cards:', err);
    return false;
  }
}

/**
 * 获取统计信息
 */
export function getLocalCardsStats() {
  const cards = loadLocalCards();
  const stats = {
    total: cards.length,
    bilibili: 0,
    local: 0,
    public: 0,
    private: 0
  };

  cards.forEach(card => {
    if (card.source === 'bilibili') stats.bilibili++;
    if (card.source === 'local') stats.local++;
    if (card.visibility === 'public') stats.public++;
    if (card.visibility === 'private') stats.private++;
  });

  return stats;
}

/**
 * 数据迁移(用于版本升级)
 */
function migrateLocalCards(data) {
  // 这里可以添加版本迁移逻辑
  // 目前直接返回卡片数据
  return data.cards || [];
}

/**
 * 导出本地卡片数据(用于备份)
 */
export function exportLocalCards() {
  const cards = loadLocalCards();
  const data = {
    version: LOCAL_CARDS_VERSION,
    exportDate: new Date().toISOString(),
    cards: cards
  };

  return JSON.stringify(data, null, 2);
}

/**
 * 导入本地卡片数据(用于恢复)
 * @param {string} jsonData - JSON格式的卡片数据
 * @param {Object} options - 导入选项
 * @param {boolean} options.merge - 是否合并(默认false,会覆盖)
 */
export function importLocalCards(jsonData, options = {}) {
  try {
    const data = JSON.parse(jsonData);

    if (!Array.isArray(data.cards)) {
      throw new Error('Invalid data format');
    }

    if (options.merge) {
      // 合并模式:将导入的卡片添加到现有卡片
      const existingCards = loadLocalCards();
      const existingIds = new Set(existingCards.map(c => c.id));

      const newCards = data.cards.filter(c => !existingIds.has(c.id));
      const merged = [...newCards, ...existingCards];

      saveLocalCards(merged);
      return { success: true, imported: newCards.length, total: merged.length };
    } else {
      // 覆盖模式:完全替换
      saveLocalCards(data.cards);
      return { success: true, imported: data.cards.length, total: data.cards.length };
    }
  } catch (err) {
    console.error('[LocalCardStorage] Failed to import local cards:', err);
    return { success: false, error: err.message };
  }
}
