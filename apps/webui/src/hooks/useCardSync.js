/**
 * 卡片同步管理 Hook
 * 负责协调本地存储和服务器备份(B站卡片)
 */

import { useCallback, useEffect, useState } from "react";
import {
  loadLocalCards,
  saveLocalCards,
  addLocalCard as addLocal,
  updateLocalCard as updateLocal,
  deleteLocalCard as deleteLocal
} from "../utils/localCardStorage";

export default function useCardSync({
  // API 调用函数
  getCards,
  createCard,
  updateCard,
  deleteCard,
  // 卡片处理函数
  hydrateCard,
  validateCards
}) {
  const [localCards, setLocalCards] = useState([]);
  const [serverCards, setServerCards] = useState([]);
  const [allCards, setAllCards] = useState([]);
  const [syncStatus, setSyncStatus] = useState({
    loading: false,
    error: null,
    lastSync: null
  });

  /**
   * 加载本地卡片
   */
  const loadLocal = useCallback(async () => {
    const cards = loadLocalCards();
    setLocalCards(cards);
    return cards;
  }, []);

  /**
   * 从服务器加载B站卡片
   */
  const loadServer = useCallback(async () => {
    try {
      const res = await getCards();
      if (res.ok) {
        const cards = res.items || [];
        setServerCards(cards);
        return cards;
      }
      return [];
    } catch (err) {
      console.error('[CardSync] Failed to load server cards:', err);
      return [];
    }
  }, [getCards]);

  /**
   * 同步本地和服务器卡片
   */
  const sync = useCallback(async () => {
    setSyncStatus(prev => ({ ...prev, loading: true, error: null }));

    try {
      // 1. 加载本地卡片
      const local = await loadLocal();

      // 2. 加载服务器卡片
      const server = await loadServer();

      // 3. 合并卡片(服务器卡片优先)
      const serverIdMap = new Map(server.map(c => [c.id, c]));
      const merged = [];

      // 先添加本地独有的卡片(包括本地来源卡片)
      for (const card of local) {
        if (!serverIdMap.has(card.id)) {
          merged.push(card);
        }
      }

      // 然后添加服务器卡片(可能包含更新的版本)
      for (const card of server) {
        merged.push(card);
      }

      // 按更新时间排序
      merged.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

      // 4. 保存合并后的卡片到本地
      saveLocalCards(merged);

      // 5. 更新状态
      setLocalCards(merged);
      setServerCards(server);
      setAllCards(merged);

      setSyncStatus({
        loading: false,
        error: null,
        lastSync: Date.now()
      });

      return merged;
    } catch (err) {
      console.error('[CardSync] Sync failed:', err);
      setSyncStatus(prev => ({
        ...prev,
        loading: false,
        error: err.message
      }));
      return null;
    }
  }, [loadLocal, loadServer]);

  /**
   * 创建新卡片
   * - B站来源: 上传到服务器 + 保存到本地
   * - 本地来源: 仅保存到本地
   */
  const create = useCallback(async (cardData) => {
    const isLocal = cardData.source === 'local';
    const now = Date.now();

    const newCard = {
      ...cardData,
      id: cardData.id || `card-${now}`,
      createdAt: now,
      updatedAt: now
    };

    // 本地来源卡片强制为私有
    if (isLocal) {
      newCard.visibility = 'private';
    }

    try {
      if (!isLocal) {
        // B站卡片:上传到服务器
        const res = await createCard(newCard);
        if (!res.ok) {
          throw new Error(res.message || '创建卡片失败');
        }
        newCard.id = res.item.id; // 使用服务器返回的ID
      }

      // 保存到本地
      addLocal(newCard);

      // 更新状态
      await sync();

      return { success: true, card: newCard };
    } catch (err) {
      console.error('[CardSync] Create failed:', err);
      return { success: false, error: err.message };
    }
  }, [createCard, sync]);

  /**
   * 更新卡片
   * - B站来源: 更新服务器 + 本地
   * - 本地来源: 仅更新本地
   */
  const update = useCallback(async (cardId, updates) => {
    const card = allCards.find(c => c.id === cardId);
    if (!card) {
      return { success: false, error: '卡片不存在' };
    }

    const isLocal = card.source === 'local';

    try {
      if (!isLocal) {
        // B站卡片:更新服务器
        const res = await updateCard(cardId, updates);
        if (!res.ok) {
          throw new Error(res.message || '更新卡片失败');
        }
      }

      // 更新本地
      updateLocal(cardId, updates);

      // 刷新状态
      await sync();

      return { success: true };
    } catch (err) {
      console.error('[CardSync] Update failed:', err);
      return { success: false, error: err.message };
    }
  }, [allCards, updateCard, sync]);

  /**
   * 删除卡片
   * - B站来源: 从服务器删除 + 本地删除
   * - 本地来源: 仅本地删除
   */
  const remove = useCallback(async (cardId) => {
    const card = allCards.find(c => c.id === cardId);
    if (!card) {
      return { success: false, error: '卡片不存在' };
    }

    const isLocal = card.source === 'local';

    try {
      if (!isLocal) {
        // B站卡片:从服务器删除
        const res = await deleteCard(cardId);
        if (!res.ok) {
          throw new Error(res.message || '删除卡片失败');
        }
      }

      // 从本地删除
      deleteLocal(cardId);

      // 刷新状态
      await sync();

      return { success: true };
    } catch (err) {
      console.error('[CardSync] Delete failed:', err);
      return { success: false, error: err.message };
    }
  }, [allCards, deleteCard, sync]);

  /**
   * 初始化时同步一次
   */
  useEffect(() => {
    sync();
  }, []);

  return {
    // 状态
    localCards,
    serverCards,
    allCards,
    syncStatus,

    // 方法
    sync,
    createCard: create,
    updateCard: update,
    deleteCard: remove,

    // 工具方法
    loadLocal,
    loadServer
  };
}
