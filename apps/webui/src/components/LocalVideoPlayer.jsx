import { useCallback, useEffect, useRef, useState } from "react";

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

export default function LocalVideoPlayer({ localPath, localVideoRef, setDuration, setIsPlaying, syncCardRange, activeCard, setTimeHighlight }) {

  const [videoUrl, setVideoUrl] = useState(null);

  const [isLoading, setIsLoading] = useState(true);

  const [error, setError] = useState(null);

  const [currentTime, setCurrentTime] = useState(0);

  const [duration, setVideoDuration] = useState(0);

  const [volume, setVolume] = useState(1);

  const [isMuted, setIsMuted] = useState(false);

  const [playbackRate, setPlaybackRate] = useState(1);

  const [isPlaying, setIsPlayingState] = useState(false);

  const [controlsVisible, setControlsVisible] = useState(true);

  const [isFullscreen, setIsFullscreen] = useState(false);

  const playbackRateRef = useRef(1);

  const volumeRef = useRef(1);

  const lastVolumeRef = useRef(1);

  const controlsHideRef = useRef(null);

  const rangeStartRef = useRef(0);

  const rangeEndRef = useRef(0);

  const isPlayingRef = useRef(false);

  const playerActiveRef = useRef(false);

  const dragSyncRef = useRef({ pending: false, lastStart: null, lastEnd: null, fallback: null });


  // B绔欓鏍兼椂闂磋酱鐘舵€?- 瀹屾暣澶嶅埗B绔欐敞鍏ヤ唬鐮佺殑鐘舵€佺鐞?
  const [rangeStart, setRangeStart] = useState(0);

  const [rangeEnd, setRangeEnd] = useState(0);

  const [isScrubbing, setIsScrubbing] = useState(false);

  const [isHovering, setIsHovering] = useState(false);

  const [hoverPercent, setHoverPercent] = useState(0);

  const [hoverTime, setHoverTime] = useState(0);

  const [dragHandle, setDragHandle] = useState(null);



  // 鏂板锛氬瀭鐩撮樆灏煎拰鑷姩缂╂斁鐘舵€?
  // 灏嗛珮棰戞洿鏂扮姸鎬佹敼涓簉ef绠＄悊锛堥伩鍏嶆墦鏂璕AF寰幆锛?
  const dampStateRef = useRef({

    scale: 1,

    width: 1

  });

  const [dampScale, setDampScale] = useState(1);

  const [dampWidth, setDampWidth] = useState(1);



  // 绉婚櫎zoomScale鍜宻howZoomBadge鐨剈seState锛屾敼鐢╮ef绠＄悊锛堝畬鍏ㄥ鍒禕绔欙級

  const [showZoomBadge, setShowZoomBadge] = useState(false);

  const [showFrameHint, setShowFrameHint] = useState(false); // Show D/F key hint when scrubbing

  const [frameAdjustInfo, setFrameAdjustInfo] = useState(null); // Show frame adjustment info



  // Refs - 瀹屽叏澶嶅埗B绔欑殑鎷栧姩鐘舵€?
  const timelineRef = useRef(null);

  const playerSurfaceRef = useRef(null);

  const timelineBarRef = useRef(null); // 杩涘害鏉″厓绱犵殑ref

  const timelineClipRef = useRef(null); // 閫夊尯涓庢粦鍧楀眰锛岄渶璺熼殢缂╂斁

  const clipRootRef = useRef(null);

  const zoomOverlayRef = useRef(null);

  const zoomBadgeRef = useRef(null);

  const frameHintRef = useRef(null); // D/F key hint overlay

  const zoomBandRef = useRef(null);

  const clipTipRef = useRef(null);

  const clipTipImgRef = useRef(null);

  const clipTipTimeRef = useRef(null);

  const clipPreviewVideoRef = useRef(null);

  const clipPreviewCanvasRef = useRef(null);

  const clipPreviewQueueRef = useRef({ busy: false, pending: null });

  const clipPreviewLastRef = useRef({ time: null, ts: 0 });

  const frameAdjustTipTimerRef = useRef(null); // 用于 ZX 调整时的缩略图显示定时器

  const clampActiveRef = useRef(false);

  const suppressClampRef = useRef(false);

  const internalLockRef = useRef(false);

  const keyHoldLocalRef = useRef({

    key: null,

    timeout: null,

    raf: null,

    long: false,

    lastRate: 1,

    lastFrame: null,

    seekTime: null,

    wasPlaying: false

  });

  const startHandleRef = useRef(null);

  const endHandleRef = useRef(null);

  const playheadRef = useRef(null);

  const currentTimeRef = useRef(currentTime); // 鎾斁澶存洿鏂扮敤ref

  const dragRef = useRef({
    type: null,
    startX: 0,
    startY: 0,
    start: 0,
    end: 0,
    targetX: 0,
    smoothX: 0,
    damp: 1,
    grabOffset: 0
  });
  const dragPidRef = useRef(null);
  const dragTargetRef = useRef(null);
  const dragRafRef = useRef(null);
  const dragApplyRef = useRef(null);
  const dragLogRef = useRef({ enabled: true, last: 0 });
  const wasPlayingRef = useRef(false);

  const lastRangeStartRef = useRef(0);

  const rangeEpsilon = 0.05;



  // Zoom鐩稿叧ref锛堝畬鍏ㄥ鍒禕绔欙級

  const zoomStateRef = useRef({

    zoomScale: 1,

    zoomTranslateX: 0,

    baselineLeft: null,

    baselineWidth: null,

    zoomPending: false

  });



  // 婊戝潡浣嶇疆ref锛圧AF涓洿鎺ユ洿鏂癉OM锛岄伩鍏嶈Е鍙慠eact閲嶆覆鏌擄級

  const sliderPosRef = useRef({

    start: rangeStart,

    end: rangeEnd

  });



  // 褰揳ctiveCard鍙樺寲鏃讹紝鍚屾鑼冨洿
  useEffect(() => {
    if (activeCard) {
      const nextStart = Number.isFinite(activeCard.start) ? activeCard.start : 0;

      const nextEnd = Number.isFinite(activeCard.end) ? activeCard.end : (duration || 30);

      setRangeStart(nextStart);

      setRangeEnd(nextEnd);

      lastRangeStartRef.current = nextStart;



      // 鍚屾鍒皊liderPosRef

      sliderPosRef.current.start = nextStart;

      sliderPosRef.current.end = nextEnd;



      // 濡傛灉褰撳墠鎾斁浣嶇疆涓嶅湪鏂板尯闂村唴锛屼慨姝ｅ埌鏂板尯闂寸殑璧峰浣嶇疆

      if (localVideoRef.current) {

        const current = localVideoRef.current.currentTime;

        if (current < nextStart || current > nextEnd) {

          console.log('[鑼冨洿鍙樺寲] 鎾斁浣嶇疆', current, '涓嶅湪鏂板尯闂村唴 [', nextStart, ',', nextEnd, ']锛屼慨姝ｅ埌', nextStart);

          localVideoRef.current.currentTime = nextStart;

          setCurrentTime(nextStart);

        }

      }

    }

  }, [activeCard?.id, activeCard?.start, activeCard?.end, duration]);

  // range 鏇存柊鏃跺悓姝?slider 浣嶇疆锛岄伩鍏嶆嫋鍔ㄨ鍙栨棫鍊?
  useEffect(() => {
    if (isScrubbing) return;
    sliderPosRef.current.start = rangeStart;
    sliderPosRef.current.end = rangeEnd;
  }, [rangeStart, rangeEnd, isScrubbing]);


  useEffect(() => {

    console.log('[LocalVideoPlayer] 鍔犺浇瑙嗛鏂囦欢:', localPath);

    setIsLoading(true);

    setError(null);



    // 閫氳繃 IPC 璇锋眰涓昏繘绋嬭鍙栬棰戞枃

    window.localVideo?.load(localPath).then((arrayBuffer) => {

      console.log("[LocalVideoPlayer] video data size", arrayBuffer.byteLength);


      // 鍒涘缓 Blob URL

      const blob = new Blob([arrayBuffer], { type: 'video/mp4' });

      const url = URL.createObjectURL(blob);

      console.log('[LocalVideoPlayer] 鍒涘缓 Blob URL:', url);



      setVideoUrl(url);

      setIsLoading(false);

    }).catch((error) => {

      console.error('[LocalVideoPlayer] 鍔犺浇瑙嗛澶辫触:', error);

      setError(error.message);

      setIsLoading(false);

    });

  }, [localPath]);



  // ========== B绔欓鏍糧oom绯荤粺 - 鐩存帴DOM鎿嶄綔 ==========



  // 鑾峰彇鏃堕棿杞村搴︼紙BgetBaseWidth

  const getBaseWidth = useCallback(() => {

    if (!timelineBarRef.current) return null;

    const width = timelineBarRef.current.offsetWidth;

    if (Number.isFinite(width) && width > 0) return width;

    const rect = timelineBarRef.current.getBoundingClientRect();

    return rect.width || null;

  }, []);



  // 鎹曡幏鍩哄噯鐘舵€侊紙BcaptureBaseline

  const captureBaseline = useCallback(() => {

    if (!timelineBarRef.current) return;

    const rect = timelineBarRef.current.getBoundingClientRect();

    if (!rect.width) return;



    const { zoomScale, zoomTranslateX, baselineLeft, baselineWidth } = zoomStateRef.current;



    if (zoomScale !== 1) {

      // 宸茬粡鍦ㄧ缉鏀剧姸鎬侊紝涓嶆洿鏂癰aseline锛堥櫎闈炴槸绗竴娆★級

      if (baselineLeft == null || baselineWidth == null) {

        zoomStateRef.current.baselineLeft = rect.left - zoomTranslateX;

        zoomStateRef.current.baselineWidth = rect.width / zoomScale;

      }

      return;

    }



    // 鏈缉鏀剧姸鎬侊紝璁板綍鍩哄噯

    zoomStateRef.current.baselineLeft = rect.left;

    zoomStateRef.current.baselineWidth = rect.width;

  }, []);



  // 灞忓箷鍧愭爣杞熀鍑嗗潗鏍囷紙BscreenXToBaseX

  const screenXToBaseX = useCallback((clientX) => {

    const baseWidth = getBaseWidth();

    if (!baseWidth) return 0;



    captureBaseline();

    const { zoomScale, zoomTranslateX, baselineLeft, baselineWidth } = zoomStateRef.current;

    if (!baselineWidth) return 0;



    const rectLeft = baselineLeft + zoomTranslateX;

    const scaledWidth = baselineWidth * (zoomScale > 1.001 ? zoomScale : 1);

    const xScaled = clamp(clientX - rectLeft, 0, scaledWidth);



    if (zoomScale > 1.001) {

      return clamp(xScaled / zoomScale, 0, baseWidth);

    }

    return (xScaled / baselineWidth) * baseWidth;

  }, [getBaseWidth, captureBaseline]);



  // 鍩哄噯鍧愭爣杞睆骞曞潗鏍囷紙B绔?baseXToScreenX锛?

  const baseXToScreenX = useCallback((xBase) => {

    const baseWidth = getBaseWidth();

    captureBaseline();

    if (!baseWidth) return 0;



    const { zoomScale, zoomTranslateX, baselineLeft, baselineWidth } = zoomStateRef.current;

    if (!baselineWidth) return baselineLeft || 0;



    if (zoomScale > 1.001) {

      return baselineLeft + zoomTranslateX + xBase * zoomScale;

    }

    return baselineLeft + (xBase / baseWidth) * baselineWidth;

  }, [getBaseWidth, captureBaseline]);



  const baseXToScreenXScaled = useCallback((xBase) => {

    if (!timelineBarRef.current) return 0;

    const baseWidth = getBaseWidth();

    const rect = timelineBarRef.current.getBoundingClientRect();

    if (!baseWidth || !rect.width) return rect.left || 0;

    return rect.left + (xBase / baseWidth) * rect.width;

  }, [getBaseWidth]);



  const getMinSpan = useCallback((currentDuration, baseWidth) => {

    const zoomAssistRatio = 0;

    const zoomAssistSeconds = 1;

    const minSpanMaxSeconds = 1;

    const minSpanPx = 2;

    const baseMin = Math.min(

      currentDuration,

      minSpanMaxSeconds,

      Math.max(0.05, currentDuration * zoomAssistRatio, zoomAssistSeconds)

    );

    const width = baseWidth || getBaseWidth();

    const zoomScale = zoomStateRef.current.zoomScale || 1;

    if (!width || !Number.isFinite(zoomScale) || zoomScale <= 0) return baseMin;

    const minPxTime = (minSpanPx / (width * Math.max(zoomScale, 1))) * currentDuration;

    return Math.min(currentDuration, Math.max(baseMin, minPxTime));

  }, [getBaseWidth]);



  const updateZoomBadgePosition = useCallback(() => {

    if (!zoomBadgeRef.current || !duration) return;

    const baseWidth = getBaseWidth();

    if (!baseWidth) return;

    const xS = (rangeStart / duration) * baseWidth;

    const xE = (rangeEnd / duration) * baseWidth;

    const center = (xS + xE) / 2;

    const badgeWidth = zoomBadgeRef.current.offsetWidth || 0;

    const half = badgeWidth ? badgeWidth / 2 : 16;

    const minX = half;

    const maxX = Math.max(minX, baseWidth - half);

    const clamped = clamp(center, minX, maxX);

    zoomBadgeRef.current.style.left = `${clamped}px`;

  }, [duration, rangeStart, rangeEnd, getBaseWidth]);



  const requestClipPreview = useCallback((timeValue) => {

    const video = clipPreviewVideoRef.current;

    const canvas = clipPreviewCanvasRef.current;

    const tipImg = clipTipImgRef.current;

    if (!video || !canvas || !tipImg || !Number.isFinite(timeValue)) return;

    const currentDuration = duration || video.duration || timeValue;

    const clamped = clamp(timeValue, 0, currentDuration || timeValue);

    const now = Date.now();

    if (

      clipPreviewLastRef.current.time !== null &&

      Math.abs(clipPreviewLastRef.current.time - clamped) < 0.05 &&

      now - clipPreviewLastRef.current.ts < 120

    ) {

      return;

    }

    clipPreviewLastRef.current.time = clamped;

    clipPreviewLastRef.current.ts = now;

    if (clipPreviewQueueRef.current.busy) {

      clipPreviewQueueRef.current.pending = clamped;

      return;

    }

    clipPreviewQueueRef.current.busy = true;

    const seekAndDraw = () => {

      const handleSeeked = () => {

        const width = 160;

        const height = 90;

        canvas.width = width;

        canvas.height = height;

        const ctx = canvas.getContext("2d");

        if (ctx) {

          try {

            ctx.drawImage(video, 0, 0, width, height);

            tipImg.src = canvas.toDataURL("image/jpeg", 0.7);

            tipImg.style.visibility = "visible";

          } catch (err) {

            console.warn("clip preview capture failed", err);

          }

        }

        clipPreviewQueueRef.current.busy = false;

        const next = clipPreviewQueueRef.current.pending;

        clipPreviewQueueRef.current.pending = null;

        if (Number.isFinite(next)) {

          requestClipPreview(next);

        }

      };

      video.addEventListener("seeked", handleSeeked, { once: true });

      try {

        video.currentTime = clamped;

      } catch {

        clipPreviewQueueRef.current.busy = false;

      }

    };

    if (video.readyState >= 2) {

      seekAndDraw();

    } else {

      const handleLoaded = () => {

        video.removeEventListener("loadeddata", handleLoaded);

        seekAndDraw();

      };

      video.addEventListener("loadeddata", handleLoaded);

    }

  }, [duration]);



  const showTipAt = useCallback((clientX, timeValue) => {

    if (!clipTipRef.current || !clipTipTimeRef.current || !timelineBarRef.current) return;

    const baseWidth = getBaseWidth();

    if (!baseWidth || !duration) return;

    const xBase = clamp((timeValue / duration) * baseWidth, 0, baseWidth);

    const overlayRect = zoomOverlayRef.current?.getBoundingClientRect?.();

    const anchorScreenX = baseXToScreenXScaled(xBase);

    const overlayLeft = overlayRect?.left ?? 0;

    clipTipRef.current.style.left = `${anchorScreenX - overlayLeft}px`;

    clipTipRef.current.style.display = "block";

    clipTipTimeRef.current.textContent = formatTime(timeValue);

    requestClipPreview(timeValue);

  }, [duration, getBaseWidth, baseXToScreenXScaled, requestClipPreview]);

  // 显示 ZX 调整时的缩略图
  const showFrameAdjustTip = useCallback((timeValue, durationMs = 500) => {
    if (!clipTipRef.current || !clipTipTimeRef.current || !timelineBarRef.current) return;

    const baseWidth = getBaseWidth();
    if (!baseWidth || !duration) return;

    // 清除之前的定时器
    if (frameAdjustTipTimerRef.current) {
      clearTimeout(frameAdjustTipTimerRef.current);
    }

    const xBase = clamp((timeValue / duration) * baseWidth, 0, baseWidth);
    const overlayRect = zoomOverlayRef.current?.getBoundingClientRect?.();
    const anchorScreenX = baseXToScreenXScaled(xBase);
    const overlayLeft = overlayRect?.left ?? 0;

    clipTipRef.current.style.left = `${anchorScreenX - overlayLeft}px`;
    clipTipRef.current.style.display = "block";
    clipTipTimeRef.current.textContent = formatTime(timeValue);

    requestClipPreview(timeValue);

    // 设置自动隐藏定时器
    frameAdjustTipTimerRef.current = setTimeout(() => {
      if (clipTipRef.current) {
        clipTipRef.current.style.display = "none";
      }
    }, durationMs);
  }, [duration, getBaseWidth, baseXToScreenXScaled, requestClipPreview]);


  const hideTip = useCallback(() => {

    if (clipTipRef.current) {

      clipTipRef.current.style.display = "none";

    }

  }, []);



  // 璁剧疆缂╂斁姣斾緥锛圔setZoomScale 鐩存帴鎿嶄綔DOM

  const applyZoomScaleToDOM = useCallback((scale, immediate = false) => {

    if (!timelineBarRef.current || !duration) return;



    const zoomEase = 0.18;

    const { zoomScale: currentScale } = zoomStateRef.current;

    const nextScale = immediate ? scale : currentScale + (scale - currentScale) * zoomEase;



    const baseWidth = getBaseWidth();

    if (!baseWidth) return;



    // 璁＄畻閿氱偣锛堥€夊尯涓績

    const anchorTime = (rangeStart + rangeEnd) / 2;

    const anchorRatio = anchorTime / duration;

    const anchorX = anchorRatio * baseWidth;



    captureBaseline();

    const { baselineLeft, baselineWidth } = zoomStateRef.current;

    const left = baselineLeft ?? timelineBarRef.current.getBoundingClientRect().left;



    zoomStateRef.current.zoomScale = nextScale;



    // 鐩存帴鎿嶄綔DOM

    timelineBarRef.current.style.setProperty("transform-origin", "left center", "important");

    timelineBarRef.current.style.willChange = "transform";

    if (timelineClipRef.current) {

      timelineClipRef.current.style.setProperty("transform-origin", "left center", "important");

      timelineClipRef.current.style.willChange = "transform";

    }



    if (nextScale === 1) {

      timelineBarRef.current.style.removeProperty("transform");

      if (timelineClipRef.current) {

        timelineClipRef.current.style.removeProperty("transform");

      }

      zoomStateRef.current.zoomTranslateX = 0;

      console.log('[Zoom] 閲嶇疆缂╂斁');

    } else {

      // 璁＄畻translateX淇濇寔閿氱偣涓嶅彉

      const anchorScreen = (baselineLeft ?? left) +

        (baselineWidth ? (anchorX / baseWidth) * baselineWidth : anchorX);

      const translateX = anchorScreen - (baselineLeft ?? left) - anchorX * nextScale;

      zoomStateRef.current.zoomTranslateX = translateX;



      const transformValue = `translateX(${translateX}px) scaleX(${nextScale})`;

      timelineBarRef.current.style.setProperty("transform", transformValue, "important");

      if (timelineClipRef.current) {

        timelineClipRef.current.style.setProperty("transform", transformValue, "important");

      }



      console.log('[Zoom] 搴旂敤缂╂斁:', {

        nextScale: nextScale.toFixed(2),

        translateX: translateX.toFixed(2),

        transformValue,

        baseWidth: baseWidth.toFixed(2),

        anchorX: anchorX.toFixed(2)

      });

    }



    // 鏇存柊婊戝潡鐨剆cale锛堝弽姣斾緥锛屾粦鍧椾繚鎸佽瑙夊昂瀵革級

    const inverse = nextScale ? 1 / nextScale : 1;

    if (startHandleRef.current) {

      startHandleRef.current.style.setProperty("--clip-scale", String(inverse));

    }

    if (endHandleRef.current) {

      endHandleRef.current.style.setProperty("--clip-scale", String(inverse));

    }

    const zoomActive = nextScale > 1.02;

    if (clipRootRef.current) {

      clipRootRef.current.classList.toggle("__clip_zoomed", zoomActive);

    }

    if (zoomOverlayRef.current) {

      zoomOverlayRef.current.classList.toggle("__clip_zoomed", zoomActive);

    }

    if (zoomActive && zoomBadgeRef.current) {

      zoomBadgeRef.current.textContent = `缩放 x${nextScale.toFixed(1)}`;

    }



    // 鍏抽敭锛氭粦鍧椾綅缃缁堢敤鏈缉鏀剧殑鍍忕礌鍊硷紝鍥犱负婊戝潡鍦ㄧ缉鏀惧眰鍐?

      // 浼氳嚜鍔ㄨ窡闅忕埗鍏冪礌鐨則ransform

    const xS = (rangeStart / duration) * baseWidth;

    const xE = (rangeEnd / duration) * baseWidth;



    if (startHandleRef.current) {

      startHandleRef.current.style.left = `${xS}px`;

    }

    if (endHandleRef.current) {

      endHandleRef.current.style.left = `${xE}px`;

    }



    // 鏇存柊閫夊尯bar浣嶇疆

    const selectionEl = timelineClipRef.current?.querySelector('[data-role="selection"]')

      ?? timelineBarRef.current?.querySelector('[data-role="selection"]');

    if (selectionEl) {

      selectionEl.style.left = `${xS}px`;

      selectionEl.style.width = `${Math.max(0, xE - xS)}px`;

    }

    if (zoomBandRef.current) {

      zoomBandRef.current.style.left = `${xS}px`;

      zoomBandRef.current.style.width = `${Math.max(0, xE - xS)}px`;

    }

    if (zoomActive) {

      updateZoomBadgePosition();

    }



    // Update zoom badge UI

    setShowZoomBadge(zoomActive);

  }, [duration, rangeStart, rangeEnd, getBaseWidth, captureBaseline, updateZoomBadgePosition]);



  // Apply auto zoom

  const applyAutoZoom = useCallback((force = false) => {
    const actualDuration = Number.isFinite(duration) && duration > 0
      ? duration
      : Number.isFinite(localVideoRef.current?.duration)
        ? localVideoRef.current.duration
        : 0;
    if (!actualDuration || !timelineBarRef.current) return;

    const { zoomPending, zoomScale } = zoomStateRef.current;

    // Defer zoom while scrubbing
    if (!force && (isScrubbing || dragRef.current.type)) {
      zoomStateRef.current.zoomPending = true;
      return;
    }
    zoomStateRef.current.zoomPending = false;


    const span = Math.max(0.05, rangeEnd - rangeStart);
    const baseWidth = getBaseWidth();
    if (!baseWidth) return;


    // 璁＄畻閫夊尯鍦ㄨ繘搴︽潯涓婄殑鍍忕礌瀹藉害

    const spanBasePx = Math.max(0.001, (span / actualDuration) * baseWidth);


    // 鐩爣锛氳40鍍忕礌浠ｈ〃閫夊尯

    const zoomTargetSpanPx = 40;

    const zoomMaxScale = 18;



    // 璁＄畻闇€瑕佺殑缂╂斁姣斾緥

    const targetScale = Math.max(1, Math.min(zoomMaxScale, zoomTargetSpanPx / spanBasePx));



    applyZoomScaleToDOM(targetScale, true);
  }, [duration, rangeStart, rangeEnd, isScrubbing, getBaseWidth, applyZoomScaleToDOM]);


  // Handle positions are set by inline left styles


  // Check if time is outside range

  const isOutsideRange = useCallback(

    (time) => time < rangeStart - rangeEpsilon || time > rangeEnd + rangeEpsilon,

    [rangeStart, rangeEnd, rangeEpsilon]

  );



  // Seek player with range clamp

  const seekPlayer = useCallback(

    (timeValue) => {

      if (!localVideoRef.current) return;

      // 涓ユ牸闄愬埗鍦ㄥ尯闂磋寖鍥村唴

      const clamped = clamp(timeValue, rangeStart, rangeEnd);

      setCurrentTime(clamped);

      localVideoRef.current.currentTime = clamped;

      console.log('[seekPlayer] 瀹氫綅', clamped, '(鍘熷:', timeValue, ')');

    },

    [rangeStart, rangeEnd]

  );



  // 瀹夊叏鎾斁锛堥槻姝㈤噸澶嶆挱鏀捐姹傦級

  const safePlay = useCallback(async () => {

    if (!localVideoRef.current) return;

    try {

      await localVideoRef.current.play();

    } catch (err) {

      console.error('[LocalVideoPlayer] 鎾斁澶辫触:', err);

    }

  }, []);



  // 澶勭悊鎾斁/鏆傚仠

  const togglePlay = useCallback(() => {

    if (!localVideoRef.current) return;

    if (isPlaying) {

      localVideoRef.current.pause();

    } else {

      localVideoRef.current.play();

    }

  }, [isPlaying]);



  // 鏇存柊鑼冨洿鐘舵€侊紙鍚屾鍒癆pp缁勪欢锛?

  const updateRangeState = useCallback((startValue, endValue) => {

    setRangeStart(startValue);

    setRangeEnd(endValue);

    lastRangeStartRef.current = startValue;

    // 鍚屾鍒癆pp缁勪欢鐨刢ard鐘舵€?
    if (syncCardRange) {

      syncCardRange(startValue, endValue);

    }

  }, [syncCardRange]);



  // 澶勭悊鑼冨洿鍙樺寲

  const handleRangeChange = useCallback((nextStart, nextEnd) => {

    const maxValue = duration || Math.max(30, rangeEnd, nextEnd);

    const safeStart = clamp(nextStart, 0, maxValue);

    const baseWidth = getBaseWidth();

    const minSpan = getMinSpan(maxValue, baseWidth);

    const safeEnd = clamp(nextEnd, safeStart + minSpan, maxValue);

    updateRangeState(safeStart, safeEnd);

  }, [duration, rangeEnd, updateRangeState, getBaseWidth, getMinSpan]);



  // 瀹氫綅鍒版寚瀹氶紶鏍囦綅缃紙浣跨敤B绔欓鏍煎潗鏍囪浆鎹級

  const seekTo = useCallback((clientX) => {

    if (!timelineBarRef.current || !duration) return;



    const baseWidth = getBaseWidth();

    if (!baseWidth) return;



    // 浣跨敤B绔欓鏍肩殑鍧愭爣杞崲

    const xBase = screenXToBaseX(clientX);

    const ratio = xBase / baseWidth;



    const absoluteTime = ratio * duration;

    const threshold = Math.min(0.6, duration * 0.01);

    let clamped = clamp(absoluteTime, rangeStart, rangeEnd);

    if (Math.abs(clamped - rangeStart) <= threshold) clamped = rangeStart;

    if (Math.abs(clamped - rangeEnd) <= threshold) clamped = rangeEnd;



    seekPlayer(clamped);

  }, [duration, rangeStart, rangeEnd, seekPlayer, getBaseWidth, screenXToBaseX]);



  // 寮€濮嬫嫋鍔紙瀹屽叏澶嶅埗B绔欑殑闃诲凹绯荤粺

  const startScrub = useCallback(
    (type, clientX, clientY, pointerId, pointerTarget) => {
      if (!timelineRef.current) return;
      const videoDuration = localVideoRef.current?.duration;
      const currentDuration =
        Number.isFinite(duration) && duration > 0
          ? duration
          : Number.isFinite(videoDuration) && videoDuration > 0
            ? videoDuration
            : Number.isFinite(rangeEnd) && rangeEnd > 0
              ? rangeEnd
              : 0;
      if (!currentDuration) return;


      // 璁＄畻婊戝潡鎶撳彇鍋忕Щ
      const targetRect = type === 'start'
        ? startHandleRef.current?.getBoundingClientRect()
        : type === 'end'
        ? endHandleRef.current?.getBoundingClientRect()
        : null;


      const grabOffset = targetRect && Number.isFinite(targetRect.left)

        ? clientX - (targetRect.left + targetRect.width / 2)

        : 0;



      // 浣跨敤sliderPosRef鐨勫綋鍓?

      const currentStart = sliderPosRef.current.start;

      const currentEnd = sliderPosRef.current.end;



      dragRef.current = {
        type,
        startX: clientX,
        startY: clientY,
        start: currentStart,
        end: currentEnd,
        targetX: clientX,
        smoothX: clientX,
        damp: 1,
        grabOffset
      };
      dragPidRef.current = Number.isFinite(pointerId) ? pointerId : null;
      dragTargetRef.current = pointerTarget || null;
      if (dragLogRef.current.enabled) {
        console.log("[Drag] start", {
          type,
          clientX,
          clientY,
          pointerId,
          duration: currentDuration,
          rangeStart: currentStart,
          rangeEnd: currentEnd
        });
      }


      setIsScrubbing(true);

      setIsHovering(false);

      setDragHandle(type === "start" ? "start" : type === "end" ? "end" : null);

      // Activate keyboard handling when dragging timeline handles
      if (type === "start" || type === "end") {
        playerActiveRef.current = true;
        keyHoldLocalRef.current.lastDragHandle = type; // Save for Z/X keys
        console.log('[Frame Adjust] Activated playerActiveRef for frame adjustment, saved lastDragHandle:', type);
      }

      clampActiveRef.current = false;

      document.body.style.cursor = "grabbing";

      suppressClampRef.current = type !== "timeline";



      wasPlayingRef.current = isPlaying;



      // 濡傛灉鐐瑰嚮鏃堕棿杞达紝绔嬪嵆瀹氫綅
      if (type === "timeline") {
        seekTo(clientX);
      }
      if (type === "start") {
        showTipAt(clientX, currentStart);
      }
      if (type === "end") {
        showTipAt(clientX, currentEnd);
      }

      // 绔嬪嵆搴旂敤涓€娆″苟鍚姩鎷栧姩寰幆锛岄伩鍏嶅彧瑙﹀彂涓€甯?
      dragApplyRef.current?.applyDragAtX?.(clientX);
      dragApplyRef.current?.startTick?.();
    },
    [duration, rangeEnd, seekTo, isPlaying, setIsPlaying, showTipAt]
  );


  // 鏃堕棿杞撮紶鏍囨寜涓嬪

  const handleTimelineMouseDown = useCallback((event) => {
    const videoDuration = localVideoRef.current?.duration;
    const currentDuration =
      Number.isFinite(duration) && duration > 0
        ? duration
        : Number.isFinite(videoDuration) && videoDuration > 0
          ? videoDuration
          : Number.isFinite(rangeEnd) && rangeEnd > 0
            ? rangeEnd
            : 0;
    if (!timelineRef.current || !currentDuration) return;

    const roleTarget = event.target?.closest?.("[data-role]");
    const role = roleTarget?.dataset?.role || "timeline";

    if (role === "selection") {
      return;
    }

    const type =
      role === "playhead"
        ? "playhead"
        : role === "start-handle"
          ? "start"
          : role === "end-handle"
            ? "end"
            : "timeline";

    startScrub(type, event.clientX, event.clientY);
  }, [duration, rangeEnd, startScrub]);


  // 寮€濮嬫粦鍧楅紶鏍囨寜

  const handleStartHandleMouseDown = useCallback(
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      startScrub("start", event.clientX, event.clientY);
    },

    [startScrub]

  );



  // 缁撴潫婊戝潡榧犳爣鎸変笅

  const handleEndHandleMouseDown = useCallback(
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      startScrub("end", event.clientX, event.clientY);
    },
    [startScrub]
  );

  const handleStartHandlePointerDown = useCallback(
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      startScrub("start", event.clientX, event.clientY, event.pointerId, event.currentTarget);
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {}
    },
    [startScrub]
  );

  const handleEndHandlePointerDown = useCallback(
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      startScrub("end", event.clientX, event.clientY, event.pointerId, event.currentTarget);
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {}
    },
    [startScrub]
  );


  const clampNow = useCallback(() => {

    if (suppressClampRef.current || internalLockRef.current) return;

    if (!localVideoRef.current) return;

    if (!duration) return;

    const video = localVideoRef.current;

    const t = video.currentTime;

    const EPS = 0.015;

    if (!video.paused && t >= rangeEnd - EPS) {

      internalLockRef.current = true;

      const overshoot = Math.max(0, t - rangeEnd);

      let nextTime = rangeStart + overshoot;

      if (nextTime >= rangeEnd - EPS) {

        nextTime = rangeStart;

      }

      video.currentTime = nextTime;

      if (!video.paused) {
        video.play().catch(() => {});
      }

      requestAnimationFrame(() => {

        internalLockRef.current = false;

      });

      return;

    }

    if (t < rangeStart - EPS) {

      internalLockRef.current = true;

      video.currentTime = rangeStart;

      if (!video.paused) {
        video.play().catch(() => {});
      }

      requestAnimationFrame(() => {

        internalLockRef.current = false;

      });

      return;

    }

    if (t > rangeEnd + EPS) {

      internalLockRef.current = true;

      const overshoot = Math.max(0, t - rangeEnd);

      let nextTime = rangeStart + overshoot;

      if (nextTime >= rangeEnd - EPS) {

        nextTime = rangeStart;

      }

      video.currentTime = nextTime;

      if (!video.paused) {
        video.play().catch(() => {});
      }

      requestAnimationFrame(() => {

        internalLockRef.current = false;

      });

    }

  }, [duration, rangeStart, rangeEnd]);



  const applyPlaybackRate = useCallback((rate) => {

    setPlaybackRate(rate);

    playbackRateRef.current = rate;

    if (localVideoRef.current) {

      localVideoRef.current.playbackRate = rate;

    }

  }, []);

  const applyVolume = useCallback((nextValue, options = {}) => {
    const { forceMuted } = options;
    const next = clamp(nextValue, 0, 1);
    const muted = typeof forceMuted === "boolean" ? forceMuted : next === 0;
    setVolume(next);
    volumeRef.current = next;
    if (next > 0) {
      lastVolumeRef.current = next;
    }
    setIsMuted(muted);
    if (localVideoRef.current) {
      localVideoRef.current.volume = next;
      localVideoRef.current.muted = muted;
    }
  }, []);

  const toggleMuteLocal = useCallback(() => {
    const hasSound = volumeRef.current > 0;
    if (isMuted || !hasSound) {
      const restore = lastVolumeRef.current || 1;
      applyVolume(restore, { forceMuted: false });
      return;
    }
    lastVolumeRef.current = volumeRef.current || lastVolumeRef.current || 1;
    applyVolume(0, { forceMuted: true });
  }, [applyVolume, isMuted]);

  const scheduleHideControls = useCallback((delay = 2200) => {
    if (controlsHideRef.current) {
      clearTimeout(controlsHideRef.current);
      controlsHideRef.current = null;
    }
    if (!isPlaying) {
      setControlsVisible(true);
      return;
    }
    controlsHideRef.current = setTimeout(() => {
      if (isScrubbing || isHovering) return;
      setControlsVisible(false);
    }, delay);
  }, [isPlaying, isScrubbing, isHovering]);

  const revealControls = useCallback((delay = 2200) => {
    setControlsVisible(true);
    scheduleHideControls(delay);
  }, [scheduleHideControls]);

  const toggleFullscreen = useCallback(() => {
    const surface = playerSurfaceRef.current;
    if (!surface) return;
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
      return;
    }
    surface.requestFullscreen?.();
  }, []);



  useEffect(() => {

    playbackRateRef.current = playbackRate;

  }, [playbackRate]);

  useEffect(() => {
    volumeRef.current = volume;
    if (volume > 0) {
      lastVolumeRef.current = volume;
    }
    if (localVideoRef.current) {
      localVideoRef.current.volume = volume;
      localVideoRef.current.muted = isMuted;
    }
  }, [volume, isMuted]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  useEffect(() => {
    if (isScrubbing || isHovering) {
      setControlsVisible(true);
      if (controlsHideRef.current) {
        clearTimeout(controlsHideRef.current);
        controlsHideRef.current = null;
      }
      return;
    }
    scheduleHideControls();
  }, [isScrubbing, isHovering, isPlaying, scheduleHideControls]);

  useEffect(() => () => {
    if (controlsHideRef.current) {
      clearTimeout(controlsHideRef.current);
      controlsHideRef.current = null;
    }
  }, []);

  useEffect(() => {

    rangeStartRef.current = rangeStart;

    rangeEndRef.current = rangeEnd;

  }, [rangeStart, rangeEnd]);

  useEffect(() => {
    if (!Number.isFinite(rangeStart)) return;
    if (!localVideoRef.current) return;
    localVideoRef.current.currentTime = rangeStart;
    currentTimeRef.current = rangeStart;
    setCurrentTime(rangeStart);
  }, [rangeStart]);

  useEffect(() => {

    isPlayingRef.current = isPlaying;

  }, [isPlaying]);



  useEffect(() => {

    const clearHold = () => {

      console.log('[Frame Adjust] clearHold called, current key:', keyHoldLocalRef.current.key);

      if (keyHoldLocalRef.current.timeout) {

        clearTimeout(keyHoldLocalRef.current.timeout);

      }

      if (keyHoldLocalRef.current.raf) {

        cancelAnimationFrame(keyHoldLocalRef.current.raf);

      }

      keyHoldLocalRef.current.timeout = null;

      keyHoldLocalRef.current.raf = null;

      keyHoldLocalRef.current.key = null;

      keyHoldLocalRef.current.long = false;

      keyHoldLocalRef.current.lastFrame = null;

      keyHoldLocalRef.current.seekTime = null;

      keyHoldLocalRef.current.wasPlaying = false;

      console.log('[Frame Adjust] clearHold finished, key reset to:', keyHoldLocalRef.current.key);

    };



    const startRewindLoop = () => {

      const speed = 27;

      const loop = (now) => {

        if (keyHoldLocalRef.current.key !== "ArrowLeft" || !keyHoldLocalRef.current.long) return;

        const last = keyHoldLocalRef.current.lastFrame || now;

        const delta = (now - last) / 1000;

        keyHoldLocalRef.current.lastFrame = now;

        const baseTime = Number.isFinite(keyHoldLocalRef.current.seekTime)

          ? keyHoldLocalRef.current.seekTime

          : currentTimeRef.current;

        const updated = clamp(baseTime - delta * speed, rangeStartRef.current, rangeEndRef.current);

        keyHoldLocalRef.current.seekTime = updated;

        seekPlayer(updated);

        keyHoldLocalRef.current.raf = requestAnimationFrame(loop);

      };

      keyHoldLocalRef.current.lastFrame = null;

      keyHoldLocalRef.current.raf = requestAnimationFrame(loop);

    };

    // Frame adjustment loop for Z/X keys (accelerated frame-based movement)
    const startFrameAdjustLoop = () => {
      const framesPerSecond = 60; // Run at 60fps for smooth acceleration
      const baseFramesPerStep = 1; // Start with 1 frame per step
      const maxFramesPerStep = 20; // Accelerate up to 20 frames per step (2x faster)

      let currentFramesPerStep = baseFramesPerStep;
      let lastUpdate = performance.now();
      let accumulator = 0;
      let lastTipUpdate = 0; // 用于节流缩略图更新

      const loop = (now) => {
        const savedDragHandle = keyHoldLocalRef.current.dragHandle;

        if (!keyHoldLocalRef.current.long ||
            (keyHoldLocalRef.current.key !== "z" && keyHoldLocalRef.current.key !== "x") ||
            !savedDragHandle) {
          return;
        }

        const delta = (now - lastUpdate) / 1000; // Convert to seconds
        lastUpdate = now;
        accumulator += delta;

        // Gradually accelerate (2x faster than before)
        if (currentFramesPerStep < maxFramesPerStep) {
          currentFramesPerStep += delta * 10; // Increase by 10 frames per second (was 5)
          currentFramesPerStep = Math.min(currentFramesPerStep, maxFramesPerStep);
        }

        const frameDuration = keyHoldLocalRef.current.frameDuration || (1 / 30);
        const direction = keyHoldLocalRef.current.direction || 1;
        const stepSize = frameDuration * currentFramesPerStep;

        if (accumulator >= 1 / framesPerSecond) {
          accumulator = 0;

          if (savedDragHandle === 'start') {
            const next = clamp(rangeStartRef.current + stepSize * direction, 0, rangeEndRef.current - 0.05);
            setRangeStart(next);
            lastRangeStartRef.current = next;
            if (syncCardRange) syncCardRange(next, rangeEndRef.current);

            // 节流更新缩略图（每 100ms 最多更新一次）
            if (now - lastTipUpdate > 100) {
              showFrameAdjustTip(next, 500);
              lastTipUpdate = now;
            }
          } else if (savedDragHandle === 'end') {
            const next = clamp(rangeEndRef.current + stepSize * direction, rangeStartRef.current + 0.05, duration);
            setRangeEnd(next);
            if (syncCardRange) syncCardRange(rangeStartRef.current, next);

            // 节流更新缩略图（每 100ms 最多更新一次）
            if (now - lastTipUpdate > 100) {
              showFrameAdjustTip(next, 500);
              lastTipUpdate = now;
            }
          }
        }

        keyHoldLocalRef.current.raf = requestAnimationFrame(loop);
      };

      keyHoldLocalRef.current.raf = requestAnimationFrame(loop);
    };


    const handleKeyDown = (event) => {
      const target = event.target;
      if (target && (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable
      )) {
        return;
      }

      const key = event.key;
      const lowerKey = typeof key === "string" ? key.toLowerCase() : "";
      const isSpace = key === " " || event.code === "Space";
      const isHotkey = isSpace ||
        key === "ArrowRight" ||
        key === "ArrowLeft" ||
        key === "ArrowUp" ||
        key === "ArrowDown" ||
        lowerKey === "k" ||
        lowerKey === "j" ||
        lowerKey === "l" ||
        lowerKey === "m" ||
        lowerKey === "z" ||
        lowerKey === "x";

      if (playerActiveRef.current && isHotkey) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
      }

      if (!playerActiveRef.current) return;

      // Z/X keys work even when video is not loaded (for timeline adjustment)
      if (!localVideoRef.current || !videoUrl) {
        // Only allow Z/X if we're dragging a handle
        if (!(lowerKey === "z" || lowerKey === "x")) {
          return;
        }
      }

      if ((key === "ArrowRight" || key === "ArrowLeft") && event.repeat) return;

      if (isSpace || lowerKey === "k") {
        togglePlay();
        return;
      }

      if (lowerKey === "m") {
        toggleMuteLocal();
        return;
      }

      if (key === "ArrowUp") {
        const base = isMuted ? 0 : volumeRef.current;
        const next = Math.min(1, base + 0.05);
        applyVolume(next, { forceMuted: false });
        return;
      }

      if (key === "ArrowDown") {
        const base = isMuted ? 0 : volumeRef.current;
        const next = Math.max(0, base - 0.05);
        applyVolume(next, { forceMuted: next === 0 });
        return;
      }

      if (lowerKey === "j" || lowerKey === "l") {
        const step = lowerKey === "l" ? 10 : -10;
        const next = clamp(currentTimeRef.current + step, rangeStartRef.current, rangeEndRef.current);
        seekPlayer(next);
        return;
      }

      // Z/X keys: Frame-based adjustment for timeline handles
      if (lowerKey === "z" || lowerKey === "x") {
        // Check if we have a recently dragged handle
        const lastDragHandle = keyHoldLocalRef.current.lastDragHandle;
        if (!lastDragHandle || (lastDragHandle !== 'start' && lastDragHandle !== 'end')) {
          console.log('[Frame Adjust] No valid lastDragHandle:', lastDragHandle);
          return;
        }

        console.log('[Frame Adjust] Z/X key pressed:', lowerKey, 'lastDragHandle:', lastDragHandle, 'current dragHandle:', dragHandle, 'isScrubbing:', isScrubbing);
        console.log('[Frame Adjust] Current keyHoldLocalRef.key:', keyHoldLocalRef.current.key);

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();

        if (keyHoldLocalRef.current.key && keyHoldLocalRef.current.key !== key) {
          console.log('[Frame Adjust] Blocked: Different key already held:', keyHoldLocalRef.current.key);
          return;
        }
        if (keyHoldLocalRef.current.key === key) {
          console.log('[Frame Adjust] Blocked: Same key already held (repeat press)');
          return;
        }

        // Get fps from active card or default to 30
        const fps = activeCard?.localFps || 30;
        const frameDuration = 1 / fps; // Duration of one frame in seconds

        console.log('[Frame Adjust] fps:', fps, 'frameDuration:', frameDuration);

        keyHoldLocalRef.current.key = key;
        keyHoldLocalRef.current.long = false;
        keyHoldLocalRef.current.frameDuration = frameDuration;
        keyHoldLocalRef.current.direction = lowerKey === "x" ? 1 : -1; // X: forward (right), Z: backward (left)
        keyHoldLocalRef.current.dragHandle = lastDragHandle; // Use lastDragHandle for keyUp

        console.log('[Frame Adjust] Set direction:', keyHoldLocalRef.current.direction, 'for key:', lowerKey);

        // Highlight decimals when Z/X is pressed
        if (setTimeHighlight) {
          setTimeHighlight(true);
        }

        // 防止控制栏自动隐藏
        if (controlsHideRef.current) {
          clearTimeout(controlsHideRef.current);
          controlsHideRef.current = null;
        }
        setControlsVisible(true);

        keyHoldLocalRef.current.timeout = setTimeout(() => {
          console.log('[Frame Adjust] Timeout fired! key:', keyHoldLocalRef.current.key, 'expected:', key);
          if (keyHoldLocalRef.current.key !== key) {
            console.log('[Frame Adjust] Timeout: key mismatch, ignoring');
            return;
          }
          keyHoldLocalRef.current.long = true;
          console.log('[Frame Adjust] Long press detected, starting acceleration');

          // 确保控制栏保持可见
          if (controlsHideRef.current) {
            clearTimeout(controlsHideRef.current);
            controlsHideRef.current = null;
          }
          setControlsVisible(true);

          // Start accelerated frame-based movement
          startFrameAdjustLoop();
        }, 220);

        return;
      }

      if (key === "ArrowRight" || key === "ArrowLeft") {
        if (keyHoldLocalRef.current.key && keyHoldLocalRef.current.key !== key) return;
        if (keyHoldLocalRef.current.key === key) return;
        keyHoldLocalRef.current.key = key;
        keyHoldLocalRef.current.long = false;
        keyHoldLocalRef.current.timeout = setTimeout(() => {
          if (keyHoldLocalRef.current.key !== key) return;
          keyHoldLocalRef.current.long = true;
          keyHoldLocalRef.current.wasPlaying = isPlayingRef.current;
          if (key === "ArrowRight") {
            keyHoldLocalRef.current.lastRate = playbackRateRef.current || 1;
            applyPlaybackRate(3);
            if (!isPlayingRef.current) {
              safePlay();
              setIsPlaying(true);
            }
          } else {
            if (localVideoRef.current) {
              localVideoRef.current.pause();
              setIsPlayingState(false);
              setIsPlaying(false);
            }
            startRewindLoop();
          }
        }, 220);
      }
    };



    const handleKeyUp = (event) => {
      const key = event.key;
      const lowerKey = typeof key === "string" ? key.toLowerCase() : "";
      const isSpace = key === " " || event.code === "Space";
      const isHotkey = isSpace ||
        key === "ArrowRight" ||
        key === "ArrowLeft" ||
        key === "ArrowUp" ||
        key === "ArrowDown" ||
        lowerKey === "k" ||
        lowerKey === "j" ||
        lowerKey === "l" ||
        lowerKey === "m" ||
        lowerKey === "z" ||
        lowerKey === "x";

      if (playerActiveRef.current && isHotkey) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
      }

      if (!playerActiveRef.current) return;

      // Handle Z/X key release (frame adjustment)
      if (lowerKey === "z" || lowerKey === "x") {
        console.log('[Frame Adjust] Z/X key released:', lowerKey, 'keyHoldLocalRef.key:', keyHoldLocalRef.current.key);

        if (keyHoldLocalRef.current.key && keyHoldLocalRef.current.key !== key) {
          console.log('[Frame Adjust] keyUp: Different key, ignoring');
          return;
        }

        if (!keyHoldLocalRef.current.long) {
          console.log('[Frame Adjust] keyUp: Short press detected');

          // Use dragHandle from when key was pressed (stored in ref)
          const savedDragHandle = keyHoldLocalRef.current.dragHandle;
          if (!savedDragHandle || (savedDragHandle !== 'start' && savedDragHandle !== 'end')) {
            console.log('[Frame Adjust] No valid saved dragHandle:', savedDragHandle);
            clearHold();
            return;
          }

          // Short press: move by exactly 1 frame
          const frameDuration = keyHoldLocalRef.current.frameDuration || (1 / 30);
          const direction = keyHoldLocalRef.current.direction || (lowerKey === "x" ? 1 : -1);
          const delta = frameDuration * direction;

          console.log('[Frame Adjust] Short press details:');
          console.log('  - savedDragHandle:', savedDragHandle);
          console.log('  - frameDuration:', frameDuration);
          console.log('  - keyHoldLocalRef.current.direction:', keyHoldLocalRef.current.direction);
          console.log('  - calculated direction:', direction);
          console.log('  - delta:', delta);
          console.log('  - rangeStartRef.current:', rangeStartRef.current);
          console.log('  - rangeEndRef.current:', rangeEndRef.current);

          if (savedDragHandle === 'start') {
            const next = clamp(rangeStartRef.current + delta, 0, rangeEndRef.current - 0.05);
            console.log('[Frame Adjust] Moving start handle from', rangeStartRef.current, 'to', next, 'delta:', delta);
            setRangeStart(next);
            lastRangeStartRef.current = next;
            if (syncCardRange) {
              console.log('[Frame Adjust] Calling syncCardRange with', next, rangeEndRef.current);
              syncCardRange(next, rangeEndRef.current);
            }
            // Show adjustment info
            const fps = activeCard?.localFps || 30;
            const framesMoved = Math.round(Math.abs(delta) * fps);
            setFrameAdjustInfo({
              start: next,
              end: rangeEndRef.current,
              frames: framesMoved,
              direction: delta > 0 ? 'forward' : 'backward'
            });
            setTimeout(() => setFrameAdjustInfo(null), 1500);
            // 显示缩略图
            showFrameAdjustTip(next, 500);
          } else if (savedDragHandle === 'end') {
            const next = clamp(rangeEndRef.current + delta, rangeStartRef.current + 0.05, duration);
            console.log('[Frame Adjust] Moving end handle from', rangeEndRef.current, 'to', next, 'delta:', delta);
            setRangeEnd(next);
            if (syncCardRange) {
              console.log('[Frame Adjust] Calling syncCardRange with', rangeStartRef.current, next);
              syncCardRange(rangeStartRef.current, next);
            }
            // Show adjustment info
            const fps = activeCard?.localFps || 30;
            const framesMoved = Math.round(Math.abs(delta) * fps);
            setFrameAdjustInfo({
              start: rangeStartRef.current,
              end: next,
              frames: framesMoved,
              direction: delta > 0 ? 'forward' : 'backward'
            });
            setTimeout(() => setFrameAdjustInfo(null), 1500);
            // 显示缩略图
            showFrameAdjustTip(next, 500);
          }
        } else {
          // Long press: cancel the loop
          console.log('[Frame Adjust] Long press released, canceling loop');
          if (keyHoldLocalRef.current.raf) {
            cancelAnimationFrame(keyHoldLocalRef.current.raf);
          }
        }

        // 清除缩略图定时器
        if (frameAdjustTipTimerRef.current) {
          clearTimeout(frameAdjustTipTimerRef.current);
          frameAdjustTipTimerRef.current = null;
        }

        // Remove decimal highlight when Z/X is released
        if (setTimeHighlight) {
          setTimeHighlight(false);
        }

        // 恢复控制栏自动隐藏
        scheduleHideControls(2200);

        clearHold();
        return;
      }

      if (key !== "ArrowRight" && key !== "ArrowLeft") return;

      if (keyHoldLocalRef.current.key && keyHoldLocalRef.current.key !== key) return;

      const step = 5;

      if (!keyHoldLocalRef.current.long) {
        const delta = key === "ArrowRight" ? step : -step;
        const next = clamp(currentTimeRef.current + delta, rangeStartRef.current, rangeEndRef.current);
        seekPlayer(next);
      } else if (key === "ArrowRight") {
        const nextRate = keyHoldLocalRef.current.lastRate || 1;
        applyPlaybackRate(nextRate);
        if (!keyHoldLocalRef.current.wasPlaying && localVideoRef.current) {
          localVideoRef.current.pause();
          setIsPlayingState(false);
          setIsPlaying(false);
        }
      } else if (key === "ArrowLeft") {
        if (keyHoldLocalRef.current.raf) cancelAnimationFrame(keyHoldLocalRef.current.raf);
        if (keyHoldLocalRef.current.wasPlaying) {
          safePlay();
          setIsPlaying(true);
        }
      }

      clearHold();
    };



    const handleBlur = () => {

      if (keyHoldLocalRef.current.key === "ArrowRight" && keyHoldLocalRef.current.long) {

        const nextRate = keyHoldLocalRef.current.lastRate || 1;

        applyPlaybackRate(nextRate);

        if (!keyHoldLocalRef.current.wasPlaying && localVideoRef.current) {

          localVideoRef.current.pause();

          setIsPlayingState(false);

          setIsPlaying(false);

        }

      } else if (keyHoldLocalRef.current.key === "ArrowLeft" && keyHoldLocalRef.current.long) {

        if (keyHoldLocalRef.current.wasPlaying) {

          safePlay();

          setIsPlaying(true);

        }

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
    videoUrl,
    seekPlayer,
    togglePlay,
    safePlay,
    applyPlaybackRate,
    applyVolume,
    toggleMuteLocal,
    isMuted
  ]);



  // Show/hide frame adjustment hint when scrubbing timeline handles
  useEffect(() => {
    console.log('[Frame Hint] isScrubbing:', isScrubbing, 'dragHandle:', dragHandle);

    if (isScrubbing && dragHandle && (dragHandle === 'start' || dragHandle === 'end')) {
      console.log('[Frame Hint] Showing frame hint overlay');
      setShowFrameHint(true);
    } else {
      console.log('[Frame Hint] Hiding frame hint overlay');
      setShowFrameHint(false);
    }
  }, [isScrubbing, dragHandle]);


  // 鍏ㄥ眬鎷栧姩澶勭悊锛堝畬鍏ㄥ鍒禕绔欑殑RAF闃诲凹绯荤粺

  useEffect(() => {

    const scheduleDragSync = () => {
      if (dragSyncRef.current.pending) return;
      dragSyncRef.current.pending = true;
      const run = () => {
        if (!dragSyncRef.current.pending) return;
        dragSyncRef.current.pending = false;
        if (dragSyncRef.current.fallback) {
          clearTimeout(dragSyncRef.current.fallback);
          dragSyncRef.current.fallback = null;
        }
        const nextStart = sliderPosRef.current.start;
        const nextEnd = sliderPosRef.current.end;
        if (
          dragSyncRef.current.lastStart !== nextStart ||
          dragSyncRef.current.lastEnd !== nextEnd
        ) {
          dragSyncRef.current.lastStart = nextStart;
          dragSyncRef.current.lastEnd = nextEnd;
          setRangeStart(nextStart);
          setRangeEnd(nextEnd);
          lastRangeStartRef.current = nextStart;
          if (syncCardRange) {
            syncCardRange(nextStart, nextEnd);
          }
        }
      };
      requestAnimationFrame(run);
      dragSyncRef.current.fallback = setTimeout(run, 50);
    };


    // 搴旂敤鎷栧姩浣嶇疆锛堝甫闃诲凹骞虫粦锛?

    const applyDragAtX = (clientX) => {
      if (!dragRef.current.type || !timelineBarRef.current) return;

      // 閫氳繃ref鑾峰彇鏈€鏂板€硷紝閬垮厤闂寘闄烽槺
      const videoDuration = localVideoRef.current?.duration;
      const currentDuration =
        Number.isFinite(duration) && duration > 0
          ? duration
          : Number.isFinite(videoDuration) && videoDuration > 0
            ? videoDuration
            : Number.isFinite(rangeEnd) && rangeEnd > 0
              ? rangeEnd
              : 0;
      if (!currentDuration) return;


      const baseWidth = getBaseWidth();

      if (!baseWidth) return;


      // 鑰冭檻鎶撳彇鍋忕Щ

      const adjustedX = Number.isFinite(dragRef.current.grabOffset)

        ? clientX - dragRef.current.grabOffset

        : clientX;



      // 浣跨敤B绔欓鏍肩殑鍧愭爣杞崲

      const xBase = screenXToBaseX(adjustedX);

      const startBaseX = screenXToBaseX(dragRef.current.startX);



      // 璁＄畻delta锛堝熀鍑嗗潗鏍囩郴涓殑鍍忕礌宸級

      const deltaBaseX = xBase - startBaseX;

      const ratio = deltaBaseX / baseWidth;



      const deltaSeconds = ratio * currentDuration;



      if (dragRef.current.type === "playhead") {
        seekTo(adjustedX);
        return;
      }


      let nextStart = sliderPosRef.current.start;

      let nextEnd = sliderPosRef.current.end;

      clampActiveRef.current = false;



      if (dragRef.current.type === "range") {

        nextStart = dragRef.current.start + deltaSeconds;

        nextEnd = dragRef.current.end + deltaSeconds;

        if (nextStart > nextEnd) return;

      } else if (dragRef.current.type === "start") {

        const minSpan = getMinSpan(currentDuration, baseWidth);

        const tRaw = (xBase / baseWidth) * currentDuration;

        const minTime = nextEnd - minSpan;

        if (tRaw > minTime) {

          nextStart = minTime;

          clampActiveRef.current = true;

        } else {

          nextStart = tRaw;

        }

        if (nextStart < 0) nextStart = 0;

        showTipAt(adjustedX, nextStart);

      } else if (dragRef.current.type === "end") {

        const minSpan = getMinSpan(currentDuration, baseWidth);

        const tRaw = (xBase / baseWidth) * currentDuration;

        const minTime = nextStart + minSpan;

        if (tRaw < minTime) {

          nextEnd = minTime;

          clampActiveRef.current = true;

        } else {

          nextEnd = tRaw;

        }

        if (nextEnd > currentDuration) nextEnd = currentDuration;

        showTipAt(adjustedX, nextEnd);

      }



      // 鏇存柊ref锛堜笉瑙﹀彂React閲嶆覆鏌擄級

      sliderPosRef.current.start = nextStart;

      sliderPosRef.current.end = nextEnd;

      scheduleDragSync();



      // 鍏抽敭锛氭粦鍧椾綅缃敤鏈缉鏀剧殑鍍忕礌鍊硷紙婊戝潡鍦ㄧ缉鏀惧眰鍐咃紝浼氳嚜鍔ㄨ窡闅弔ransform锛?

      const xS = (nextStart / currentDuration) * baseWidth;

      const xE = (nextEnd / currentDuration) * baseWidth;



      if (startHandleRef.current) {

        startHandleRef.current.style.left = `${xS}px`;

      }

      if (endHandleRef.current) {

        endHandleRef.current.style.left = `${xE}px`;

      }



      // 鏇存柊閫夊尯bar

      const selectionEl = timelineClipRef.current?.querySelector('[data-role="selection"]')

        ?? timelineBarRef.current?.querySelector('[data-role="selection"]');

      if (selectionEl) {
        selectionEl.style.left = `${xS}px`;
        selectionEl.style.width = `${Math.max(0, xE - xS)}px`;
      }
      const now = performance.now();
      if (dragLogRef.current.enabled && now - dragLogRef.current.last > 120) {
        dragLogRef.current.last = now;
        console.log("[Drag] apply", {
          type: dragRef.current.type,
          clientX,
          adjustedX,
          xBase: xBase.toFixed(2),
          duration: currentDuration,
          nextStart: nextStart.toFixed(3),
          nextEnd: nextEnd.toFixed(3)
        });
      }
    };


    // RAF闃诲凹骞虫粦寰幆锛堝畬鍏ㄥ鍒禕绔欑殑tickDrag

    const tickDrag = () => {
      if (!dragRef.current.type) {
        dragRafRef.current = null;
        return;
      }
      const delta = dragRef.current.targetX - dragRef.current.smoothX;

      if (Math.abs(delta) < 0.15) {

        dragRef.current.smoothX = dragRef.current.targetX;

      } else {

        dragRef.current.smoothX += delta * dragRef.current.damp;

      }

      applyDragAtX(dragRef.current.smoothX);
      dragRafRef.current = requestAnimationFrame(tickDrag);
    };

    dragApplyRef.current = {
      applyDragAtX,
      startTick: () => {
        if (!dragRafRef.current) {
          dragRafRef.current = requestAnimationFrame(tickDrag);
        }
      }
    };

    const handleMove = (event) => {
      if (!dragRef.current.type) return;
      if (dragPidRef.current != null && Number.isFinite(event.pointerId)) {
        if (event.pointerId !== dragPidRef.current) return;
      }
      if (dragLogRef.current.enabled) {
        console.log("[Drag] move", {
          clientX: event.clientX,
          pointerId: Number.isFinite(event.pointerId) ? event.pointerId : null,
          type: dragRef.current.type
        });
      }


      // 鏇存柊鐩爣X浣嶇疆
      dragRef.current.targetX = event.clientX;


      // 璁＄畻鍨傜洿闃诲凹锛堝畬鍏ㄥ鍒禕绔欓€昏緫

      const maxLift = 200;

      const lift = clamp(dragRef.current.startY - event.clientY, 0, maxLift);

      const ratio = lift / maxLift;

      const eased = 1 - ratio;

      const damp = (0.02 + 0.98 * eased * eased) / 3;

      dragRef.current.damp = damp;



      // 鏇存柊瑙嗚鍘嬬缉/鎷変几鏁堟灉锛堢洿鎺ユ搷浣淒OM锛屼笉瑙﹀彂React閲嶆覆鏌擄級

      const dampNorm = clamp(damp * 3, 0, 1);

      const compress = clampActiveRef.current ? 1 : 0.7 + 0.3 * dampNorm;

      const widen = clampActiveRef.current ? 1 : Math.min(1.25, 1 / compress);



      // 鏇存柊ref

      dampStateRef.current.scale = compress;

      dampStateRef.current.width = widen;



      // 鐩存帴鏇存柊婊戝潡鐨凜SS鍙橀噺
      const activeHandle = dragRef.current.type === "start"
        ? startHandleRef.current
        : dragRef.current.type === "end"
        ? endHandleRef.current
        : null;


      if (activeHandle) {
        activeHandle.style.setProperty("--clip-damp-scale", compress.toFixed(3));
        activeHandle.style.setProperty("--clip-damp-width", widen.toFixed(3));
      }

      // 鐩存帴搴旂敤涓€娆℃嫋鍔紝骞剁敤闃诲凹骞虫粦
      const delta = dragRef.current.targetX - dragRef.current.smoothX;
      if (Math.abs(delta) < 0.15) {
        dragRef.current.smoothX = dragRef.current.targetX;
      } else {
        dragRef.current.smoothX += delta * dragRef.current.damp;
      }
      applyDragAtX(dragRef.current.smoothX);

      // 鍚姩RAF寰幆
      if (!dragRafRef.current) {
        dragRafRef.current = requestAnimationFrame(tickDrag);
      }
    };



    const handleUp = (event) => {
      if (dragPidRef.current != null && Number.isFinite(event?.pointerId)) {
        if (event.pointerId !== dragPidRef.current) return;
      }
      if (dragLogRef.current.enabled) {
        console.log("[Drag] up", {
          pointerId: Number.isFinite(event?.pointerId) ? event.pointerId : null,
          type: dragRef.current.type
        });
      }
      const wasDragging = !!dragRef.current.type;
      if (wasDragging) {
        // 鍙栨秷RAF寰幆
        if (dragRafRef.current) {
          cancelAnimationFrame(dragRafRef.current);
          dragRafRef.current = null;

        }



        // 鍚屾鍒癛eact鐘舵€侊紙鍙Е鍙戜竴娆￠噸娓叉煋

        const finalStart = sliderPosRef.current.start;

        const finalEnd = sliderPosRef.current.end;



        setRangeStart(finalStart);

        setRangeEnd(finalEnd);

        lastRangeStartRef.current = finalStart;



        // 鍚屾鍒癆pp缁勪欢

        if (syncCardRange) {

          syncCardRange(finalStart, finalEnd);

        }



        setIsScrubbing(false);

        setDragHandle(null);



        // 澶嶄綅闃诲凹鏍峰紡

        dampStateRef.current.scale = 1;

        dampStateRef.current.width = 1;

        if (startHandleRef.current) {

          startHandleRef.current.style.setProperty("--clip-damp-scale", "1");

          startHandleRef.current.style.setProperty("--clip-damp-width", "1");

        }

        if (endHandleRef.current) {

          endHandleRef.current.style.setProperty("--clip-damp-scale", "1");

          endHandleRef.current.style.setProperty("--clip-damp-width", "1");

        }

        // 鎵归噺鍚屾React鐘舵€侊紙鍙Е鍙戜竴娆￠噸娓叉煋锛?

        setDampScale(1);

        setDampWidth(1);



        const startChanged = lastRangeStartRef.current !== rangeStart;

        const absoluteTime = currentTime;

        const outOfRange = isOutsideRange(absoluteTime);



        if (startChanged && outOfRange) {

          seekPlayer(finalStart);

        }



        if (wasPlayingRef.current) {

          if (outOfRange) {

            seekPlayer(finalStart);

          }

          safePlay();

          setIsPlayingState(true);

          setIsPlaying(true);

        }



      }

      if (!wasDragging) return;

      // 閲嶇疆鎷栧姩鐘舵€?
      hideTip();
      document.body.style.cursor = "";
      suppressClampRef.current = false;
      clampNow();
      dragRef.current = {
        type: null,
        startX: 0,
        startY: 0,
        start: 0,
        end: 0,
        targetX: 0,
        smoothX: 0,
        damp: 1,
        grabOffset: 0
      };
      if (dragTargetRef.current && dragTargetRef.current.releasePointerCapture && dragPidRef.current != null) {
        try {
          dragTargetRef.current.releasePointerCapture(dragPidRef.current);
        } catch {}
      }
      dragTargetRef.current = null;
      dragPidRef.current = null;

      // 缂╂斁鍙湪缁撴潫鎷栧姩鍚庤Е鍙?
      applyAutoZoom(true);
    };


    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    window.addEventListener("blur", handleUp);
    window.addEventListener("pointermove", handleMove, true);
    window.addEventListener("pointerup", handleUp, true);
    window.addEventListener("pointercancel", handleUp, true);


    return () => {

      if (dragRafRef.current) {

        cancelAnimationFrame(dragRafRef.current);

      }

      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
      window.removeEventListener("blur", handleUp);
      window.removeEventListener("pointermove", handleMove, true);
      window.removeEventListener("pointerup", handleUp, true);
      window.removeEventListener("pointercancel", handleUp, true);
    };
  }, [duration, clampNow, syncCardRange, applyAutoZoom]); // 渚濊禆绋冲畾鍥炶皟涓巖ef璇诲彇鐨勬渶鏂?
  useEffect(() => {
    if (!showZoomBadge) return;
    if (zoomBadgeRef.current) {
      zoomBadgeRef.current.textContent = `缩放 x${zoomStateRef.current.zoomScale.toFixed(1)}`;
    }
    updateZoomBadgePosition();
  }, [showZoomBadge, updateZoomBadgePosition]);

  useEffect(() => {
    if (isScrubbing) return;
    if (zoomStateRef.current.zoomPending) {
      applyAutoZoom(true);
    }
  }, [isScrubbing, applyAutoZoom]);


  useEffect(() => {

    if (!timelineBarRef.current) return;

    const observer = new ResizeObserver(() => {

      zoomStateRef.current.baselineLeft = null;

      zoomStateRef.current.baselineWidth = null;

      const baseWidth = getBaseWidth();

      if (!duration || !baseWidth) return;

      const xS = (rangeStart / duration) * baseWidth;

      const xE = (rangeEnd / duration) * baseWidth;

      if (startHandleRef.current) {

        startHandleRef.current.style.left = `${xS}px`;

      }

      if (endHandleRef.current) {

        endHandleRef.current.style.left = `${xE}px`;

      }

      const selectionEl = timelineClipRef.current?.querySelector('[data-role="selection"]')

        ?? timelineBarRef.current?.querySelector('[data-role="selection"]');

      if (selectionEl) {

        selectionEl.style.left = `${xS}px`;

        selectionEl.style.width = `${Math.max(0, xE - xS)}px`;

      }

      if (zoomBandRef.current) {

        zoomBandRef.current.style.left = `${xS}px`;

        zoomBandRef.current.style.width = `${Math.max(0, xE - xS)}px`;

      }

      updateZoomBadgePosition();

    });

    observer.observe(timelineBarRef.current);

    return () => observer.disconnect();

  }, [duration, rangeStart, rangeEnd, getBaseWidth, updateZoomBadgePosition]);



  // 鍒濆鍖栨粦鍧椾綅缃紙浣跨敤鍍忕礌鍊硷紝涓嶣绔欎竴鑷达級

  useEffect(() => {

    if (!duration || !timelineBarRef.current) return;



    const baseWidth = getBaseWidth();

    if (!baseWidth) return;



    const xS = (rangeStart / duration) * baseWidth;

    const xE = (rangeEnd / duration) * baseWidth;



    if (startHandleRef.current) {

      startHandleRef.current.style.left = `${xS}px`;

    }

    if (endHandleRef.current) {

      endHandleRef.current.style.left = `${xE}px`;

    }



    const selectionEl = timelineClipRef.current?.querySelector('[data-role="selection"]')

      ?? timelineBarRef.current?.querySelector('[data-role="selection"]');

    if (selectionEl) {

      selectionEl.style.left = `${xS}px`;

      selectionEl.style.width = `${Math.max(0, xE - xS)}px`;

    }

    if (zoomBandRef.current) {

      zoomBandRef.current.style.left = `${xS}px`;

      zoomBandRef.current.style.width = `${Math.max(0, xE - xS)}px`;

    }



    // 鍒濆鍖栨挱鏀惧ご浣嶇疆

    if (playheadRef.current) {

      const zoomState = zoomStateRef.current;

      const { zoomScale, zoomTranslateX } = zoomState;

      const xPUnscaled = (currentTime / duration) * baseWidth;

      const xPScaled = xPUnscaled * zoomScale + zoomTranslateX;

      playheadRef.current.style.left = `${xPScaled}px`;

    }

    updateZoomBadgePosition();

  }, [duration, rangeStart, rangeEnd, getBaseWidth]);



  // 鍚屾currentTime鍒皉ef锛堜緵鎾斁澶碦AF寰幆浣跨敤

  useEffect(() => {

    currentTimeRef.current = currentTime;

  }, [currentTime]);



  // 鎾斁澶翠綅缃洿鏂帮紙浣跨敤RAF鎸佺画鏇存柊锛屼絾涓嶄緷璧朿urrentTime閬垮厤棰戠箒閲嶅缓

  useEffect(() => {

    if (!duration || !playheadRef.current || !timelineBarRef.current) return;



    let rafId = null;

    let lastCurrentTime = currentTime;



    const updatePlayhead = () => {

      if (!playheadRef.current || !timelineBarRef.current) return;



      // 鍙湪currentTime鐪熸鍙樺寲鏃舵洿

      if (currentTimeRef.current !== lastCurrentTime) {

        lastCurrentTime = currentTimeRef.current;



        const baseWidth = getBaseWidth();

        if (!baseWidth) return;



        const zoomState = zoomStateRef.current;

        const { zoomScale, zoomTranslateX } = zoomState;

        const xPUnscaled = (currentTimeRef.current / duration) * baseWidth;

        const xPScaled = xPUnscaled * zoomScale + zoomTranslateX;

        playheadRef.current.style.left = `${xPScaled}px`;

      }



      rafId = requestAnimationFrame(updatePlayhead);

    };



    rafId = requestAnimationFrame(updatePlayhead);



    return () => {

      if (rafId) {

        cancelAnimationFrame(rafId);

      }

    };

  }, [duration, getBaseWidth]);



  // 鏃堕棿杞存偓鍋滃鐞嗭紙瀹屽叏澶嶅埗B绔欓瑙堬級

  const handleTimelineHover = useCallback((event) => {

    if (!timelineRef.current || !duration) return;

    const rect = timelineRef.current.getBoundingClientRect();

    const computedStyle = window.getComputedStyle(timelineRef.current);

    const paddingLeft = parseFloat(computedStyle.paddingLeft) || 0;

    const paddingRight = parseFloat(computedStyle.paddingRight) || 0;

    const contentWidth = rect.width - paddingLeft - paddingRight;

    const ratio = clamp((event.clientX - rect.left - paddingLeft) / contentWidth, 0, 1);

    setHoverPercent(ratio * 100);

    const absoluteTime = ratio * duration;

    setHoverTime(absoluteTime);

    setIsHovering(true);

    showTipAt(event.clientX, absoluteTime);
    revealControls(2000);
  }, [duration, showTipAt, revealControls]);



  // ========== B绔欓鏍兼椂闂磋酱鏍稿績鍑芥暟缁撴潫 ==========



  // 褰撹棰戞椂闀挎敼鍙樻椂锛屽垵濮嬪寲鑼冨洿骞剁‘淇濇挱鏀句綅缃湪鍖洪棿

  useEffect(() => {

    if (duration > 0 && rangeEnd === 0) {

      setRangeEnd(duration);

      lastRangeStartRef.current = rangeStart;

    }



    // 濡傛灉褰撳墠鎾斁浣嶇疆涓嶅湪鍖洪棿鍐咃紝淇鍒皉angeStart

    if (localVideoRef.current && duration > 0) {

      const current = localVideoRef.current.currentTime;

      if (current < rangeStart || current > rangeEnd) {

        console.log('[浣嶇疆淇] 褰撳墠鏃堕棿', current, '涓嶅湪鍖洪棿[', rangeStart, ',', rangeEnd, ']锛屼慨姝ｅ埌', rangeStart);

        localVideoRef.current.currentTime = rangeStart;

        setCurrentTime(rangeStart);

      }

    }

  }, [duration, rangeStart, rangeEnd]);



  // 鏍煎紡鍖栨椂

  const formatTime = (seconds) => {

    if (!seconds || isNaN(seconds)) return '0:00';

    const mins = Math.floor(seconds / 60);

    const secs = Math.floor(seconds % 60);

    return `${mins}:${secs.toString().padStart(2, '0')}`;

  };



  useEffect(() => {

    let rafId = null;

    const tick = () => {

      clampNow();

      rafId = requestAnimationFrame(tick);

    };

    rafId = requestAnimationFrame(tick);

    return () => {

      if (rafId) cancelAnimationFrame(rafId);

    };

  }, [clampNow]);



  // 澶勭悊闊抽噺鍙樺寲

  const handleVolumeChange = (e) => {

    const vol = parseFloat(e.target.value);
    if (!Number.isFinite(vol)) return;
    applyVolume(vol);

  };



  // 澶勭悊鎾斁閫熷害鍙樺寲

  const handleRateChange = (e) => {

    const rate = parseFloat(e.target.value);

    setPlaybackRate(rate);

    if (localVideoRef.current) {

      localVideoRef.current.playbackRate = rate;

    }

  };



  if (isLoading) {

    return (

      <div className="player-surface" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', color: 'white', gap: '20px', background: '#000', borderRadius: '16px' }}>

        <div style={{ fontSize: '24px' }}>加载视频...</div>

      </div>

    );

  }



  if (error) {

    return (

      <div className="player-surface" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ff6b6b', background: '#000', borderRadius: '16px' }}>

        <div>加载失败：{error}</div>

      </div>

    );

  }



  return (

    <div

      className="player-surface"

      ref={playerSurfaceRef}

      tabIndex={0}

      onMouseDown={(event) => {
        playerActiveRef.current = true;
        event.currentTarget.focus();
        revealControls(2200);
      }}

      onMouseMove={() => {
        revealControls(2000);
      }}

      onMouseLeave={() => {
        scheduleHideControls(600);
      }}

      onTouchStart={(event) => {
        playerActiveRef.current = true;
        event.currentTarget.focus();
        revealControls(2200);
      }}

      onPointerDown={(event) => {
        playerActiveRef.current = true;
        event.currentTarget.focus();
        revealControls(2200);
      }}

      onFocusCapture={() => {

        playerActiveRef.current = true;

      }}

      onBlurCapture={() => {

        playerActiveRef.current = false;

      }}

      style={{

        width: '100%',

        height: '100%',

        background: '#000',

        borderRadius: '16px',

        overflow: 'hidden',

        position: 'relative',

        display: 'flex',

        flexDirection: 'column'

      }}

    >

      {/* Player controls */}

      <video

        ref={localVideoRef}

        src={videoUrl}

        className="local-video-player"

        style={{

          width: '100%',

          height: '100%',

          objectFit: 'contain',

          display: 'block',

          flex: 1

        }}

        onClick={(event) => {
          if (isScrubbing) return;
          togglePlay();
          revealControls(2200);
        }}

        onDoubleClick={(event) => {
          event.preventDefault();
          toggleFullscreen();
        }}

        onLoadedMetadata={() => {

          if (localVideoRef.current) {

            console.log('[鏈湴瑙嗛] onLoadedMetadata - 鏃堕暱:', localVideoRef.current.duration);

            setVideoDuration(localVideoRef.current.duration);

            setRangeEnd(localVideoRef.current.duration);

            setDuration(localVideoRef.current.duration);



            // 鑷姩鎾斁

            console.log("[LocalVideoPlayer] autoplay start");

            localVideoRef.current.currentTime = rangeStart;

            localVideoRef.current.play().then(() => {

              console.log('[鏈湴瑙嗛] 鑷姩鎾斁鎴愬姛');

              setIsPlayingState(true);

              setIsPlaying(true);

            }).catch(err => {

              console.error('[鏈湴瑙嗛] 鑷姩鎾斁澶辫触:', err);

            });

          }

        }}

        onTimeUpdate={() => {

          if (localVideoRef.current && dragHandle !== 'playhead') {

            const current = localVideoRef.current.currentTime;

            const clamped = clamp(current, rangeStart, rangeEnd);

            setCurrentTime(clamped);

          }

        }}

        onPlay={() => {

          console.log('[鏈湴瑙嗛] onPlay');

          setIsPlayingState(true);

          setIsPlaying(true);

        }}

        onPause={() => {

          console.log('[鏈湴瑙嗛] onPause');

          setIsPlayingState(false);

          setIsPlaying(false);

        }}

        onError={(e) => {

          console.error('[鏈湴瑙嗛] onError:', e);

        }}
      />

      {/* Player controls */}

      <div
        className={`local-player-overlay${controlsVisible ? "" : " is-hidden"}`}
      >

        {/* Player controls */}

        <div className="local-player-timeline">
          <div

            ref={timelineRef}

            className="timeline"

            onMouseDown={handleTimelineMouseDown}

            onMouseMove={handleTimelineHover}

            onMouseLeave={() => {
              setIsHovering(false);
              hideTip();
            }}

            style={{
              position: 'relative',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              cursor: 'pointer',
              userSelect: 'none',
              overflow: 'visible',
              padding: '0 12px',
              pointerEvents: 'auto'
            }}

          >

          {/* Player controls */}

          <div

            ref={timelineBarRef}

            className="timeline-bar"

            style={{

              position: 'absolute',

              left: 0,

              right: 0,

              height: isScrubbing ? '10px' : '6px',

              top: '50%',

              marginTop: isScrubbing ? '-5px' : '-3px', // 鍨傜洿灞呬腑琛ュ伩

              borderRadius: '999px',

              background: 'rgba(143, 152, 164, 0.7)',

              zIndex: 1,

              transition: isScrubbing ? 'none' : 'height 0.12s ease',

              // transform 鐢?applyZoomScaleToDOM 閫氳繃 setProperty 鍔ㄦ€佹帶鍒?

              transformOrigin: 'left center',

              overflow: 'visible' // 鍏佽婊戝潡瓒呭嚭杩涘害鏉¤寖鍥?

            }}

          >

          </div>



          <div

            ref={timelineClipRef}

            className="timeline-clip-layer"

            style={{

              position: 'absolute',

              left: 0,

              right: 0,

              height: isScrubbing ? '10px' : '6px',

              top: '50%',

              marginTop: isScrubbing ? '-5px' : '-3px',

              zIndex: 3,

              overflow: 'visible',

              pointerEvents: 'auto'

            }}

          >

            {/* Player controls */}

            <div

              ref={clipRootRef}

              className="__clip_root"

              style={{

                position: 'absolute',

                left: 0,

                right: 0,

                top: 0,

                bottom: 0,

                pointerEvents: 'auto',

                zIndex: 10

              }}

            >

              <div ref={zoomBandRef} className="__clip_zoom_band" />



              {/* Player controls */}

              <div

                data-role="selection"

                className="__clip_range"

                style={{

                  position: 'absolute',

                  top: '0',

                  bottom: '0',

                  left: '0',

                  width: '0',

                  height: isScrubbing ? '10px' : '6px',

                  borderRadius: '999px',

                  background: 'rgba(64, 196, 255, 0.45)',

                  boxShadow: '0 0 0 1px rgba(64, 196, 255, 0.75)',

                  cursor: 'default',

                  transition: isScrubbing ? 'none' : 'height 0.12s ease, box-shadow 0.12s ease',

                  // left width JS 鍔ㄦ€佹帶鍒讹紙鍍忕礌鍊硷級

                  zIndex: 1,

                  pointerEvents: 'none'

                }}
      />

      {/* Player controls */}

              <div
                ref={startHandleRef}
                data-role="start-handle"
                className={`__clip_handle __clip_start${isScrubbing && dragHandle === 'start' ? ' __clip_dragging' : ''}`}
                style={{
                  position: 'absolute',

                  top: '-10px',

                  pointerEvents: 'auto',

                  cursor: dragHandle === 'start' ? 'grabbing' : 'grab',

                  // left JS 鍔ㄦ€佹帶鍒讹紙鍍忕礌鍊硷級

                  zIndex: 2,

                  // CSS鍙橀噺绯荤粺锛?-clip-scale鐢盿pplyZoomScaleToDOM鐩存帴璁剧疆

                  '--clip-damp-width': isScrubbing && dragHandle === 'start' ? dampStateRef.current.width.toFixed(3) : dampWidth.toFixed(3),

                  '--clip-damp-scale': isScrubbing && dragHandle === 'start' ? dampStateRef.current.scale.toFixed(3) : dampScale.toFixed(3)
                }}
                onMouseDown={handleStartHandleMouseDown}
                onPointerDown={handleStartHandlePointerDown}
              />
{/* Player controls */}

              <div
                ref={endHandleRef}
                data-role="end-handle"
                className={`__clip_handle __clip_end${isScrubbing && dragHandle === 'end' ? ' __clip_dragging' : ''}`}
                style={{
                  position: 'absolute',

                  top: '-10px',

                  pointerEvents: 'auto',

                  cursor: dragHandle === 'end' ? 'grabbing' : 'grab',

                  // left JS 鍔ㄦ€佹帶鍒讹紙鍍忕礌鍊硷級

                  zIndex: 2,

                  // CSS鍙橀噺绯荤粺锛?-clip-scale鐢盿pplyZoomScaleToDOM鐩存帴璁剧疆

                  '--clip-damp-width': isScrubbing && dragHandle === 'end' ? dampStateRef.current.width.toFixed(3) : dampWidth.toFixed(3),

                  '--clip-damp-scale': isScrubbing && dragHandle === 'end' ? dampStateRef.current.scale.toFixed(3) : dampScale.toFixed(3)
                }}
                onMouseDown={handleEndHandleMouseDown}
                onPointerDown={handleEndHandlePointerDown}
              />

          </div>



          <div

            ref={zoomOverlayRef}

            className="__clip_zoom_overlay"

            style={{

              position: 'absolute',

              left: 0,

              right: 0,

              top: 0,

              bottom: 0,

              pointerEvents: 'none',

              zIndex: 4

            }}

          >

            {showZoomBadge && (

              <div ref={zoomBadgeRef} className="__clip_zoom_badge">

                缩放 x1.0

              </div>

            )}

            {showFrameHint && (

              <div

                ref={frameHintRef}

                className="__clip_frame_hint"

                style={{

                  position: 'absolute',

                  top: '50%',

                  left: '50%',

                  transform: 'translate(-50%, -50%)',

                  backgroundColor: 'rgba(0, 0, 0, 0.85)',

                  color: '#fff',

                  padding: '12px 20px',

                  borderRadius: '8px',

                  fontSize: '14px',

                  fontWeight: '500',

                  whiteSpace: 'nowrap',

                  pointerEvents: 'none',

                  zIndex: 10,

                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',

                  border: '1px solid rgba(255, 255, 255, 0.1)'

                }}

              >

                <div style={{ marginBottom: '4px', fontSize: '12px', opacity: 0.8 }}>帧精确调整</div>

                <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>

                  <span style={{ fontWeight: 'bold', color: '#4facfe' }}>Z</span>

                  <span>后退一帧</span>

                  <span style={{ fontWeight: 'bold', color: '#4facfe' }}>X</span>

                  <span>前进一帧</span>

                </div>

                <div style={{ marginTop: '6px', fontSize: '11px', opacity: 0.6 }}>长按可加速移动</div>

              </div>

            )}

            {frameAdjustInfo && (

              <div

                style={{

                  position: 'absolute',

                  bottom: '80px',

                  left: '50%',

                  transform: 'translateX(-50%)',

                  backgroundColor: 'rgba(79, 172, 254, 0.95)',

                  color: '#fff',

                  padding: '8px 16px',

                  borderRadius: '6px',

                  fontSize: '13px',

                  fontWeight: '600',

                  pointerEvents: 'none',

                  zIndex: 11,

                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.2)',

                  animation: 'fadeInOut 1.5s ease-in-out'

                }}

              >

                {frameAdjustInfo.direction === 'forward' ? '→' : '←'} 移动 {frameAdjustInfo.frames} 帧

                ({frameAdjustInfo.start.toFixed(2)}s - {frameAdjustInfo.end.toFixed(2)}s)

              </div>

            )}

            <div

              ref={clipTipRef}

              className="__clip_tip"

              style={{

                position: 'absolute',

                bottom: '52px',

                transform: 'translateX(-50%)',

                pointerEvents: 'none',

                display: 'none'

              }}

            >

              <img

                ref={clipTipImgRef}

                alt=""

                style={{

                  display: 'block',

                  width: '160px',

                  height: '90px',

                  objectFit: 'cover',

                  borderRadius: '6px',

                  background: 'rgba(255,255,255,0.12)',

                  visibility: 'hidden'

                }}
              />

              <div

                ref={clipTipTimeRef}

                style={{

                  marginTop: '6px',

                  textAlign: 'center',

                  fontFamily:

                    'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',

                  fontWeight: '600'

                }}
              >
                {formatTime(hoverTime)}
              </div>

            </div>

          </div>



          {/* Player controls */}

          <div

            ref={playheadRef}

            data-role="playhead"

            className="timeline-playhead"

            style={{

              position: 'absolute',

              width: '18px',

              height: '18px',

              borderRadius: '999px',

              background: '#ffffff',

              top: '50%',

              marginTop: '-9px',

              cursor: 'ew-resize',

              pointerEvents: 'auto',

              border: '2px solid #40c4ff',

              boxShadow: '0 0 0 8px rgba(64, 196, 255, 0.22)',

              transition: isScrubbing && dragHandle === 'playhead' ? 'none' : 'transform 0.12s ease, box-shadow 0.12s ease',

              zIndex: 0,

              opacity: 1,

              left: '0',

              transform: 'translateX(-50%)'

            }}
      />

      {/* Player controls */}

          <div

            className="timeline-label timeline-label-start"

            style={{

              position: 'absolute',

              top: '-24px',

              fontSize: '12px',

              color: 'rgba(255, 255, 255, 0.9)',

              background: 'rgba(0, 0, 0, 0.75)',

              padding: '2px 6px',

              borderRadius: '4px',

              pointerEvents: 'none',

              whiteSpace: 'nowrap',

              left: `${(rangeStart / (duration || 1)) * 100}%`,

              transform: 'translateX(-50%)'

            }}

          >

            {formatTime(rangeStart)}

          </div>

          <div

            className="timeline-label timeline-label-end"

            style={{

              position: 'absolute',

              top: '-24px',

              fontSize: '12px',

              color: 'rgba(255, 255, 255, 0.9)',

              background: 'rgba(0, 0, 0, 0.75)',

              padding: '2px 6px',

              borderRadius: '4px',

              pointerEvents: 'none',

              whiteSpace: 'nowrap',

              left: `${(rangeEnd / (duration || 1)) * 100}%`,

              transform: 'translateX(-50%)'

            }}

          >

            {formatTime(rangeEnd)}

          </div>

          </div>
        </div>



        <video

          ref={clipPreviewVideoRef}

          src={videoUrl}

          muted

          preload="auto"

          style={{ display: 'none' }}
        />

        <canvas ref={clipPreviewCanvasRef} style={{ display: 'none' }} />



        {/* Player controls */}

        <div className="local-player-controls">
        <div className="player-controls">
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button
              onClick={togglePlay}
              className="player-btn"
              style={{
                fontSize: '15px',
                width: '32px',
                height: '32px'
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.2)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)'}
            >
              {isPlaying ? (
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                  <rect x="3" y="3" width="4" height="10" rx="1" fill="currentColor" />
                  <rect x="9" y="3" width="4" height="10" rx="1" fill="currentColor" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M4 3.5L12.5 8 4 12.5V3.5Z" fill="currentColor" />
                </svg>
              )}
            </button>

            <div
              className="player-time"
              style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}
            >
              <span>{formatTime(currentTime)}</span>
              <span style={{ opacity: 0.5 }}>/</span>
              <span>{formatTime(duration)}</span>
            </div>

            <div className="segment-duration" style={{ fontSize: '12px', opacity: 0.8 }}>
              片段: {formatTime(rangeEnd - rangeStart)}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <input
              type="range"
              min={0}
              max={1}
              step={0.1}
              value={volume}
              onChange={handleVolumeChange}
              className="volume-slider"
              style={{
                width: '72px',
                height: '4px'
              }}
            />

            <select
              value={playbackRate}
              onChange={handleRateChange}
              className="rate-selector"
              style={{
                padding: '5px 8px',
                fontSize: '12px'
              }}
            >
              <option value={0.5}>0.5x</option>
              <option value={1}>1x</option>
              <option value={1.25}>1.25x</option>
              <option value={1.5}>1.5x</option>
              <option value={2}>2x</option>
              <option value={3}>3x</option>
            </select>

            <button
              type="button"
              className="player-btn"
              onClick={toggleFullscreen}
              title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
              style={{
                fontSize: '12px',
                width: '34px',
                height: '30px'
              }}
            >
              {isFullscreen ? (
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                  <path
                    d="M6 3H4.5V4.5H3V3a1 1 0 0 1 1-1h2V3ZM12 3V2h-2v1h1.5V4.5H13V3a1 1 0 0 0-1-1ZM3 11v2a1 1 0 0 0 1 1h2v-1H4.5V11H3Zm10 0h-1.5v2H10v1h2a1 1 0 0 0 1-1v-2Z"
                    fill="currentColor"
                  />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                  <path
                    d="M3 6V4a1 1 0 0 1 1-1h2v1H4.5V6H3Zm10 0V4.5H11V3h2a1 1 0 0 1 1 1v2h-1ZM3 10h1.5v1.5H6v1H4a1 1 0 0 1-1-1v-2Zm10 0h1v2a1 1 0 0 1-1 1h-2v-1h1.5V10Z"
                    fill="currentColor"
                  />
                </svg>
              )}
            </button>
          </div>
        </div>
        </div>

      </div>

    </div>

    </div>

  );

}






