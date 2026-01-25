import { useCallback, useState, useEffect } from "react";
import { playbackSentinel } from "../utils/playbackSentinel.js";

export default function useCardPreviewHover({
  setWebviewPreviewPlayback,
  setWebviewManageIds,
  setManageLoadingState,
  setWebviewCommunityIds,
  setCommunityLoadingState
}) {
  const [hoveredManageId, setHoveredManageId] = useState("");
  const [hoveredCommunityId, setHoveredCommunityId] = useState("");
  const [hoveredManageBvid, setHoveredManageBvid] = useState("");
  const [hoveredCommunityBvid, setHoveredCommunityBvid] = useState("");

  // 启动播放哨兵
  useEffect(() => {
    playbackSentinel.start();
    return () => {
      playbackSentinel.stop();
    };
  }, []);

  // 更新哨兵的hover状态 - 社区页面
  useEffect(() => {
    playbackSentinel.setHoveredCardId(hoveredCommunityId);
  }, [hoveredCommunityId]);

  // 更新哨兵的hover状态 - 管理页面
  useEffect(() => {
    window.__hoveredManageId = hoveredManageId || null;
  }, [hoveredManageId]);

  const handleManageHoverStart = useCallback((card) => {
    if (!card) return;
    setHoveredManageId(card.id);
    setHoveredManageBvid(card.bvid);
    setWebviewManageIds((prev) => {
      if (prev.has(card.id)) return prev;
      const next = new Set(prev);
      next.add(card.id);
      return next;
    });
    if (card.source !== "local") {
      setManageLoadingState((prev) => {
        const next = new Map(prev);
        if (!next.get(card.id)) {
          next.set(card.id, {
            webviewLoading: true,
            webviewStartTime: Date.now()
          });
        }
        return next;
      });
    }
    if (card.source !== "local" && card.bvid) {
      setWebviewPreviewPlayback(card.id, card.start, true);
    }
  }, [setManageLoadingState, setWebviewManageIds, setWebviewPreviewPlayback]);

  const handleManageHoverEnd = useCallback((card) => {
    if (!card) return;
    setHoveredManageId((prev) => (prev === card.id ? "" : prev));
    if (card.source !== "local" && card.bvid) {
      setWebviewPreviewPlayback(card.id, card.start, false);
    }
  }, [setWebviewPreviewPlayback]);

  const handleCommunityHoverStart = useCallback((card) => {
    if (!card) return;
    setHoveredCommunityId(card.id);
    setHoveredCommunityBvid(card.bvid);
    setWebviewCommunityIds((prev) => {
      if (prev.has(card.id)) return prev;
      const next = new Set(prev);
      next.add(card.id);
      return next;
    });
    if (card.source !== "local") {
      setCommunityLoadingState((prev) => {
        const next = new Map(prev);
        if (!next.get(card.id)) {
          next.set(card.id, {
            webviewLoading: true,
            webviewStartTime: Date.now()
          });
        }
        return next;
      });
    }
    if (card.source !== "local" && card.bvid) {
      setWebviewPreviewPlayback(card.id, card.start, true);
    }
  }, [setCommunityLoadingState, setWebviewCommunityIds, setWebviewPreviewPlayback]);

  const handleCommunityHoverEnd = useCallback((card) => {
    if (!card) return;
    setHoveredCommunityId((prev) => (prev === card.id ? "" : prev));
    if (card.source !== "local" && card.bvid) {
      setWebviewPreviewPlayback(card.id, card.start, false);
    }
  }, [setWebviewPreviewPlayback]);

  return {
    hoveredManageId,
    setHoveredManageId,
    hoveredCommunityId,
    setHoveredCommunityId,
    hoveredManageBvid,
    setHoveredManageBvid,
    hoveredCommunityBvid,
    setHoveredCommunityBvid,
    handleManageHoverStart,
    handleManageHoverEnd,
    handleCommunityHoverStart,
    handleCommunityHoverEnd
  };
}
