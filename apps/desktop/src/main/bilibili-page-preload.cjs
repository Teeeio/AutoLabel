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

  if (!document.querySelector("#__clip_style")) {
    const style = document.createElement("style");
    style.id = "__clip_style";
    style.textContent = `
      .__clip_handle {
        width: 18px;
        height: 28px;
        border-radius: 9px;
        background: linear-gradient(180deg, #e9f7ff 0%, #bfe9ff 100%);
        border: 2px solid #29b6ff;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3),
          inset 0 1px 0 rgba(255, 255, 255, 0.6);
        transform: translateX(-50%);
        cursor: grab;
        transition: transform 120ms ease, box-shadow 120ms ease;
      }
      .__clip_handle:hover {
        transform: translateX(-50%) scale(1.08);
        box-shadow: 0 6px 16px rgba(0, 0, 0, 0.4);
      }
      .__clip_handle.__clip_dragging {
        cursor: grabbing;
      }
    `;
    document.head.appendChild(style);
  }

  const cs = getComputedStyle(progressWrap);
  if (cs.position === "static") progressWrap.style.position = "relative";

  const OLD = $(".__clip_root", progressWrap);
  if (OLD) OLD.remove();

  const dur = () => (Number.isFinite(videoEl.duration) ? videoEl.duration : 0);

  function getRange() {
    const d = dur();
    if (!d) return null;
    let s = parseFloat(progressWrap.dataset.clipStart);
    let e = parseFloat(progressWrap.dataset.clipEnd);
    if (!Number.isFinite(s)) s = 0;
    if (!Number.isFinite(e)) e = d;
    const MIN = 0.05;
    s = clamp(s, 0, d);
    e = clamp(e, s + MIN, d);
    progressWrap.dataset.clipStart = String(s);
    progressWrap.dataset.clipEnd = String(e);
    return { s, e, d };
  }

  function setRange(s, e) {
    const d = dur();
    if (!d) return;
    const MIN = 0.05;
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
    const rect = progressWrap.getBoundingClientRect();
    return (t / r.d) * rect.width;
  }

  function xToTime(clientX) {
    const r = getRange();
    if (!r) return 0;
    const rect = progressWrap.getBoundingClientRect();
    const x = clamp(clientX - rect.left, 0, rect.width);
    return (x / rect.width) * r.d;
  }

  function pokeBpxPreview(clientX, clientY) {
    const evt = new MouseEvent("mousemove", {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY,
      view: window
    });
    progressWrap.dispatchEvent(evt);
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

  const root = document.createElement("div");
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

  root.appendChild(rangeBar);
  root.appendChild(hStart);
  root.appendChild(hEnd);
  root.appendChild(tooltip);
  progressWrap.appendChild(root);

  function render() {
    const r = getRange();
    if (!r) return;
    const rect = progressWrap.getBoundingClientRect();
    const xS = (r.s / r.d) * rect.width;
    const xE = (r.e / r.d) * rect.width;
    hStart.style.left = `${xS}px`;
    hEnd.style.left = `${xE}px`;
    rangeBar.style.left = `${xS}px`;
    rangeBar.style.width = `${Math.max(0, xE - xS)}px`;
  }

  let dragging = null;
  let dragPid = null;
  let dragTarget = null;
  let suppressClamp = false;
  let dragStartRange = null;
  let wasPlayingOnDrag = false;

  function showTipAt(clientX, t) {
    const rect = progressWrap.getBoundingClientRect();
    const x = clamp(clientX - rect.left, 0, rect.width);
    tooltip.style.left = `${x}px`;
    tooltip.style.display = "block";
    tipTime.textContent = fmt(t);
    pokeBpxPreview(clientX, rect.top + rect.height / 2);
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
    dragTarget?.classList?.add("__clip_dragging");
    document.body.style.cursor = "grabbing";
    const range = getRange();
    dragStartRange = range ? { s: range.s, e: range.e } : null;
    wasPlayingOnDrag = !videoEl.paused;
    suppressClamp = true;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation?.();
    try {
      e.target.setPointerCapture(e.pointerId);
    } catch {}
    const t = xToTime(e.clientX);
    showTipAt(e.clientX, t);
  }

  function onPointerMove(e) {
    if (!dragging) return;
    if (dragPid != null && e.pointerId !== dragPid) return;
    const r = getRange();
    if (!r) return;
    const t = xToTime(e.clientX);
    if (dragging === "start") {
      setRange(t, r.e);
    } else {
      setRange(r.s, t);
    }
    showTipAt(e.clientX, t);
  }

  function onPointerUp(e) {
    if (!dragging) return;
    if (dragPid != null && e.pointerId !== dragPid) return;
    dragging = null;
    dragPid = null;
    if (dragTarget && dragTarget.releasePointerCapture) {
      try {
        dragTarget.releasePointerCapture(e.pointerId);
      } catch {}
    }
    dragTarget?.classList?.remove("__clip_dragging");
    document.body.style.cursor = "";
    dragTarget = null;
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
  window.addEventListener("blur", onPointerUp, true);
  window.addEventListener("pointermove", onPointerMove, true);
  window.addEventListener("pointerup", onPointerUp, true);
  window.addEventListener("pointercancel", onPointerUp, true);

  let internalLock = false;

  function clampNow() {
    if (suppressClamp) return;
    if (internalLock) return;
    const r = getRange();
    if (!r) return;
    const t = videoEl.currentTime;
    const EPS = 0.03;
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

  progressWrap.addEventListener(
    "pointerdown",
    (e) => {
      if (e.target?.closest?.(".__clip_handle")) return;
      if (dragging) return;
      const r = getRange();
      if (!r) return;
      const targetT = xToTime(e.clientX);
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
    clampNow();
    emitRangeUpdate();
  }

  initRangeWhenReady();
  new ResizeObserver(() => render()).observe(progressWrap);

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
  ensureVideo();
  initClipRange();

  const observer = new MutationObserver(() => {
    mountPlayer();
    if (!videoEl) ensureVideo();
    if (!clipApi) initClipRange();
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
