const { ipcRenderer } = require("electron");

const KEEP_SELECTOR =
  "#bilibili-player > div > div > div.bpx-player-primary-area > div.bpx-player-video-area";
const ENABLE_ISOLATION = true;
let isolationApplied = false;

function applyOnlyVideoArea() {
  const TARGET_SEL = KEEP_SELECTOR;
  const videoArea = document.querySelector(TARGET_SEL);
  const root = document.querySelector("#bilibili-player");
  if (!videoArea || !root) return false;

  document.documentElement.style.overflow = "hidden";
  document.body.style.margin = "0";
  document.body.style.padding = "0";
  document.body.style.background = "#000";

  root.style.position = "fixed";
  root.style.inset = "0";
  root.style.width = "100vw";
  root.style.height = "100vh";
  root.style.zIndex = "9999";
  root.style.background = "#000";

  videoArea.style.position = "absolute";
  videoArea.style.inset = "0";
  videoArea.style.width = "100%";
  videoArea.style.height = "100%";

  Array.from(document.body.children).forEach((el) => {
    if (el !== root) {
      el.dataset.__onlyVideoMoved = "1";
      el.style.position = "fixed";
      el.style.left = "-99999px";
      el.style.top = "0";
    }
  });

  const isInVideoBranch = (el) =>
    el === videoArea || videoArea.contains(el) || el.contains(videoArea);

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  const toMove = [];
  while (walker.nextNode()) {
    const el = walker.currentNode;
    if (el === root) continue;
    if (!isInVideoBranch(el)) toMove.push(el);
  }

  toMove.forEach((el) => {
    el.dataset.__onlyVideoMoved = "1";
    el.style.position = "fixed";
    el.style.left = "-99999px";
    el.style.top = "0";
  });

  window.__onlyVideoAreaOff = () => {
    document.documentElement.style.overflow = "";
    document.body.style.margin = "";
    document.body.style.padding = "";
    document.body.style.background = "";

    root.removeAttribute("style");
    videoArea.removeAttribute("style");

    document
      .querySelectorAll("[data-__only-video-moved], [data-__onlyVideoMoved]")
      .forEach((el) => {
        el.removeAttribute("data-__onlyVideoMoved");
        el.removeAttribute("data-__only-video-moved");
        el.style.position = "";
        el.style.left = "";
        el.style.top = "";
      });
  };
  return true;
}

function suppressEndingPrompts() {
  if (document.querySelector("#__bpx_prompt_style")) return;
  const style = document.createElement("style");
  style.id = "__bpx_prompt_style";
  style.textContent = `
    .bpx-player-ending,
    .bpx-player-ending-panel,
    .bpx-player-ending-layer,
    .bpx-player-ending-dialog,
    .bpx-player-ending-popup,
    .bpx-player-ending-wrapper,
    .bpx-player-ending-close,
    .bpx-player-ending-recommend,
    .bpx-player-ending-up-next,
    .bpx-player-ending-bubble,
    .bpx-player-ending-tips,
    .bpx-player-ending-screen,
    .bpx-player-ending-overlay,
    .bpx-player-ending-mask,
    .bpx-player-ending-tip,
    .bpx-player-ending-card,
    .bpx-player-ending-ad,
    .bpx-player-toast-wrap,
    .bpx-player-state-ending,
    .bpx-player-endscreen,
    .bpx-player-up-next,
    .bpx-player-ending-main,
    .bpx-player-ending-secondary {
      display: none !important;
      opacity: 0 !important;
      visibility: hidden !important;
      pointer-events: none !important;
    }
  `;
  document.head.appendChild(style);
}

function mountPlayer() {
  if (!ENABLE_ISOLATION || isolationApplied) return;
  isolationApplied = applyOnlyVideoArea();
}

let videoEl = null;
let buffering = false;
let clipApi = null;
const pendingCommands = [];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pad2 = (n) => String(n).padStart(2, "0");
const fmt = (sec) => {
  sec = Math.max(0, sec);
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${pad2(m)}:${pad2(s)}`;
};

function sendState() {
  if (!videoEl) return;
  ipcRenderer.sendToHost("player:state", {
    currentTime: Number.isFinite(videoEl.currentTime) ? videoEl.currentTime : 0,
    duration: Number.isFinite(videoEl.duration) ? videoEl.duration : 0,
    paused: !!videoEl.paused,
    buffering
  });
}

function emitRangeUpdate() {
  if (!clipApi) return;
  const r = clipApi.getRange();
  if (!r) return;
  ipcRenderer.sendToHost("player:range", { start: r.s, end: r.e });
}

let lastTagSignature = "";
let lastTagUrl = "";
let tagProbeTimer = null;
const tagContainerSelector =
  "#mirror-vdcon > div.left-container.scroll-sticky > div.video-tag-container > div";

function collectVideoTags() {
  const currentUrl = location.href;
  if (currentUrl !== lastTagUrl) {
    lastTagUrl = currentUrl;
    lastTagSignature = "";
  }
  const container = document.querySelector(tagContainerSelector);
  if (!container) return;
  const tags = Array.from(container.querySelectorAll(".tag-link"))
    .map((tag) => tag.innerText.trim())
    .filter(Boolean);
  if (!tags.length) return;
  const signature = tags.join("|");
  if (signature === lastTagSignature) return;
  lastTagSignature = signature;
  ipcRenderer.sendToHost("player:tags", { tags });
}

function scheduleTagProbe(delay = 120) {
  if (tagProbeTimer) return;
  tagProbeTimer = setTimeout(() => {
    tagProbeTimer = null;
    collectVideoTags();
  }, delay);
}

function hookVideo(el) {
  if (!el || videoEl === el) return;
  videoEl = el;
  videoEl.addEventListener("timeupdate", sendState);
  videoEl.addEventListener("loadedmetadata", sendState);
  videoEl.addEventListener("durationchange", sendState);
  videoEl.addEventListener("play", sendState);
  videoEl.addEventListener("pause", sendState);
  videoEl.addEventListener("waiting", () => {
    buffering = true;
    sendState();
  });
  videoEl.addEventListener("playing", () => {
    buffering = false;
    sendState();
  });
  sendState();
  if (!clipApi) initClipRange();
  if (pendingCommands.length) {
    pendingCommands.splice(0).forEach((payload) => applyCommand(payload));
  }
}

function ensureVideo() {
  const el = document.querySelector("video");
  if (el) hookVideo(el);
}

function initClipRange() {
  if (clipApi || !videoEl) return;
  const $ = (sel, root = document) => root.querySelector(sel);
  const progressWrap =
    $(".bpx-player-progress-wrap") ||
    $(".bpx-player-progress") ||
    $("#bilibili-player .bpx-player-progress-wrap");
  if (!progressWrap) return;
  const baseCandidate = progressWrap.querySelector(".bpx-player-progress");
  const candidateWidth = baseCandidate
    ? baseCandidate.getBoundingClientRect().width
    : 0;
  const baseEl =
    baseCandidate && candidateWidth > 0 ? baseCandidate : progressWrap;

  if (!document.querySelector("#__clip_style")) {
    const style = document.createElement("style");
    style.id = "__clip_style";
    style.textContent = `
      .__clip_handle {
        --clip-base-w: 14px;
        --clip-base-h: 22px;
        width: calc(var(--clip-base-w) * var(--clip-damp-width, 1));
        height: calc(var(--clip-base-h) * var(--clip-damp-scale, 1));
        border-radius: calc(
          7px * var(--clip-damp-scale, 1)
        );
        background: linear-gradient(180deg, #e9f7ff 0%, #bfe9ff 100%);
        border: 2px solid #29b6ff;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3),
          inset 0 1px 0 rgba(255, 255, 255, 0.6);
        transform: translateX(-50%) scaleX(var(--clip-scale, 1)) translateZ(0);
        backface-visibility: hidden;
        will-change: transform;
        cursor: grab;
        transition: width 120ms ease, height 120ms ease, box-shadow 120ms ease;
      }
      .__clip_handle:hover {
        transform: translateX(-50%) scaleX(var(--clip-scale, 1)) translateZ(0);
        box-shadow: 0 6px 16px rgba(0, 0, 0, 0.4);
      }
      .__clip_handle.__clip_dragging {
        cursor: grabbing;
      }
      .__clip_tip {
        transform: translateX(-50%);
        transform-origin: center;
      }
      .__clip_zoom_band {
        position: absolute;
        top: -12px;
        height: 6px;
        left: 0;
        width: 0;
        border-radius: 999px;
        background: linear-gradient(
          90deg,
          rgba(41, 182, 255, 0.18),
          rgba(41, 182, 255, 0.08)
        );
        border: 1px dashed rgba(41, 182, 255, 0.5);
        box-shadow: 0 0 0 1px rgba(41, 182, 255, 0.08);
        opacity: 0;
        transition: opacity 120ms ease;
      }
      .__clip_zoom_badge {
        position: absolute;
        top: -32px;
        left: 50%;
        transform: translateX(-50%);
        transform-origin: center;
        padding: 2px 6px;
        border-radius: 999px;
        font-size: 11px;
        font-weight: 600;
        letter-spacing: 0.3px;
        color: #0d1b2a;
        background: rgba(191, 233, 255, 0.95);
        border: 1px solid rgba(41, 182, 255, 0.6);
        box-shadow: 0 6px 12px rgba(0, 0, 0, 0.18);
        opacity: 0;
        transition: opacity 120ms ease;
        pointer-events: none;
        white-space: nowrap;
      }
      .__clip_root.__clip_zoomed .__clip_zoom_band,
      .__clip_zoom_overlay.__clip_zoomed .__clip_zoom_badge,
      .__clip_root.__clip_zoomed .__clip_zoom_band {
        opacity: 1;
      }
      .__clip_disable_hover .bpx-player-progress-hover,
      .__clip_disable_hover .bpx-player-progress-preview,
      .__clip_disable_hover .bpx-player-progress-preview-image,
      .__clip_disable_hover .bpx-player-progress-preview-picture,
      .__clip_disable_hover .bpx-player-progress-pop,
      .__clip_disable_hover .bpx-player-progress-tooltip {
        display: none !important;
      }
    `;
    document.head.appendChild(style);
  }

  const cs = getComputedStyle(progressWrap);
  if (cs.position === "static") progressWrap.style.position = "relative";       
  const baseCs = getComputedStyle(baseEl);
  if (baseCs.position === "static") baseEl.style.position = "relative";
  progressWrap.style.setProperty("transform-origin", "left center", "important");

  const OLD = $(".__clip_root", progressWrap);
  if (OLD) OLD.remove();

  const dur = () => (Number.isFinite(videoEl.duration) ? videoEl.duration : 0);
  let zoomScale = 1;
  const zoomEase = 0.18;
  const zoomAssistRatio = 0;
  const zoomAssistSeconds = 1;
  const minSpanMaxSeconds = 1;
  const minSpanPx = 2;
  const zoomTargetSpanPx = 40;
  const zoomMaxScale = 18;
  let zoomRaf = null;
  let zoomPending = false;
  let zoomTranslateX = 0;
  let baselineLeft = null;
  let baselineWidth = null;
  let root = null;

  const getBaseRect = () => baseEl.getBoundingClientRect();
  const getBaseWidth = () => {
    const width = baseEl.offsetWidth;
    if (Number.isFinite(width) && width > 0) return width;
    const rect = getBaseRect();
    return rect.width || 0;
  };

  const captureBaseline = () => {
    const rect = getBaseRect();
    if (!rect.width) return;
    if (zoomScale !== 1) {
      if (baselineLeft == null || baselineWidth == null) {
        baselineLeft = rect.left - zoomTranslateX;
        baselineWidth = rect.width / zoomScale;
      }
      return;
    }
    baselineLeft = rect.left;
    baselineWidth = rect.width;
  };

  const getMinSpan = (d, baseWidth) => {
    const baseMin = Math.min(
      d,
      minSpanMaxSeconds,
      Math.max(0.05, d * zoomAssistRatio, zoomAssistSeconds)
    );
    const width = baseWidth || getBaseWidth();
    if (!width || !Number.isFinite(zoomScale) || zoomScale <= 0) return baseMin;
    const minPxTime = (minSpanPx / (width * Math.max(zoomScale, 1))) * d;
    return Math.min(d, Math.max(baseMin, minPxTime));
  };

  const screenXToBaseX = (clientX, r) => {
    const baseWidth = getBaseWidth();
    if (!baseWidth) return 0;
    captureBaseline();
    if (!baselineWidth) return 0;
    const rectLeft = baselineLeft + zoomTranslateX;
    const scaledWidth =
      baselineWidth * (zoomScale > 1.001 ? zoomScale : 1);
    const xScaled = clamp(clientX - rectLeft, 0, scaledWidth);
    if (zoomScale > 1.001) {
      return clamp(xScaled / zoomScale, 0, baseWidth);
    }
    return (xScaled / baselineWidth) * baseWidth;
  };

  const baseXToScreenX = (xBase, r) => {
    const baseWidth = getBaseWidth();
    captureBaseline();
    if (!baseWidth || !baselineWidth) return baselineLeft || 0;
    if (zoomScale > 1.001) {
      return baselineLeft + zoomTranslateX + xBase * zoomScale;
    }
    return baselineLeft + (xBase / baseWidth) * baselineWidth;
  };

  const baseXToScreenXScaled = (xBase) => {
    const baseWidth = getBaseWidth();
    const rect = getBaseRect();
    if (!baseWidth || !rect.width) return rect.left || 0;
    return rect.left + (xBase / baseWidth) * rect.width;
  };

  let zoomBadge = null;
  let zoomOverlay = null;

  const getAnchorTime = (r) => (r.s + r.e) / 2;

  const setZoomScale = (scale, r, immediate = false) => {
    const nextScale = immediate
      ? scale
      : zoomScale + (scale - zoomScale) * zoomEase;
    const baseWidth = getBaseWidth();
    const anchorTime = getAnchorTime(r);
    const anchorRatio = anchorTime / r.d;
    const anchorX = anchorRatio * baseWidth;
    captureBaseline();
    const left = baselineLeft ?? getBaseRect().left;
    zoomScale = nextScale;
    baseEl.style.setProperty("transform-origin", "left center", "important");
    baseEl.style.willChange = "transform";
    if (zoomScale === 1) {
      baseEl.style.removeProperty("transform");
      zoomTranslateX = 0;
      captureBaseline();
    } else {
      const anchorScreen =
        (baselineLeft ?? left) +
        (baselineWidth
          ? (anchorX / baseWidth) * baselineWidth
          : anchorX);
      const translateX = anchorScreen - (baselineLeft ?? left) - anchorX * zoomScale;
      zoomTranslateX = translateX;
      baseEl.style.setProperty(
        "transform",
        `translateX(${zoomTranslateX}px) scaleX(${zoomScale})`,
        "important"
      );
    }
    root?.style?.removeProperty?.("transform");
    const zoomActive = zoomScale > 1.02;
    root.classList.toggle("__clip_zoomed", zoomActive);
    zoomOverlay?.classList?.toggle("__clip_zoomed", zoomActive);
    progressWrap.classList.toggle("__clip_disable_hover", zoomActive);
    baseEl.classList.toggle("__clip_disable_hover", zoomActive);
    if (zoomActive && zoomBadge) {
      zoomBadge.textContent = `Zoom x${zoomScale.toFixed(1)}`;
    }
    const inverse = zoomScale ? 1 / zoomScale : 1;
    hStart?.style?.setProperty?.("--clip-scale", inverse);
    hEnd?.style?.setProperty?.("--clip-scale", inverse);
  };

  const applyZoom = () => {
    const r = readRange();
    if (!r) return;
    const span = Math.max(0.05, r.e - r.s);
    if (!Number.isFinite(r.d) || r.d <= 0) return;
    const baseWidth = getBaseWidth();
    if (!baseWidth) return;
    if (dragging) {
      zoomPending = true;
      return;
    }
    const spanBasePx = Math.max(0.001, (span / r.d) * baseWidth);
    const targetScale = Math.max(
      1,
      Math.min(zoomMaxScale, zoomTargetSpanPx / spanBasePx)
    );
    setZoomScale(targetScale, r, true);
  };

  function readRange() {
    const d = dur();
    if (!d) return null;
    let s = parseFloat(progressWrap.dataset.clipStart);
    let e = parseFloat(progressWrap.dataset.clipEnd);
    if (!Number.isFinite(s)) s = 0;
    if (!Number.isFinite(e)) e = d;
    s = clamp(s, 0, d);
    e = clamp(e, 0, d);
    if (e < s) {
      const tmp = s;
      s = e;
      e = tmp;
    }
    return { s, e, d };
  }

  function getRange() {
    const r = readRange();
    if (!r) return null;
    const MIN = getMinSpan(r.d);
    let s = r.s;
    let e = r.e;
    s = clamp(s, 0, r.d);
    e = clamp(e, s + MIN, r.d);
    progressWrap.dataset.clipStart = String(s);
    progressWrap.dataset.clipEnd = String(e);
    return { s, e, d: r.d };
  }

  function setRange(s, e) {
    const d = dur();
    if (!d) return;
    const MIN = getMinSpan(d);
    s = clamp(s, 0, d);
    e = clamp(e, s + MIN, d);
    progressWrap.dataset.clipStart = String(s);
    progressWrap.dataset.clipEnd = String(e);
    render();
    emitRangeUpdate();
  }

  function timeToX(t) {
    const r = getRange();
    if (!r) return 0;
    const baseWidth = getBaseWidth();
    if (!baseWidth) return 0;
    return (t / r.d) * baseWidth;
  }

  function xToTime(clientX) {
    const r = getRange();
    if (!r) return 0;
    const baseWidth = getBaseWidth();
    if (!baseWidth) return 0;
    const xBase = screenXToBaseX(clientX, r);
    return (xBase / baseWidth) * r.d;
  }

  function pokeBpxPreview(clientX, clientY) {
    const evt = new MouseEvent("mousemove", {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY,
      view: window
    });
    (baseEl || progressWrap).dispatchEvent(evt);
  }

  function readBpxPreviewImage() {
    const img =
      $(".bpx-player-progress-preview-image") ||
      $(".bpx-player-progress-preview img") ||
      $(".bpx-player-progress-preview-picture img");
    if (!img) return null;
    const style = getComputedStyle(img);
    const bgImage =
      style.backgroundImage && style.backgroundImage !== "none"
        ? style.backgroundImage
        : null;
    const src = img.getAttribute("src") || null;
    if (src && src.startsWith("data:image")) return { type: "src", value: src };
    if (bgImage) {
      const m = bgImage.match(/url\(["']?(.*?)["']?\)/);
      if (m && m[1]) return { type: "bg", value: m[1] };
    }
    return null;
  }

  root = document.createElement("div");
  root.className = "__clip_root";
  Object.assign(root.style, {
    position: "absolute",
    left: "0",
    top: "0",
    right: "0",
    bottom: "0",
    pointerEvents: "none",
    zIndex: "999999"
  });

  const rangeBar = document.createElement("div");
  rangeBar.className = "__clip_range";
  Object.assign(rangeBar.style, {
    position: "absolute",
    top: "0",
    bottom: "0",
    left: "0",
    width: "0",
    background: "rgba(0,0,0,0.25)",
    borderRadius: "999px",
    pointerEvents: "none"
  });

  const mkHandle = (kind) => {
    const h = document.createElement("div");
    h.className = `__clip_handle __clip_${kind}`;
    Object.assign(h.style, {
      position: "absolute",
      top: "-10px",
      pointerEvents: "auto",
      cursor: "grab"
    });
    return h;
  };

  const hStart = mkHandle("start");
  const hEnd = mkHandle("end");

  const zoomBand = document.createElement("div");
  zoomBand.className = "__clip_zoom_band";

  zoomOverlay = document.createElement("div");
  zoomOverlay.className = "__clip_zoom_overlay";
  Object.assign(zoomOverlay.style, {
    position: "absolute",
    left: "0",
    top: "0",
    right: "0",
    bottom: "0",
    pointerEvents: "none",
    zIndex: "1000002"
  });

  zoomBadge = document.createElement("div");
  zoomBadge.className = "__clip_zoom_badge";
  zoomBadge.textContent = "Zoom x1.0";

  const tooltip = document.createElement("div");
  tooltip.className = "__clip_tip";
  Object.assign(tooltip.style, {
    position: "absolute",
    bottom: "26px",
    transform: "translateX(-50%)",
    pointerEvents: "none",
    display: "none",
    background: "rgba(0,0,0,0.78)",
    color: "#fff",
    borderRadius: "8px",
    padding: "6px",
    boxShadow: "0 6px 18px rgba(0,0,0,0.35)",
    fontSize: "12px",
    lineHeight: "1.1",
    whiteSpace: "nowrap"
  });

  const tipImg = document.createElement("img");
  Object.assign(tipImg.style, {
    display: "block",
    width: "160px",
    height: "90px",
    objectFit: "cover",
    borderRadius: "6px",
    background: "rgba(255,255,255,0.12)"
  });

  const tipTime = document.createElement("div");
  Object.assign(tipTime.style, {
    marginTop: "6px",
    textAlign: "center",
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    fontWeight: "600"
  });

  tooltip.appendChild(tipImg);
  tooltip.appendChild(tipTime);

  root.appendChild(zoomBand);
  root.appendChild(rangeBar);
  root.appendChild(hStart);
  root.appendChild(hEnd);
  baseEl.appendChild(root);
  zoomOverlay.appendChild(zoomBadge);
  zoomOverlay.appendChild(tooltip);
  progressWrap.appendChild(zoomOverlay);

  function render() {
    const r = readRange();
    if (!r) return;
    const baseWidth = getBaseWidth();
    if (!baseWidth) return;
    applyZoom();
    const xS = (r.s / r.d) * baseWidth;
    const xE = (r.e / r.d) * baseWidth;
    hStart.style.left = `${xS}px`;
    hEnd.style.left = `${xE}px`;
    rangeBar.style.left = `${xS}px`;
    rangeBar.style.width = `${Math.max(0, xE - xS)}px`;
    zoomBand.style.left = `${xS}px`;
    zoomBand.style.width = `${Math.max(0, xE - xS)}px`;
    const center = (xS + xE) / 2;
    if (zoomBadge) {
      const badgeWidth = zoomBadge.offsetWidth || 0;
      const half = badgeWidth ? badgeWidth / 2 : 16;
      const minX = half;
      const maxX = Math.max(minX, baseWidth - half);
      const clamped = clamp(center, minX, maxX);
      zoomBadge.style.left = `${clamped}px`;
    }
  }

  let dragging = null;
  let dragPid = null;
  let dragTarget = null;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragTargetX = 0;
  let dragSmoothX = 0;
  let dragDamp = 1;
  let dragRaf = null;
  let clampActive = false;
  let dragGrabOffset = 0;
  let seeking = false;
  let seekPid = null;
  let suppressClamp = false;
  let dragStartRange = null;
  let wasPlayingOnDrag = false;

  const applyDragAtX = (clientX) => {
    const r = getRange();
    if (!r) return;
    const baseWidth = getBaseWidth();
    if (!baseWidth) return;
    const adjustedX = Number.isFinite(dragGrabOffset)
      ? clientX - dragGrabOffset
      : clientX;
    const xBase = screenXToBaseX(adjustedX, r);
    const tRaw = (xBase / baseWidth) * r.d;
    const minSpan = getMinSpan(r.d, baseWidth);
    let t = tRaw;
    clampActive = false;
    if (dragging === "start") {
      const minTime = r.e - minSpan;
      if (tRaw > minTime) {
        t = minTime;
        clampActive = true;
      }
      setRange(t, r.e);
    } else {
      const minTime = r.s + minSpan;
      if (tRaw < minTime) {
        t = minTime;
        clampActive = true;
      }
      setRange(r.s, t);
    }
    showTipAt(clientX, t);
  };

  const tickDrag = () => {
    if (!dragging) return;
    const delta = dragTargetX - dragSmoothX;
    if (Math.abs(delta) < 0.15) {
      dragSmoothX = dragTargetX;
    } else {
      dragSmoothX += delta * dragDamp;
    }
    applyDragAtX(dragSmoothX);
    dragRaf = requestAnimationFrame(tickDrag);
  };

  function showTipAt(clientX, t) {
    const rect = getBaseRect();
    const baseWidth = getBaseWidth();
    if (!baseWidth) return;
    const r = getRange();
    if (!r) return;
    const xBase = clamp((t / r.d) * baseWidth, 0, baseWidth);
    const overlayRect = zoomOverlay?.getBoundingClientRect?.();
    const anchorScreenX = baseXToScreenXScaled(xBase);
    const overlayLeft = overlayRect?.left ?? 0;
    tooltip.style.left = `${anchorScreenX - overlayLeft}px`;
    tooltip.style.display = "block";
    tipTime.textContent = fmt(t);
    const previewX = baseXToScreenXScaled(xBase);
    pokeBpxPreview(previewX, rect.top + rect.height / 2);
    const prev = readBpxPreviewImage();
    if (prev?.type === "src") {
      tipImg.src = prev.value;
      tipImg.style.visibility = "visible";
    } else if (prev?.type === "bg") {
      tipImg.src = prev.value;
      tipImg.style.visibility = "visible";
    }
  }

  function hideTip() {
    tooltip.style.display = "none";
  }

  function onPointerDown(kind, e) {
    if (e.button !== 0) return;
    dragging = kind;
    dragPid = e.pointerId;
    dragTarget = e.currentTarget;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragTargetX = e.clientX;
    dragSmoothX = e.clientX;
    dragDamp = 1;
    dragTarget?.style?.setProperty?.("--clip-damp-scale", "1");
    dragTarget?.style?.setProperty?.("--clip-damp-width", "1");
    dragTarget?.classList?.add("__clip_dragging");
    document.body.style.cursor = "grabbing";
    const targetRect = dragTarget?.getBoundingClientRect?.();
    dragGrabOffset =
      targetRect && Number.isFinite(targetRect.left)
        ? e.clientX - (targetRect.left + targetRect.width / 2)
        : 0;
    const range = getRange();
    dragStartRange = range ? { s: range.s, e: range.e } : null;
    if (zoomRaf) {
      cancelAnimationFrame(zoomRaf);
      zoomRaf = null;
    }
    if (range) setZoomScale(zoomScale, range, true);
    wasPlayingOnDrag = !videoEl.paused;
    suppressClamp = true;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation?.();
    try {
      e.target.setPointerCapture(e.pointerId);
    } catch {}
    applyDragAtX(e.clientX);
    if (!dragRaf) {
      dragRaf = requestAnimationFrame(tickDrag);
    }
  }

  function onPointerMove(e) {
    if (!dragging) return;
    if (dragPid != null && e.pointerId !== dragPid) return;
    dragTargetX = e.clientX;
    const maxLift = 200;
    const lift = clamp(dragStartY - e.clientY, 0, maxLift);
    const ratio = lift / maxLift;
    const eased = 1 - ratio;
    dragDamp = (0.02 + 0.98 * eased * eased) / 3;
    const dampNorm = clamp(dragDamp * 3, 0, 1);
    const compress = clampActive ? 1 : 0.7 + 0.3 * dampNorm;
    const widen = clampActive ? 1 : Math.min(1.25, 1 / compress);
    dragTarget?.style?.setProperty?.("--clip-damp-scale", compress.toFixed(3));
    dragTarget?.style?.setProperty?.("--clip-damp-width", widen.toFixed(3));
    if (!dragRaf) {
      dragRaf = requestAnimationFrame(tickDrag);
    }
  }

  function onPointerUp(e) {
    if (!dragging) return;
    if (dragPid != null && e.pointerId !== dragPid) return;
    applyDragAtX(Number.isFinite(dragTargetX) ? dragTargetX : e.clientX);
    if (dragRaf) {
      cancelAnimationFrame(dragRaf);
      dragRaf = null;
    }
    dragging = null;
    dragPid = null;
    if (dragTarget && dragTarget.releasePointerCapture) {
      try {
        dragTarget.releasePointerCapture(e.pointerId);
      } catch {}
    }
    dragTarget?.classList?.remove("__clip_dragging");
    dragTarget?.style?.setProperty?.("--clip-damp-scale", "1");
    dragTarget?.style?.setProperty?.("--clip-damp-width", "1");
    document.body.style.cursor = "";
    dragTarget = null;
    dragStartX = 0;
    dragStartY = 0;
    dragTargetX = 0;
    dragSmoothX = 0;
    dragDamp = 1;
    dragGrabOffset = 0;
    suppressClamp = false;
    hideTip();
    const r = getRange();
    if (r && dragStartRange && dragStartRange.s !== r.s) {
      videoEl.currentTime = r.s;
      if (wasPlayingOnDrag) videoEl.play().catch(() => {});
    } else {
      clampNow();
    }
    dragStartRange = null;
    if (zoomPending) {
      zoomPending = false;
      applyZoom();
    }
    render();
  }

  hStart.addEventListener("pointerdown", (e) => onPointerDown("start", e), true);
  hEnd.addEventListener("pointerdown", (e) => onPointerDown("end", e), true);
  hStart.addEventListener(
    "click",
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation?.();
    },
    true
  );
  hEnd.addEventListener(
    "click",
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation?.();
    },
    true
  );
  hStart.addEventListener("pointerup", onPointerUp, true);
  hEnd.addEventListener("pointerup", onPointerUp, true);
  hStart.addEventListener("lostpointercapture", onPointerUp, true);
  hEnd.addEventListener("lostpointercapture", onPointerUp, true);
  window.addEventListener("blur", (e) => {
    onPointerUp(e);
    stopSeeking(e);
  }, true);
  window.addEventListener("pointermove", onPointerMove, true);
  window.addEventListener("pointerup", (e) => {
    onPointerUp(e);
    stopSeeking(e);
  }, true);
  window.addEventListener("pointercancel", (e) => {
    onPointerUp(e);
    stopSeeking(e);
  }, true);

  let internalLock = false;

  function clampNow() {
    if (suppressClamp) return;
    if (internalLock) return;
    const r = getRange();
    if (!r) return;
    const t = videoEl.currentTime;
    const EPS = 0.03;
    const endIsVideoEnd = Math.abs(r.e - r.d) < 0.05;
    if (!videoEl.paused && t >= r.e - EPS) {
      internalLock = true;
      videoEl.currentTime = r.s;
      if (!videoEl.paused) videoEl.play().catch(() => {});
      requestAnimationFrame(() => (internalLock = false));
      return;
    }
    if (t < r.s - EPS) {
      internalLock = true;
      videoEl.currentTime = r.s;
      if (!videoEl.paused) videoEl.play().catch(() => {});
      requestAnimationFrame(() => (internalLock = false));
      return;
    }
    if (t > r.e + EPS) {
      internalLock = true;
      videoEl.currentTime = r.s;
      if (!videoEl.paused) videoEl.play().catch(() => {});
      requestAnimationFrame(() => (internalLock = false));
    }
  }

  (function tick() {
    clampNow();
    requestAnimationFrame(tick);
  })();

  videoEl.addEventListener("seeking", () => clampNow(), true);
  videoEl.addEventListener("seeked", () => clampNow(), true);
  videoEl.addEventListener(
    "ended",
    () => {
      if (suppressClamp || internalLock) return;
      const r = getRange();
      if (!r) return;
      internalLock = true;
      videoEl.currentTime = r.s;
      videoEl.play().catch(() => {});
      requestAnimationFrame(() => (internalLock = false));
    },
    true
  );

  progressWrap.addEventListener(
    "pointerdown",
    (e) => {
      if (e.target?.closest?.(".__clip_handle")) return;
    if (dragging) return;
      const r = getRange();
      if (!r) return;
      const targetT = xToTime(e.clientX);
      if (Math.abs(zoomScale - 1) > 0.01) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation?.();
        seeking = true;
        seekPid = e.pointerId;
        if (progressWrap.setPointerCapture) {
          try {
            progressWrap.setPointerCapture(e.pointerId);
          } catch {}
        }
        const nextTime = targetT < r.s || targetT > r.e ? r.s : targetT;
        internalLock = true;
        videoEl.currentTime = clamp(nextTime, 0, r.d);
        if (!videoEl.paused) videoEl.play().catch(() => {});
        requestAnimationFrame(() => (internalLock = false));
        return;
      }
      if (targetT < r.s || targetT > r.e) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation?.();
        internalLock = true;
        videoEl.currentTime = r.s;
        if (!videoEl.paused) videoEl.play().catch(() => {});
        requestAnimationFrame(() => (internalLock = false));
      }
    },
    true
  );

  const stopSeeking = (e) => {
    if (!seeking) return;
    if (seekPid != null && e?.pointerId != null && e.pointerId !== seekPid) {
      return;
    }
    if (progressWrap.releasePointerCapture && seekPid != null) {
      try {
        progressWrap.releasePointerCapture(seekPid);
      } catch {}
    }
    seeking = false;
    seekPid = null;
  };

  progressWrap.addEventListener(
    "pointermove",
    (e) => {
      if (!seeking) return;
      if (seekPid != null && e.pointerId !== seekPid) return;
      const r = getRange();
      if (!r) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation?.();
      const targetT = xToTime(e.clientX);
      const nextTime = targetT < r.s || targetT > r.e ? r.s : targetT;
      internalLock = true;
      videoEl.currentTime = clamp(nextTime, 0, r.d);
      if (!videoEl.paused) videoEl.play().catch(() => {});
      requestAnimationFrame(() => (internalLock = false));
    },
    true
  );

  window.addEventListener(
    "keydown",
    (e) => {
      const keys = [
        "ArrowLeft",
        "ArrowRight",
        "Home",
        "End",
        "j",
        "k",
        "l",
        "J",
        "K",
        "L"
      ];
      if (!keys.includes(e.key)) return;
      requestAnimationFrame(() => clampNow());
    },
    true
  );

  function initRangeWhenReady() {
    const d = dur();
    if (!d) return requestAnimationFrame(initRangeWhenReady);
    if (!progressWrap.dataset.clipStart) progressWrap.dataset.clipStart = "0";
    if (!progressWrap.dataset.clipEnd) progressWrap.dataset.clipEnd = String(d);
    render();
    captureBaseline();
    clampNow();
    emitRangeUpdate();
  }

  initRangeWhenReady();
  new ResizeObserver(() => {
    baselineLeft = null;
    baselineWidth = null;
    render();
  }).observe(progressWrap);

  clipApi = { getRange, setRange, render };
}

function applyCommand(payload = {}) {
  const type = payload.type;
  if (type === "range") {
    if (!clipApi) initClipRange();
    if (!clipApi) return;
    clipApi.setRange(payload.start ?? 0, payload.end ?? 0);
    return;
  }
  if (!videoEl) return;
  if (type === "seek") {
    const target = Number.isFinite(payload.time) ? payload.time : videoEl.currentTime || 0;
    videoEl.currentTime = clamp(target, 0, Number.isFinite(videoEl.duration) ? videoEl.duration : target);
    return;
  }
  if (type === "play") {
    videoEl.play().catch(() => {});
    return;
  }
  if (type === "pause") {
    videoEl.pause();
    return;
  }
  if (type === "volume") {
    if (Number.isFinite(payload.value)) {
      videoEl.volume = clamp(payload.value, 0, 1);
    }
    if (typeof payload.muted === "boolean") {
      videoEl.muted = payload.muted;
    } else if (videoEl.volume === 0) {
      videoEl.muted = true;
    }
    return;
  }
  if (type === "rate") {
    if (Number.isFinite(payload.value)) {
      videoEl.playbackRate = payload.value;
    }
  }
}

window.addEventListener("DOMContentLoaded", () => {
  mountPlayer();
  suppressEndingPrompts();
  ensureVideo();
  initClipRange();
  scheduleTagProbe(0);

  const observer = new MutationObserver(() => {
    mountPlayer();
    suppressEndingPrompts();
    if (!videoEl) ensureVideo();
    if (!clipApi) initClipRange();
    scheduleTagProbe();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
});

ipcRenderer.on("player:command", (_event, payload = {}) => {
  if (!videoEl) {
    pendingCommands.push(payload);
    return;
  }
  applyCommand(payload);
});
