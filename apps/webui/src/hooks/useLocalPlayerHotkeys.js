import { useEffect } from "react";

export default function useLocalPlayerHotkeys({
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
}) {
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
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }

      const key = event.key;
      const lowerKey = typeof key === "string" ? key.toLowerCase() : "";
      const isSpace = key === " " || event.code === "Space";
      const isHotkey =
        isSpace ||
        key === "ArrowRight" ||
        key === "ArrowLeft" ||
        key === "ArrowUp" ||
        key === "ArrowDown" ||
        lowerKey === "k" ||
        lowerKey === "j" ||
        lowerKey === "l" ||
        lowerKey === "m";

      if (previewUrl && isHotkey) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
      }

      if (!previewUrl) return;

      if ((key === "ArrowRight" || key === "ArrowLeft") && event.repeat) return;

      if (isSpace || lowerKey === "k") {
        togglePlayback();
        return;
      }

      if (lowerKey === "m") {
        toggleMute();
        return;
      }

      if (key === "ArrowUp") {
        const base = muteRef.current ? 0 : volumeRef.current;
        const next = Math.min(1, base + 0.05);
        setVolume(next);
        if (next > 0 && muteRef.current) setIsMuted(false);
        return;
      }

      if (key === "ArrowDown") {
        const base = muteRef.current ? 0 : volumeRef.current;
        const next = Math.max(0, base - 0.05);
        setVolume(next);
        if (next === 0) setIsMuted(true);
        return;
      }

      if (lowerKey === "j" || lowerKey === "l") {
        const step = lowerKey === "l" ? 10 : -10;
        const next = clamp(currentTime + step, rangeRef.current.start, rangeRef.current.end);
        seekPlayer(next);
        return;
      }

      if (key === "ArrowRight" || key === "ArrowLeft") {
        if (keyHoldRef.current.key && keyHoldRef.current.key !== key) return;
        if (keyHoldRef.current.key === key) return;
        keyHoldRef.current.key = key;
        keyHoldRef.current.long = false;
        keyHoldRef.current.timeout = setTimeout(() => {
          if (keyHoldRef.current.key !== key) return;
          keyHoldRef.current.long = true;
          if (key === "ArrowRight") {
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
      const key = event.key;
      const lowerKey = typeof key === "string" ? key.toLowerCase() : "";
      const isSpace = key === " " || event.code === "Space";
      const isHotkey =
        isSpace ||
        key === "ArrowRight" ||
        key === "ArrowLeft" ||
        key === "ArrowUp" ||
        key === "ArrowDown" ||
        lowerKey === "k" ||
        lowerKey === "j" ||
        lowerKey === "l" ||
        lowerKey === "m";

      if (previewUrl && isHotkey) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
      }

      if (!previewUrl) return;

      if (key !== "ArrowRight" && key !== "ArrowLeft") return;

      if (keyHoldRef.current.key && keyHoldRef.current.key !== key) return;

      const step = 5;

      if (!keyHoldRef.current.long) {
        const delta = key === "ArrowRight" ? step : -step;
        const next = clamp(currentTime + delta, rangeRef.current.start, rangeRef.current.end);
        seekPlayer(next);
      } else if (key === "ArrowRight") {
        const nextRate = keyHoldRef.current.lastRate || 1;
        setPlaybackRate(nextRate);
      } else if (key === "ArrowLeft") {
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
  }, [
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
  ]);
}
