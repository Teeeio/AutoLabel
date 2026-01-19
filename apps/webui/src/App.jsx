import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import {
  createCard,
  getCards,
  getSession,
  login,
  logout,
  register,
  searchCardsPublic,
  updateCard
} from "./communityApi";
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
  return {
    ...card,
    tags: tags.join(", "),
    searchTags: tags,
    clipTags: Array.isArray(card.clipTags) ? card.clipTags : [],
    notes: card.notes || "",
    visibility: card.visibility === "public" ? "public" : "private"
  };
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
function buildCardPreviewUrl({ bvid, start, end }) {
  if (!bvid) return "";
  const params = new URLSearchParams();
  params.set("bvid", bvid);
  params.set("autoplay", "0");
  params.set("muted", "1");
  params.set("danmaku", "0");
  params.set("high_quality", "1");
  params.set("as_wide", "1");
  params.set("page", "1");
  if (Number.isFinite(start) && start > 0) {
    params.set("t", String(Math.floor(start)));
  }
  // 添加区间限制到URL
  const startTime = Math.floor(start || 0);
  const endTime = Number.isFinite(end) ? Math.floor(end) : undefined;
  return `https://player.bilibili.com/player.html?${params.toString()}#t=${startTime}`;
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
  const [communitySession, setCommunitySession] = useState(null);
  const [communityLogin, setCommunityLogin] = useState({ username: "", password: "" });
  const [communityStatus, setCommunityStatus] = useState({ loading: false, error: "" });
  const [communityMyCards, setCommunityMyCards] = useState([]);
  const [communitySearchQuery, setCommunitySearchQuery] = useState("");
  const [communitySearchSort, setCommunitySearchSort] = useState("latest");
  const [communityCardResults, setCommunityCardResults] = useState([]);
  const [saveNotice, setSaveNotice] = useState("");
  const [manageFilter, setManageFilter] = useState("all");
  const [manageSearch, setManageSearch] = useState("");
  const [manageSelected, setManageSelected] = useState([]);
  const [webviewManageIds, setWebviewManageIds] = useState(new Set());
  const [webviewCommunityIds, setWebviewCommunityIds] = useState(new Set());
  const [detailCard, setDetailCard] = useState(null);
  const [detailWebviewLoading, setDetailWebviewLoading] = useState(false);
  const [detailWebviewLoadStartTime, setDetailWebviewLoadStartTime] = useState(Date.now());
  const [hoveredManageId, setHoveredManageId] = useState("");
  const [hoveredCommunityId, setHoveredCommunityId] = useState("");
  const [hoveredManageBvid, setHoveredManageBvid] = useState("");
  const [hoveredCommunityBvid, setHoveredCommunityBvid] = useState("");
  const [manageLoadingState, setManageLoadingState] = useState(new Map());
  const [communityLoadingState, setCommunityLoadingState] = useState(new Map());
  const [previewCurrentTime, setPreviewCurrentTime] = useState(new Map()); // 跟踪每个预览的当前时间
  const [isDraggingProgress, setIsDraggingProgress] = useState(false); // 跟踪是否正在拖动进度条
  const manageWebviewTimerRef = useRef(null);
  const communityWebviewTimerRef = useRef(null);

  // 预加载所有卡片的webview标志
  const [managePreloaded, setManagePreloaded] = useState(false);
  const [communityPreloaded, setCommunityPreloaded] = useState(false);
  const [loadTick, setLoadTick] = useState(0);
  const loadTimerRef = useRef(null);
  const [showCommunityAuth, setShowCommunityAuth] = useState(false);
  const [communityAuthMode, setCommunityAuthMode] = useState("login");
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
  const [tooltip, setTooltip] = useState({ visible: false, text: '', x: 0, y: 0 });
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
  const detailWebviewKeyRef = useRef(0);
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
    source: "",
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
  const searchSuggestion = "LoveLive";
  const [searchQuery, setSearchQuery] = useState("");
  const [searchUrl, setSearchUrl] = useState(
    () =>
      `https://search.bilibili.com/all?keyword=${encodeURIComponent(
        searchSuggestion
      )}`
  );
  const [isSearchLoading, setIsSearchLoading] = useState(false);
  const [searchDebugLines, setSearchDebugLines] = useState([]);
  const [showSearchOverlay, setShowSearchOverlay] = useState(true);
  const searchOverlayRef = useRef({ key: "", ready: false });
  const parseQueueRef = useRef([]);
  const [cachedRangesMap, setCachedRangesMap] = useState({});
  const [previewSource, setPreviewSource] = useState(null);
  const [thumbs, setThumbs] = useState({ start: "", end: "" });
  const prefetchRef = useRef({ inflight: false, lastKey: "", lastAt: 0 });
  const searchWebviewRef = useRef(null);
  const managePreviewWebviewsRef = useRef(new Map());
  const communityPreviewWebviewsRef = useRef(new Map());
  const initializeCardPreview = useCallback((webview, bvid, start) => {
    if (!webview) return;
    webview.addEventListener('dom-ready', () => {
      setTimeout(() => {
        webview.executeJavaScript(`
          (function() {
            const video = document.querySelector('video');
            if (video) {
              video.pause();
              const targetTime = ${Number.isFinite(start) ? start : 0};
              if (targetTime > 0 && Math.abs(video.currentTime - targetTime) > 0.5) {
                video.currentTime = targetTime;
              }
            }
            const player = document.querySelector('.bpx-player-container');
            if (player) {
              player.style.pointerEvents = 'none';
            }
          })();
        `).catch(() => {});
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
  useEffect(() => {
    // 初始化所有已加载的webview
    const initializedWebviews = new Set();

    webviewManageIds.forEach((cardId) => {
      if (initializedWebviews.has(cardId)) return;

      const card = communityMyCards.find(c => c.id === cardId);
      if (!card) return;

      const webview = document.getElementById(`manage-preview-${card.bvid}`);
      if (!webview) return;

      // 标记为已初始化，避免重复
      initializedWebviews.add(cardId);

      const handler = () => {
        const loadTime = Date.now() - (manageLoadingState.get(cardId)?.webviewStartTime || Date.now());
        setManageLoadingState((prev) => new Map(prev).set(cardId, {
          ...prev.get(cardId),
          webviewLoading: false,
          webviewReady: true,
          webviewLoadTime: loadTime
        }));

        const startTime = Number.isFinite(card.start) ? card.start : 0;
        const endTime = Number.isFinite(card.end) ? card.end : undefined;

        // 初始化webview：跳转到start位置并暂停
        const initializeVideo = () => {
          // 检查 webview 是否仍然存在于 DOM 中
          const currentWebview = document.getElementById(webview.id);
          if (!currentWebview) {
            console.log('Webview no longer exists, skipping initialization');
            return;
          }

          webview.executeJavaScript(`
            (function() {
              const video = document.querySelector('video');
              const player = document.querySelector('.bpx-player-container');
              const controller = document.querySelector('.bpx-player-control-wrap');
              const danmaku = document.querySelector('.bpx-player-dm-layer');

              console.log('Initializing video at:', ${startTime}, 'video:', !!video);

              // 隐藏播放器控件
              if (controller) {
                controller.style.display = 'none';
              }
              if (danmaku) {
                danmaku.style.display = 'none';
              }

              // 跳转到起始位置并播放以显示画面
              if (video) {
                video.muted = true; // 静音以允许自动播放

                // 先播放以加载画面
                video.currentTime = ${startTime};
                const playPromise = video.play();

                if (playPromise !== undefined) {
                  playPromise.then(() => {
                    // 播放成功后立即暂停
                    setTimeout(() => {
                      video.pause();
                      video.currentTime = ${startTime};
                      video.muted = false; // 恢复音量
                    }, 100);
                  }).catch(err => {
                    console.log('Autoplay prevented, trying alternative:', err);
                    // 如果自动播放被阻止，尝试静音播放
                    video.muted = true;
                    video.play().then(() => {
                      setTimeout(() => {
                        video.pause();
                        video.currentTime = ${startTime};
                      }, 100);
                    }).catch(e => {
                      console.error('Play failed:', e);
                    });
                  });
                }

                // 添加播放范围限制和时间更新
                video.addEventListener('timeupdate', function() {
                  // 通知父组件更新时间
                  if (window.electronIPC) {
                    window.electronIPC.sendMessage('preview-timeupdate', {
                      cardId: '${cardId}',
                      currentTime: video.currentTime,
                      startTime: ${startTime},
                      endTime: ${endTime}
                    });
                  }

                  // 循环播放：到达结束时回到起始位置
                  if (${endTime} !== undefined && video.currentTime >= ${endTime}) {
                    video.currentTime = ${startTime};
                    // 如果视频正在播放，继续播放
                    if (!video.paused) {
                      video.play().catch(e => console.log('Auto-loop play failed:', e));
                    }
                  }
                });
              }

              if (player) {
                // 只禁用控制栏的点击，保留视频区域的交互
                const controlWrap = player.querySelector('.bpx-player-control-wrap');
                if (controlWrap) {
                  controlWrap.style.pointerEvents = 'none';
                }
              }

              return {
                video: !!video,
                currentTime: video ? video.currentTime : 0
              };
            })();
          `).then((result) => {
            console.log('Webview initialized:', result);
          }).catch((err) => {
            console.error('Failed to initialize webview:', err);
          });
        };

        // 先尝试初始化，如果失败则延迟重试
        setTimeout(initializeVideo, 500);

        // 再次尝试确保视频已初始化
        setTimeout(initializeVideo, 2000);

        // 标记webview已准备好，用于时间更新
        let isReadyForTimeUpdate = false;
        let updateInterval = null;

        // 定期更新当前时间
        const startTimeUpdate = () => {
          if (updateInterval) return; // 避免重复启动

          const updateTime = () => {
            const currentWebview = document.getElementById(webview.id);
            if (!currentWebview) {
              clearInterval(updateInterval);
              updateInterval = null;
              return;
            }

            currentWebview.executeJavaScript(`
              (function() {
                const video = document.querySelector('video');
                return video ? video.currentTime : ${startTime};
              })();
            `).then((time) => {
              if (typeof time === 'number') {
                setPreviewCurrentTime(prev => new Map(prev).set(cardId, time));
              }
            }).catch((err) => {
              console.error('Time update error:', err);
            });
          };

          updateInterval = setInterval(updateTime, 500);
        };

        // 等待一段时间后开始更新时间
        const readyTimer = setTimeout(() => {
          isReadyForTimeUpdate = true;
          startTimeUpdate();
        }, 1500);

        // 清理函数
        return () => {
          clearTimeout(readyTimer);
          if (updateInterval) {
            clearInterval(updateInterval);
            updateInterval = null;
          }
        };
      };

      webview.addEventListener('dom-ready', handler);

      // 清理函数
      return () => {
        webview.removeEventListener('dom-ready', handler);
      };
    });
  }, [webviewManageIds, manageLoadingState, communityMyCards]);
  useEffect(() => {
    // 初始化所有已加载的webview
    const initializedWebviews = new Set();

    webviewCommunityIds.forEach((cardId) => {
      if (initializedWebviews.has(cardId)) return;

      const card = communityCardResults.find(c => c.id === cardId);
      if (!card) return;

      const webview = document.getElementById(`community-preview-${card.bvid}`);
      if (!webview) return;

      initializedWebviews.add(cardId);

      const handler = () => {
        const loadTime = Date.now() - (communityLoadingState.get(cardId)?.webviewStartTime || Date.now());
        setCommunityLoadingState((prev) => new Map(prev).set(cardId, {
          ...prev.get(cardId),
          webviewLoading: false,
          webviewReady: true,
          webviewLoadTime: loadTime
        }));

        const startTime = Number.isFinite(card.start) ? card.start : 0;
        const endTime = Number.isFinite(card.end) ? card.end : undefined;

        // 初始化webview：跳转到start位置并暂停
        const initializeVideo = () => {
          // 检查 webview 是否仍然存在于 DOM 中
          const currentWebview = document.getElementById(webview.id);
          if (!currentWebview) {
            console.log('Community webview no longer exists, skipping initialization');
            return;
          }

          webview.executeJavaScript(`
            (function() {
              const video = document.querySelector('video');
              const player = document.querySelector('.bpx-player-container');
              const controller = document.querySelector('.bpx-player-control-wrap');
              const danmaku = document.querySelector('.bpx-player-dm-layer');

              console.log('Initializing community video at:', ${startTime}, 'video:', !!video);

              // 隐藏播放器控件
              if (controller) {
                controller.style.display = 'none';
              }
              if (danmaku) {
                danmaku.style.display = 'none';
              }

              // 跳转到起始位置并播放以显示画面
              if (video) {
                video.muted = true; // 静音以允许自动播放

                // 先播放以加载画面
                video.currentTime = ${startTime};
                const playPromise = video.play();

                if (playPromise !== undefined) {
                  playPromise.then(() => {
                    // 播放成功后立即暂停
                    setTimeout(() => {
                      video.pause();
                      video.currentTime = ${startTime};
                      video.muted = false; // 恢复音量
                    }, 100);
                  }).catch(err => {
                    console.log('Autoplay prevented, trying alternative:', err);
                    // 如果自动播放被阻止，尝试静音播放
                    video.muted = true;
                    video.play().then(() => {
                      setTimeout(() => {
                        video.pause();
                        video.currentTime = ${startTime};
                      }, 100);
                    }).catch(e => {
                      console.error('Play failed:', e);
                    });
                  });
                }

                // 添加播放范围限制（循环播放）
                video.addEventListener('timeupdate', function() {
                  // 循环播放：到达结束时回到起始位置
                  if (${endTime} !== undefined && video.currentTime >= ${endTime}) {
                    video.currentTime = ${startTime};
                    // 如果视频正在播放，继续播放
                    if (!video.paused) {
                      video.play().catch(e => console.log('Auto-loop play failed:', e));
                    }
                  }
                });
              }

              if (player) {
                // 只禁用控制栏的点击，保留视频区域的交互
                const controlWrap = player.querySelector('.bpx-player-control-wrap');
                if (controlWrap) {
                  controlWrap.style.pointerEvents = 'none';
                }
              }

              return true;
            })();
          `).catch((err) => {
            console.error('Failed to initialize community webview:', err);
          });
        };

        // 先尝试初始化，如果失败则延迟重试
        setTimeout(initializeVideo, 500);

        // 再次尝试确保视频已初始化
        setTimeout(initializeVideo, 2000);

        // 标记webview已准备好，用于时间更新
        let isReadyForTimeUpdate = false;
        let updateInterval = null;

        // 定期更新当前时间
        const startTimeUpdate = () => {
          if (updateInterval) return; // 避免重复启动

          const updateTime = () => {
            const currentWebview = document.getElementById(webview.id);
            if (!currentWebview) {
              clearInterval(updateInterval);
              updateInterval = null;
              return;
            }

            currentWebview.executeJavaScript(`
              (function() {
                const video = document.querySelector('video');
                return video ? video.currentTime : ${startTime};
              })();
            `).then((time) => {
              if (typeof time === 'number') {
                setPreviewCurrentTime(prev => new Map(prev).set(cardId, time));
              }
            }).catch((err) => {
              console.error('Time update error:', err);
            });
          };

          updateInterval = setInterval(updateTime, 500);
        };

        // 等待一段时间后开始更新时间
        const readyTimer = setTimeout(() => {
          isReadyForTimeUpdate = true;
          startTimeUpdate();
        }, 1500);

        // 清理函数
        return () => {
          clearTimeout(readyTimer);
          if (updateInterval) {
            clearInterval(updateInterval);
            updateInterval = null;
          }
        };
      };

      webview.addEventListener('dom-ready', handler);
    });

    // 清理函数
    return () => {
      initializedWebviews.forEach((cardId) => {
        const card = communityCardResults.find(c => c.id === cardId);
        if (card) {
          const webview = document.getElementById(`community-preview-${card.bvid}`);
          if (webview) {
            // 移除事件监听器,不要设置opacity为0
            // webview.style.opacity = '0'; // 移除这行,会导致黑屏
          }
        }
      });
    };
  }, [webviewCommunityIds, communityLoadingState, communityCardResults]);

  // 初始化详情页 webview
  useEffect(() => {
    if (!detailCard) return;

    // 设置加载状态和开始时间
    setDetailWebviewLoading(true);
    setDetailWebviewLoadStartTime(Date.now());

    const webviewId = `detail-preview-${detailCard.bvid}`;
    const webview = document.getElementById(webviewId);
    if (!webview) return;

    const handler = () => {
      console.log('Detail webview dom-ready');

      // 修复webview内部iframe高度
      patchWebviewIframeHeight(webview);

      // 设置加载完成状态
      setDetailWebviewLoading(false);

      const startTime = Number.isFinite(detailCard.start) ? detailCard.start : 0;
      const endTime = Number.isFinite(detailCard.end) ? detailCard.end : undefined;

      // 初始化webview：跳转到start位置并暂停
      const initializeVideo = () => {
        // 检查 webview 是否仍然存在于 DOM 中
        const currentWebview = document.getElementById(webviewId);
        if (!currentWebview) {
          console.log('Detail webview no longer exists, skipping initialization');
          return;
        }

        currentWebview.executeJavaScript(`
          (function() {
            const video = document.querySelector('video');
            const player = document.querySelector('#bilibili-player');

            if (video) {
              // 设置起始位置
              video.currentTime = ${startTime};
              video.pause().catch(e => console.log('Auto-pause failed:', e));

              // 添加播放范围限制（循环播放）
              video.addEventListener('timeupdate', function() {
                // 循环播放：到达结束时回到起始位置
                if (${endTime} !== undefined && video.currentTime >= ${endTime}) {
                  video.currentTime = ${startTime};
                  // 如果视频正在播放，继续播放
                  if (!video.paused) {
                    video.play().catch(e => console.log('Auto-loop play failed:', e));
                  }
                }
              });
            }

            if (player) {
              // 只禁用控制栏的点击，保留视频区域的交互
              const controlWrap = player.querySelector('.bpx-player-control-wrap');
              if (controlWrap) {
                controlWrap.style.pointerEvents = 'none';
              }
            }

            return true;
          })();
        `).catch((err) => {
          console.error('Failed to initialize detail webview:', err);
        });
      };

      // 先尝试初始化，如果失败则延迟重试
      setTimeout(initializeVideo, 500);
      setTimeout(initializeVideo, 2000);
    };

    webview.addEventListener('dom-ready', handler);

    return () => {
      webview.removeEventListener('dom-ready', handler);
    };
  }, [detailCard, detailWebviewKeyRef.current]);

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
      const keyword = trimmed || searchSuggestion;
      if (!keyword) return;
      const nextUrl = buildSearchUrl(keyword);
      searchOverlayRef.current = { key: nextUrl, ready: false };
      setShowSearchOverlay(true);
      setSearchUrl(nextUrl);
    },
    [searchQuery, searchSuggestion, buildSearchUrl]
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
            error: "Invalid BV"
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
  const handleAddCard = async () => {
    if (!communitySession) {
      setCommunityStatus({ loading: false, error: "请先登录社区账号。" });
      openCommunityLogin();
      return;
    }
    const rawSource = activeCard?.bvid || form.source || "";
    const bvid = extractBvid(rawSource);
    const resolvedTitle = (form.title || activeCard?.title || "").trim();
    if (!resolvedTitle) {
      alert("请先输入标题。");
      return;
    }
    if (!bvid) {
      alert("请先选择视频。");
      return;
    }
    const startValue = Number.isFinite(rangeStart) ? rangeStart : 0;
    const endValue = Number.isFinite(rangeEnd) ? rangeEnd : startValue + 30;
    const start = Math.min(startValue, endValue);
    const end = Math.max(startValue, endValue);
    setCommunityStatus({ loading: true, error: "" });
    let result;
    try {
      result = await createCard({
        title: resolvedTitle,
        bvid,
        start,
        end,
        tags: [...tagList],
        clipTags: [...clipTags],
        bpm: form.bpm.trim(),
        notes: form.notes.trim(),
        visibility: form.visibility
      });
    } catch (err) {
      setCommunityStatus({
        loading: false,
        error: "服务端未启动或网络异常。",
      });
      return;
    }
    if (!result.ok) {
      setCommunityStatus({ loading: false, error: result.message || "创建失败。" });
      if (result.message && result.message.includes("not logged in")) {
        openCommunityLogin();
      }
      return;
    }
    const newCard = hydrateCard(result.item);
    if (newCard) {
      setCards((prev) => [newCard, ...prev]);
    }
    await loadCommunitySession();
    await refreshCommunitySearch();
    setSaveNotice("卡片已保存到社区。");
    setCommunityStatus({ loading: false, error: "" });
    setForm({
      title: "",
      source: "",
      tags: "",
      bpm: "",
      notes: "",
      visibility: "private"
    });
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
  const handleApplyCardTags = (card) => {
    const tags = normalizeCardTags(card?.tags);
    if (!tags.length) return;
    setTagList((prev) => Array.from(new Set([...prev, ...tags])));
    setTagInput("");
    if (card?.notes) {
      setForm((prev) => (prev.notes ? prev : { ...prev, notes: card.notes }));
    }
  };
  const openCommunityLogin = () => {
    setCommunityAuthMode("login");
    setCommunityStatus({ loading: false, error: "" });
    setShowCommunityAuth(true);
  };
  const openCommunityRegister = () => {
    setCommunityAuthMode("register");
    setCommunityStatus({ loading: false, error: "" });
    setShowCommunityAuth(true);
  };
  const loadCommunitySession = useCallback(async () => {
    setCommunityStatus((prev) => ({ ...prev, loading: true, error: "" }));
    const session = await getSession();
    setCommunitySession(session?.user || null);
    if (session?.user) {
      const cardRes = await getCards();
      setCommunityMyCards(cardRes.ok ? cardRes.items.map(hydrateCard).filter(Boolean) : []);
      setCards(cardRes.ok ? cardRes.items.map(hydrateCard).filter(Boolean) : []);
    } else {
      setCommunityMyCards([]);
      setCards([]);
    }
    setCommunityStatus((prev) => ({ ...prev, loading: false }));
  }, []);
  const refreshCommunitySearch = useCallback(async () => {
    const result = await searchCardsPublic({
      query: communitySearchQuery,
      sort: communitySearchSort
    });
    setCommunityCardResults(result.ok ? result.items.map(hydrateCard).filter(Boolean) : []);
  }, [communitySearchQuery, communitySearchSort]);
  const handleCommunityLogin = async () => {
    setCommunityStatus({ loading: true, error: "" });
    const result = await login(communityLogin);
    if (!result.ok) {
      setCommunityStatus({ loading: false, error: result.message || "登录失败。" });
      return;
    }
    setCommunitySession(result.user || null);
    setCommunityLogin({ username: "", password: "" });
    setCommunityStatus({ loading: false, error: "" });
    await loadCommunitySession();
    await refreshCommunitySearch();
    setShowCommunityAuth(false);
  };
  const handleCommunityRegister = async () => {
    setCommunityStatus({ loading: true, error: "" });
    const result = await register(communityLogin);
    if (!result.ok) {
      setCommunityStatus({ loading: false, error: result.message || "注册失败。" });
      return;
    }
    setCommunityStatus({ loading: false, error: "" });
    await handleCommunityLogin();
  };
  const handleCommunityLogout = async () => {
    await logout();
    setCommunitySession(null);
    setCommunityMyCards([]);
    setCards([]);
    setCommunityStatus({ loading: false, error: "" });
    await refreshCommunitySearch();
  };
  const handleToggleCardVisibility = async (card) => {
    if (!communitySession || !card) {
      setCommunityStatus({ loading: false, error: "请先登录社区账号。" });
      openCommunityLogin();
      return;
    }
    const nextVisibility = card.visibility === "public" ? "private" : "public";
    await updateCard(card.id, { visibility: nextVisibility });
    await loadCommunitySession();
    await refreshCommunitySearch();
  };
  useEffect(() => {
    loadCommunitySession();
    refreshCommunitySearch();
  }, [loadCommunitySession, refreshCommunitySearch]);
  useEffect(() => {
    if (!saveNotice) return;
    const timer = setTimeout(() => setSaveNotice(""), 2500);
    return () => clearTimeout(timer);
  }, [saveNotice]);
  const filteredManageCards = useMemo(() => {
    const query = manageSearch.trim().toLowerCase();
    return communityMyCards.filter((card) => {
      if (manageFilter !== "all" && card.visibility !== manageFilter) return false;
      if (!query) return true;
      return (
        (card.title || "").toLowerCase().includes(query) ||
        (card.bvid || "").toLowerCase().includes(query) ||
        normalizeCardTags(card.tags).some((tag) => tag.toLowerCase().includes(query)) ||
        (card.notes || "").toLowerCase().includes(query)
      );
    });
  }, [communityMyCards, manageFilter, manageSearch]);

  const filteredCommunityCards = useMemo(() => {
    return communityCardResults;
  }, [communityCardResults]);
  const handleToggleManageSelect = (tagId) => {
    setManageSelected((prev) =>
      prev.includes(tagId) ? prev.filter((id) => id !== tagId) : [...prev, tagId]
    );
  };
  const handleSelectAllManageTags = () => {
    setManageSelected(filteredManageCards.map((card) => card.id));
  };
  const handleClearManageSelection = () => {
    setManageSelected([]);
  };
  const handleBulkVisibility = async (visibility) => {
    if (!communitySession) {
      setCommunityStatus({ loading: false, error: "请先登录社区账号。" });
      openCommunityLogin();
      return;
    }
    const targets = communityMyCards.filter((card) => manageSelected.includes(card.id));
    if (!targets.length) return;
    setCommunityStatus({ loading: true, error: "" });
    await Promise.all(targets.map((card) => updateCard(card.id, { visibility })));
    await loadCommunitySession();
    setCommunityStatus({ loading: false, error: "" });
    setManageSelected([]);
  };
  const clipTagGroups = [
    {
      label: "团体",
      single: true,
      options: ["μ's", "Aqours", "Nijigasaki", "Liella", "Hasunosora", "Bird"]
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
      alert("Please add at least one tag.");
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
    alert(`${result.message}\n${result.outputPath || ""}`);
  };
  const handleLogin = async () => {
    if (!window.auth) {
      setAuthStatus("unavailable");
      alert("无法登录。");
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
      const nextUrl = buildEmbedUrl({
        bvid: activeCard.bvid,
        aid: activeCard.aid,
        cid: activeCard.cid
      });
      setPreviewUrl(activeCard.resolvedUrl || nextUrl);
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
      setPreviewUrl(buildEmbedUrl({ bvid: nextCard.bvid, aid: nextCard.aid, cid: nextCard.cid }));
    },
    [updateRangeState]
  );
  const handleOpenCardDetail = useCallback(
    (card) => {
      // 增加 key 以强制重新创建 webview
      detailWebviewKeyRef.current += 1;
      setDetailCard(card);
    },
    []
  );
  const handleCloseDetail = useCallback(() => {
    setDetailCard(null);
    setDetailWebviewLoading(false);

    // 切回卡片制作页面时,强制刷新整个预览面板
    setPreviewPanelKey(prev => prev + 1);

    // 切回卡片制作页面时,重置为初始状态(空预览)
    setPreviewEpoch(prev => prev + 2);
    setActiveId("");
    setPreviewSource(null);
    setPreviewUrl("");
    setPreviewError("");
    setDuration(0);
    setCurrentTime(0);
    setRangeStart(0);
    setRangeEnd(30);
    setSegmentSpan(0);
    setSegmentOffset(0);
    setSourceDuration(0);
    setIsPlaying(false);
    setIsBuffering(false);
    setIsDashMode(false);
    setIsLoadingPreview(false);
    setIsResolving(false);
    resetDash();
  }, []);
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

  // 当切换回卡片制作页面时,重新修复webview高度
  useEffect(() => {
    if (!previewUrl || !activeId) return;
    const view = webviewRef.current;
    if (!view) return;

    // 延迟多次尝试,确保webview已经完全加载
    const timers = [
      setTimeout(() => patchWebviewIframeHeight(view), 100),
      setTimeout(() => patchWebviewIframeHeight(view), 500),
      setTimeout(() => patchWebviewIframeHeight(view), 1000)
    ];

    return () => timers.forEach(t => clearTimeout(t));
  }, [activeId, previewUrl]);

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
      if (event.channel === "player:tags") {
        const payload = event.args?.[0] || {};
        const tags = Array.isArray(payload.tags) ? payload.tags : [];
        const normalized = Array.from(
          new Set(tags.map((tag) => String(tag || "").trim()).filter(Boolean))
        );
        if (!normalized.length) return;
        setTagList((prev) => {
          if (
            prev.length === normalized.length &&
            prev.every((value, index) => value === normalized[index])
          ) {
            return prev;
          }
          return normalized;
        });
        setTagInput("");
        const nextTags = normalized.join(", ");
        setForm((prev) =>
          prev.tags === nextTags ? prev : { ...prev, tags: nextTags }
        );
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
            const emitMaskReady = () => {
              if (state.maskReady) return;
              state.maskReady = true;
              console.log("rdg-mask:ready");
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
                '<span class="rdg-spinner"></span><span class="rdg-loading-text">加载中...</span>';
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
              state.maskReady = false;
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
            if (state.bootstrapped) {
              emitMaskReady();
              return;
            }
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
              overlay.className = "rdg-search-card-mask";
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
              emitMaskReady();
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
                  if (title.includes("verify") || title.includes("captcha")) {
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
                  if (text.includes("no results") || text.includes("not found")) {
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
              emitMaskReady();
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
      if (text.startsWith("rdg-mask:ready")) {
        searchOverlayRef.current = {
          ...searchOverlayRef.current,
          ready: true
        };
        setShowSearchOverlay(false);
        return;
      }
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
          ? "selection"
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
  const location = useLocation();
  const currentPath = location.pathname || "/";
  const isBuilderPage = currentPath === "/" || currentPath.startsWith("/builder");
  const normalizedAuth = authStatus?.toLowerCase?.() || "";

  // 监听路由变化,当切换回卡片制作页面时强制刷新预览栏
  const previousPathRef = useRef(null);
  useEffect(() => {
    const previousPath = previousPathRef.current;
    const currentPath = location.pathname || "/";

    // 只在路径真正变化时执行
    if (previousPath !== currentPath) {
      // 只在切换到卡片制作页面(根路径或/builder)时执行
      if (currentPath === "/" || currentPath.startsWith("/builder")) {
        // 只刷新预览栏相关的状态
        setPreviewPanelKey(prev => prev + 1);
        setPreviewEpoch(prev => prev + 1);
        setPreviewUrl("");
        setPreviewError("");
        setIsLoadingPreview(false);
        setIsResolving(false);
      }

      // 更新上一次的路径
      previousPathRef.current = currentPath;
    }
  }, [location.pathname]);

  // 预加载卡片管理的webview - 只预加载前10个
  useEffect(() => {
    // 只在卡片管理页面且未预加载时执行
    if (location.pathname !== "/manage" && location.pathname !== "/") return;
    if (managePreloaded || !cards.length) return;

    // 延迟预加载,避免阻塞页面渲染
    const timer = setTimeout(() => {
      const newIds = new Set(webviewManageIds);
      const newLoadingStates = new Map(manageLoadingState);

      // 只预加载前10个卡片,避免同时加载太多导致黑屏
      const preloadCount = Math.min(cards.length, 10);

      for (let i = 0; i < preloadCount; i++) {
        const card = cards[i];
        if (!newIds.has(card.id)) {
          newIds.add(card.id);
          newLoadingStates.set(card.id, {
            webviewLoading: true,
            webviewStartTime: Date.now()
          });
        }
      }

      setWebviewManageIds(newIds);
      setManageLoadingState(newLoadingStates);
      setManagePreloaded(true);
    }, 500);

    return () => clearTimeout(timer);
  }, [location.pathname, cards, managePreloaded]);

  // 预加载社区卡片的webview - 只预加载前10个
  useEffect(() => {
    // 只在社区页面且未预加载时执行
    if (location.pathname !== "/community") return;
    if (communityPreloaded || !communityCardResults.length) return;

    // 延迟预加载,避免阻塞页面渲染
    const timer = setTimeout(() => {
      const newIds = new Set(webviewCommunityIds);
      const newLoadingStates = new Map(communityLoadingState);

      // 只预加载前10个卡片,避免同时加载太多导致黑屏
      const preloadCount = Math.min(communityCardResults.length, 10);

      for (let i = 0; i < preloadCount; i++) {
        const card = communityCardResults[i];
        if (!newIds.has(card.id)) {
          newIds.add(card.id);
          newLoadingStates.set(card.id, {
            webviewLoading: true,
            webviewStartTime: Date.now()
          });
        }
      }

      setWebviewCommunityIds(newIds);
      setCommunityLoadingState(newLoadingStates);
      setCommunityPreloaded(true);
    }, 500);

    return () => clearTimeout(timer);
  }, [location.pathname, communityCardResults, communityPreloaded]);

  const isLoggedIn = normalizedAuth === "logged in";
  const isLoggingIn = normalizedAuth === "logging in";
  const isUnavailable = normalizedAuth === "unavailable";
  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-left">
          <div className="brand">Random Dance Generator</div>
          <div className="topbar-nav">
            <NavLink
              to="/builder"
              className={({ isActive }) =>
                "nav-button" + (isActive ? " is-active" : "")
              }
            >
              卡片制作
            </NavLink>
            <NavLink
              to="/manage"
              className={({ isActive }) =>
                "nav-button" + (isActive ? " is-active" : "")
              }
            >
              卡片管理
            </NavLink>
            <NavLink
              to="/community"
              className={({ isActive }) =>
                "nav-button" + (isActive ? " is-active" : "")
              }
            >
              卡片社区
            </NavLink>
          </div>
        </div>
        <div className="topbar-actions">
          <div className="topbar-login">
            <div className="login-card">
              <div className="login-block">
                <div className="login-label">
                  <span className="bili-logo" aria-label="Bilibili" />
                </div>
              {isLoggedIn ? (
                <div className="login-status is-bili">已登录</div>
              ) : (
                <button
                  type="button"
                  className="ghost"
                  onClick={handleLogin}
                  disabled={isLoggingIn || isUnavailable}
                >
                  {isLoggingIn ? "登录中..." : isUnavailable ? "不可用" : "登录"}
                </button>
              )}
              </div>
              <div className="login-block">
                <div className="login-label">社区</div>
                {communitySession ? (
                  <div className="login-status is-app">已登录</div>
                ) : (
                  <button type="button" className="ghost" onClick={openCommunityLogin}>
                    登录
                </button>
              )}
              </div>
            </div>
          </div>
          <div className="topbar-utils">
            <button type="button" className="ghost" onClick={handleReload}>
              刷新
            </button>
            {communitySession || isLoggedIn ? (
              <div className="profile-avatar-wrap is-active">
                <img
                  className="profile-avatar"
                  src={placeholderAvatar}
                  alt="avatar"
                />
                <div className="profile-menu">
                  <button
                    type="button"
                    className="ghost"
                    onClick={handleCommunityLogout}
                    disabled={!communitySession}
                  >
                    登出社区
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={handleBiliLogout}
                    disabled={!isLoggedIn}
                  >
                    登出B站                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </header>
      <main className={isBuilderPage ? "workspace" : "workspace workspace--single"}>
  <Routes>
    <Route path="/" element={<Navigate to="/builder" replace />} />
    <Route
      path="/builder"
      element={
        <>
          <section className="panel panel-sources">
            <form className="search-form" onSubmit={handleSearchSubmit}>
              <div className="search-input-wrap">
                <input
                  className="search-input"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder={searchSuggestion}
                />
              </div>
              <button type="submit">搜索</button>
            </form>
            <div className="search-hint">点击结果加入预览。</div>
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
              {showSearchOverlay ? (
                <div className="search-overlay">
                  <div className="search-overlay-spinner" />
                  <div className="search-overlay-text">加载中...</div>
                </div>
              ) : null}
            </div>
          </section>
          <section className="panel panel-preview" key={previewPanelKey}>
            <div className="preview-head">
              <div className="preview-title">
                <h2>{activeCard?.title || "预览"}</h2>
                <div className="preview-range">
                  {activeCard
                    ? `${formatTime(rangeStart)} - ${formatTime(rangeEnd)}`
                    : "--:-- - --:--"}
                </div>
              </div>
            </div>
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
                  <div className="placeholder">解析后播放。</div>
                )}
                {isLoadingPreview || isResolving ? (
                  <div className="preview-loading">
                    <div className="preview-loading-spinner" />
                    <div className="preview-loading-text">预览加载中...</div>
                  </div>
                ) : null}
                {previewError && !isLoadingPreview && !isResolving ? (
                  <div className="preview-error">
                    <button onClick={handleResolvePreview}>重试预览</button>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="placeholder">点击左侧搜索栏结果加入预览。</div>
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
                  <div className="builder-grid builder-grid--preview">
                    <div className="builder-card">
                      <div className="builder-label">预览区间</div>
                      <div className="builder-range">
                        {formatTime(rangeStart)} - {formatTime(rangeEnd)}
                      </div>
                      <div className="builder-hint">拖动预览区间滑块同步。</div>
                      <div className="builder-hint">
                        标签来源：{activeCard ? activeCard.bvid || "未知BV" : "未选择"}
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
                      <div className="tag-hint">搜索标签用于卡片社区检索展示。</div>
                      <div className="tag-input-row">
                        <input
                          value={tagInput}
                          onChange={(event) => setTagInput(event.target.value)}
                          onKeyDown={handleTagKeyDown}
                          placeholder="添加标签，回车确认"
                        />
                        <button type="button" className="ghost" onClick={handleAddTag}>
                          添加
                        </button>
                      </div>
                      <div className="tag-chip-list">
                        {tagList.length ? (
                          tagList.map((tag) => (
                            <span key={tag} className="tag-chip">
                              <span className="tag-chip-text">#{tag}</span>
                              <button type="button" onClick={() => handleRemoveTag(tag)}>
                                ×
                              </button>
                            </span>
                          ))
                        ) : (
                          <div className="tag-empty">暂无标签。</div>
                        )}
                      </div>
                      <div className="tag-hint">搜索标签用于卡片社区检索展示。</div>
                    </div>
                    <div className="builder-card">
                      <div className="builder-label">剪辑标签</div>
                      {clipTagGroups.map((group) => (
                        <div key={group.label} className="clip-tag-group">
                          <div className="clip-tag-title">
                            {group.label}
                            {group.single ? "（单选）" : ""}
                          </div>
                          <div className="clip-tag-list">
                            {group.options.map((tag) => {
                              const isSelected = clipTags.includes(tag);
                              return (
                                <button
                                  key={tag}
                                  type="button"
                                  className={"clip-tag" + (isSelected ? " is-selected" : "")}
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
                    <div className="builder-card">
                      <div className="builder-label">备注</div>
                      <textarea
                        className="builder-textarea"
                        value={form.notes}
                        onChange={(event) =>
                          setForm((prev) => ({ ...prev, notes: event.target.value }))
                        }
                        placeholder="备注"
                      />
                      <div className="builder-label">可见性</div>
                      <select
                        className="builder-select"
                        value={form.visibility}
                        onChange={(event) =>
                          setForm((prev) => ({ ...prev, visibility: event.target.value }))
                        }
                      >
                        <option value="private">私有</option>
                        <option value="public">公开</option>
                      </select>
                      <div className="builder-hint">私有仅自己可见，公开可跨设备同步。</div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="builder-actions">
                <button className="primary" onClick={handleAddCard}>
                  生成卡片
                </button>
                {communityStatus.error ? (
                  <div className="community-error">{communityStatus.error}</div>
                ) : null}
                {saveNotice ? <div className="save-notice">{saveNotice}</div> : null}
                <div className="save-list">
                  <div className="save-title">最近生成卡片</div>
                  {cards.length ? (
                    <div className="save-items">
                      {cards.slice(0, 3).map((card) => (
                        <div key={card.id} className="save-item">
                          <div className="save-item-title">{card.title || "未命名卡片"}</div>
                          <div className="save-item-meta">
                            {card.bvid} 路 {formatTime(card.start)}-{formatTime(card.end)}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="save-empty">暂无记录</div>
                  )}
                </div>
              </div>
            </div>
          </section>
        </>
      }
    />
    <Route
      path="/manage"
      element={
        <section className="panel panel-community">
          <div className="manage-layout">
            <aside className="manage-sidebar">
              <div className="manage-section">
                <div className="manage-section-title">账号</div>
                {communitySession ? (
                  <div className="community-row">
                    <div>
                      <div className="community-title">已登录</div>
                      <div className="community-meta">{communitySession.username}</div>
                    </div>
                    <button type="button" className="ghost" onClick={handleCommunityLogout}>
                      退出                    </button>
                  </div>
                ) : (
                  <div className="manage-empty">
                    <div className="community-meta">未登录社区账号</div>
                    <div className="manage-row-actions">
                      <button type="button" className="ghost" onClick={openCommunityLogin}>
                        登录
                      </button>
                      <button type="button" className="ghost" onClick={openCommunityRegister}>
                        注册
                      </button>
                    </div>
                  </div>
                )}
                {communityStatus.error ? (
                  <div className="community-error">{communityStatus.error}</div>
                ) : null}
              </div>
              <div className="manage-section">
                <div className="manage-section-title">筛选</div>
                <div className="manage-filters">
                  <button
                    type="button"
                    className={"manage-filter" + (manageFilter === "all" ? " is-active" : "")}
                    onClick={() => setManageFilter("all")}
                  >
                    全部
                  </button>
                  <button
                    type="button"
                    className={"manage-filter" + (manageFilter === "public" ? " is-active" : "")}
                    onClick={() => setManageFilter("public")}
                  >
                    公开
                  </button>
                  <button
                    type="button"
                    className={"manage-filter" + (manageFilter === "private" ? " is-active" : "")}
                    onClick={() => setManageFilter("private")}
                  >
                    私有
                  </button>
                </div>
              </div>
            </aside>
            <div className="manage-content">
              {!communitySession ? (
                <div className="manage-alert">
                  需要登录社区账号才能管理卡片。
                  <button type="button" className="ghost" onClick={openCommunityLogin}>
                    立即登录
                  </button>
                </div>
              ) : null}
              <div className="manage-toolbar">
                <div className="manage-search">
                  <input
                    value={manageSearch}
                    onChange={(event) => setManageSearch(event.target.value)}
                    placeholder="搜索我的卡片"
                  />
                </div>
                <div className="manage-actions">
                  <button type="button" className="ghost" onClick={handleSelectAllManageTags}>
                    全选                  </button>
                  <button type="button" className="ghost" onClick={handleClearManageSelection}>
                    清空
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => handleBulkVisibility("public")}
                    disabled={!manageSelected.length}
                  >
                    批量公开
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => handleBulkVisibility("private")}
                    disabled={!manageSelected.length}
                  >
                    批量私有
                  </button>
                </div>
              </div>
              <div className="manage-list manage-cards">
                {filteredManageCards.length ? (
                  filteredManageCards.map((card) => (
                    <div key={card.id} className="manage-card" data-card-id={card.id}>
                      <div className="manage-card-head">
                        <label className="manage-check">
                          <input
                            type="checkbox"
                            checked={manageSelected.includes(card.id)}
                            onChange={() => handleToggleManageSelect(card.id)}
                          />
                          <div className="manage-card-info">
                            <div
                              className="manage-card-title"
                              onMouseEnter={(e) => {
                                const rect = e.currentTarget.getBoundingClientRect();
                                setTooltip({
                                  visible: true,
                                  text: card.title || "未命名卡片",
                                  x: rect.left,
                                  y: rect.bottom + 8
                                });
                              }}
                              onMouseLeave={() => {
                                setTooltip(prev => ({ ...prev, visible: false }));
                              }}
                            >
                              {card.title || "未命名卡片"}
                            </div>
                          </div>
                        </label>
                        <div className={"manage-visibility " + card.visibility}>
                          {card.visibility === "public" ? "公开" : "私有"}
                        </div>
                      </div>
                      <div
                        className="manage-card-preview"
                        onMouseEnter={() => {
                          setHoveredManageId(card.id);
                          setHoveredManageBvid(card.bvid);
                          // webview已经预加载,不需要再创建
                        }}
                        onMouseLeave={() => {
                          setHoveredManageId((prev) => (prev === card.id ? "" : prev));
                          // 不再销毁webview,保持预加载状态
                        }}
                      >
                        <div className="preview-container">
                          {webviewManageIds.has(card.id) ? (
                            <>
                              <webview
                                id={`manage-preview-${card.bvid}`}
                                data-card-id={card.id}
                                data-bvid={card.bvid}
                                data-start={card.start}
                                data-end={card.end}
                                src={buildCardPreviewUrl({
                                  bvid: card.bvid,
                                  start: card.start,
                                  end: card.end
                                })}
                                className="card-preview-webview"
                                allowpopups="true"
                                httpreferrer="https://www.bilibili.com"
                                useragent={bilibiliUserAgent}
                                partition="temp:bili"
                                preload={window.env?.bilibiliPagePreload}
                                style={{
                                  opacity: 1,
                                  width: '100%',
                                  height: '100%'
                                }}
                              />
                              {/* 底部渐变遮罩 - 防止误点击 */}
                              <div
                                className="preview-bottom-shield"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  e.preventDefault();
                                }}
                                onMouseDown={(e) => {
                                  e.stopPropagation();
                                  e.preventDefault();
                                }}
                              />
                              {/* 进度条 */}
                              <div
                                className="preview-progress-bar"
                                onMouseDown={(e) => {
                                  e.stopPropagation();
                                  setIsDraggingProgress(true); // 开始拖动
                                  const progressBar = e.currentTarget;

                                  const updateTime = (clientX) => {
                                    const rect = progressBar.getBoundingClientRect();
                                    const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
                                    const newTime = card.start + (card.end - card.start) * percent;
                                    const webview = document.getElementById(`manage-preview-${card.bvid}`);
                                    if (webview) {
                                      webview.executeJavaScript(`
                                        (function() {
                                          const video = document.querySelector('video');
                                          if (video) {
                                            video.currentTime = ${newTime};
                                          }
                                        })();
                                      `).catch(() => {});
                                    }
                                    setPreviewCurrentTime(prev => new Map(prev).set(card.id, newTime));
                                  };

                                  const handleMouseMove = (moveEvent) => {
                                    updateTime(moveEvent.clientX);
                                  };

                                  const handleMouseUp = () => {
                                    setIsDraggingProgress(false); // 结束拖动
                                    document.removeEventListener('mousemove', handleMouseMove);
                                    document.removeEventListener('mouseup', handleMouseUp);
                                  };

                                  // 初始点击
                                  updateTime(e.clientX);

                                  document.addEventListener('mousemove', handleMouseMove);
                                  document.addEventListener('mouseup', handleMouseUp);
                                }}
                              >
                                <div
                                  className="preview-progress-track"
                                  style={{
                                    width: `${Math.max(0, Math.min(100, ((previewCurrentTime.get(card.id) || card.start) - card.start) / (card.end - card.start) * 100))}%`
                                  }}
                                />
                                <div
                                  className="preview-progress-handle"
                                  style={{
                                    left: `${Math.max(0, Math.min(100, ((previewCurrentTime.get(card.id) || card.start) - card.start) / (card.end - card.start) * 100))}%`
                                  }}
                                />
                              </div>
                              {/* 时间标记 - 显示区间内的相对时间 */}
                              <div className="preview-range-markers">
                                <div className="preview-range-marker">
                                  {formatTime(Math.floor((previewCurrentTime.get(card.id) || card.start) - card.start))}
                                </div>
                                <div className="preview-range-marker">
                                  总时长: {formatTime(card.end - card.start)}
                                </div>
                              </div>
                            </>
                          ) : (
                            <div className="preview-placeholder">
                              <div className="preview-placeholder-content">
                                <div className="preview-placeholder-icon">▶</div>
                                <div className="preview-placeholder-text">
                                  {formatTime(card.start)} - {formatTime(card.end)}
                                </div>
                              </div>
                            </div>
                          )}
                          {manageLoadingState.get(card.id)?.webviewLoading && webviewManageIds.has(card.id) && (
                            <div className="preview-overlay">
                              <div className="loading-indicator">
                                <div className="spinner"></div>
                                <div className="loading-text">
                                  预览加载中...
                                  <span className="loading-time" key={loadTick}>
                                    {(getLoadingTime(card.id, 'webview') / 1000).toFixed(1)}s
                                  </span>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                        {manageLoadingState.get(card.id)?.webviewLoadTime && (
                          <div className="loading-debug" key={loadTick}>
                            <div>预览: {manageLoadingState.get(card.id).webviewLoadTime.toFixed(0)}ms</div>
                          </div>
                        )}
                      </div>
                      <div className="manage-card-footer">
                        <div className="manage-range">
                          {formatTime(card.start)}-{formatTime(card.end)}
                        </div>
                        <div className="manage-row-actions">
                          <button
                            type="button"
                            className="ghost"
                            onClick={() => handleOpenCardDetail(card)}
                          >
                            详情
                          </button>
                          <button
                            type="button"
                            className="ghost"
                            onClick={() => handleToggleCardVisibility(card)}
                          >
                            {card.visibility === "public" ? "转私有" : "转公开"}
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="tag-empty">暂无卡片。</div>
                )}
              </div>
            </div>
          </div>
        </section>
      }
    />
    <Route
      path="/community"
      element={
        <section className="panel panel-community">
          <div className="builder-flow">
            <div className="builder-stage">
              <div className="builder-stage-title">
                <span className="builder-step">01</span>
                <span>社区搜索</span>
              </div>
              <div className="builder-grid builder-grid--tags">
                <div className="builder-card">
                  <div className="builder-label">发现卡片</div>
                  {!communitySession ? (
                    <div className="manage-alert">
                      登录后可使用社区卡片。
                      <button type="button" className="ghost" onClick={openCommunityLogin}>
                        登录
                      </button>
                    </div>
                  ) : null}
                  <div className="community-search">
                    <input
                      className="community-input"
                      value={communitySearchQuery}
                      onChange={(event) => setCommunitySearchQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          refreshCommunitySearch();
                        }
                      }}
                    placeholder="搜索社区卡片"
                    />
                    <select
                      className="community-select"
                      value={communitySearchSort}
                      onChange={(event) => setCommunitySearchSort(event.target.value)}
                    >
                      <option value="latest">最新</option>
                      <option value="oldest">最旧</option>
                    </select>
                    <button type="button" className="ghost" onClick={refreshCommunitySearch}>
                      搜索
                    </button>
                  </div>
                  <div className="community-list">
                    {communityCardResults.length ? (
                      communityCardResults.map((card) => (
                        <div key={card.id} className="community-card" data-card-id={card.id}>
                          <div className="manage-card-head">
                            <div className="manage-card-info">
                              <div
                                className="manage-card-title"
                                onMouseEnter={(e) => {
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  setTooltip({
                                    visible: true,
                                    text: card.title || "未命名卡片",
                                    x: rect.left,
                                    y: rect.bottom + 8
                                  });
                                }}
                                onMouseLeave={() => {
                                  setTooltip(prev => ({ ...prev, visible: false }));
                                }}
                              >
                                {card.title || "未命名卡片"}
                              </div>
                            </div>
                          </div>
                          <div
                            className="manage-card-preview"
                            onMouseEnter={() => {
                              setHoveredCommunityId(card.id);
                              setHoveredCommunityBvid(card.bvid);
                              // webview已经预加载,不需要再创建
                            }}
                            onMouseLeave={() => {
                              setHoveredCommunityId((prev) => (prev === card.id ? "" : prev));
                              // 不再销毁webview,保持预加载状态
                            }}
                          >
                            <div className="preview-container">
                              {webviewCommunityIds.has(card.id) ? (
                                <>
                                  <webview
                                    id={`community-preview-${card.bvid}`}
                                    data-card-id={card.id}
                                    data-bvid={card.bvid}
                                    data-start={card.start}
                                    data-end={card.end}
                                    src={buildCardPreviewUrl({
                                      bvid: card.bvid,
                                      start: card.start,
                                      end: card.end
                                    })}
                                    className="card-preview-webview"
                                    allowpopups="true"
                                    httpreferrer="https://www.bilibili.com"
                                    useragent={bilibiliUserAgent}
                                    partition="temp:bili"
                                    preload={window.env?.bilibiliPagePreload}
                                    style={{
                                      opacity: 1,
                                      width: '100%',
                                      height: '100%'
                                    }}
                                  />
                                  {/* 底部渐变遮罩 - 防止误点击 */}
                                  <div
                                    className="preview-bottom-shield"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      e.preventDefault();
                                    }}
                                    onMouseDown={(e) => {
                                      e.stopPropagation();
                                      e.preventDefault();
                                    }}
                                  />
                                  {/* 进度条 */}
                                  <div
                                    className="preview-progress-bar"
                                    onMouseDown={(e) => {
                                      e.stopPropagation();
                                      setIsDraggingProgress(true); // 开始拖动
                                      const progressBar = e.currentTarget;

                                      const updateTime = (clientX) => {
                                        const rect = progressBar.getBoundingClientRect();
                                        const percent = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
                                        const newTime = card.start + (card.end - card.start) * percent;
                                        const webview = document.getElementById(`community-preview-${card.bvid}`);
                                        if (webview) {
                                          webview.executeJavaScript(`
                                            (function() {
                                              const video = document.querySelector('video');
                                              if (video) {
                                                video.currentTime = ${newTime};
                                              }
                                            })();
                                          `).catch(() => {});
                                        }
                                        setPreviewCurrentTime(prev => new Map(prev).set(card.id, newTime));
                                      };

                                      const handleMouseMove = (moveEvent) => {
                                        updateTime(moveEvent.clientX);
                                      };

                                      const handleMouseUp = () => {
                                        setIsDraggingProgress(false); // 结束拖动
                                        document.removeEventListener('mousemove', handleMouseMove);
                                        document.removeEventListener('mouseup', handleMouseUp);
                                      };

                                      // 初始点击
                                      updateTime(e.clientX);

                                      document.addEventListener('mousemove', handleMouseMove);
                                      document.addEventListener('mouseup', handleMouseUp);
                                    }}
                                  >
                                    <div
                                      className="preview-progress-track"
                                      style={{
                                        width: `${Math.max(0, Math.min(100, ((previewCurrentTime.get(card.id) || card.start) - card.start) / (card.end - card.start) * 100))}%`
                                      }}
                                    />
                                    <div
                                      className="preview-progress-handle"
                                      style={{
                                        left: `${Math.max(0, Math.min(100, ((previewCurrentTime.get(card.id) || card.start) - card.start) / (card.end - card.start) * 100))}%`
                                      }}
                                    />
                                  </div>
                                  {/* 时间标记 - 显示区间内的相对时间 */}
                                  <div className="preview-range-markers">
                                    <div className="preview-range-marker">
                                      {formatTime(Math.floor((previewCurrentTime.get(card.id) || card.start) - card.start))}
                                    </div>
                                    <div className="preview-range-marker">
                                      总时长: {formatTime(card.end - card.start)}
                                    </div>
                                  </div>
                                </>
                              ) : (
                                <div className="preview-placeholder">
                                  <div className="preview-placeholder-content">
                                    <div className="preview-placeholder-icon">▶</div>
                                    <div className="preview-placeholder-text">
                                      {formatTime(card.start)} - {formatTime(card.end)}
                                    </div>
                                  </div>
                                </div>
                              )}
                              {communityLoadingState.get(card.id)?.webviewLoading && webviewCommunityIds.has(card.id) && (
                                <div className="preview-overlay">
                                  <div className="loading-indicator">
                                    <div className="spinner"></div>
                                    <div className="loading-text">
                                      预览加载中...
                                      <span className="loading-time" key={loadTick}>
                                        {(getCommunityLoadingTime(card.id, 'webview') / 1000).toFixed(1)}s
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                            {communityLoadingState.get(card.id)?.webviewLoadTime && (
                              <div className="loading-debug" key={loadTick}>
                                <div>预览: {communityLoadingState.get(card.id).webviewLoadTime.toFixed(0)}ms</div>
                              </div>
                            )}
                          </div>
                          <div className="manage-card-footer">
                            <div className="manage-range">
                              {formatTime(card.start)}-{formatTime(card.end)}
                            </div>
                            <div className="manage-row-actions">
                              <button
                                type="button"
                                className="ghost"
                                onClick={() => handleOpenCardDetail(card)}
                              >
                                详情
                              </button>
                            </div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="tag-empty">暂无结果。</div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      }
    />
  </Routes>
      </main>
      {detailCard && (
        <div className="modal-backdrop" role="presentation" onClick={handleCloseDetail}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">卡片详情</div>
              <button className="modal-close" onClick={handleCloseDetail}>×</button>
            </div>
            <div className="modal-body">
              <div className="detail-content">
                <div className="detail-preview-wrapper">
                  <div className="detail-label">预览</div>
                  <div className="detail-preview">
                    <div className="preview-body" style={{ width: '100%', height: '100%' }}>
                      <webview
                        key={`detail-${detailCard.id}-${detailWebviewKeyRef.current}`}
                        id={`detail-preview-${detailCard.bvid}`}
                        data-detail-webview="true"
                        src={`https://www.bilibili.com/video/${detailCard.bvid}`}
                        className="player-webview embed-player"
                        allowpopups="true"
                        httpreferrer="https://www.bilibili.com"
                        useragent={bilibiliUserAgent}
                        partition="persist:bili"
                        preload={window.env?.bilibiliPagePreload}
                      />
                      {detailWebviewLoading && (
                        <div className="preview-overlay">
                          <div className="loading-indicator">
                            <div className="spinner"></div>
                            <div className="loading-text">
                              预览加载中...
                              <span className="loading-time" key={loadTick}>
                                {((Date.now() - (detailWebviewLoadStartTime || Date.now())) / 1000).toFixed(1)}s
                              </span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <div className="detail-info">
                  <div className="detail-section">
                    <div className="detail-label">标题</div>
                    <div className="detail-value">{detailCard.title || "未命名"}</div>
                  </div>
                  <div className="detail-section">
                    <div className="detail-label">BV号</div>
                    <div className="detail-value">{detailCard.bvid || "-"}</div>
                  </div>
                  <div className="detail-section">
                    <div className="detail-label">时间区间</div>
                    <div className="detail-value">
                      {formatTime(detailCard.start)} - {formatTime(detailCard.end)}
                    </div>
                  </div>
                  {detailCard.tags && detailCard.tags.length > 0 && (
                    <div className="detail-section">
                      <div className="detail-label">标签</div>
                      <div className="detail-value">
                        {normalizeCardTags(detailCard.tags).join(" / ")}
                      </div>
                    </div>
                  )}
                  {detailCard.notes && (
                    <div className="detail-section">
                      <div className="detail-label">备注</div>
                      <div className="detail-value">{detailCard.notes}</div>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="primary" onClick={handleCloseDetail}>关闭</button>
            </div>
          </div>
        </div>
      )}
      {showCommunityAuth ? (
        <div className="modal-backdrop" role="presentation">
          <div className="modal">
            <div className="modal-header">
              <div className="modal-title">
                {communityAuthMode === "register" ? "注册社区账号" : "社区账号登录"}
              </div>
              <button
                type="button"
                className="modal-close"
                onClick={() => setShowCommunityAuth(false)}
              >
                ×
              </button>
            </div>
            <div className="modal-body">
              <div className="field">
                <label>账号</label>
                <input
                  value={communityLogin.username}
                  onChange={(event) =>
                    setCommunityLogin((prev) => ({
                      ...prev,
                      username: event.target.value
                    }))
                  }
                  placeholder="社区账号"
                />
              </div>
              <div className="field">
                <label>密码</label>
                <input
                  type="password"
                  value={communityLogin.password}
                  onChange={(event) =>
                    setCommunityLogin((prev) => ({
                      ...prev,
                      password: event.target.value
                    }))
                  }
                  placeholder={communityAuthMode === "register" ? "至少 4 位" : "密码"}
                />
              </div>
              {communityStatus.error ? (
                <div className="community-error">{communityStatus.error}</div>
              ) : null}
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="ghost"
                onClick={() =>
                  setCommunityAuthMode((prev) => (prev === "login" ? "register" : "login"))
                }
              >
                {communityAuthMode === "register" ? "去登录" : "去注册"}
              </button>
              <button
                type="button"
                className="primary"
                onClick={
                  communityAuthMode === "register"
                    ? handleCommunityRegister
                    : handleCommunityLogin
                }
                disabled={communityStatus.loading}
              >
                {communityAuthMode === "register" ? "注册" : "登录"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {tooltip.visible && (
        <div
          style={{
            position: 'fixed',
            left: `${tooltip.x}px`,
            top: `${tooltip.y}px`,
            padding: '8px 12px',
            background: 'rgba(15, 23, 42, 0.95)',
            color: 'white',
            fontSize: '13px',
            fontWeight: '500',
            borderRadius: '8px',
            maxWidth: '300px',
            zIndex: 10000,
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
            pointerEvents: 'none',
            lineHeight: '1.4',
            wordWrap: 'break-word'
          }}
        >
          {tooltip.text}
        </div>
      )}
    </div>
  );
}
