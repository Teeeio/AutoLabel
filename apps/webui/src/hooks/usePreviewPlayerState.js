import { useRef, useState } from "react";

export default function usePreviewPlayerState() {
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
  const localVideoRef = useRef(null);
  const timelineRef = useRef(null);
  const resolvingRef = useRef(false);
  const dragRef = useRef({ type: null, startX: 0, start: 0, end: 0 });
  const wasPlayingRef = useRef(false);
  const [tooltip, setTooltip] = useState({ visible: false, text: "", x: 0, y: 0 });
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

  return {
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
  };
}
