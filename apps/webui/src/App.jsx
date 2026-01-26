import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useLocation } from "react-router-dom";


import AppContext from "./context/AppContext";
import AppRoutes from "./routes/AppRoutes";
import LocalCardPreview from "./components/LocalCardPreview";
import LocalVideoPlayer from "./components/LocalVideoPlayer";
import useLocalVideoLibrary from "./hooks/useLocalVideoLibrary";
import Topbar from "./layout/Topbar";
import CommunityAuthModal from "./layout/CommunityAuthModal";
import TooltipLayer from "./layout/TooltipLayer";
import CardDetailPanel from "./layout/CardDetailPanel";
import useBiliSearchOverlay from "./hooks/useBiliSearchOverlay";
import useCommunityManager from "./hooks/useCommunityManager";
import { useCollectionManager } from "./hooks/useCollectionManager";
import useCardPreviewHover from "./hooks/useCardPreviewHover";
import useLocalPlayerHotkeys from "./hooks/useLocalPlayerHotkeys";
import usePreviewPlayerState from "./hooks/usePreviewPlayerState";
import useRangeRefSync from "./hooks/useRangeRefSync";
import usePlayerMediaSync from "./hooks/usePlayerMediaSync";
import usePreviewPlaybackControl from "./hooks/usePreviewPlaybackControl";
import useManagePreviewWebview from "./hooks/useManagePreviewWebview";
import useCommunityPreviewWebview from "./hooks/useCommunityPreviewWebview";
import usePreviewWebviewLifecycle from "./hooks/usePreviewWebviewLifecycle";
import useTimelineScrub from "./hooks/useTimelineScrub";
import useCardFormActions from "./hooks/useCardFormActions";
import usePreviewPreload from "./hooks/usePreviewPreload";
import useDetailWebview from "./hooks/useDetailWebview";
import useDetailPanel from "./hooks/useDetailPanel";

import {

  createCard,

  deleteCard,

  getCards,

  getCardFavorites,

  getSession,

  login,

  logout,

  register,

  searchCardsPublic,

  toggleCardFavorite,

  updateCard

} from "./communityApi";

import cardValidator from "./utils/CardValidator";

import validationScheduler from "./utils/ValidationScheduler";

import { formatCardId, getCardIdShort, isValidCVId } from "./utils/cvIdValidator";

function extractBvid(input) {

  if (!input) return "";

  const trimmed = input.trim();

  const directMatch = trimmed.match(/BV[0-9A-Za-z]{10}/);

  if (directMatch) return directMatch[0];

  return "";

}

function normalizeCardTags(tags) {

  if (Array.isArray(tags)) {

    return tags.map((tag) => String(tag || "").trim()).filter(Boolean);

  }

  if (typeof tags === "string") {

    return tags

      .split(",")

      .map((tag) => String(tag || "").trim())

      .filter(Boolean);

  }

  return [];

}

function hydrateCard(card) {

  if (!card) return null;

  const tags = normalizeCardTags(card.tags);
  const resolvedSource = card.source || (card.localPath ? "local" : "bilibili");

  return {

    ...card,

    tags: tags.join(", "),

    searchTags: tags,

    clipTags: Array.isArray(card.clipTags) ? card.clipTags : [],

    notes: card.notes || "",

    visibility: card.visibility === "public" ? "public" : "private",

    validation: card.validation || null,

    source: card.source || "bilibili" // 默为bilibili

  };

}



/**

 * 批量验证卡?

 * @param {Array} cards - 卡片数组

 * @param {string} mode - 'quick' | 'deep'

 * @returns {Promise<Array>} 带验证结果的卡片数?

 */

async function validateCards(cards, mode = 'quick') {

  const validateFn = mode === 'deep' ?

    cardValidator.deepValidate.bind(cardValidator) :

    cardValidator.quickValidate.bind(cardValidator);



  // 批量验证，限制并发?

  const concurrency = 5;

  const results = [];



  for (let i = 0; i < cards.length; i += concurrency) {

    const batch = cards.slice(i, i + concurrency);

    const validationPromises = batch.map(async (card) => {

      try {

        const validation = await validateFn(card);

        return { ...card, validation };

      } catch (error) {

        console.error(`验证卡片 ${card.id} 失?`, error);

        return {

          ...card,

          validation: {

            status: 'error',

            score: 0,

            issues: [`验证异常: ${error.message}`],

            warnings: [],

            lastChecked: Date.now()

          }

        };

      }

    });



    const batchResults = await Promise.all(validationPromises);

    results.push(...batchResults);

  }



  return results;

}

function clamp(value, min, max) {

  return Math.min(Math.max(value, min), max);

}

function formatTime(value, highlight = false, showDecimal = false) {

  if (!Number.isFinite(value)) return "00:00";

  const total = Math.max(0, value);

  const minutes = Math.floor(total / 60);

  const seconds = total % 60;

  const integerPart = Math.floor(seconds);
  const decimalPart = seconds % 1;

  // Check if seconds has decimal part
  const hasDecimal = decimalPart !== 0;

  if (hasDecimal && showDecimal) {
    // Format decimal with 3 digits precision, remove trailing zeros
    const decimalStr = decimalPart.toFixed(3).replace(/0+$/, '').replace(/^\./, '');
    const secondsInt = String(integerPart).padStart(2, "0");

    if (highlight) {
      // Highlight version: white text, blue decimal
      return `${String(minutes).padStart(2, "0")}:${secondsInt}<span class="time-decimal-highlight">.${decimalStr}</span>`;
    } else {
      // Normal version: gray decimal
      return `${String(minutes).padStart(2, "0")}:${secondsInt}<span class="time-decimal">.${decimalStr}</span>`;
    }
  } else {
    // Show as integer
    return `${String(minutes).padStart(2, "0")}:${String(integerPart).padStart(2, "0")}`;
  }

}

function buildVideoUrl({ bvid, start }) {
  if (!bvid) return "";
  if (bvid.startsWith("local:")) return "";
  const startTime = Math.max(0, Math.floor(start || 0));
  const params = new URLSearchParams();
  if (startTime > 0) {
    params.set("t", String(startTime));
  }
  // 设置为低画质预览：关闭高清
  params.set("high_quality", "0");
  const query = params.toString();
  return `https://www.bilibili.com/video/${bvid}${query ? `?${query}` : ""}`;
}
const buildEmbedUrl = buildVideoUrl;
function buildCardPreviewUrl({ bvid, start }) {
  if (!bvid) return "";
  return buildVideoUrl({ bvid, start });
}
const bilibiliUserAgent =

  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const placeholderAvatar =

  "data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A//www.w3.org/2000/svg%22%20viewBox%3D%220%200%2096%2096%22%3E%3Crect%20width%3D%2296%22%20height%3D%2296%22%20rx%3D%2248%22%20fill%3D%22%23e2e8f0%22/%3E%3Ccircle%20cx%3D%2248%22%20cy%3D%2238%22%20r%3D%2218%22%20fill%3D%22%2394a3b8%22/%3E%3Cpath%20d%3D%22M16%2084c6-18%2024-28%2032-28h0c8%200%2026%2010%2032%2028%22%20fill%3D%22%2394a3b8%22/%3E%3C/svg%3E";

function mergeRanges(ranges, nextRange) {

  if (!Number.isFinite(nextRange.start) || !Number.isFinite(nextRange.end)) {

    return ranges;

  }

  const start = Math.max(0, Math.min(nextRange.start, nextRange.end));

  const end = Math.max(nextRange.start, nextRange.end);

  if (end - start < 0.05) return ranges;

  const sorted = [...ranges, { start, end }].sort((a, b) => a.start - b.start);

  const merged = [];

  for (const range of sorted) {

    if (!merged.length) {

      merged.push({ ...range });

      continue;

    }

    const last = merged[merged.length - 1];

    if (range.start <= last.end + 0.05) {

      last.end = Math.max(last.end, range.end);

    } else {

      merged.push({ ...range });

    }

  }

  return merged;

}

function rangesEqual(a, b) {

  if (a.length !== b.length) return false;

  for (let i = 0; i < a.length; i += 1) {

    if (Math.abs(a[i].start - b[i].start) > 0.01) return false;

    if (Math.abs(a[i].end - b[i].end) > 0.01) return false;

  }

  return true;

}

function findMissingRange(start, end, ranges, epsilon = 0.05) {

  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;

  let cursor = start;

  for (const range of ranges) {

    if (range.end < cursor - epsilon) continue;

    if (range.start > cursor + epsilon) {

      return { start: cursor, end: Math.min(end, range.start) };

    }

    cursor = Math.max(cursor, range.end);

    if (cursor >= end - epsilon) return null;

  }

  if (cursor < end - epsilon) return { start: cursor, end };

  return null;

}

function getBufferAhead(time, ranges, epsilon = 0.05) {

  if (!Number.isFinite(time)) return 0;

  for (const range of ranges) {

    if (time >= range.start - epsilon && time <= range.end + epsilon) {

      return Math.max(0, range.end - time);

    }

  }

  return 0;

}

function patchWebviewIframeHeight(webview) {

  const iframe = webview?.shadowRoot?.querySelector("iframe");

  if (!iframe) return false;

  iframe.style.height = "100%";

  iframe.style.minHeight = "100%";

  return true;

}

function patchSearchWebviewIframeHeight(webview) {

  const iframe = webview?.shadowRoot?.querySelector("iframe");

  if (!iframe) return false;

  iframe.style.height = "100%";

  iframe.style.minHeight = "100%";

  return true;

}

function findSegmentIndex(time, segments) {

  if (!segments?.length || !Number.isFinite(time)) return 0;

  let low = 0;

  let high = segments.length - 1;

  while (low <= high) {

    const mid = Math.floor((low + high) / 2);

    const seg = segments[mid];

    if (time < seg.time) {

      high = mid - 1;

    } else if (time >= seg.time + seg.duration) {

      low = mid + 1;

    } else {

      return mid;

    }

  }

  return Math.min(low, segments.length - 1);

}



// 朜视撔器组?- B站格（完整复制B站注入滑块功能）
export default function App() {

  const [cards, setCards] = useState([]);

  const [selection, setSelection] = useState([]);

  const [activeId, setActiveId] = useState("");

  const [progress, setProgress] = useState([]);

  const [status, setStatus] = useState("idle");

  const [previewUrl, setPreviewUrl] = useState("");

  const [previewError, setPreviewError] = useState("");

  const [isResolving, setIsResolving] = useState(false);

  const [isBuffering, setIsBuffering] = useState(false);

  const [isLoadingPreview, setIsLoadingPreview] = useState(false);

  const [previewEpoch, setPreviewEpoch] = useState(0);

  const [previewPanelKey, setPreviewPanelKey] = useState(0);

  const [isDashMode, setIsDashMode] = useState(false);

  const [isScrubbing, setIsScrubbing] = useState(false);

  const [dragHandle, setDragHandle] = useState(null);

  const [authStatus, setAuthStatus] = useState("not logged in");

  const [saveNotice, setSaveNotice] = useState("");

  const [webviewManageIds, setWebviewManageIds] = useState(new Set());

  const [webviewCommunityIds, setWebviewCommunityIds] = useState(new Set());

  const [detailCard, setDetailCard] = useState(null);

  const [detailWebviewLoading, setDetailWebviewLoading] = useState(false);

  const [detailWebviewLoadStartTime, setDetailWebviewLoadStartTime] = useState(Date.now());

  const [manageLoadingState, setManageLoadingState] = useState(new Map());

  const [communityLoadingState, setCommunityLoadingState] = useState(new Map());

  const [previewCurrentTime, setPreviewCurrentTime] = useState(new Map()); // 跟踪每个预的当前?

  const [isDraggingProgress, setIsDraggingProgress] = useState(false); // 跟踪昐正在拖动进?

  const manageWebviewTimerRef = useRef(null);

  const communityWebviewTimerRef = useRef(null);

  // 追踪验证任务初始化状态，避免无限循环
  const validationTaskInitializedRef = useRef(false);
  const communityValidationTaskInitializedRef = useRef(false);



  // 预加载所有卡片的webview标?

  const [managePreloaded, setManagePreloaded] = useState(false);

  const [communityPreloaded, setCommunityPreloaded] = useState(false);

  const [loadTick, setLoadTick] = useState(0);

  const loadTimerRef = useRef(null);

  const {
    previewQuality,
    setPreviewQuality,
    duration,
    setDuration,
    sourceDuration,
    setSourceDuration,
    segmentOffset,
    setSegmentOffset,
    segmentSpan,
    setSegmentSpan,
    rangeStart,
    setRangeStart,
    rangeEnd,
    setRangeEnd,
    currentTime,
    setCurrentTime,
    isPlaying,
    setIsPlaying,
    volume,
    setVolume,
    isMuted,
    setIsMuted,
    playbackRate,
    setPlaybackRate,
    hoverTime,
    setHoverTime,
    hoverPercent,
    setHoverPercent,
    isHovering,
    setIsHovering,
    webviewRef,
    webviewReadyRef,
    pendingCommandsRef,
    localVideoRef,
    timelineRef,
    resolvingRef,
    dragRef,
    wasPlayingRef,
    tooltip,
    setTooltip,
    lastRangeStartRef,
    playRequestRef,
    keyHoldRef,
    thumbVideoRef,
    thumbCanvasRef,
    thumbQueueRef,
    thumbLastRef,
    resolveKeyRef,
    rangeRef,
    rangePollRef,
    lastRangeUpdateRef,
    previewSwitchRef,
    volumeRef,
    muteRef,
    rateRef,
    detailWebviewKeyRef,
    dashRef
  } = usePreviewPlayerState();

  const [form, setForm] = useState({

    title: "",

    source: "",

    localPath: "", // 朜视?

    tags: "",

    bpm: "",

    notes: "",

    visibility: "private"

  });

  const [tagInput, setTagInput] = useState("");

  const [tagList, setTagList] = useState([]);

  const [clipTags, setClipTags] = useState([]);

  const [parseInput, setParseInput] = useState("");

  const [parseQueue, setParseQueue] = useState([]);

  const [isBatchResolving, setIsBatchResolving] = useState(false);
  const {
    localVideoInfo,
    setLocalVideoInfo,
    selectedLocalFile,
    setSelectedLocalFile,
    localVideoFolder,
    setLocalVideoFolder,
    localVideoList,
    setLocalVideoList
  } = useLocalVideoLibrary();

  const [searchSourceType, setSearchSourceType] = useState("bilibili"); // 'bilibili' | 'local'

  // 当切换视频来源时,自动设置默认可见性
  useEffect(() => {
    setForm((prev) => ({
      ...prev,
      visibility: searchSourceType === "local" ? "private" : "public"
    }));
  }, [searchSourceType]);

  const [previewSource, setPreviewSource] = useState(null);
  const searchWebviewRef = useRef(null);
  const managePreviewWebviewsRef = useRef(new Map());
  const communityPreviewWebviewsRef = useRef(new Map());
  const [cachedRangesMap, setCachedRangesMap] = useState({});
  const [timeHighlight, setTimeHighlight] = useState(false); // 高亮时间小数部分（ZX调整时）


  // 臊打开上的本地频文件?
  const { setWebviewPreviewPlayback, markWebviewReady } = usePreviewPlaybackControl();

  const {
    hoveredManageId,
    setHoveredManageId,
    hoveredManageBvid,
    setHoveredManageBvid,
    hoveredCommunityId,
    setHoveredCommunityId,
    hoveredCommunityBvid,
    setHoveredCommunityBvid,
    handleManageHoverStart,
    handleManageHoverEnd,
    handleCommunityHoverStart,
    handleCommunityHoverEnd
  } = useCardPreviewHover({
    setWebviewPreviewPlayback,
    setWebviewManageIds,
    setManageLoadingState,
    setWebviewCommunityIds,
    setCommunityLoadingState
  });




  useDetailWebview({
    detailCard,
    setDetailWebviewLoading,
    setDetailWebviewLoadStartTime,
    patchWebviewIframeHeight,
    setCurrentTime
  });




  useEffect(() => {

    loadTimerRef.current = setInterval(() => {

      setLoadTick((prev) => prev + 1);

    }, 500);

    return () => {

      if (loadTimerRef.current) {

        clearInterval(loadTimerRef.current);

        loadTimerRef.current = null;

      }

    };

  }, []);

  const useEmbedPlayer = true;

  const getLoadingTime = useCallback((cardId, type) => {

    const state = manageLoadingState.get(cardId);

    if (!state) return 0;

    if (type === 'webview') {

      if (state.webviewLoadTime) return state.webviewLoadTime;

      if (state.webviewLoading && state.webviewStartTime) {

        return Date.now() - state.webviewStartTime;

      }

    }

    return 0;

  }, [manageLoadingState]);

  const getCommunityLoadingTime = useCallback((cardId, type) => {

    const state = communityLoadingState.get(cardId);

    if (!state) return 0;

    if (type === 'webview') {

      if (state.webviewLoadTime) return state.webviewLoadTime;

      if (state.webviewLoading && state.webviewStartTime) {

        return Date.now() - state.webviewStartTime;

      }

    }

    return 0;

  }, [communityLoadingState]);

  const useEmbedHijack = true;

  const sendPlayerCommand = useCallback((type, payload = {}) => {

    if (!useEmbedHijack) return;

    const view = webviewRef.current;

    if (!view || !type) return;

    if (!webviewReadyRef.current) {

      pendingCommandsRef.current.push({ type, payload });

      return;

    }

    view.send("player:command", { type, ...payload });

  }, []);

  const activeCard = useMemo(() => {

    const found = cards.find((card) => card.id === activeId);

    return found || previewSource;

  }, [cards, activeId, previewSource]);

  const activeCardInLibrary = useMemo(() => cards.some((card) => card.id === activeId), [cards, activeId]);

  useEffect(() => {

    if (!activeCard) return;

    setForm((prev) => {

      const next = {

        ...prev,

        title: activeCard.title || prev.title || "",

        source: activeCard.bvid || prev.source || "",

        notes: activeCard.notes || prev.notes || "",

        visibility: activeCard.visibility || prev.visibility || "private"

      };

      if (

        next.title === prev.title &&

        next.source === prev.source &&

        next.notes === prev.notes &&

        next.visibility === prev.visibility

      ) {

        return prev;

      }

      return next;

    });

  }, [activeCard?.title, activeCard?.bvid, activeCard?.notes, activeCard?.visibility]);

  const parseStats = useMemo(() => {

    return parseQueue.reduce(

      (acc, item) => {

        acc.total += 1;

        acc[item.status] = (acc[item.status] || 0) + 1;

        return acc;

      },

      { total: 0, pending: 0, resolving: 0, ready: 0, error: 0, invalid: 0 }

    );

  }, [parseQueue]);

  const isQueueResolving = useMemo(

    () => isBatchResolving || parseQueue.some((item) => item.status === "resolving"),

    [isBatchResolving, parseQueue]

  );

  const addCachedRange = useCallback((bvid, quality, start, end) => {

    if (!bvid || !Number.isFinite(start) || !Number.isFinite(end)) return;

    const key = `${bvid}:${quality || "auto"}`;

    setCachedRangesMap((prev) => {

      const existing = prev[key] || [];

      const merged = mergeRanges(existing, { start, end });

      if (rangesEqual(existing, merged)) return prev;

      return { ...prev, [key]: merged };

    });

  }, []);

  const isSegmentPreview = segmentSpan > 0;

  const activeCacheKey = activeCard?.bvid ? `${activeCard.bvid}:${previewQuality || "auto"}` : "";

  const cachedRanges = useMemo(

    () => (activeCacheKey ? cachedRangesMap[activeCacheKey] || [] : []),

    [activeCacheKey, cachedRangesMap]

  );

  const timelineSpan = sourceDuration || duration || segmentSpan || Math.max(30, rangeEnd);

  const previewSpan = duration || segmentSpan || Math.max(0.1, rangeEnd - rangeStart);

  const inputMax = sourceDuration || Math.max(rangeEnd, rangeStart + previewSpan);

  const startPercent = timelineSpan ? (clamp(rangeStart, 0, timelineSpan) / timelineSpan) * 100 : 0;

  const endPercent = timelineSpan ? (clamp(rangeEnd, 0, timelineSpan) / timelineSpan) * 100 : 0;

  const playheadPercent = timelineSpan ? (clamp(currentTime, 0, timelineSpan) / timelineSpan) * 100 : 0;

  const prefetchAheadSeconds = 22;

  const prefetchBehindSeconds = 6;

  const dashPrefetchAheadSeconds = 40;

  const prefetchCooldownMs = 250;

  const cacheEpsilon = 0.05;

  const rangeEpsilon = 0.05;

  const searchResultsLimit = 6;

  const isTimeCached = useCallback(

    (time) => {

      if (!Number.isFinite(time)) return false;

      if (cachedRanges.length) {

        return cachedRanges.some(

          (range) => time >= range.start - cacheEpsilon && time <= range.end + cacheEpsilon

        );

      }

      if (isSegmentPreview) {

        return time >= segmentOffset - cacheEpsilon && time <= segmentOffset + segmentSpan + cacheEpsilon;

      }

      return true;

    },

    [cachedRanges, isSegmentPreview, segmentOffset, segmentSpan, cacheEpsilon]

  );



  // 验证调度器 - 禁用自动定期验证以避免循环
  useEffect(() => {
    // 只启动调度器,不设置定期验证
    // 验证将通过 useEffect 在卡片变化时手动触发
    validationScheduler.isRunning = true;

    return () => {
      // 组件卸载时停止调度器
      validationScheduler.stop();
    };
  }, []);



  // 当卡片更新时，更新验证任务
  useEffect(() => {
    if (cards.length > 0) {
      if (!validationTaskInitializedRef.current) {
        // 首次初始化：添加任务
        validationScheduler.addTask(
          'my-cards',
          cards,
          (validated, total) => {
            console.log(`验证进度: ${validated}/${total}`);
          },
          (results) => {
            // 更新卡片的验证结果(不触发useEffect循环)
            setCards(prevCards => {
              const resultMap = new Map(results.map(r => [r.cardId, r.result]));

              // 使用 Map 来跟踪变化
              const updated = prevCards.map(card => {
                const newValidation = resultMap.get(card.id);
                if (!newValidation) return card;

                const oldValidation = card.validation;
                // 深度比较验证结果的关键字段
                const validationChanged =
                  !oldValidation ||
                  oldValidation.status !== newValidation.status ||
                  oldValidation.score !== newValidation.score ||
                  JSON.stringify(oldValidation.issues) !== JSON.stringify(newValidation.issues) ||
                  JSON.stringify(oldValidation.warnings) !== JSON.stringify(newValidation.warnings);

                return validationChanged ? { ...card, validation: newValidation } : card;
              });

              // 检查是否真的有变化
              const hasChanges = updated.some((card, i) => card !== prevCards[i]);

              return hasChanges ? updated : prevCards;
            });
          },
          cardValidator.quickValidate.bind(cardValidator)
        );
        validationTaskInitializedRef.current = true;
      } else {
        // 检查卡片是否真的变化了(通过ID和bvid比较)
        const existingTask = validationScheduler.tasks.get('my-cards');
        if (!existingTask) return; // 任务可能已被移除，跳过

        const existingIds = new Set(existingTask?.cards.map(c => c.id) || []);
        const newIds = new Set(cards.map(c => c.id));

        // 只有卡片ID列表变化时才更新
        const idsChanged =
          existingIds.size !== newIds.size ||
          ![...existingIds].every(id => newIds.has(id));

        if (idsChanged) {
          validationScheduler.updateTaskCards('my-cards', cards);
        }
      }
    } else {
      // cards 为空时，移除任务并重置初始化状态
      if (validationTaskInitializedRef.current) {
        validationScheduler.removeTask('my-cards');
        validationTaskInitializedRef.current = false;
      }
    }

  }, [cards.length]); // 只依赖 cards.length，而不是整个 cards 数组



  // 当社区搜索结果更新时，更新验证任?
  



  const isBufferedTime = useCallback(() => true, []);

  const requestPrefetch = useCallback(

    async (start, end) => {

      if (isDashMode) return;

      if (!activeCard?.bvid) return;

      const safeStart = clamp(start, rangeStart, rangeEnd);

      const safeEnd = clamp(end, safeStart + 0.1, rangeEnd);

      if (safeEnd <= safeStart) return;

      const key = `${activeCard.bvid}:${previewQuality}:${safeStart.toFixed(1)}:${safeEnd.toFixed(1)}`;

      const now = Date.now();

      if (prefetchRef.current.inflight) return;

      if (now - prefetchRef.current.lastAt < prefetchCooldownMs && prefetchRef.current.lastKey === key) {

        return;

      }

      prefetchRef.current = { inflight: true, lastKey: key, lastAt: now };

      try {

        const result = await window.preview?.prefetch({

          bvid: activeCard.bvid,

          quality: previewQuality,

          start: safeStart,

          end: safeEnd

        });

        if (result?.cachedRanges?.length) {

          result.cachedRanges.forEach((range) => {

            addCachedRange(activeCard.bvid, previewQuality, range.start, range.end);

          });

        }

        if (Number.isFinite(result?.duration) && result.duration > 0 && !sourceDuration) {

          setSourceDuration(result.duration);

        }

      } catch (err) {

        // ignore prefetch errors

      } finally {

        prefetchRef.current = { ...prefetchRef.current, inflight: false, lastAt: Date.now() };

      }

    },

    [

      activeCard?.bvid,

      previewQuality,

      rangeStart,

      rangeEnd,

      addCachedRange,

      sourceDuration,

      isDashMode

    ]

  );

  const resetDash = useCallback(() => {}, []);

  const appendNextDash = useCallback(() => {}, []);

  const enqueueDashSegment = useCallback(async () => {}, []);

  const ensureDashBuffer = useCallback(() => {}, []);

  const setupDashPlayback = useCallback(async () => "", []);

  const cachedSegments = useMemo(() => {

    if (!timelineSpan || !cachedRanges.length) return [];

    return cachedRanges

      .map((range, index) => {

        const start = clamp(range.start, 0, timelineSpan);

        const end = clamp(range.end, 0, timelineSpan);

        const width = Math.max(0, end - start);

        if (width <= 0) return null;

        return {

          id: `${activeCacheKey || "cache"}-${index}-${start.toFixed(2)}`,

          left: (start / timelineSpan) * 100,

          width: (width / timelineSpan) * 100

        };

      })

      .filter(Boolean);

  }, [cachedRanges, timelineSpan, activeCacheKey]);

  useEffect(() => {

    if (useEmbedPlayer) return;

    if (isDashMode) return;

    if (!activeCard?.bvid || !previewUrl) return;

    if (!timelineSpan || rangeEnd <= rangeStart) return;

    const now = clamp(currentTime, rangeStart, rangeEnd);

    const bufferAhead = getBufferAhead(now, cachedRanges, cacheEpsilon);

    const targetAhead = Math.min(prefetchAheadSeconds, rangeEnd - now);

    if (bufferAhead >= targetAhead - 0.1) return;

    const start = now + Math.max(0, bufferAhead - prefetchBehindSeconds);

    const end = Math.min(rangeEnd, now + prefetchAheadSeconds);

    if (end <= start) return;

    const missing = findMissingRange(start, end, cachedRanges, cacheEpsilon);

    if (!missing) return;

    requestPrefetch(missing.start, missing.end);

  }, [

    activeCard?.bvid,

    previewUrl,

    currentTime,

    rangeStart,

    rangeEnd,

    timelineSpan,

    cachedRanges,

    cacheEpsilon,

    prefetchAheadSeconds,

    prefetchBehindSeconds,

    requestPrefetch,

    isDashMode

  ]);

  const isOutsideRange = useCallback(

    (time) => time < rangeStart - rangeEpsilon || time > rangeEnd + rangeEpsilon,

    [rangeStart, rangeEnd]

  );

  const seekPlayer = useCallback(

    (timeValue) => {

      const clamped = clamp(timeValue, rangeStart, rangeEnd);

      setCurrentTime(clamped);

      sendPlayerCommand("seek", { time: clamped });

    },

    [rangeStart, rangeEnd, sendPlayerCommand]

  );

  const safePlay = useCallback(async () => {

    if (playRequestRef.current) return;

    playRequestRef.current = Promise.resolve();

    try {

      sendPlayerCommand("play");

    } finally {

      playRequestRef.current = null;

    }

  }, [sendPlayerCommand]);

  const togglePlayback = useCallback(async () => {

    if (!previewUrl) return;

    if (isOutsideRange(currentTime)) {

      seekPlayer(rangeStart);

    }

    if (isPlaying) {

      sendPlayerCommand("pause");

      setIsPlaying(false);

      return;

    }

    setIsBuffering(false);

    await safePlay();

    setIsPlaying(true);

  }, [

    isOutsideRange,

    rangeStart,

    safePlay,

    previewUrl,

    currentTime,

    isPlaying,

    seekPlayer,

    sendPlayerCommand

  ]);

  const toggleMute = useCallback(() => {

    setIsMuted((prev) => !prev);

  }, []);

  const handleVolumeChange = useCallback((event) => {

    const nextValue = Number(event.target.value);

    setVolume(nextValue);

    if (nextValue > 0 && muteRef.current) setIsMuted(false);

  }, []);

  const handleSurfaceClick = useCallback((event) => {

    if (isScrubbing) return;

    if (event.defaultPrevented) return;

    const target = event.target;

    if (target.closest(".timeline")) return;

    if (target.closest(".range-handle") || target.closest(".timeline-playhead")) return;

    if (target.closest("button, input, select, a")) return;

    togglePlayback();

  }, [isScrubbing, togglePlayback]);

  const markQueueResolved = useCallback((bvid, result) => {

    if (!bvid || !result?.url) return;

    if (Array.isArray(result.cachedRanges) && result.cachedRanges.length) {

      result.cachedRanges.forEach((range) => {

        addCachedRange(bvid, previewQuality, range.start, range.end);

      });

    } else if (Number.isFinite(result.segmentStart) && Number.isFinite(result.segmentEnd)) {

      addCachedRange(bvid, previewQuality, result.segmentStart, result.segmentEnd);

    }

    setParseQueue((prev) => {

      if (!prev.some((entry) => entry.bvid === bvid)) return prev;

      return prev.map((entry) =>

        entry.bvid === bvid

          ? {

              ...entry,

              status: "ready",

              url: result.url,

              title: result.title || entry.title || "",

              duration: Number.isFinite(result.duration)

                ? result.duration

                : entry.duration,

              segmentStart: Number.isFinite(result.segmentStart)

                ? result.segmentStart

                : entry.segmentStart,

              segmentEnd: Number.isFinite(result.segmentEnd)

                ? Math.min(

                    result.segmentEnd,

                    Number.isFinite(result.duration) && result.duration > 0

                      ? result.duration

                      : result.segmentEnd

                  )

                : entry.segmentEnd,

              error: ""

            }

          : entry

      );

    });

  }, [addCachedRange, previewQuality]);

  const markQueueError = useCallback((bvid, err) => {

    if (!bvid) return;

    setParseQueue((prev) => {

      if (!prev.some((entry) => entry.bvid === bvid)) return prev;

      return prev.map((entry) =>

        entry.bvid === bvid

          ? { ...entry, status: "error", error: err?.message || "解析失败" }

          : entry

      );

    });

  }, []);

  const requestThumbnail = useCallback(

    (time, type) => {

      const video = thumbVideoRef.current;

      const canvas = thumbCanvasRef.current;

      if (!video || !canvas || !previewUrl || isDashMode || useEmbedPlayer || !Number.isFinite(time)) return;

      const localTime = isSegmentPreview ? time - segmentOffset : time;

      const clamped = clamp(localTime, 0, previewSpan || localTime);

      const now = Date.now();

      if (

        thumbLastRef.current[type] !== null &&

        Math.abs(thumbLastRef.current[type] - clamped) < 0.05 &&

        now - thumbLastRef.current.ts < 120

      ) {

        return;

      }

      thumbLastRef.current[type] = clamped;

      thumbLastRef.current.ts = now;

      if (thumbQueueRef.current.busy) {

        thumbQueueRef.current.pending = { time: clamped, type };

        return;

      }

      thumbQueueRef.current.busy = true;

      const finalize = () => {

        thumbQueueRef.current.busy = false;

        const next = thumbQueueRef.current.pending;

        thumbQueueRef.current.pending = null;

        if (next) requestThumbnail(next.time, next.type);

      };

      const drawFrame = () => {

        const width = video.videoWidth || 320;

        const height = video.videoHeight || 180;

        if (!width || !height) {

          finalize();

          return;

        }

        canvas.width = width;

        canvas.height = height;

        const ctx = canvas.getContext("2d");

        if (!ctx) {

          finalize();

          return;

        }

        ctx.drawImage(video, 0, 0, width, height);

        try {

          const url = canvas.toDataURL("image/jpeg", 0.7);

          setThumbs((prev) => ({ ...prev, [type]: url }));

        } catch (err) {

          console.warn("thumbnail capture failed", err);

        }

        finalize();

      };

      const seekAndDraw = () => {

        const target = clamp(clamped, 0, previewSpan || clamped);

        if (Math.abs(video.currentTime - target) < 0.04 && video.readyState >= 2) {

          drawFrame();

          return;

        }

        const handleSeeked = () => {

          video.removeEventListener("seeked", handleSeeked);

          drawFrame();

        };

        video.addEventListener("seeked", handleSeeked, { once: true });

        try {

          video.currentTime = target;

        } catch (err) {

          video.removeEventListener("seeked", handleSeeked);

          drawFrame();

        }

      };

      if (video.readyState >= 2) {

        seekAndDraw();

        return;

      }

      const handleLoaded = () => {

        video.removeEventListener("loadeddata", handleLoaded);

        seekAndDraw();

      };

      video.addEventListener("loadeddata", handleLoaded);

    },

    [previewUrl, isSegmentPreview, segmentOffset, previewSpan, isDashMode, useEmbedPlayer]

  );

  useEffect(() => {

    parseQueueRef.current = parseQueue;

  }, [parseQueue]);

  useEffect(() => {

    setThumbs({ start: "", end: "" });

    setDragHandle(null);

  }, [previewUrl]);

  useEffect(() => {

    if (!isScrubbing || !dragHandle) return;

    if (dragHandle === "start") requestThumbnail(rangeStart, "start");

    if (dragHandle === "end") requestThumbnail(rangeEnd, "end");

  }, [isScrubbing, dragHandle, rangeStart, rangeEnd, requestThumbnail]);

  useEffect(() => {

    const switchToken = ++previewSwitchRef.current;

    setPreviewUrl("");

    setPreviewError("");

    setDuration(0);

    setCurrentTime(0);

    setSegmentSpan(0);

    setSegmentOffset(0);

    setSourceDuration(activeCard?.sourceDuration || 0);

    setIsPlaying(false);

    setIsBuffering(false);

    setIsDashMode(false);

    setIsLoadingPreview(false);

    setIsResolving(false);

    resetDash();

    if (!activeCard?.bvid) {

      return;

    }

    const nextStart = Number.isFinite(activeCard.start) ? activeCard.start : 0;

    const durationCap = Number.isFinite(activeCard.sourceDuration)

      ? activeCard.sourceDuration

      : 0;

    const fallbackEnd = durationCap ? Math.min(30, durationCap) : 30;

    const nextEnd = Number.isFinite(activeCard.end) ? activeCard.end : fallbackEnd;

    setRangeStart(nextStart);

    setRangeEnd(nextEnd);

    lastRangeStartRef.current = nextStart;

    setCurrentTime(nextStart);

    if (activeCard.source === "local") {

      return;

    }

    const embedUrl =

      activeCard.resolvedUrl ||

      buildEmbedUrl({ bvid: activeCard.bvid, aid: activeCard.aid, cid: activeCard.cid });

    const timer = setTimeout(() => {

      if (previewSwitchRef.current !== switchToken) return;

      setPreviewUrl(embedUrl);

    }, 0);

    return () => clearTimeout(timer);

  }, [

    activeId,

    activeCard?.bvid,

    previewQuality,

    resetDash,

    activeCardInLibrary,

    previewEpoch

  ]);

  useEffect(() => {

    if (!Number.isFinite(sourceDuration) || sourceDuration <= 0) return;

    if (rangeEnd <= sourceDuration) return;

    const nextEnd = sourceDuration;

    const nextStart = Math.min(rangeStart, nextEnd);

    setRangeStart(nextStart);

    setRangeEnd(nextEnd);

    lastRangeStartRef.current = nextStart;

    setCurrentTime((prev) => (prev > nextEnd ? nextStart : prev));

  }, [sourceDuration, rangeEnd, rangeStart]);

  useEffect(() => {

    if (!activeCard?.bvid || isScrubbing) return;

    if (!previewUrl) return;

    sendPlayerCommand("range", { start: rangeStart, end: rangeEnd });

  }, [activeCard?.bvid, isScrubbing, previewUrl, rangeStart, rangeEnd, sendPlayerCommand]);

  useEffect(() => {

    if (!activeId?.startsWith("source-")) return;

    const bvid = activeId.replace("source-", "");

    const entry = parseQueue.find((item) => item.bvid === bvid);

    if (!entry) return;

    if (Number.isFinite(entry.duration) && entry.duration > 0 && entry.duration !== sourceDuration) {

      setSourceDuration(entry.duration);

    }

    setPreviewSource((prev) => {

      if (!prev || prev.bvid !== bvid) return prev;

      const next = {

        ...prev,

        title: entry.title || prev.title,

        resolvedUrl: entry.url || prev.resolvedUrl,

        segmentStart: Number.isFinite(entry.segmentStart) ? entry.segmentStart : prev.segmentStart,

        segmentEnd: Number.isFinite(entry.segmentEnd) ? entry.segmentEnd : prev.segmentEnd,

        sourceDuration:

          Number.isFinite(entry.duration) && entry.duration > 0 ? entry.duration : prev.sourceDuration

      };

      const changed =

        next.title !== prev.title ||

        next.resolvedUrl !== prev.resolvedUrl ||

        next.segmentStart !== prev.segmentStart ||

        next.segmentEnd !== prev.segmentEnd ||

        next.sourceDuration !== prev.sourceDuration;

      return changed ? next : prev;

    });

  }, [activeId, parseQueue, sourceDuration]);

    useRangeRefSync({
    rangeStart,
    rangeEnd,
    isSegmentPreview,
    segmentOffset,
    previewSpan,
    rangeRef,
    clamp
  });

  usePlayerMediaSync({
    volume,
    isMuted,
    playbackRate,
    volumeRef,
    muteRef,
    rateRef,
    sendPlayerCommand
  });


  useLocalPlayerHotkeys({
    clamp,
    currentTime,
    isPlaying,
    keyHoldRef,
    muteRef,
    previewUrl,
    rangeRef,
    rateRef,
    safePlay,
    seekPlayer,
    setIsMuted,
    setIsPlaying,
    setPlaybackRate,
    setVolume,
    toggleMute,
    togglePlayback,
    volumeRef
  });


  const enqueueParseSources = () => {

    const raw = parseInput.trim();

    if (!raw) return;

    const entries = raw.split(/[\s,;]+/).map((item) => item.trim()).filter(Boolean);

    setParseQueue((prev) => {

      const existing = new Set(prev.filter((item) => item.bvid).map((item) => item.bvid));

      const next = [...prev];

      entries.forEach((source) => {

        const bvid = extractBvid(source);

        if (!bvid) {

          next.push({

            id: `invalid-${Date.now()}-${Math.random().toString(16).slice(2)}`,

            source,

            bvid: "",

            status: "invalid",

            error: "无效的 BV 号"

          });

          return;

        }

        if (existing.has(bvid)) return;

        existing.add(bvid);

        next.push({

          id: `queue-${bvid}-${Date.now()}`,

          source,

          bvid,

          status: "pending",

          error: ""

        });

      });

      return next;

    });

    setParseInput("");

  };

  const resolveQueueItem = useCallback(async (item, options = {}) => {

    setParseQueue((prev) =>

      prev.map((entry) => (entry.id === item.id ? { ...entry, status: "resolving", error: "" } : entry))

    );

    try {

      const info = await window.preview?.info({ bvid: item.bvid });

      if (!info) {

        throw new Error("解析失败");

      }

      const resolvedDuration = Number.isFinite(info.duration) ? info.duration : item.duration;

      setParseQueue((prev) =>

        prev.map((entry) =>

          entry.id === item.id

            ? {

                ...entry,

                status: "ready",

                url: buildEmbedUrl({ bvid: item.bvid, aid: info?.aid, cid: info?.cid }),

                title: info.title || entry.title || "",

                duration: resolvedDuration,

                aid: info?.aid || entry.aid,

                cid: info?.cid || entry.cid,

                segmentStart: entry.segmentStart,

                segmentEnd: entry.segmentEnd,

                error: ""

              }

            : entry

        )

      );

    } catch (err) {

      setParseQueue((prev) =>

        prev.map((entry) =>

          entry.id === item.id ? { ...entry, status: "error", error: err?.message || "解析失败" } : entry

        )

      );

    }

  }, [previewQuality]);

  const resolveParseQueue = useCallback(async (mode = "pending") => {

    if (isBatchResolving) return;

    const statuses = mode === "failed" ? ["error"] : ["pending"];

    const pending = parseQueueRef.current.filter((item) => statuses.includes(item.status));

    if (!pending.length) return;

    setIsBatchResolving(true);

    const concurrency = 3;

    let index = 0;

    const workers = Array.from({ length: Math.min(concurrency, pending.length) }, async () => {

      while (index < pending.length) {

        const current = pending[index++];

        if (!current?.bvid) continue;

        await resolveQueueItem(current);

      }

    });

    await Promise.all(workers);

    setIsBatchResolving(false);

  }, [isBatchResolving, resolveQueueItem]);

  useEffect(() => {

    if (isQueueResolving || isBatchResolving) return;

    const hasPending = parseQueueRef.current.some((item) => item.status === "pending");

    if (!hasPending) return;

    resolveParseQueue("pending");

  }, [parseQueue, isQueueResolving, isBatchResolving, resolveParseQueue]);

  const handleQueuePreview = (item) => {

    if (!item?.bvid) return;

    const bvid = item.bvid;

    const existing = parseQueueRef.current.find((entry) => entry.bvid === bvid);

    const resolvedDuration = Number.isFinite(item.duration)

      ? item.duration

      : Number.isFinite(existing?.duration)

        ? existing.duration

        : 0;

    setParseQueue((prev) => {

      const index = prev.findIndex((entry) => entry.bvid === bvid);

      if (index === -1) {

        return [

          ...prev,

          {

            id: `queue-${bvid}-${Date.now()}`,

            source: item.source || bvid,

            bvid,

            status: item.url ? "ready" : "pending",

            url: item.url || "",

      title: item.title || existing?.title || "加载中...",

            duration: resolvedDuration,

            aid: item.aid || "",

            cid: item.cid || "",

            segmentStart: item.segmentStart,

            segmentEnd: item.segmentEnd,

            error: ""

          }

        ];

      }

      const current = prev[index];

      const next = {

        ...current,

        title: current.title || item.title || "",

        duration:

          Number.isFinite(current.duration) && current.duration > 0

            ? current.duration

            : resolvedDuration,

        aid: current.aid || item.aid || "",

        cid: current.cid || item.cid || "",

        url: current.url || item.url || "",

        segmentStart:

          Number.isFinite(current.segmentStart) ? current.segmentStart : item.segmentStart,

        segmentEnd:

          Number.isFinite(current.segmentEnd) ? current.segmentEnd : item.segmentEnd,

        status: current.status === "error" ? "pending" : current.status

      };

      const changed = Object.keys(next).some((key) => next[key] !== current[key]);

      if (!changed) return prev;

      return prev.map((entry, i) => (i === index ? next : entry));

    });

    const previewCard = {

      id: `source-${bvid}`,

      title: item.title || existing?.title || "加载中...",

      start: 0,

      end: resolvedDuration ? Math.min(30, resolvedDuration) : 30,

      bvid,

      tags: form.tags,

      bpm: form.bpm,

      notes: form.notes,

      visibility: form.visibility,

      aid: item.aid || existing?.aid || "",

      cid: item.cid || existing?.cid || "",

      resolvedUrl:

        item.url ||

        existing?.url ||

        buildEmbedUrl({ bvid, aid: item.aid || existing?.aid, cid: item.cid || existing?.cid }),

      segmentStart: item.segmentStart,

      segmentEnd: item.segmentEnd,

      sourceDuration: resolvedDuration

    };

    setPreviewEpoch((prev) => prev + 1);

    setPreviewSource(previewCard);

    setActiveId(previewCard.id);

  };

  const handleQueueUse = (item) => {

    if (!item?.bvid) return;

    setForm((prev) => ({

      ...prev,

      title: prev.title || item.title || "",

      source: item.source || item.bvid || prev.source

    }));

  };

  const {
    searchSuggestion,
    searchQuery,
    setSearchQuery,
    searchUrl,
    setSearchUrl,
    isSearchLoading,
    showSearchOverlay,
    setShowSearchOverlay,
    searchDebugLines,
    handleSearchSubmit
  } = useBiliSearchOverlay({
    searchWebviewRef,
    searchResultsLimit,
    handleQueuePreview,
    patchSearchWebviewIframeHeight,
    extractBvid
  });

  const {
    communitySession,
    setCommunitySession,
    communityLogin,
    setCommunityLogin,
    communityStatus,
    setCommunityStatus,
    communityMyCards,
    setCommunityMyCards,
    communitySearchQuery,
    setCommunitySearchQuery,
    communitySearchSort,
    setCommunitySearchSort,
    communityCardResults,
    setCommunityCardResults,
    showCommunityAuth,
    setShowCommunityAuth,
    communityAuthMode,
    setCommunityAuthMode,
    openCommunityLogin,
    openCommunityRegister,
    handleCommunityLogin,
    handleCommunityRegister,
    handleCommunityLogout,
    handleToggleCardVisibility,
    handleDeleteCard,
    handleToggleCardFavorite,
    favoriteCards,
    favoriteCardIds,
    refreshCommunitySearch,
    loadCommunitySession,
    filteredManageCards,
    filteredCommunityCards,
    manageFilter,
    setManageFilter,
    manageSearch,
    setManageSearch,
    manageSelected,
    setManageSelected,
    handleToggleManageSelect,
    handleSelectAllManageTags,
    handleClearManageSelection,
    handleBulkVisibility,
    handleRevalidateCards
  } = useCommunityManager({
    getSession,
    getCards,
    login,
    logout,
    register,
    searchCardsPublic,
    updateCard,
    deleteCard,
    getCardFavorites,
    toggleCardFavorite,
    hydrateCard,
    validateCards,
    normalizeCardTags,
    setCards
  });

  // 收藏夹管理
  const {
    collections,
    publicCollections,
    loading: collectionsLoading,
    createCollection,
    updateCollection,
    deleteCollection,
    toggleCardInCollection
  } = useCollectionManager(communitySession?.id);

  useEffect(() => {
    if (communityCardResults.length > 0) {
      if (!communityValidationTaskInitializedRef.current) {
        // 首次初始化：添加任务
        validationScheduler.addTask(
          'community-search',
          communityCardResults,
          (validated, total) => {
            console.log(`社区搜索验证进度: ${validated}/${total}`);
          },
          (results) => {
            // 更新卡片的验证结果(不触发useEffect循环)
            setCommunityCardResults(prevCards => {
              const resultMap = new Map(results.map(r => [r.cardId, r.result]));
              const updated = prevCards.map(card => ({
                ...card,
                validation: resultMap.get(card.id) || card.validation
              }));

              // 只有验证结果真正变化时才返回新数组
              const hasChanges = updated.some((card, i) =>
                JSON.stringify(card.validation) !== JSON.stringify(prevCards[i].validation)
              );

              return hasChanges ? updated : prevCards;
            });
          },
          cardValidator.quickValidate.bind(cardValidator)
        );
        communityValidationTaskInitializedRef.current = true;
      } else {
        // 检查卡片是否真的变化了(通过ID比较)
        const existingTask = validationScheduler.tasks.get('community-search');
        if (!existingTask) return; // 任务可能已被移除，跳过

        const existingIds = new Set(existingTask?.cards.map(c => c.id) || []);
        const newIds = new Set(communityCardResults.map(c => c.id));

        // 只有卡片ID列表变化时才更新
        const idsChanged =
          existingIds.size !== newIds.size ||
          ![...existingIds].every(id => newIds.has(id));

        if (idsChanged) {
          validationScheduler.updateTaskCards('community-search', communityCardResults);
        }
      }
    } else {
      // communityCardResults 为空时，移除任务并重置初始化状态
      if (communityValidationTaskInitializedRef.current) {
        validationScheduler.removeTask('community-search');
        communityValidationTaskInitializedRef.current = false;
      }
    }

  }, [communityCardResults.length]); // 只监听长度变化，而不是整个数组
  
  useCommunityPreviewWebview({
    webviewCommunityIds,
    communityCardResults,
    communityLoadingState,
    setCommunityLoadingState,
    setPreviewCurrentTime,
    markWebviewReady,
    hoveredCommunityId
  });


   // 叜组件挂载时执行一?


  const parseQueueRef = useRef([]);


  const [thumbs, setThumbs] = useState({ start: "", end: "" });

  const prefetchRef = useRef({ inflight: false, lastKey: "", lastAt: 0 });




  const initializeCardPreview = useCallback((webview, bvid, start) => {

    if (!webview) return;

    webview.addEventListener('dom-ready', () => {

      setTimeout(() => {

        webview.executeJavaScript(`          (function() {            const video = document.querySelector('video');            if (video) {              video.pause();              const targetTime = ${Number.isFinite(start) ? start : 0};              if (targetTime > 0 && Math.abs(video.currentTime - targetTime) > 0.5) {                video.currentTime = targetTime;              }            }            const player = document.querySelector('.bpx-player-container');            if (player) {              player.style.pointerEvents = 'none';            }          })();        `).catch(() => {});

      }, 500);

    });

  }, []);

  useEffect(() => {

    const root = document.documentElement;

    const topbar = document.querySelector(".topbar");

    if (!topbar || !root) return;

    const update = () => {

      const height = topbar.getBoundingClientRect().height;

      if (height) root.style.setProperty("--topbar-height", `${height}px`);

    };

    update();

    let observer;

    if (typeof ResizeObserver !== "undefined") {

      observer = new ResizeObserver(update);

      observer.observe(topbar);

    }

    window.addEventListener("resize", update);

    return () => {

      window.removeEventListener("resize", update);

      observer?.disconnect();

      if (manageWebviewTimerRef.current) {

        clearTimeout(manageWebviewTimerRef.current);

      }

      if (communityWebviewTimerRef.current) {

        clearTimeout(communityWebviewTimerRef.current);

      }

    };

  }, []);

  
  useManagePreviewWebview({
    webviewManageIds,
    communityMyCards,
    manageLoadingState,
    setManageLoadingState,
    setPreviewCurrentTime,
    markWebviewReady
  });



  const handleQueueRemove = (id) => {

    setParseQueue((prev) => prev.filter((item) => item.id !== id));

  };

  const handlePreviewCard = (card) => {

    setPreviewEpoch((prev) => prev + 1);

    setPreviewSource(null);

    setActiveId(card.id);

  };

  const syncCardRange = useCallback(
    (startValue, endValue) => {
      setRangeStart(startValue);
      setRangeEnd(endValue);
      lastRangeStartRef.current = startValue;
      lastRangeUpdateRef.current = Date.now();
      if (!activeCardInLibrary) return;
      setCards((prev) =>
        prev.map((card) =>
          card.id === activeId ? { ...card, start: startValue, end: endValue } : card
        )
      );
      setSelection((prev) =>
        prev.map((card) =>
          card.id === activeId ? { ...card, start: startValue, end: endValue } : card
        )
      );
    },
    [activeCardInLibrary, activeId]
  );
  const updateRangeState = useCallback(

    (startValue, endValue) => {

      setRangeStart(startValue);

      setRangeEnd(endValue);

      syncCardRange(startValue, endValue);

      lastRangeStartRef.current = startValue;

      lastRangeUpdateRef.current = Date.now();

    },

    [syncCardRange]

  );

  const {
    handleAddCard,
    handleAddTag,
    handleRemoveTag,
    handleTagKeyDown,
    handleApplyCardTags,
    clipTagGroups,
    toggleClipTag
  } = useCardFormActions({
    communitySession,
    setCommunityStatus,
    openCommunityLogin,
    searchSourceType,
    form,
    activeCard,
    extractBvid,
    selectedLocalFile,
    localVideoInfo,
    rangeStart,
    rangeEnd,
    tagList,
    setTagList,
    clipTags,
    setClipTags,
    tagInput,
    setTagInput,
    createCard,
    hydrateCard,
    setCards,
    loadCommunitySession,
    refreshCommunitySearch,
    setSaveNotice,
    setForm,
    setLocalVideoInfo,
    setSelectedLocalFile,
    normalizeCardTags,
    saveNotice
  });
  const handleSelect = (card) => {

    setSelection((prev) => {

      if (prev.find((item) => item.id === card.id)) return prev;

      return [...prev, card];

    });

  };

  const handleRemove = (cardId) => {

    setSelection((prev) => prev.filter((item) => item.id !== cardId));

  };

  const handleGenerate = async (mode) => {

    if (selection.length === 0) {

      alert("请至少添加一个标签。");

      return;

    }

    setStatus("running");

    setProgress([]);

    const payload = { mode, selection };

    const result = await window.generator?.run(payload);

    if (!result?.ok) {

      alert(result?.message || "生成器不可用");

      setStatus("idle");

      return;

    }

    setStatus("done");

    alert(`${result.message}${result.outputPath || ""}`);

  };

  const handleLogin = async () => {

    if (!window.auth) {
      setAuthStatus("unavailable");
      alert("无法登录");

      return;

    }

    setAuthStatus("logging in");

    try {

      const result = await window.auth?.login();

      if (result?.cancelled) {

        setAuthStatus("not logged in");

        return;

      }

      const status = await window.auth?.status();

      setAuthStatus(status?.cookiePath ? "logged in" : "not logged in");

      if (previewUrl && webviewRef.current) {

        webviewRef.current.reload();

      }

    } catch (err) {

      setAuthStatus("not logged in");

      alert(err?.message || "登录失败。");

    }

  };

  const handleBiliLogout = async () => {

    if (!window.auth?.logout) {

      setAuthStatus("unavailable");

      return;

    }

    try {

      await window.auth.logout();

    } catch {}

    setAuthStatus("not logged in");

    if (previewUrl && webviewRef.current) {

      webviewRef.current.reload();

    }

  };

  const handleReload = () => {

    window.location.reload();

  };

  useEffect(() => {

    let active = true;

    const hydrateAuth = async () => {

      if (!window.auth?.status) return;

      try {

        const status = await window.auth.status();

        if (!active) return;

        setAuthStatus(status?.cookiePath ? "logged in" : "not logged in");

        if (previewUrl && webviewRef.current) {

          webviewRef.current.reload();

        }

      } catch {

        if (!active) return;

        setAuthStatus("not logged in");

      }

    };

    hydrateAuth();

    return () => {

      active = false;

    };

  }, []);

  const handleResolvePreview = useCallback(() => {

    if (!activeCard) return;

    if (isResolving) return;

    resetDash();

    setIsDashMode(false);

    setPreviewUrl("");

    setPreviewError("");

    setIsResolving(true);

    resolvingRef.current = true;

    try {

      const nextUrl = buildVideoUrl({
        bvid: activeCard.bvid,
        start: rangeStart
      });
      const resolvedUrl = activeCard.resolvedUrl || nextUrl;
      console.log("[预览] 使用地址:", resolvedUrl);
      setPreviewUrl(resolvedUrl);
      setIsBuffering(false);

    } catch (err) {

      setPreviewError(err?.message || "预览加载失败。");

    } finally {

      resolvingRef.current = false;

      setIsResolving(false);

    }

  }, [activeCard, isResolving, resetDash]);

  const handlePreviewExternalCard = useCallback(

    (card) => {

      if (!card?.bvid) return;

      const startValue = Number.isFinite(card.start) ? card.start : 0;

      const endValue = Number.isFinite(card.end) ? card.end : startValue + 30;

      updateRangeState(startValue, endValue);

      const nextCard = {

        ...card,

        id: card.id || `public-${card.bvid}`

      };

      setPreviewEpoch((prev) => prev + 1);

      setPreviewSource(nextCard);

      setActiveId(nextCard.id);

      setPreviewError("");

      const nextUrl = buildVideoUrl({ bvid: nextCard.bvid, start: startValue });
      console.log("[预览] 使用地址:", nextUrl);
      setPreviewUrl(nextUrl);
    },

    [updateRangeState]

  );

  const {
    handleOpenCardDetail,
    handleCloseDetail
  } = useDetailPanel({
    setDetailCard,
    setDetailWebviewLoading,
    detailWebviewKeyRef,
    setPreviewPanelKey,
    setPreviewEpoch,
    setActiveId,
    setPreviewSource,
    setPreviewUrl,
    setPreviewError,
    setDuration,
    setCurrentTime,
    setRangeStart,
    setRangeEnd,
    setSegmentSpan,
    setSegmentOffset,
    setSourceDuration,
    setIsPlaying,
    setIsBuffering,
    setIsDashMode,
    setIsLoadingPreview,
    setIsResolving,
    resetDash
  });
  const handleSetPoint = (field) => {

    if (!Number.isFinite(currentTime)) return;

    const timeValue = Math.floor(currentTime * 10) / 10;

    const absoluteTime = timeValue;

    if (field === "start") {

      const nextStart = clamp(absoluteTime, 0, rangeEnd);

      updateRangeState(nextStart, rangeEnd);

      return;

    }

    const maxValue = sourceDuration || duration || absoluteTime;

    const nextEnd = clamp(absoluteTime, rangeStart, maxValue);

    updateRangeState(rangeStart, nextEnd);

  };

  const handleRangeChange = (nextStart, nextEnd) => {

    const maxValue = sourceDuration || duration || Math.max(30, rangeEnd, nextEnd);

    const safeStart = clamp(nextStart, 0, maxValue);

    const minSpan = 0.1;

    const safeEnd = clamp(nextEnd, safeStart + minSpan, maxValue);

    updateRangeState(safeStart, safeEnd);

  };

  useEffect(() => {

    if (!useEmbedHijack) return;

    webviewReadyRef.current = false;

    pendingCommandsRef.current = [];

  }, [previewUrl, useEmbedHijack]);

  usePreviewWebviewLifecycle({
    previewUrl,
    activeId,
    webviewRef,
    useEmbedHijack,
    rangePollRef,
    lastRangeUpdateRef,
    rangeStart,
    rangeEnd,
    updateRangeState,
    setTagList,
    setTagInput,
    setForm,
    setCurrentTime,
    setDuration,
    setIsPlaying,
    setIsBuffering,
    setIsLoadingPreview,
    volume,
    isMuted,
    playbackRate,
    webviewReadyRef,
    pendingCommandsRef,
    patchWebviewIframeHeight,
    setTimeHighlight
  });

  const {
    handleTimelineMouseDown,
    handleStartHandleMouseDown,
    handleEndHandleMouseDown,
    handleRangeMouseDown,
    handleTimelineHover
  } = useTimelineScrub({
    timelineRef,
    timelineSpan,
    rangeStart,
    rangeEnd,
    handleRangeChange,
    isOutsideRange,
    safePlay,
    currentTime,
    seekPlayer,
    isPlaying,
    sendPlayerCommand,
    setIsPlaying,
    setIsScrubbing,
    setIsHovering,
    setDragHandle,
    setHoverPercent,
    setHoverTime,
    dragRef,
    wasPlayingRef,
    lastRangeStartRef,
    clamp
  });
  const location = useLocation();

  const currentPath = location.pathname || "/";

  const isBuilderPage = currentPath === "/" || currentPath.startsWith("/builder");

  const normalizedAuth = authStatus?.toLowerCase?.() || "";



  // 监听跔变?当切换回卡片制作页面时强制刷新览?

  const previousPathRef = useRef(null);

  useEffect(() => {

    const previousPath = previousPathRef.current;

    const currentPath = location.pathname || "/";



    // 叜跾真变化时?

    if (previousPath !== currentPath) {

      // 叜切换到卡片制作页根路径?builder)时执?
      if (currentPath === "/" || currentPath.startsWith("/builder")) {

      // 又新览栏相关的状?
        setPreviewPanelKey(prev => prev + 1);

        setPreviewEpoch(prev => prev + 1);

        setPreviewUrl("");

        setPreviewError("");

        setIsLoadingPreview(false);

        setIsResolving(false);

      }



      // 更新上一次的跾

      previousPathRef.current = currentPath;

    }

  }, [location.pathname]);



  usePreviewPreload({
    locationPathname: location.pathname,
    cards,
    communityCardResults,
    managePreloaded,
    setManagePreloaded,
    communityPreloaded,
    setCommunityPreloaded,
    webviewManageIds,
    setWebviewManageIds,
    manageLoadingState,
    setManageLoadingState,
    webviewCommunityIds,
    setWebviewCommunityIds,
    communityLoadingState,
    setCommunityLoadingState,
    manageWebviewTimerRef,
    communityWebviewTimerRef
  });
  const appContextValue = {
    searchSourceType,
    setSearchSourceType,
    handleSearchSubmit,
    searchQuery,
    setSearchQuery,
    searchSuggestion,
    searchWebviewRef,
    searchUrl,
    isSearchLoading,
    showSearchOverlay,
    bilibiliUserAgent,
    localVideoFolder,
    setLocalVideoFolder,
    localVideoList,
    setLocalVideoList,
    selectedLocalFile,
    setSelectedLocalFile,
    localVideoInfo,
    setLocalVideoInfo,
    setRangeStart,
    setRangeEnd,
    setDuration,
    setSourceDuration,
    setActiveId,
    setPreviewSource,
    previewPanelKey,
    activeCard,
    LocalVideoPlayer,
    localVideoRef,
    previewUrl,
    webviewRef,
    isLoadingPreview,
    isResolving,
    previewError,
    handleResolvePreview,
    previewEpoch,
    formatTime,
    rangeStart,
    rangeEnd,
    tagInput,
    setTagInput,
    handleTagKeyDown,
    handleAddTag,
    tagList,
    handleRemoveTag,
    clipTagGroups,
    clipTags,
    toggleClipTag,
    form,
    setForm,
    handleAddCard,
    communityStatus,
    saveNotice,
    cards,
    setIsPlaying,
    syncCardRange,
    communitySession,
    communityMyCards,
    openCommunityLogin,
    openCommunityRegister,
    handleCommunityLogout,
    handleToggleCardVisibility,
    handleDeleteCard,
    handleToggleCardFavorite,
    favoriteCards,
    favoriteCardIds,
    handleOpenCardDetail,
    handleCloseDetail,
    detailCard,
    manageFilter,
    setManageFilter,
    manageSearch,
    setManageSearch,
    manageSelected,
    handleToggleManageSelect,
    handleSelectAllManageTags,
    handleClearManageSelection,
    handleRevalidateCards,
    handleBulkVisibility,
    filteredManageCards,
    setTooltip,
    setHoveredManageId,
    setHoveredManageBvid,
    handleManageHoverStart,
    handleManageHoverEnd,
    setWebviewManageIds,
    setManageLoadingState,
    webviewManageIds,
    manageLoadingState,
    previewCurrentTime,
    setPreviewCurrentTime,
    hoveredManageId,
    LocalCardPreview,
    buildCardPreviewUrl,
    setWebviewPreviewPlayback,
    communitySearchQuery,
    setCommunitySearchQuery,
    communitySearchSort,
    setCommunitySearchSort,
    refreshCommunitySearch,
    communityCardResults,
    setHoveredCommunityId,
    setHoveredCommunityBvid,
    handleCommunityHoverStart,
    handleCommunityHoverEnd,
    setWebviewCommunityIds,
    setCommunityLoadingState,
    webviewCommunityIds,
    communityLoadingState,
    hoveredCommunityId,
    formatCardId,
    getCardIdShort,
    isValidCVId,
    timeHighlight,
    setTimeHighlight,
    // 收藏夹管理
    collections,
    publicCollections,
    collectionsLoading,
    createCollection,
    updateCollection,
    deleteCollection,
    toggleCardInCollection
  };

  const isLoggedIn = normalizedAuth === "logged in";

  const isLoggingIn = normalizedAuth === "logging in";

  const isUnavailable = normalizedAuth === "unavailable";

  return (
    <AppContext.Provider value={appContextValue}>
      <div className="app">

      <Topbar
        isLoggedIn={isLoggedIn}
        isLoggingIn={isLoggingIn}
        isUnavailable={isUnavailable}
        handleLogin={handleLogin}
        communitySession={communitySession}
        openCommunityLogin={openCommunityLogin}
        handleReload={handleReload}
        handleCommunityLogout={handleCommunityLogout}
        handleBiliLogout={handleBiliLogout}
        placeholderAvatar={placeholderAvatar}
      />
      <main className={isBuilderPage ? "workspace" : "workspace workspace--single"}>
        <AppRoutes />
      </main>

      <CommunityAuthModal
        open={showCommunityAuth}
        communityAuthMode={communityAuthMode}
        communityLogin={communityLogin}
        communityStatus={communityStatus}
        setCommunityLogin={setCommunityLogin}
        setCommunityAuthMode={setCommunityAuthMode}
        setShowCommunityAuth={setShowCommunityAuth}
        handleCommunityLogin={handleCommunityLogin}
        handleCommunityRegister={handleCommunityRegister}
      />


      <TooltipLayer tooltip={tooltip} />

      <CardDetailPanel
        card={detailCard}
        onClose={handleCloseDetail}
        app={{
          localVideoRef,
          bilibiliUserAgent,
          formatTime,
          setIsPlaying,
          setIsBuffering
        }}
      />

      </div>
    </AppContext.Provider>
  );

}






























