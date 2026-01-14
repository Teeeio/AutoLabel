import { useCallback, useEffect, useMemo, useRef, useState } from "react";

function extractBvid(input) {
  if (!input) return "";
  const trimmed = input.trim();
  const directMatch = trimmed.match(/BV[0-9A-Za-z]{10}/);
  if (directMatch) return directMatch[0];
  return "";
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function formatTime(value) {
  if (!Number.isFinite(value)) return "00:00";
  const total = Math.max(0, Math.floor(value));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function buildEmbedUrl({ bvid, aid, cid }) {
  if (!bvid) return "";
  const params = new URLSearchParams();
  params.set("p", "1");
  if (aid) params.set("aid", aid);
  if (cid) params.set("cid", cid);
  return `https://www.bilibili.com/video/${bvid}?${params.toString()}`;
}

const bilibiliUserAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

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
  const [isDashMode, setIsDashMode] = useState(false);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [dragHandle, setDragHandle] = useState(null);
  const [authStatus, setAuthStatus] = useState("not logged in");
  const [previewQuality, setPreviewQuality] = useState("720p");
  const [duration, setDuration] = useState(0);
  const [sourceDuration, setSourceDuration] = useState(0);
  const [segmentOffset, setSegmentOffset] = useState(0);
  const [segmentSpan, setSegmentSpan] = useState(0);
  const [rangeStart, setRangeStart] = useState(0);
  const [rangeEnd, setRangeEnd] = useState(30);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [hoverTime, setHoverTime] = useState(0);
  const [hoverPercent, setHoverPercent] = useState(0);
  const [isHovering, setIsHovering] = useState(false);
  const webviewRef = useRef(null);
  const webviewReadyRef = useRef(false);
  const pendingCommandsRef = useRef([]);
  const timelineRef = useRef(null);
  const resolvingRef = useRef(false);
  const dragRef = useRef({ type: null, startX: 0, start: 0, end: 0 });
  const wasPlayingRef = useRef(false);
  const lastRangeStartRef = useRef(rangeStart);
  const playRequestRef = useRef(null);
  const keyHoldRef = useRef({ key: null, timeout: null, raf: null, long: false, lastRate: 1, lastFrame: null });
  const thumbVideoRef = useRef(null);
  const thumbCanvasRef = useRef(null);
  const thumbQueueRef = useRef({ busy: false, pending: null });
  const thumbLastRef = useRef({ start: null, end: null, ts: 0 });
  const resolveKeyRef = useRef("");
  const rangeRef = useRef({ start: rangeStart, end: rangeEnd });
  const rangePollRef = useRef({ busy: false });
  const lastRangeUpdateRef = useRef(0);
  const previewSwitchRef = useRef(0);
  const volumeRef = useRef(volume);
  const muteRef = useRef(isMuted);
  const rateRef = useRef(playbackRate);
  const dashRef = useRef({
    active: false,
    info: null,
    objectUrl: "",
    videoBuffer: null,
    audioBuffer: null,
    queues: { video: [], audio: [] },
    appended: { video: new Set(), audio: new Set() },
    pending: { video: new Set(), audio: new Set() }
  });
  const [form, setForm] = useState({
    title: "",
    artist: "",
    source: "",
    tags: "",
    bpm: ""
  });
  const [tagInput, setTagInput] = useState("");
  const [tagList, setTagList] = useState([]);
  const [clipTags, setClipTags] = useState([]);
  const [parseInput, setParseInput] = useState("");
  const [parseQueue, setParseQueue] = useState([]);
  const [isBatchResolving, setIsBatchResolving] = useState(false);
  const [searchQuery, setSearchQuery] = useState("lovelive");
  const [searchUrl, setSearchUrl] = useState(
    "https://search.bilibili.com/all?keyword=lovelive"
  );
  const [isSearchLoading, setIsSearchLoading] = useState(false);
  const [searchDebugLines, setSearchDebugLines] = useState([]);
  const parseQueueRef = useRef([]);
  const [cachedRangesMap, setCachedRangesMap] = useState({});
  const [previewSource, setPreviewSource] = useState(null);
  const [thumbs, setThumbs] = useState({ start: "", end: "" });
  const prefetchRef = useRef({ inflight: false, lastKey: "", lastAt: 0 });
  const searchWebviewRef = useRef(null);
  const useEmbedPlayer = true;
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
        artist: activeCard.artist || prev.artist || "",
        source: activeCard.bvid || prev.source || ""
      };
      if (
        next.title === prev.title &&
        next.artist === prev.artist &&
        next.source === prev.source
      ) {
        return prev;
      }
      return next;
    });
  }, [activeCard?.title, activeCard?.artist, activeCard?.bvid]);
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
          ? { ...entry, status: "error", error: err?.message || "Resolve failed" }
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

  useEffect(() => {
    const localStart = isSegmentPreview ? clamp(rangeStart - segmentOffset, 0, previewSpan) : rangeStart;
    const localEnd = isSegmentPreview ? clamp(rangeEnd - segmentOffset, 0, previewSpan) : rangeEnd;
    rangeRef.current = { start: localStart, end: localEnd };
  }, [rangeStart, rangeEnd, isSegmentPreview, segmentOffset, previewSpan]);

  useEffect(() => {
    volumeRef.current = volume;
    muteRef.current = isMuted;
    sendPlayerCommand("volume", { value: volume, muted: isMuted });
  }, [volume, isMuted, sendPlayerCommand]);

  useEffect(() => {
    rateRef.current = playbackRate;
    sendPlayerCommand("rate", { value: playbackRate });
  }, [playbackRate, sendPlayerCommand]);

  useEffect(() => {
  const clearHold = () => {
    if (keyHoldRef.current.timeout) {
      clearTimeout(keyHoldRef.current.timeout);
    }
    if (keyHoldRef.current.raf) {
      cancelAnimationFrame(keyHoldRef.current.raf);
    }
    keyHoldRef.current.timeout = null;
    keyHoldRef.current.raf = null;
    keyHoldRef.current.key = null;
    keyHoldRef.current.long = false;
    keyHoldRef.current.lastFrame = null;
    keyHoldRef.current.seekTime = null;
  };

    const startRewindLoop = () => {
      const speed = 27;
    const loop = (now) => {
      if (keyHoldRef.current.key !== "ArrowLeft" || !keyHoldRef.current.long) return;
      const last = keyHoldRef.current.lastFrame || now;
      const delta = (now - last) / 1000;
      keyHoldRef.current.lastFrame = now;
      const baseTime =
        Number.isFinite(keyHoldRef.current.seekTime) ? keyHoldRef.current.seekTime : currentTime;
      const updated = clamp(baseTime - delta * speed, rangeRef.current.start, rangeRef.current.end);
      keyHoldRef.current.seekTime = updated;
      seekPlayer(updated);
      keyHoldRef.current.raf = requestAnimationFrame(loop);
    };
    keyHoldRef.current.lastFrame = null;
    keyHoldRef.current.raf = requestAnimationFrame(loop);
  };

  const handleKeyDown = (event) => {
    const target = event.target;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) {
      return;
    }
    if (event.repeat) return;
    if (!previewUrl) return;

    if (event.key === " " || event.code === "Space") {
      event.preventDefault();
      togglePlayback();
      return;
    }

    if (event.key.toLowerCase() === "m") {
      toggleMute();
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      const base = muteRef.current ? 0 : volumeRef.current;
      const next = Math.min(1, base + 0.05);
      setVolume(next);
      if (next > 0 && muteRef.current) setIsMuted(false);
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      const base = muteRef.current ? 0 : volumeRef.current;
      const next = Math.max(0, base - 0.05);
      setVolume(next);
      if (next === 0) setIsMuted(true);
      return;
    }

    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      if (keyHoldRef.current.key && keyHoldRef.current.key !== event.key) return;
      if (keyHoldRef.current.key === event.key) return;
      keyHoldRef.current.key = event.key;
      keyHoldRef.current.long = false;

      keyHoldRef.current.timeout = setTimeout(() => {
        if (keyHoldRef.current.key !== event.key) return;
        keyHoldRef.current.long = true;
        if (event.key === "ArrowRight") {
          keyHoldRef.current.lastRate = rateRef.current || 1;
          setPlaybackRate(3);
          if (!isPlaying) {
            safePlay();
            setIsPlaying(true);
          }
        } else {
          startRewindLoop();
        }
      }, 220);
    }
  };

  const handleKeyUp = (event) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    if (keyHoldRef.current.key && keyHoldRef.current.key !== event.key) return;
    const step = 5;

    if (!keyHoldRef.current.long) {
      const delta = event.key === "ArrowRight" ? step : -step;
      const next = clamp(currentTime + delta, rangeRef.current.start, rangeRef.current.end);
      seekPlayer(next);
    } else if (event.key === "ArrowRight") {
      const nextRate = keyHoldRef.current.lastRate || 1;
      setPlaybackRate(nextRate);
    } else if (event.key === "ArrowLeft") {
      if (keyHoldRef.current.raf) cancelAnimationFrame(keyHoldRef.current.raf);
    }

    clearHold();
  };

  const handleBlur = () => {
    if (keyHoldRef.current.key === "ArrowRight" && keyHoldRef.current.long) {
      const nextRate = keyHoldRef.current.lastRate || 1;
      setPlaybackRate(nextRate);
    }
    clearHold();
  };

    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("keyup", handleKeyUp, true);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("keyup", handleKeyUp, true);
      window.removeEventListener("blur", handleBlur);
      clearHold();
    };
}, [safePlay, togglePlayback, toggleMute, seekPlayer, currentTime, previewUrl, isPlaying]);


  const buildSearchUrl = useCallback((query) => {
    const keyword = encodeURIComponent(query.trim());
    if (!keyword) return "https://search.bilibili.com/all";
    return `https://search.bilibili.com/all?keyword=${keyword}`;
  }, []);

  const pushSearchDebug = useCallback((message) => {
    const text = String(message || "").trim();
    if (!text) return;
    const stamp = new Date().toTimeString().slice(0, 8);
    setSearchDebugLines((prev) => {
      const next = [...prev, `[${stamp}] ${text}`];
      return next.slice(-120);
    });
  }, []);

  const handleSearchSubmit = useCallback(
    (event) => {
      if (event?.preventDefault) event.preventDefault();
      const trimmed = searchQuery.trim();
      if (!trimmed) return;
      setSearchUrl(buildSearchUrl(trimmed));
    },
    [searchQuery, buildSearchUrl]
  );

  const enqueueParseSources = () => {
    const raw = parseInput.trim();
    if (!raw) return;
    const entries = raw.split(/\r?\n|,|;/).map((item) => item.trim()).filter(Boolean);
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
            error: "Invalid BV id"
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
        throw new Error("Parse failed");
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
          entry.id === item.id ? { ...entry, status: "error", error: err?.message || "Parse failed" } : entry
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
            title: item.title || "",
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
      title: item.title || existing?.title || "Loading...",
      artist: item.author || form.artist || "Unknown",
      start: 0,
      end: resolvedDuration ? Math.min(30, resolvedDuration) : 30,
      bvid,
      tags: form.tags,
      bpm: form.bpm,
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

  const handleAddCard = () => {
    const rawSource = activeCard?.bvid || form.source || "";
    const bvid = extractBvid(rawSource);
    const resolvedTitle = (form.title || activeCard?.title || "").trim();
    if (!resolvedTitle) {
      alert("Title is required.");
      return;
    }
    if (!bvid) {
      alert("Please provide a valid Bilibili BV id or URL.");
      return;
    }

    const startValue = Number.isFinite(rangeStart) ? rangeStart : 0;
    const endValue = Number.isFinite(rangeEnd) ? rangeEnd : startValue + 30;
    const start = Math.min(startValue, endValue);
    const end = Math.max(startValue, endValue);

    const newCard = {
      id: bvid + "-" + Date.now(),
      title: resolvedTitle,
      artist: activeCard?.artist || form.artist || "Unknown",
      start,
      end,
      bvid,
      tags: tagList.join(", "),
      searchTags: [...tagList],
      clipTags: [...clipTags],
      bpm: form.bpm.trim()
    };

    setCards((prev) => [newCard, ...prev]);
    setActiveId(newCard.id);
    setForm({ title: "", artist: "", source: "", tags: "", bpm: "" });
    setTagInput("");
    setTagList([]);
    setClipTags([]);
  };

  const handleSelect = (card) => {
    setSelection((prev) => {
      if (prev.find((item) => item.id === card.id)) return prev;
      return [...prev, card];
    });
  };


  const handleRemove = (cardId) => {
    setSelection((prev) => prev.filter((item) => item.id !== cardId));
  };

  const normalizeTag = (value) => value.trim().replace(/^#/, "");

  const handleAddTag = () => {
    const nextTag = normalizeTag(tagInput);
    if (!nextTag) return;
    setTagList((prev) => (prev.includes(nextTag) ? prev : [...prev, nextTag]));
    setTagInput("");
  };

  const handleRemoveTag = (tag) => {
    setTagList((prev) => prev.filter((item) => item !== tag));
  };

  const handleTagKeyDown = (event) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      handleAddTag();
    }
  };

  const clipTagGroups = [
    {
      label: "团体",
      single: true,
      options: ["μs", "Aqours", "Nijigasaki", "Liella", "Hasunosora"]
    }
  ];

  const toggleClipTag = (group, tag) => {
    setClipTags((prev) => {
      if (group?.single) {
        return prev[0] === tag ? [] : [tag];
      }
      return prev.includes(tag)
        ? prev.filter((item) => item !== tag)
        : [...prev, tag];
    });
  };

  const handleGenerate = async (mode) => {
    if (selection.length === 0) {
      alert("Please add at least one card to the selection.");
      return;
    }
    setStatus("running");
    setProgress([]);
    const payload = { mode, selection };
    const result = await window.generator?.run(payload);
    if (!result?.ok) {
      alert(result?.message || "Generator is not available");
      setStatus("idle");
      return;
    }
    setStatus("done");
    alert(`${result.message}\n${result.outputPath || ""}`);
  };

  const handleLogin = async () => {
    if (!window.auth) {
      setAuthStatus("unavailable");
      alert("Auth bridge not available. Please restart the app.");
      return;
    }
    setAuthStatus("logging in");
    try {
      await window.auth?.login();
      const status = await window.auth?.status();
      setAuthStatus(status?.cookiePath ? "logged in" : "not logged in");
      if (previewUrl && webviewRef.current) {
        webviewRef.current.reload();
      }
    } catch (err) {
      setAuthStatus("not logged in");
      alert(err?.message || "Login failed.");
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

  const handleResolvePreview = async () => {
    if (!activeCard) return;
    if (isResolving) return;
    resetDash();
    setIsDashMode(false);
    setPreviewUrl("");
    setPreviewError("");
    setIsResolving(true);
    resolvingRef.current = true;
    try {
      const nextUrl = buildEmbedUrl({
        bvid: activeCard.bvid,
        aid: activeCard.aid,
        cid: activeCard.cid
      });
      setPreviewUrl(activeCard.resolvedUrl || nextUrl);
      setIsBuffering(false);
    } catch (err) {
      setPreviewError(err?.message || "Failed to load preview.");
    } finally {
      resolvingRef.current = false;
      setIsResolving(false);
    }
  };

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

  useEffect(() => {
    if (!previewUrl) return;
    setIsLoadingPreview(true);
    const timer = setTimeout(() => {
      setIsLoadingPreview(false);
      const view = webviewRef.current;
      if (view) {
        patchWebviewIframeHeight(view);
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [previewUrl]);

  useEffect(() => {
    if (!useEmbedHijack || !previewUrl) return;
    const view = webviewRef.current;
    if (!view) return;
    const pollRange = async () => {
      if (rangePollRef.current.busy) return;
      if (Date.now() - lastRangeUpdateRef.current < 500) return;
      rangePollRef.current.busy = true;
      try {
        const result = await view.executeJavaScript(
          `
          (() => {
            const wrap =
              document.querySelector(".bpx-player-progress-wrap") ||
              document.querySelector(".bpx-player-progress") ||
              document.querySelector("#bilibili-player .bpx-player-progress-wrap");
            if (!wrap) return null;
            const s = Number(wrap.dataset.clipStart);
            const e = Number(wrap.dataset.clipEnd);
            if (!Number.isFinite(s) || !Number.isFinite(e)) return null;
            return { s, e };
          })();
        `,
          true
        );
        if (!result) return;
        const start = Number(result.s);
        const end = Number(result.e);
        if (!Number.isFinite(start) || !Number.isFinite(end)) return;
        if (
          Math.abs(start - rangeStart) < 0.05 &&
          Math.abs(end - rangeEnd) < 0.05
        ) {
          return;
        }
        updateRangeState(start, end);
      } catch {} finally {
        rangePollRef.current.busy = false;
      }
    };
    const timer = setInterval(pollRange, 400);
    return () => clearInterval(timer);
  }, [previewUrl, rangeStart, rangeEnd, updateRangeState, useEmbedHijack]);

  useEffect(() => {
    if (!useEmbedHijack) return;
    const view = webviewRef.current;
    if (!view) return;
    let loadingTimer = null;
    const handleMessage = (event) => {
      if (event.channel === "probe:hit") {
        console.log("probe:hit", event.args?.[0]);
        return;
      }
      if (event.channel === "player:range") {
        const payload = event.args?.[0] || {};
        const start = Number(payload.start);
        const end = Number(payload.end);
        if (Number.isFinite(start) && Number.isFinite(end)) {
          updateRangeState(start, end);
        }
        return;
      }
      if (event.channel === "player:zoom") {
        const payload = event.args?.[0] || {};
        const scale = Number(payload.scale);
        if (Number.isFinite(scale)) {
          pushSearchDebug(`zoom:scale=${scale.toFixed(2)}`);
        }
        return;
      }
      if (event.channel !== "player:state") return;
      const payload = event.args?.[0] || {};
      if (Number.isFinite(payload.currentTime)) {
        setCurrentTime(payload.currentTime);
      }
      if (Number.isFinite(payload.duration) && payload.duration > 0) {
        setDuration(payload.duration);
      }
      if (typeof payload.paused === "boolean") {
        setIsPlaying(!payload.paused);
      }
      if (typeof payload.buffering === "boolean") {
        setIsBuffering(payload.buffering);
      }
    };
    const handleDomReady = () => {
      webviewReadyRef.current = true;
      setIsLoadingPreview(false);
      view.style.width = "100%";
      view.style.height = "100%";
      view.style.minHeight = "100%";
      view.style.display = "block";
      view.style.flex = "1 1 auto";
      if (window.webviewControl?.register) {
        window.webviewControl.register({ id: view.getWebContentsId() });
      }
      const pending = pendingCommandsRef.current.splice(0);
      pending.forEach((item) => {
        view.send("player:command", { type: item.type, ...item.payload });
      });
      view.send("player:command", { type: "range", start: rangeStart, end: rangeEnd });
      view.send("player:command", { type: "volume", value: volume, muted: isMuted });
      view.send("player:command", { type: "rate", value: playbackRate });
    };
    const handleStartLoading = () => {
      if (loadingTimer) clearTimeout(loadingTimer);
      loadingTimer = setTimeout(() => {
        setIsLoadingPreview(true);
      }, 3000);
    };
    const handleStopLoading = () => {
      if (loadingTimer) {
        clearTimeout(loadingTimer);
        loadingTimer = null;
      }
      const stopTimer = setTimeout(() => {
        setIsLoadingPreview(false);
      }, 3000);
      return () => clearTimeout(stopTimer);
    };
    const handleFailLoad = () => {
      if (loadingTimer) {
        clearTimeout(loadingTimer);
        loadingTimer = null;
      }
      setIsLoadingPreview(false);
    };
    view.addEventListener("ipc-message", handleMessage);
    view.addEventListener("dom-ready", handleDomReady);
    view.addEventListener("did-start-loading", handleStartLoading);
    view.addEventListener("did-stop-loading", handleStopLoading);
    view.addEventListener("did-fail-load", handleFailLoad);
    return () => {
      view.removeEventListener("ipc-message", handleMessage);
      view.removeEventListener("dom-ready", handleDomReady);
      view.removeEventListener("did-start-loading", handleStartLoading);
      view.removeEventListener("did-stop-loading", handleStopLoading);
      view.removeEventListener("did-fail-load", handleFailLoad);
      if (loadingTimer) clearTimeout(loadingTimer);
    };
  }, [
    rangeStart,
    rangeEnd,
    volume,
    isMuted,
    playbackRate,
    sendPlayerCommand,
    useEmbedHijack,
    updateRangeState
  ]);

  useEffect(() => {
    const view = searchWebviewRef.current;
    if (!view || !searchUrl) return;
    const limit = Math.max(1, searchResultsLimit);
    const searchCss = `
      html, body {
        height: 100% !important;
        width: 100vw !important;
        max-width: 100vw !important;
        overflow-x: hidden !important;
        box-sizing: border-box !important;
      }
      body { overflow: hidden !important; background: #ffffff !important; }
      *::-webkit-scrollbar {
        width: 8px !important;
      }
      *::-webkit-scrollbar-track {
        background: transparent !important;
      }
      *::-webkit-scrollbar-thumb {
        background: rgba(15, 23, 42, 0.28) !important;
        border-radius: 999px !important;
        border: 2px solid transparent !important;
        background-clip: padding-box !important;
      }
      *::-webkit-scrollbar-thumb:hover {
        background: rgba(15, 23, 42, 0.45) !important;
      }
      *::-webkit-scrollbar-corner {
        background: transparent !important;
      }
      #biliMainHeader,
      .bili-header,
      .bili-header-m,
      .international-header,
      .bili-footer,
      .search-header,
      .search-footer,
      .search-sidebar,
      .search-page-right,
      .search-right,
      .search-tag,
      .recommend-wrapper,
      .nav-search-box {
        display: none !important;
      }
      .search-page,
      .search-content,
      .search-container,
      .search-wrap {
        padding: 0 12px !important;
        margin: 0 !important;
      }
      .search-page .video-list,
      .search-all-list {
        margin-top: 12px !important;
      }
      .rdg-search-loading {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 12px 0 18px;
        color: #94a3b8;
        font-size: 12px;
      }
      .rdg-search-loading.is-hidden {
        display: none !important;
      }
      .rdg-search-loading .rdg-spinner {
        width: 14px;
        height: 14px;
        border-radius: 999px;
        border: 2px solid rgba(15, 23, 42, 0.15);
        border-top-color: rgba(15, 23, 42, 0.55);
        animation: rdg-spin 0.9s linear infinite;
      }
      @keyframes rdg-spin {
        to {
          transform: rotate(360deg);
        }
      }
    `;
      const isolateScript = `
        (() => {
          try {
            const thresholdCount = 12;
            const selectCards = (root) =>
              Array.from(
                (root || document).querySelectorAll(".bili-video-card__wrap")
              );
            const emit = (message) => {
              if (!message) return;
              console.log("rdg-debug:" + message);
            };
            const body = document.body;
            const root = document.documentElement;
            root.style.overflow = "hidden";
            root.style.width = "100vw";
            root.style.maxWidth = "100vw";
            root.style.boxSizing = "border-box";
            body.style.margin = "0";
            body.style.padding = "0";
            body.style.background = "#ffffff";
            body.style.display = "flex";
            body.style.flexDirection = "column";
            body.style.height = "100%";
            body.style.width = "100vw";
            body.style.maxWidth = "100vw";
            body.style.boxSizing = "border-box";
            body.style.overflowX = "hidden";
            Array.from(body.children).forEach((el) => {
              if (
                el.id === "rdg-search-list" ||
                el.id === "rdg-search-loader"
              ) {
                return;
              }
              el.style.display = "none";
            });
            let list = document.getElementById("rdg-search-list");
            if (!list) {
              list = document.createElement("div");
              list.id = "rdg-search-list";
              body.appendChild(list);
              emit("list:init");
            }
            list.style.display = "flex";
            list.style.flexDirection = "column";
            list.style.alignItems = "stretch";
            list.style.gap = "12px";
            list.style.padding = "12px 0";
            list.style.width = "100vw";
            list.style.maxWidth = "100vw";
            list.style.minWidth = "0";
            list.style.boxSizing = "border-box";
            list.style.overflowX = "hidden";
            list.style.overflow = "auto";
            list.style.height = "100%";
            list.style.position = "relative";
            list.style.visibility = "visible";
            list.style.opacity = "1";
            let sentinel = document.getElementById("rdg-search-sentinel");
            if (!sentinel) {
              sentinel = document.createElement("div");
              sentinel.id = "rdg-search-sentinel";
              sentinel.style.width = "100%";
              sentinel.style.height = "1px";
              sentinel.style.pointerEvents = "none";
              list.appendChild(sentinel);
            }
            let loader = document.getElementById("rdg-search-loading");
            if (!loader) {
              loader = document.createElement("div");
              loader.id = "rdg-search-loading";
              loader.className = "rdg-search-loading is-hidden";
              loader.innerHTML =
                '<span class="rdg-spinner"></span><span class="rdg-loading-text">Loading...</span>';
              list.appendChild(loader);
            }
            const state = window.__rdgSearchState || {
              loading: false,
              pending: false,
              page: 1,
              done: false,
              bootstrapped: false,
              url: "",
              lastLoadAt: 0,
              loadDelayMs: 150,
              retryMap: {},
              maxRetries: 1,
              retryDelayMs: 250,
              skipOnEmpty: true,
              emptyStreak: 0,
              maxEmptyStreak: 3,
              frameTimeoutMs: 4500
            };
            window.__rdgSearchState = state;
            const currentUrl = window.location.href;
            const isNewUrl = state.url !== currentUrl;
            if (isNewUrl) {
              state.loading = false;
              state.pending = false;
              state.page = 1;
              state.done = false;
              state.bootstrapped = false;
              state.url = currentUrl;
              state.logged = {};
              state.retryMap = {};
              state.loadDelayMs = 150;
              state.emptyStreak = 0;
              state.skipOnEmpty = true;
              state.maxEmptyStreak = 3;
              state.frameTimeoutMs = 4500;
              if (state.observer) {
                state.observer.disconnect();
                state.observer = null;
              }
              list.innerHTML = "";
              if (sentinel) {
                list.appendChild(sentinel);
              }
              if (loader) {
                list.appendChild(loader);
              }
            }
            if (!Number.isFinite(state.loadDelayMs)) {
              state.loadDelayMs = 150;
            }
            if (!Number.isFinite(state.frameTimeoutMs)) {
              state.frameTimeoutMs = 4500;
            }
            if (state.bootstrapped) return;
            state.bootstrapped = true;
            const seen = new Set();
            const parseCardsFromDocument = (doc) => selectCards(doc);
            const getBvid = (card) => {
              const link =
                card.querySelector("a[href*='BV']") || card.querySelector("a");
              const url = link ? link.href : "";
              if (!url) return "";
              const match = url.match(/BV[0-9A-Za-z]{10}/);
              return match ? match[0] : "";
            };
            const getOuterTag = (card) => {
              const match = card.outerHTML.match(/^<[^>]+>/);
              if (match) return match[0];
              return "<" + card.tagName.toLowerCase() + ">";
            };
            const maybeLogFirstTag = (page, source, nodes) => {
              if (!page || !nodes || !nodes.length) return;
              if (!state.logged) state.logged = {};
              const key = "tag:" + source + ":" + page;
              if (state.logged[key]) return;
              const tag = getOuterTag(nodes[0]);
              emit("card:first " + source + " page=" + page + " tag=" + tag);
              state.logged[key] = true;
            };
            const makeCard = (card) => {
              card.style.setProperty("position", "relative", "important");
              card.style.setProperty("left", "auto", "important");
              card.style.setProperty("top", "auto", "important");
              card.style.setProperty("right", "auto", "important");
              card.style.setProperty("bottom", "auto", "important");
              card.style.setProperty("transform", "none", "important");
              card.style.setProperty("opacity", "1", "important");
              card.style.setProperty("display", "block", "important");
              const wrapper = document.createElement("div");
              wrapper.className = "rdg-search-item";
              wrapper.style.position = "relative";
              wrapper.style.width = "100%";
              wrapper.style.maxWidth = "100%";
              wrapper.style.minWidth = "0";
              wrapper.style.margin = "0";
              wrapper.style.display = "block";
              wrapper.style.flex = "0 0 auto";
              wrapper.style.cursor = "pointer";
              wrapper.style.overflow = "hidden";
              wrapper.style.borderRadius = "14px";
              wrapper.style.zoom = "0.9";
              wrapper.style.transformOrigin = "top left";
              card.style.setProperty("width", "100%", "important");
              card.style.setProperty("max-width", "100%", "important");
              card.style.setProperty("min-width", "0", "important");
              card.style.setProperty("margin", "0", "important");
              card.style.setProperty("box-sizing", "border-box", "important");
              card.style.setProperty("overflow", "hidden", "important");
              const overlay = document.createElement("div");
              overlay.className = "rdg-search-mask";
              overlay.style.position = "absolute";
              overlay.style.inset = "0";
              overlay.style.background = "transparent";
              overlay.style.pointerEvents = "auto";
              overlay.style.borderRadius = "inherit";
              overlay.style.zIndex = "3";
              const handleClick = (event) => {
                if (event) {
                  event.preventDefault();
                  event.stopPropagation();
                  event.stopImmediatePropagation?.();
                }
                const bvid = getBvid(card);
                if (!bvid) return;
                console.log("rdg-bvid:" + bvid);
              };
              overlay.addEventListener("click", handleClick, true);
              wrapper.addEventListener("click", handleClick, true);
              wrapper.addEventListener(
                "pointerdown",
                (event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  event.stopImmediatePropagation?.();
                },
                true
              );
              wrapper.appendChild(card);
              wrapper.appendChild(overlay);
              list.appendChild(wrapper);
            };
            const appendCards = (nodes, page, source) => {
              const pageCards = Array.from(nodes || []);
              if (!pageCards.length) return;
              maybeLogFirstTag(page, source || "page", pageCards);
              const beforeCount = list.children.length;
              pageCards.forEach((card) => {
                const bvid = getBvid(card);
                if (bvid && seen.has(bvid)) return;
                if (bvid) seen.add(bvid);
                const clone = card.cloneNode(true);
                makeCard(clone);
              });
              if (sentinel && sentinel.parentNode === list) {
                list.appendChild(sentinel);
              }
              if (loader && loader.parentNode === list) {
                list.appendChild(loader);
              }
              const afterCount = list.children.length;
              if (afterCount !== beforeCount) {
                emit("list:total=" + afterCount);
              }
            };
            const syncLoadingIndicator = () => {
              if (!loader) return;
              const shouldShow = state.loading || state.pending;
              loader.classList.toggle("is-hidden", !shouldShow);
            };
            const getCurrentPage = () => {
              try {
                const url = new URL(window.location.href);
                const page = Number(url.searchParams.get("page"));
                return Number.isFinite(page) && page > 0 ? page : 1;
              } catch {
                return 1;
              }
            };
            state.page = getCurrentPage();
            const buildPageUrl = (page) => {
              const url = new URL(window.location.href);
              url.searchParams.set("page", String(page));
              url.searchParams.set("search_source", "5");
              return url.toString();
            };
            const loadPageFromFetch = async (page, url) => {
              try {
                const res = await fetch(url, { credentials: "include" });
                if (!res.ok) {
                  emit("loadPage:fetch-status page=" + page + " " + res.status);
                  return [];
                }
                const html = await res.text();
                const doc = new DOMParser().parseFromString(html, "text/html");
                const cards = parseCardsFromDocument(doc);
                if (!cards.length || page >= 2) {
                  emit("loadPage:fetch page=" + page + " cards=" + cards.length);
                }
                return cards;
              } catch (err) {
                emit("loadPage:fetch-error page=" + page);
                return [];
              }
            };
            const getLoaderFrame = () => {
              let frame = document.getElementById("rdg-search-loader");
              if (!frame) {
                frame = document.createElement("iframe");
                frame.id = "rdg-search-loader";
                frame.setAttribute("aria-hidden", "true");
                frame.style.position = "fixed";
                frame.style.left = "0";
                frame.style.top = "0";
                frame.style.width = "360px";
                frame.style.height = "640px";
                frame.style.border = "0";
                frame.style.opacity = "0.01";
                frame.style.pointerEvents = "none";
                frame.style.display = "block";
                frame.style.background = "transparent";
                body.appendChild(frame);
              } else {
                frame.style.display = "block";
                frame.style.opacity = "0.01";
              }
              return frame;
            };
            const loadPageViaFrame = (page, url) =>
              new Promise((resolve) => {
                let settled = false;
                let attempts = 0;
                const maxAttempts = 60;
                let pollTimer = null;
                let loggedMeta = false;
                let observer = null;
                const frame = getLoaderFrame();
                const logFrameMeta = (doc) => {
                  if (loggedMeta) return;
                  loggedMeta = true;
                  const title = doc?.title || "";
                  const ready = doc?.readyState || "";
                  emit(
                    "loadPage:frame-meta page=" +
                      page +
                      " ready=" +
                      ready +
                      " title=" +
                      title
                  );
                };
                const getEmptyReason = (doc) => {
                  if (!doc) return "";
                  const title = doc.title || "";
                  if (title.includes("验证码") || title.includes("验证")) {
                    return "verify";
                  }
                  if (title.includes("访问") || title.includes("受限")) {
                    return "access";
                  }
                  if (
                    doc.querySelector(
                      ".no-result, .search-no-result, .search-empty, .error-container, .search-error"
                    )
                  ) {
                    return "empty";
                  }
                  const text = doc.body?.innerText || "";
                  if (text.includes("没有找到") || text.includes("无相关")) {
                    return "empty";
                  }
                  return "";
                };
                const cleanup = (cards) => {
                  if (settled) return;
                  settled = true;
                  frame.removeEventListener("load", handleLoad);
                  clearTimeout(timeout);
                  if (pollTimer) clearInterval(pollTimer);
                  if (observer) observer.disconnect();
                  emit("loadPage:frame page=" + page + " cards=" + cards.length);
                  resolve(cards);
                };
                const handleLoad = () => {
                  const attachObserver = (doc) => {
                    if (!doc?.body || observer) return;
                    observer = new MutationObserver(() => {
                      const cards = selectCards(doc);
                      if (cards.length) {
                        cleanup(cards);
                      }
                    });
                    observer.observe(doc.body, { childList: true, subtree: true });
                  };
                  pollTimer = setInterval(() => {
                    attempts += 1;
                    try {
                      const doc = frame.contentDocument;
                      const cards = doc ? selectCards(doc) : [];
                      attachObserver(doc);
                      if (cards.length) {
                        cleanup(cards);
                        return;
                      }
                      const reason = getEmptyReason(doc);
                      if (reason) {
                        logFrameMeta(doc);
                        emit(
                          "loadPage:frame-empty page=" +
                            page +
                            " reason=" +
                            reason
                        );
                        cleanup([]);
                        return;
                      }
                      if (attempts >= maxAttempts) {
                        logFrameMeta(doc);
                        cleanup([]);
                      }
                    } catch (err) {
                      emit("loadPage:frame-error page=" + page);
                      cleanup([]);
                    }
                  }, 200);
                };
                const timeout = setTimeout(() => {
                  emit("loadPage:frame-timeout page=" + page);
                  cleanup([]);
                }, state.frameTimeoutMs);
                frame.addEventListener("load", handleLoad);
                frame.src = url;
              });
            const loadPage = async (page) => {
              const url = buildPageUrl(page);
              emit("loadPage:start page=" + page);
              if (page === 2) emit("loadPage:url page=2 " + url);
              let cards = await loadPageFromFetch(page, url);
              if (!cards.length) {
                emit("loadPage:fallback frame page=" + page);
                cards = await loadPageViaFrame(page, url);
              }
              emit("loadPage:done page=" + page + " cards=" + cards.length);
              return cards;
            };
            const queueNextPage = () => {
              if (state.done) return;
              if (state.loading) {
                state.pending = true;
                return;
              }
              const now = Date.now();
              const waitMs = Math.max(
                0,
                state.lastLoadAt + state.loadDelayMs - now
              );
              state.loading = true;
              state.pending = false;
              syncLoadingIndicator();
              const nextPage = state.page + 1;
              emit("loadNextPage:start page=" + nextPage);
              setTimeout(async () => {
              const nextCards = await loadPage(nextPage);
              state.lastLoadAt = Date.now();
              if (!nextCards.length) {
                if (state.skipOnEmpty) {
                  state.emptyStreak += 1;
                  state.page = nextPage;
                  state.loading = false;
                  syncLoadingIndicator();
                  emit(
                    "loadNextPage:skip page=" +
                      nextPage +
                      " streak=" +
                      state.emptyStreak
                  );
                  if (state.emptyStreak >= state.maxEmptyStreak) {
                    state.done = true;
                    emit(
                      "loadNextPage:empty-streak-stop streak=" +
                        state.emptyStreak
                    );
                    return;
                  }
                  if (
                    state.pending ||
                    shouldLoadNext() ||
                    list.scrollHeight <= list.clientHeight
                  ) {
                    queueNextPage();
                  }
                  return;
                }
                const retries = state.retryMap[nextPage] || 0;
                if (retries < state.maxRetries) {
                  state.retryMap[nextPage] = retries + 1;
                  state.loadDelayMs = Math.min(
                    state.loadDelayMs + 200,
                    900
                  );
                  state.loading = false;
                  syncLoadingIndicator();
                  emit(
                    "loadNextPage:retry page=" +
                      nextPage +
                      " attempt=" +
                      state.retryMap[nextPage]
                  );
                  setTimeout(() => {
                    queueNextPage();
                  }, state.retryDelayMs);
                  return;
                }
                state.done = true;
                state.loading = false;
                syncLoadingIndicator();
                emit(
                  "loadNextPage:empty page=" +
                    nextPage +
                    " retries=" +
                    retries
                );
                return;
              }
              state.emptyStreak = 0;
              delete state.retryMap[nextPage];
              state.loadDelayMs = 200;
              appendCards(nextCards, nextPage, "page");
              state.page = nextPage;
              state.loading = false;
              syncLoadingIndicator();
              emit(
                "loadNextPage:done page=" +
                  nextPage +
                  " cards=" +
                  nextCards.length
              );
                if (state.done) return;
                if (
                  state.pending ||
                  shouldLoadNext() ||
                  list.scrollHeight <= list.clientHeight
                ) {
                  queueNextPage();
                }
              }, waitMs);
            };
            const shouldLoadNext = () => {
              const remainingPx =
                list.scrollHeight - (list.scrollTop + list.clientHeight);
              const thresholdPx = Math.max(list.clientHeight * 5, 1600);
              return remainingPx <= thresholdPx;
            };
            let scrollRaf = null;
            list.addEventListener("scroll", () => {
              if (scrollRaf) return;
              scrollRaf = requestAnimationFrame(() => {
                scrollRaf = null;
                if (shouldLoadNext()) queueNextPage();
              });
            });
            if ("IntersectionObserver" in window && sentinel) {
              state.observer = new IntersectionObserver(
                (entries) => {
                  if (entries.some((entry) => entry.isIntersecting)) {
                    queueNextPage();
                  }
                },
                { root: list, rootMargin: "2200px 0px", threshold: 0.01 }
              );
              state.observer.observe(sentinel);
            }
            const bootstrap = async () => {
              emit("bootstrap:start page=" + state.page);
              const initialDomCards = selectCards(document);
              emit("bootstrap:domCards=" + initialDomCards.length);
              if (initialDomCards.length) {
                appendCards(initialDomCards, state.page, "dom");
              }
              const initialCards = await loadPage(state.page);
              emit("bootstrap:pageCards=" + initialCards.length);
              if (initialCards.length) {
                appendCards(initialCards, state.page, "page");
              }
              if (list.scrollHeight <= list.clientHeight) {
                queueNextPage();
              }
            };
            bootstrap();
          } catch (err) {
            const message = err && err.message ? err.message : String(err);
            console.log("rdg-debug:script-error " + message);
          }
        })();
      `;
    const applySearchPatch = () => {
      view.insertCSS(searchCss);
      view.executeJavaScript(isolateScript, true);
      patchSearchWebviewIframeHeight(view);
    };
    const handleDomReady = () => {
      setIsSearchLoading(false);
      pushSearchDebug("webview:dom-ready");
      applySearchPatch();
    };
    const handleStartLoading = () => {
      setIsSearchLoading(true);
    };
    const handleStopLoading = () => {
      setIsSearchLoading(false);
      applySearchPatch();
    };
    const handleNavigate = (event) => {
      const bvid = extractBvid(event.url);
      if (!bvid) return;
      if (event.preventDefault) event.preventDefault();
      handleQueuePreview({ bvid, status: "ready" });
    };
    const handleNewWindow = (event) => {
      const bvid = extractBvid(event.url);
      if (!bvid) return;
      if (event.preventDefault) event.preventDefault();
      handleQueuePreview({ bvid, status: "ready" });
    };
    const handleConsoleMessage = (event) => {
      const text = event.message || "";
      if (text.startsWith("rdg-debug:")) {
        pushSearchDebug(text.replace("rdg-debug:", "").trim());
        return;
      }
      if (!text.startsWith("rdg-bvid:")) return;
      const bvid = text.replace("rdg-bvid:", "").trim();
      if (!bvid) return;
      handleQueuePreview({ bvid, status: "ready" });
    };
    view.addEventListener("dom-ready", handleDomReady);
    view.addEventListener("did-start-loading", handleStartLoading);
    view.addEventListener("did-stop-loading", handleStopLoading);
    view.addEventListener("will-navigate", handleNavigate);
    view.addEventListener("new-window", handleNewWindow);
    view.addEventListener("console-message", handleConsoleMessage);
    return () => {
      view.removeEventListener("dom-ready", handleDomReady);
      view.removeEventListener("did-start-loading", handleStartLoading);
      view.removeEventListener("did-stop-loading", handleStopLoading);
      view.removeEventListener("will-navigate", handleNavigate);
      view.removeEventListener("new-window", handleNewWindow);
      view.removeEventListener("console-message", handleConsoleMessage);
    };
  }, [searchUrl, searchResultsLimit, handleQueuePreview, pushSearchDebug]);


  const seekTo = (clientX) => {
    if (!timelineRef.current || timelineSpan <= 0) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
    const absoluteTime = ratio * timelineSpan;
    const threshold = Math.min(0.6, timelineSpan * 0.01);
    let clamped = clamp(absoluteTime, rangeStart, rangeEnd);
    if (Math.abs(clamped - rangeStart) <= threshold) clamped = rangeStart;
    if (Math.abs(clamped - rangeEnd) <= threshold) clamped = rangeEnd;
    seekPlayer(clamped);
  };

  const startScrub = useCallback(
    (type, clientX) => {
      if (!timelineRef.current || timelineSpan <= 0) return;
      dragRef.current = {
        type,
        startX: clientX,
        start: rangeStart,
        end: rangeEnd
      };
      setIsScrubbing(true);
      setIsHovering(false);
      if (type === "start") {
        setDragHandle("start");
      } else if (type === "end") {
        setDragHandle("end");
      } else {
        setDragHandle(null);
      }
      wasPlayingRef.current = isPlaying;
      if (isPlaying) {
        sendPlayerCommand("pause");
        setIsPlaying(false);
      }
      if (type === "timeline") {
        seekTo(clientX);
      }
    },
    [rangeStart, rangeEnd, seekTo, timelineSpan, isPlaying, sendPlayerCommand]
  );

  const handleTimelineMouseDown = (event) => {
    if (!timelineRef.current || timelineSpan <= 0) return;
    const roleTarget = event.target?.closest?.("[data-role]");
    const role = roleTarget?.dataset?.role || "timeline";
    const type =
      role === "playhead"
        ? "playhead"
        : role === "selection"
          ? "range"
          : role === "start-handle"
            ? "start"
            : role === "end-handle"
              ? "end"
              : "timeline";
    startScrub(type, event.clientX);
  };

  const handleStartHandleMouseDown = useCallback(
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      startScrub("start", event.clientX);
    },
    [startScrub]
  );

  const handleEndHandleMouseDown = useCallback(
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      startScrub("end", event.clientX);
    },
    [startScrub]
  );

  const handleRangeMouseDown = useCallback(
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      startScrub("range", event.clientX);
    },
    [startScrub]
  );

  useEffect(() => {
    const handleMove = (event) => {
      if (!dragRef.current.type || !timelineRef.current || timelineSpan <= 0) return;
      const rect = timelineRef.current.getBoundingClientRect();
      const deltaRatio = clamp((event.clientX - dragRef.current.startX) / rect.width, -1, 1);
      const deltaSeconds = deltaRatio * timelineSpan;
      if (dragRef.current.type === "playhead") {
        seekTo(event.clientX);
        return;
      }
      if (dragRef.current.type === "range") {
        const nextStart = dragRef.current.start + deltaSeconds;
        const nextEnd = dragRef.current.end + deltaSeconds;
        if (nextStart <= nextEnd) {
          handleRangeChange(nextStart, nextEnd);
        }
      }
      if (dragRef.current.type === "start") {
        handleRangeChange(dragRef.current.start + deltaSeconds, rangeEnd);
      }
      if (dragRef.current.type === "end") {
        handleRangeChange(rangeStart, dragRef.current.end + deltaSeconds);
      }
    };

    const handleUp = () => {
      if (dragRef.current.type) {
        setIsScrubbing(false);
        setDragHandle(null);
        const startChanged = lastRangeStartRef.current !== rangeStart;
        lastRangeStartRef.current = rangeStart;
        const absoluteTime = currentTime;
        const outOfRange = isOutsideRange(absoluteTime);
        if (startChanged && outOfRange) {
          seekPlayer(rangeStart);
        }
        if (wasPlayingRef.current) {
          if (outOfRange) {
            seekPlayer(rangeStart);
          }
          safePlay();
          setIsPlaying(true);
        } else {
          setIsPlaying(false);
        }
      }
      dragRef.current = { type: null, startX: 0, start: 0, end: 0 };
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    window.addEventListener("blur", handleUp);
    window.addEventListener("mouseleave", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
      window.removeEventListener("blur", handleUp);
      window.removeEventListener("mouseleave", handleUp);
    };
  }, [timelineSpan, rangeStart, rangeEnd, handleRangeChange, isOutsideRange, safePlay, currentTime, seekPlayer]);

  const handleTimelineHover = (event) => {
    if (!timelineRef.current || timelineSpan <= 0) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    setHoverPercent(ratio * 100);
    const absoluteTime = ratio * timelineSpan;
    setHoverTime(absoluteTime);
    setIsHovering(true);
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">Random Dance Generator</div>
        <div className="topbar-meta">
          <span>Cards: {cards.length}</span>
          <span>Selected: {selection.length}</span>
        </div>
      </header>
      <div className="debug-panel">
        <div className="debug-title">Search Debug</div>
        <div className="debug-body">
          {searchDebugLines.length ? (
            searchDebugLines.map((line, index) => (
              <div key={`debug-${index}`}>{line}</div>
            ))
          ) : (
            <div className="debug-empty">No logs yet.</div>
          )}
        </div>
      </div>
      <main className="workspace">
        <section className="panel panel-sources">
          <form className="search-form" onSubmit={handleSearchSubmit}>
            <input
              className="search-input"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search on Bilibili"
            />
            <button type="submit">Search</button>
          </form>
          <div className="search-hint">Click a result to preview.</div>
          <div className="search-frame">
            <webview
              ref={searchWebviewRef}
              src={searchUrl}
              className={"search-webview" + (isSearchLoading ? " is-loading" : "")}
              style={{ width: "100%", height: "100%", minHeight: "100%" }}
              allowpopups="true"
              httpreferrer="https://www.bilibili.com"
              useragent={bilibiliUserAgent}
              partition="persist:bili"
            />
          </div>
        </section>

        <section className="panel panel-preview">
          {(() => {
            const normalized = authStatus?.toLowerCase?.() || "";
            const isLoggedIn = normalized.includes("logged in");
            const isLoggingIn = normalized.includes("logging");
            const authClass = isLoggedIn ? "auth-pill is-ready" : "auth-pill is-missing";
            const authLabel = isLoggedIn ? "已登录" : isLoggingIn ? "登录中" : "未登录";
            return (
          <div className="preview-head">
            <div className="preview-title">
              <h2>{activeCard?.title || "Preview"}</h2>
              <div className="preview-range">
                {activeCard
                  ? `${formatTime(rangeStart)} - ${formatTime(rangeEnd)}`
                  : "--:-- - --:--"}
              </div>
            </div>
            <div className="preview-toolbar">
              <div className={authClass}>{authLabel}</div>
              <div className="preview-actions">
                <button onClick={handleLogin}>Bilibili Login</button>
                <button onClick={handleReload}>Reload UI</button>
              </div>
            </div>
          </div>
            );
          })()}
          {activeCard ? (
            <div className="preview-body">
              {previewUrl ? (
                <webview
                  key={`${activeId || "preview"}-${previewEpoch}`}
                  ref={webviewRef}
                  src={previewUrl}
                  className={"player-webview embed-player " + (isLoadingPreview ? "is-loading" : "")}
                  style={{ width: "100%", height: "100%", minHeight: "100%" }}
                  allowpopups="true"
                  httpreferrer="https://www.bilibili.com"
                  useragent={bilibiliUserAgent}
                  partition="persist:bili"
                  preload={window.env?.bilibiliPagePreload}
                />
              ) : (
                <div className="placeholder">Resolve preview to play.</div>
              )}
              {isLoadingPreview || isResolving ? (
                <div className="preview-loading">
                  <div className="preview-loading-spinner" />
                  <div className="preview-loading-text">Loading preview...</div>
                </div>
              ) : null}
              {previewError && !isLoadingPreview && !isResolving ? (
                <div className="preview-error">
                  <button onClick={handleResolvePreview}>Retry Preview</button>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="placeholder">左侧搜索栏点击加入预览</div>
          )}
        </section>

        <section className="panel panel-editor">
          <div className="editor-section">
            <div className="builder-flow">
              <div className="builder-stage">
                <div className="builder-stage-title">
                  <span className="builder-step">01</span>
                  <span>同步预览信息</span>
                </div>
                <div className="builder-grid">
                  <div className="builder-card">
                    <div className="builder-label">Preview Range</div>
                    <div className="builder-range">
                      {formatTime(rangeStart)} - {formatTime(rangeEnd)}
                    </div>
                    <div className="builder-hint">
                      Drag handles in the preview to sync.
                    </div>
                  </div>

                  <div className="builder-card">
                    <div className="builder-label">Active Source</div>
                    <div className="builder-source">
                      {activeCard ? (
                        <div className="builder-source-row">
                          <div className="builder-source-title">
                            {activeCard.title || "Untitled"}
                          </div>
                          <div className="builder-source-meta">
                            {activeCard.bvid || "Unknown BV"}
                          </div>
                        </div>
                      ) : (
                        <div className="builder-empty">
                          Select a result to sync.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="builder-stage">
                <div className="builder-stage-title">
                  <span className="builder-step">02</span>
                  <span>设置标签</span>
                </div>
                <div className="builder-grid builder-grid--tags">
                  <div className="builder-card">
                    <div className="builder-label">Search Tags</div>
                    <div className="tag-input-row">
                      <input
                        value={tagInput}
                        onChange={(event) => setTagInput(event.target.value)}
                        onKeyDown={handleTagKeyDown}
                        placeholder="Add search tags, press Enter"
                      />
                      <button
                        type="button"
                        className="ghost"
                        onClick={handleAddTag}
                      >
                        Add
                      </button>
                    </div>
                    <div className="tag-chip-list">
                      {tagList.length ? (
                        tagList.map((tag) => (
                          <span key={tag} className="tag-chip">
                            <span className="tag-chip-text">#{tag}</span>
                            <button
                              type="button"
                              onClick={() => handleRemoveTag(tag)}
                            >
                              ×
                            </button>
                          </span>
                        ))
                      ) : (
                        <div className="tag-empty">No tags yet.</div>
                      )}
                    </div>
                    <div className="tag-hint">
                      Search tags appear in the community feed.
                    </div>
                  </div>

              <div className="builder-card">
                <div className="builder-label">Clip Tags</div>
                {clipTagGroups.map((group) => (
                  <div key={group.label} className="clip-tag-group">
                    <div className="clip-tag-title">
                      {group.label}
                      {group.single ? " (单选)" : ""}
                    </div>
                    <div className="clip-tag-list">
                      {group.options.map((tag) => {
                        const isSelected = clipTags.includes(tag);
                        return (
                          <button
                            key={tag}
                            type="button"
                            className={
                              "clip-tag" + (isSelected ? " is-selected" : "")
                            }
                            onClick={() => toggleClipTag(group, tag)}
                          >
                            {tag}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
                  </div>
                </div>
              </div>
            </div>
            <div className="builder-actions">
              <button className="primary" onClick={handleAddCard}>
                生成标签
              </button>
            </div>
          </div>

        </section>
      </main>
    </div>
  );
}
