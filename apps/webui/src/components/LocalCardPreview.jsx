import { useEffect, useRef, useState } from "react";

export default function LocalCardPreview({
  card,
  videoId,
  className = "",
  muted = true,
  controls = false,
  isHovered = false,
  onTimeUpdate
}) {
  const [videoUrl, setVideoUrl] = useState("");
  const [loadError, setLoadError] = useState("");
  const videoRef = useRef(null);
  const isSeekingRef = useRef(false); // 添加标记防止循环时重复触发

  useEffect(() => {
    let active = true;
    let objectUrl = "";
    setVideoUrl("");
    setLoadError("");

    if (!card?.localPath) return undefined;

    console.log('[LocalCardPreview] Loading local video:', card.localPath);

    window.localVideo?.load(card.localPath).then((arrayBuffer) => {
      if (!active) return;
      console.log('[LocalCardPreview] Video loaded, size:', arrayBuffer.byteLength);
      const blob = new Blob([arrayBuffer], { type: "video/mp4" });
      objectUrl = URL.createObjectURL(blob);
      setVideoUrl(objectUrl);
    }).catch((err) => {
      if (!active) return;
      console.error('[LocalCardPreview] Load failed:', err);
      setLoadError(err?.message || "本地预览加载失败。");
    });

    return () => {
      active = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [card?.localPath]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoUrl) return;

    const startTime = Number.isFinite(card?.start) ? card.start : 0;
    const endTime = Number.isFinite(card?.end) ? card.end : null;

    console.log('[LocalCardPreview] Component loaded with time range:', {
      startTime,
      endTime,
      duration: endTime ? endTime - startTime : 'no end',
      videoDuration: video.duration
    });

    // 如果结束时间小于等于开始时间+0.5秒，禁用循环
    if (endTime !== null && endTime <= startTime + 0.5) {
      console.warn('[LocalCardPreview] Invalid time range, loop disabled:', { startTime, endTime });
    }

    // 等待视频准备好再设置时间
    const setupVideoPosition = () => {
      console.log('[LocalCardPreview] setupVideoPosition called, readyState:', video.readyState);

      if (video.readyState >= 1) { // HAVE_METADATA
        console.log('[LocalCardPreview] Setting initial position to', startTime);
        video.currentTime = startTime;

        // 等待 seek 完成
        const waitForSeek = () => {
          console.log('[LocalCardPreview] Initial seek completed, currentTime:', video.currentTime);
          // 移除 onTimeUpdate 调用，避免无限循环
        };

        // 监听一次 seeked 事件
        video.addEventListener('seeked', waitForSeek, { once: true });
      }
    };

    if (video.readyState >= 1) {
      setupVideoPosition();
    } else {
      video.addEventListener('loadedmetadata', setupVideoPosition, { once: true });
    }
  }, [card?.start, card?.end, videoUrl]); // 移除 onTimeUpdate 依赖

  const handleLoadedMetadata = () => {
    const video = videoRef.current;
    if (!video) return;
    const startTime = Number.isFinite(card?.start) ? card.start : 0;

    console.log('[LocalCardPreview] Metadata loaded, setting currentTime to', startTime);
    video.currentTime = startTime;

    // 确保该帧被加载
    if (video.readyState < 2) {
      console.log('[LocalCardPreview] Waiting for data to be loaded...');
      const handleSeeked = () => {
        console.log('[LocalCardPreview] Seek complete, currentTime:', video.currentTime);
        onTimeUpdate?.(video.currentTime);
        video.removeEventListener('seeked', handleSeeked);
      };
      video.addEventListener('seeked', handleSeeked);
      return;
    }

    onTimeUpdate?.(startTime);

    // 确保静音，以便自动播放
    video.muted = true;
  };

  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video || isSeekingRef.current) return;

    const current = video.currentTime;
    onTimeUpdate?.(current);

    const endTime = Number.isFinite(card?.end) ? card.end : null;
    const startTime = Number.isFinite(card?.start) ? card.start : 0;

    // 只有当有明确的结束时间，且结束时间大于开始时间时才循环
    // 添加0.1秒容差，确保视频真正播放到了接近结束的位置
    if (endTime !== null && endTime > startTime + 0.5 && current >= endTime - 0.1) {
      console.log('[LocalCardPreview] Looping:', {
        current,
        endTime,
        startTime,
        duration: video.duration
      });

      isSeekingRef.current = true;
      video.currentTime = startTime;

      // seek 完成后重置标记
      const resetSeeking = () => {
        isSeekingRef.current = false;
        video.removeEventListener('seeked', resetSeeking);
      };
      video.addEventListener('seeked', resetSeeking, { once: true });
    }
  };

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoUrl) return;

    console.log('[LocalCardPreview] Hover state changed:', isHovered, 'readyState:', video.readyState, 'currentTime:', video.currentTime);

    if (isHovered) {
      // 确保视频位置正确
      const startTime = Number.isFinite(card?.start) ? card.start : 0;

      // 定义播放函数
      const attemptPlay = () => {
        console.log('[LocalCardPreview] Attempting to play from', startTime, 'current:', video.currentTime);

        // 确保在正确位置
        if (Math.abs(video.currentTime - startTime) > 0.5) {
          video.currentTime = startTime;
        }

        // 尝试播放
        const playPromise = video.play();
        if (playPromise) {
          playPromise.then(() => {
            console.log('[LocalCardPreview] Playback started successfully');
          }).catch((err) => {
            console.warn('[LocalCardPreview] Autoplay failed:', err.name, err.message);
          });
        }
      };

      // 根据视频准备状态决定何时播放
      if (video.readyState < 2) {
        // 视频还没准备好，等待 canplay 事件
        console.log('[LocalCardPreview] Video not ready (readyState:', video.readyState, '), waiting for canplay...');
        const handleCanPlay = () => {
          console.log('[LocalCardPreview] CanPlay event fired, readyState:', video.readyState);
          attemptPlay();
          video.removeEventListener('canplay', handleCanPlay);
        };

        video.addEventListener('canplay', handleCanPlay);

        return () => {
          video.removeEventListener('canplay', handleCanPlay);
        };
      } else {
        // 视频已准备好，直接播放
        console.log('[LocalCardPreview] Video ready, attempting playback');
        attemptPlay();
      }
      return;
    }

    // 非 hover 状态，暂停并重置
    console.log('[LocalCardPreview] Not hovered, pausing and resetting');
    video.pause();
    const startTime = Number.isFinite(card?.start) ? card.start : 0;
    if (Number.isFinite(startTime)) {
      video.currentTime = startTime;
      // 移除 onTimeUpdate 调用，避免无限循环
    }
  }, [isHovered, videoUrl, card?.start]); // 移除 onTimeUpdate 依赖

  if (!card?.localPath) return null;

  if (!videoUrl && loadError) {
    return (
      <div className="preview-placeholder">
        <div className="preview-placeholder-content">
          <div className="preview-placeholder-icon"></div>
          <div className="preview-placeholder-text">本地预览失败</div>
        </div>
      </div>
    );
  }

  if (!videoUrl) {
    return (
      <div className="preview-placeholder">
        <div className="preview-placeholder-content">
          <div className="preview-placeholder-icon"></div>
          <div className="preview-placeholder-text">本地预览加载中...</div>
        </div>
      </div>
    );
  }

  return (
    <video
      id={videoId}
      ref={videoRef}
      src={videoUrl}
      className={className}
      muted={muted}
      controls={controls}
      preload="auto"
      playsInline
      onLoadedMetadata={handleLoadedMetadata}
      onTimeUpdate={handleTimeUpdate}
      onLoadedData={() => {
        console.log('[LocalCardPreview] Loaded data, readyState:', videoRef.current?.readyState);
      }}
      onCanPlay={() => {
        console.log('[LocalCardPreview] Can play, readyState:', videoRef.current?.readyState);
      }}
      onCanPlayThrough={() => {
        console.log('[LocalCardPreview] Can play through');
      }}
      onSeeked={() => {
        console.log('[LocalCardPreview] Seeked to:', videoRef.current?.currentTime);
      }}
      onLoadStart={() => {
        console.log('[LocalCardPreview] Load start');
      }}
      onPlaying={() => {
        console.log('[LocalCardPreview] Now playing');
      }}
      onPause={() => {
        console.log('[LocalCardPreview] Paused');
      }}
    />
  );
}
