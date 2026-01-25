import { useState, useEffect, useCallback } from "react";
import * as collectionApi from "../collectionApi";

/**
 * 收藏夹管理 Hook
 */
export function useCollectionManager(userId) {
  const [collections, setCollections] = useState([]);
  const [publicCollections, setPublicCollections] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  /**
   * 加载用户收藏夹
   */
  const loadCollections = useCallback(async () => {
    if (!userId) return;

    setLoading(true);
    setError(null);
    try {
      const data = await collectionApi.getUserCollections(userId);
      if (data.ok) {
        setCollections(data.collections);
      } else {
        setError(data.message || "加载收藏夹失败");
      }
    } catch (err) {
      console.error("[Collection] Failed to load collections:", err);
      setError("网络错误，无法加载收藏夹");
    } finally {
      setLoading(false);
    }
  }, [userId]);

  /**
   * 加载公开收藏夹
   */
  const loadPublicCollections = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await collectionApi.getPublicCollections();
      if (data.ok) {
        setPublicCollections(data.collections);
      } else {
        setError(data.message || "加载公开收藏夹失败");
      }
    } catch (err) {
      console.error("[Collection] Failed to load public collections:", err);
      setError("网络错误，无法加载公开收藏夹");
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * 创建收藏夹
   */
  const createCollection = useCallback(async (name, description = "", visibility = "private", cardIds = []) => {
    if (!userId) {
      setError("用户未登录");
      return { ok: false, message: "用户未登录" };
    }

    setLoading(true);
    setError(null);
    try {
      const data = await collectionApi.createCollection(userId, name, description, visibility, cardIds);
      if (data.ok) {
        setCollections(prev => [...prev, data.collection]);
        return { ok: true, collection: data.collection };
      } else {
        setError(data.message || "创建收藏夹失败");
        return data;
      }
    } catch (err) {
      console.error("[Collection] Failed to create collection:", err);
      setError("网络错误，无法创建收藏夹");
      return { ok: false, message: "网络错误" };
    } finally {
      setLoading(false);
    }
  }, [userId]);

  /**
   * 更新收藏夹
   */
  const updateCollection = useCallback(async (collectionId, updates) => {
    if (!userId) {
      setError("用户未登录");
      return { ok: false, message: "用户未登录" };
    }

    setLoading(true);
    setError(null);
    try {
      const data = await collectionApi.updateCollection(collectionId, userId, updates);
      if (data.ok) {
        setCollections(prev =>
          prev.map(col => col.id === collectionId ? data.collection : col)
        );
        return { ok: true, collection: data.collection };
      } else {
        setError(data.message || "更新收藏夹失败");
        return data;
      }
    } catch (err) {
      console.error("[Collection] Failed to update collection:", err);
      setError("网络错误，无法更新收藏夹");
      return { ok: false, message: "网络错误" };
    } finally {
      setLoading(false);
    }
  }, [userId]);

  /**
   * 删除收藏夹
   */
  const deleteCollection = useCallback(async (collectionId) => {
    if (!userId) {
      setError("用户未登录");
      return { ok: false, message: "用户未登录" };
    }

    setLoading(true);
    setError(null);
    try {
      const data = await collectionApi.deleteCollection(collectionId, userId);
      if (data.ok) {
        setCollections(prev => prev.filter(col => col.id !== collectionId));
        return { ok: true };
      } else {
        setError(data.message || "删除收藏夹失败");
        return data;
      }
    } catch (err) {
      console.error("[Collection] Failed to delete collection:", err);
      setError("网络错误，无法删除收藏夹");
      return { ok: false, message: "网络错误" };
    } finally {
      setLoading(false);
    }
  }, [userId]);

  /**
   * 向收藏夹添加/移除卡片
   */
  const toggleCardInCollection = useCallback(async (collectionId, cardId) => {
    const collection = collections.find(c => c.id === collectionId);
    if (!collection) return { ok: false, message: "收藏夹不存在" };

    const hasCard = collection.cardIds.includes(cardId);
    const updatedCardIds = hasCard
      ? collection.cardIds.filter(id => id !== cardId)
      : [...collection.cardIds, cardId];

    return updateCollection(collectionId, { cardIds: updatedCardIds });
  }, [collections, updateCollection]);

  /**
   * 加载公开收藏夹（可选）
   */
  useEffect(() => {
    if (userId) {
      loadPublicCollections();
    }
  }, [userId, loadPublicCollections]);

  // 初始化时加载用户收藏夹
  useEffect(() => {
    loadCollections();
  }, [loadCollections]);

  return {
    collections,
    publicCollections,
    loading,
    error,
    loadCollections,
    loadPublicCollections,
    createCollection,
    updateCollection,
    deleteCollection,
    toggleCardInCollection
  };
}
