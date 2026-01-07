const { ipcRenderer } = require("electron");

let videoEl = null;
let rangeStart = 0;
let rangeEnd = 0;
let buffering = false;
const pendingCommands = [];

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function sendState() {
  if (!videoEl) return;
  ipcRenderer.sendToHost("player:state", {
    currentTime: Number.isFinite(videoEl.currentTime) ? videoEl.currentTime : 0,
    duration: Number.isFinite(videoEl.duration) ? videoEl.duration : 0,
    paused: !!videoEl.paused,
    buffering
  });
}

function enforceRange() {
  if (!videoEl) return;
  if (!Number.isFinite(rangeEnd) || rangeEnd <= rangeStart) return;
  if (videoEl.currentTime < rangeStart - 0.05 || videoEl.currentTime > rangeEnd - 0.02) {
    videoEl.currentTime = rangeStart;
  }
}

function applyCommand(payload = {}) {
  const type = payload.type;
  if (type === "range") {
    rangeStart = Number.isFinite(payload.start) ? payload.start : 0;
    rangeEnd = Number.isFinite(payload.end) ? payload.end : 0;
    enforceRange();
    sendState();
    return;
  }
  if (!videoEl) return;
  if (type === "seek") {
    const target = Number.isFinite(payload.time) ? payload.time : videoEl.currentTime || 0;
    videoEl.currentTime = clamp(
      target,
      0,
      Number.isFinite(videoEl.duration) ? videoEl.duration : target
    );
    enforceRange();
    sendState();
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
    sendState();
    return;
  }
  if (type === "rate") {
    if (Number.isFinite(payload.value)) {
      videoEl.playbackRate = payload.value;
    }
  }
}

function hookVideo(el) {
  if (!el || videoEl === el) return;
  videoEl = el;
  videoEl.addEventListener("timeupdate", () => {
    enforceRange();
    sendState();
  });
  videoEl.addEventListener("seeking", () => {
    enforceRange();
    sendState();
  });
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
  enforceRange();
  if (pendingCommands.length) {
    pendingCommands.splice(0).forEach((payload) => applyCommand(payload));
  }
  sendState();
}

function tryFindVideo() {
  const el = document.querySelector("video");
  if (el) {
    hookVideo(el);
    return true;
  }
  return false;
}

ipcRenderer.on("player:command", (_event, payload = {}) => {
  if (!videoEl) {
    pendingCommands.push(payload);
    if (payload.type === "range") {
      rangeStart = Number.isFinite(payload.start) ? payload.start : 0;
      rangeEnd = Number.isFinite(payload.end) ? payload.end : 0;
    }
    return;
  }
  applyCommand(payload);
});

window.addEventListener("DOMContentLoaded", () => {
  if (tryFindVideo()) return;
  const observer = new MutationObserver(() => {
    if (videoEl) return;
    tryFindVideo();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
});
