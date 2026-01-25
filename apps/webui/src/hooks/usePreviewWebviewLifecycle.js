import { useEffect } from "react";

const DEFAULT_PATCH_DELAYS = [100, 500, 1000];

export default function usePreviewWebviewLifecycle({
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
}) {
  useEffect(() => {
    if (!previewUrl) return;
    console.log("[Preview Webview] previewUrl:", previewUrl);
    setIsLoadingPreview(true);
    const timer = setTimeout(() => {
      setIsLoadingPreview(false);
      const view = webviewRef.current;

      if (view) {
        patchWebviewIframeHeight(view);
      }
    }, 50);

    return () => clearTimeout(timer);
  }, [previewUrl, patchWebviewIframeHeight, setIsLoadingPreview, webviewRef]);

  useEffect(() => {
    if (!previewUrl || !activeId) return;
    const view = webviewRef.current;
    if (!view) return;

    const timers = DEFAULT_PATCH_DELAYS.map((delay) =>
      setTimeout(() => patchWebviewIframeHeight(view), delay)
    );

    return () => timers.forEach((timer) => clearTimeout(timer));
  }, [activeId, previewUrl, patchWebviewIframeHeight, webviewRef]);

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
          `          (() => {            const wrap =              document.querySelector(".bpx-player-progress-wrap") ||              document.querySelector(".bpx-player-progress") ||              document.querySelector("#bilibili-player .bpx-player-progress-wrap");            if (!wrap) return null;            const s = Number(wrap.dataset.clipStart);            const e = Number(wrap.dataset.clipEnd);            if (!Number.isFinite(s) || !Number.isFinite(e)) return null;            return { s, e };          })();        `,
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
  }, [
    previewUrl,
    rangeStart,
    rangeEnd,
    updateRangeState,
    useEmbedHijack,
    rangePollRef,
    lastRangeUpdateRef,
    webviewRef
  ]);

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

      // 处理来自 webview preload 脚本的日志
      if (event.channel === "bilibili:log") {
        const data = event.args?.[0] || {};
        const { message, args } = data;
        console.log('[B站预览日志]', message, ...(args || []));
        return;
      }

      // 处理时间戳高亮状态
      if (event.channel === "bilibili:timeHighlight") {
        const data = event.args?.[0] || {};
        const { highlight } = data;
        if (setTimeHighlight) {
          setTimeHighlight(!!highlight);
        }
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
          // no-op: keep for future debug if needed
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
    useEmbedHijack,
    updateRangeState,
    setTagList,
    setTagInput,
    setForm,
    setCurrentTime,
    setDuration,
    setIsPlaying,
    setIsBuffering,
    setIsLoadingPreview,
    webviewReadyRef,
    pendingCommandsRef,
    webviewRef
  ]);
}
