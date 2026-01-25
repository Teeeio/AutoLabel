import { useCallback, useEffect } from "react";

export default function useTimelineScrub({
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
}) {
  const seekTo = useCallback(
    (clientX) => {
      if (!timelineRef.current || timelineSpan <= 0) return;
      const rect = timelineRef.current.getBoundingClientRect();
      const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
      const absoluteTime = ratio * timelineSpan;
      const threshold = Math.min(0.6, timelineSpan * 0.01);
      let clamped = clamp(absoluteTime, rangeStart, rangeEnd);
      if (Math.abs(clamped - rangeStart) <= threshold) clamped = rangeStart;
      if (Math.abs(clamped - rangeEnd) <= threshold) clamped = rangeEnd;
      seekPlayer(clamped);
    },
    [timelineRef, timelineSpan, clamp, rangeStart, rangeEnd, seekPlayer]
  );

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
    [
      timelineRef,
      timelineSpan,
      dragRef,
      rangeStart,
      rangeEnd,
      setIsScrubbing,
      setIsHovering,
      setDragHandle,
      wasPlayingRef,
      isPlaying,
      sendPlayerCommand,
      setIsPlaying,
      seekTo
    ]
  );

  const handleTimelineMouseDown = useCallback(
    (event) => {
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
    },
    [timelineRef, timelineSpan, startScrub]
  );

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
  }, [
    timelineSpan,
    rangeStart,
    rangeEnd,
    handleRangeChange,
    isOutsideRange,
    safePlay,
    currentTime,
    seekPlayer,
    dragRef,
    timelineRef,
    clamp,
    seekTo,
    lastRangeStartRef,
    wasPlayingRef,
    setIsScrubbing,
    setDragHandle,
    setIsPlaying
  ]);

  const handleTimelineHover = useCallback(
    (event) => {
      if (!timelineRef.current || timelineSpan <= 0) return;
      const rect = timelineRef.current.getBoundingClientRect();
      const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
      setHoverPercent(ratio * 100);
      const absoluteTime = ratio * timelineSpan;
      setHoverTime(absoluteTime);
      setIsHovering(true);
    },
    [timelineRef, timelineSpan, clamp, setHoverPercent, setHoverTime, setIsHovering]
  );

  return {
    handleTimelineMouseDown,
    handleStartHandleMouseDown,
    handleEndHandleMouseDown,
    handleRangeMouseDown,
    handleTimelineHover
  };
}
