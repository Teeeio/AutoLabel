import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const demoCard = {
  id: "bv-demo-01",
  title: "Demo Song",
  artist: "Demo Artist",
  start: 0,
  end: 30,
  bvid: "BV1Bz4y137hm",
  tags: "",
  bpm: ""
};

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
  const [cards, setCards] = useState([demoCard]);
  const [selection, setSelection] = useState([demoCard]);
  const [activeId, setActiveId] = useState(demoCard.id);
  const [progress, setProgress] = useState([]);
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewError, setPreviewError] = useState("");
  const [isResolving, setIsResolving] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
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
  const [parseInput, setParseInput] = useState("");
  const [parseQueue, setParseQueue] = useState([]);
  const [isBatchResolving, setIsBatchResolving] = useState(false);
  const parseQueueRef = useRef([]);
  const [cachedRangesMap, setCachedRangesMap] = useState({});
  const [previewSource, setPreviewSource] = useState(null);
  const [thumbs, setThumbs] = useState({ start: "", end: "" });
  const prefetchRef = useRef({ inflight: false, lastKey: "", lastAt: 0 });
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
    resetDash();
    if (!activeCard?.bvid || resolvingRef.current) return;
    const nextStart = Number.isFinite(activeCard.start) ? activeCard.start : 0;
    const durationCap = Number.isFinite(activeCard.sourceDuration) ? activeCard.sourceDuration : 0;
    const fallbackEnd = durationCap ? Math.min(30, durationCap) : 30;
    const nextEnd = Number.isFinite(activeCard.end) ? activeCard.end : fallbackEnd;
    setRangeStart(nextStart);
    setRangeEnd(nextEnd);
    lastRangeStartRef.current = nextStart;
    setCurrentTime(nextStart);
    const embedUrl =
      activeCard.resolvedUrl ||
      buildEmbedUrl({ bvid: activeCard.bvid, aid: activeCard.aid, cid: activeCard.cid });
    const cachedDuration = Number.isFinite(activeCard.sourceDuration) ? activeCard.sourceDuration : 0;
    if (cachedDuration > 0) {
      setSourceDuration(cachedDuration);
      setPreviewUrl(embedUrl);
      setIsResolving(false);
      return;
    }
    resolvingRef.current = true;
    setIsResolving(true);
    window.preview
      ?.info({ bvid: activeCard.bvid })
      .then((info) => {
        if (Number.isFinite(info?.duration) && info.duration > 0) {
          setSourceDuration(info.duration);
        }
        if (activeId?.startsWith("source-")) {
          setParseQueue((prev) =>
            prev.map((entry) =>
              entry.bvid === activeCard.bvid
                ? {
                    ...entry,
                    status: "ready",
                    title: info?.title || entry.title || "",
                    duration: Number.isFinite(info?.duration) ? info.duration : entry.duration,
                    url: embedUrl
                  }
                : entry
            )
          );
          setPreviewSource((prev) => {
            if (!prev || prev.bvid !== activeCard.bvid) return prev;
            return {
              ...prev,
              title: info?.title || prev.title,
              sourceDuration: Number.isFinite(info?.duration) ? info.duration : prev.sourceDuration,
              aid: info?.aid || prev.aid,
              cid: info?.cid || prev.cid,
              resolvedUrl: embedUrl
            };
          });
        } else if (activeCardInLibrary && Number.isFinite(info?.duration) && info.duration > 0) {
          setCards((prev) =>
            prev.map((card) =>
              card.id === activeId
                ? {
                    ...card,
                    sourceDuration: info.duration,
                    aid: info?.aid || card.aid,
                    cid: info?.cid || card.cid,
                    resolvedUrl: embedUrl
                  }
                : card
            )
          );
          setSelection((prev) =>
            prev.map((card) =>
              card.id === activeId
                ? {
                    ...card,
                    sourceDuration: info.duration,
                    aid: info?.aid || card.aid,
                    cid: info?.cid || card.cid,
                    resolvedUrl: embedUrl
                  }
                : card
            )
          );
        }
        const freshUrl = buildEmbedUrl({
          bvid: activeCard.bvid,
          aid: info?.aid || activeCard.aid,
          cid: info?.cid || activeCard.cid
        });
        setPreviewUrl(freshUrl);
      })
      .catch((err) => {
        setPreviewError(err?.message || "Failed to parse video info.");
      })
      .finally(() => {
        resolvingRef.current = false;
        setIsResolving(false);
      });
  }, [activeId, activeCard?.bvid, previewQuality, resetDash, activeCardInLibrary]);

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

  const updateForm = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

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
    if (item.status === "pending" || item.status === "error") {
      resolveQueueItem(item);
    }
    const resolvedDuration = Number.isFinite(item.duration) ? item.duration : 0;
    const previewCard = {
      id: `source-${item.bvid}`,
      title: item.title || form.title || "Untitled",
      artist: form.artist || "Unknown",
      start: 0,
      end: resolvedDuration ? Math.min(30, resolvedDuration) : 30,
      bvid: item.bvid,
      tags: form.tags,
      bpm: form.bpm,
      aid: item.aid || "",
      cid: item.cid || "",
      resolvedUrl: item.url || buildEmbedUrl({ bvid: item.bvid, aid: item.aid, cid: item.cid }),
      segmentStart: item.segmentStart,
      segmentEnd: item.segmentEnd,
      sourceDuration: resolvedDuration
    };
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
    setPreviewSource(null);
    setActiveId(card.id);
  };

  const syncCardRange = (startValue, endValue) => {
    if (!activeCardInLibrary) return;
    setCards((prev) =>
      prev.map((card) => (card.id === activeId ? { ...card, start: startValue, end: endValue } : card))
    );
    setSelection((prev) =>
      prev.map((card) => (card.id === activeId ? { ...card, start: startValue, end: endValue } : card))
    );
  };

  const handleAddCard = () => {
    setError("");
    const bvid = extractBvid(form.source);
    if (!form.title.trim()) return setError("Title is required.");
    if (!form.artist.trim()) return setError("Artist is required.");
    if (!bvid) return setError("Please provide a valid Bilibili BV id or URL.");

    const newCard = {
      id: `${bvid}-${Date.now()}`,
      title: form.title.trim(),
      artist: form.artist.trim(),
      start: 0,
      end: 30,
      bvid,
      tags: form.tags.trim(),
      bpm: form.bpm.trim()
    };

    setCards((prev) => [newCard, ...prev]);
    setActiveId(newCard.id);
    setForm({ title: "", artist: "", source: "", tags: "", bpm: "" });
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
      const info = await window.preview?.info({ bvid: activeCard.bvid });
      if (Number.isFinite(info?.duration) && info.duration > 0) {
        setSourceDuration(info.duration);
      }
      const nextUrl = buildEmbedUrl({
        bvid: activeCard.bvid,
        aid: info?.aid || activeCard.aid,
        cid: info?.cid || activeCard.cid
      });
      setPreviewUrl(activeCard.resolvedUrl || nextUrl);
      setIsBuffering(false);
    } catch (err) {
      setPreviewError(err?.message || "Failed to parse video info.");
      markQueueError(activeCard.bvid, err);
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
      setRangeStart(nextStart);
      syncCardRange(nextStart, rangeEnd);
      return;
    }
    const maxValue = sourceDuration || duration || absoluteTime;
    const nextEnd = clamp(absoluteTime, rangeStart, maxValue);
    setRangeEnd(nextEnd);
    syncCardRange(rangeStart, nextEnd);
  };

  const handleRangeChange = (nextStart, nextEnd) => {
    const maxValue = sourceDuration || duration || Math.max(30, rangeEnd, nextEnd);
    const safeStart = clamp(nextStart, 0, maxValue);
    const minSpan = 0.1;
    const safeEnd = clamp(nextEnd, safeStart + minSpan, maxValue);
    setRangeStart(safeStart);
    setRangeEnd(safeEnd);
    syncCardRange(safeStart, safeEnd);
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
        if (Number.isFinite(payload.start) && Number.isFinite(payload.end)) {
          setRangeStart(payload.start);
          setRangeEnd(payload.end);
          syncCardRange(payload.start, payload.end);
          lastRangeStartRef.current = payload.start;
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
  }, [rangeStart, rangeEnd, volume, isMuted, playbackRate, sendPlayerCommand, useEmbedHijack]);


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
          <div className="cta">
            <button onClick={handleReload}>Reload UI</button>
            <button onClick={handleLogin}>Bilibili Login</button>
          </div>
        </header>

      <main className="layout">
        <section className="panel panel-preview">
          <div className="panel-header">
            <div>
              <h2>Preview</h2>
              <div className="hint">Auth: {authStatus}. Use login if preview fails.</div>
              {activeCard ? (
                <div className="track-meta">
                  <span className="track-title">{activeCard.title}</span>
                  <span className="track-artist">{activeCard.artist}</span>
                </div>
              ) : null}
              <div className="quick-switch">
                {cards.map((card) => (
                  <button
                    key={card.id}
                    className={`chip ${activeId === card.id ? "active" : ""}`}
                    onClick={() => handlePreviewCard(card)}
                  >
                    {card.title}
                  </button>
                ))}
                {parseQueue.filter((item) => item.status !== "invalid").map((item) => (
                  <button
                    key={item.id}
                    className={`chip chip-source ${activeId === `source-${item.bvid}` ? "active" : ""}`}
                    onClick={() => handleQueuePreview(item)}
                  >
                    {item.title || "Untitled video"}
                  </button>
                ))}
              </div>
              <div className={`parse-queue ${isQueueResolving ? "is-loading" : ""}`}>
                <div className="parse-queue-header">
                  <span>Parse Queue</span>
                  <span className="parse-queue-hint">Auto parse metadata on add ¡¤ retry failed if needed</span>
                  {isQueueResolving ? <span className="parse-queue-spinner" aria-hidden="true" /> : null}
                </div>
                <textarea
                  className="parse-input"
                  value={parseInput}
                  onChange={(event) => setParseInput(event.target.value)}
                  placeholder="Paste multiple BV URLs or IDs, one per line"
                  rows={3}
                />
                <div className="parse-actions">
                  <button onClick={enqueueParseSources}>Add to List</button>
                  <button
                    onClick={() => resolveParseQueue("failed")}
                    disabled={isBatchResolving || parseStats.error === 0}
                    className={isBatchResolving ? "is-loading" : ""}
                  >
                    {isBatchResolving ? "Parsing..." : "Retry Failed"}
                  </button>
                  <div className="parse-stats">
                    {parseStats.total ? (
                      <>
                        <span>Pending {parseStats.pending}</span>
                        <span>Resolving {parseStats.resolving}</span>
                        <span>Ready {parseStats.ready}</span>
                        <span>Error {parseStats.error}</span>
                      </>
                    ) : (
                      <span>No sources yet</span>
                    )}
                  </div>
                </div>
                <div className="parse-list">
                  {parseQueue.length ? (
                    parseQueue.map((item) => (
                      <div key={item.id} className={`parse-item ${item.status}`}>
                        <div className="parse-main">
                          <div className="parse-title">
                            {item.title ||
                              (item.status === "pending"
                                ? "Title pending"
                                : item.status === "invalid"
                                  ? "Invalid source"
                                  : "Untitled video")}
                          </div>
                          <div className="parse-meta">
                            <span className={`parse-dot ${item.status}`} />
                            <span>
                              {item.status === "resolving" && "Parsing"}
                              {item.status === "ready" && "Ready"}
                              {item.status === "pending" && "Pending"}
                              {item.status === "error" && (item.error || "Error")}
                              {item.status === "invalid" && "Invalid"}
                            </span>
                          </div>
                        </div>
                        <div className="parse-buttons">
                          {item.status !== "invalid" ? (
                            <button onClick={() => handleQueuePreview(item)}>Preview</button>
                          ) : null}
                          {item.status !== "invalid" ? (
                            <button onClick={() => handleQueueUse(item)}>Use</button>
                          ) : null}
                          {item.status === "error" ? (
                            <button onClick={() => resolveQueueItem(item)}>Retry</button>
                          ) : null}
                          <button onClick={() => handleQueueRemove(item.id)}>Remove</button>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="parse-empty">Add sources to build a queue.</div>
                  )}
                </div>
              </div>
            </div>
              <div className="preview-actions">
                <button onClick={handleResolvePreview} disabled={isResolving}>
                  {isResolving ? "Parsing..." : "Retry Parse"}
                </button>
              </div>
          </div>
          {activeCard ? (
            <div className="preview-body">
              {previewUrl ? (
                <webview
                  ref={webviewRef}
                  src={previewUrl}
                  className={`player-webview embed-player ${isLoadingPreview ? "is-loading" : ""}`}
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
              {(isLoadingPreview || isResolving) ? (
                <div className="preview-loading">
                  <div className="preview-loading-spinner" />
                  <div className="preview-loading-text">Loading preview¡­</div>
                </div>
              ) : null}
              {previewError ? <div className="error">{previewError}</div> : null}
              {activeCard.tags || activeCard.bpm ? (
                <div className="track-notes">
                  {activeCard.tags ? <span>Tags: {activeCard.tags}</span> : null}
                  {activeCard.bpm ? <span>BPM: {activeCard.bpm}</span> : null}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="list-item">Select a card to preview.</div>
          )}
        </section>

        <section className="panel">
          <h2>Create Card</h2>
          <div className="form">
            <div className="field">
              <label>Title</label>
              <input
                value={form.title}
                onChange={(event) => updateForm("title", event.target.value)}
                placeholder="Song title"
              />
            </div>
            <div className="field">
              <label>Artist</label>
              <input
                value={form.artist}
                onChange={(event) => updateForm("artist", event.target.value)}
                placeholder="Artist name"
              />
            </div>
            <div className="field">
              <label>Bilibili BV id or URL</label>
              <input
                value={form.source}
                onChange={(event) => updateForm("source", event.target.value)}
                placeholder="BVxxxx... or https://www.bilibili.com/video/BV..."
              />
            </div>
            <details className="advanced">
              <summary>Advanced options</summary>
              <div className="row">
                <div className="field">
                  <label>Tags</label>
                  <input
                    value={form.tags}
                    onChange={(event) => updateForm("tags", event.target.value)}
                    placeholder="genre:pop, dance:random"
                  />
                </div>
                <div className="field">
                  <label>BPM</label>
                  <input
                    value={form.bpm}
                    onChange={(event) => updateForm("bpm", event.target.value)}
                    placeholder="120"
                  />
                </div>
              </div>
            </details>
            {error ? <div className="error">{error}</div> : null}
            <button className="primary" onClick={handleAddCard}>Create Card</button>
          </div>
        </section>

        <section className="panel">
          <h2>Card Library</h2>
          <div className="list">
            {cards.map((card) => (
              <div key={card.id} className="list-item">
                <div className="list-row">
                  <div>
                    <strong>{card.title}</strong> ¡ª {card.artist}
                  </div>
                  <div className="segment">{formatTime(card.start)} - {formatTime(card.end)}</div>
                </div>
                <div className="list-actions">
                  <button onClick={() => handlePreviewCard(card)}>Preview</button>
                  <button onClick={() => handleSelect(card)}>Add</button>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <h2>Selection</h2>
          <div className="list">
            {selection.length === 0 ? (
              <div className="list-item">No cards selected.</div>
            ) : (
              selection.map((item) => (
                <div key={item.id} className="list-item">
                  <div className="list-row">
                    <div>
                      <strong>{item.title}</strong> ¡ª {item.artist}
                    </div>
                    <div className="segment">{formatTime(item.start)} - {formatTime(item.end)}</div>
                  </div>
                  <div className="list-actions">
                    <button onClick={() => handleRemove(item.id)}>Remove</button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="panel">
          <h2>Generation</h2>
          <div className="status">Status: {status}</div>
          <div className="list">
            {progress.length === 0 ? (
              <div className="list-item">No progress yet.</div>
            ) : (
              progress.map((item, index) => (
                <div key={`${item.step}-${index}`} className="list-item">
                  {item.current}/{item.total} - {item.label}
                </div>
              ))
            )}
          </div>
        </section>
      </main>
    </div>
  );
}














