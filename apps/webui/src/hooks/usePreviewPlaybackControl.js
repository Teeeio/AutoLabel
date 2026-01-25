import { useCallback, useRef } from "react";

export default function usePreviewPlaybackControl() {
  // 跟踪已准备好的 webview
  const readyWebviews = useRef(new Set());

  const setWebviewPreviewPlayback = useCallback((cardId, startTime, shouldPlay) => {
    const webviewId = `manage-preview-${cardId}`;
    const webview =
      document.getElementById(webviewId) ||
      document.getElementById(`community-preview-${cardId}`);

    if (!webview) {
      console.warn('[PreviewPlayback] Webview not found for card:', cardId);
      return;
    }

    // 检查 webview 是否已经准备好（dom-ready 已触发）
    if (!readyWebviews.current.has(webviewId)) {
      console.warn('[PreviewPlayback] Webview not ready yet, card:', cardId);
      return;
    }

    const start = Number.isFinite(startTime) ? startTime : 0;

    try {
      webview.executeJavaScript(`
        (function() {
          const video = document.querySelector('video');
          if (!video) {
            console.warn('[PreviewPlayback] Video element not found');
            return false;
          }

          const shouldPlay = ${JSON.stringify(shouldPlay)};
          const start = ${JSON.stringify(start)};

          console.log('[PreviewPlayback] Found video, shouldPlay:', shouldPlay, ', start:', start, ', currentTime:', video.currentTime, ', paused:', video.paused);

          // 确保视频静音以便自动播放
          if (video.muted !== true) {
            video.muted = true;
            console.log('[PreviewPlayback] Muted video for autoplay');
          }

          if (shouldPlay) {
            // 设置播放位置
            if (Math.abs(video.currentTime - start) > 0.5) {
              video.currentTime = start;
              console.log('[PreviewPlayback] Seeked to', start);
            }

            // 尝试播放
            const playPromise = video.play();
            if (playPromise) {
              playPromise.then(() => {
                console.log('[PreviewPlayback] Playback started successfully');
              }).catch((err) => {
                console.warn('[PreviewPlayback] Play failed:', err.name, err.message);
              });
            }
          } else {
            // 暂停并重置到起始位置
            video.pause();
            if (Math.abs(video.currentTime - start) > 0.5) {
              video.currentTime = start;
              console.log('[PreviewPlayback] Reset to', start);
            }
            console.log('[PreviewPlayback] Paused and reset');
          }
          return true;
        })();
      `).catch((err) => {
        console.warn('[PreviewPlayback] executeJavaScript failed:', err);
      });
    } catch (err) {
      console.warn('[PreviewPlayback] Failed to execute JavaScript:', err);
    }
  }, []);

  // 标记 webview 为已准备
  const markWebviewReady = useCallback((webviewId) => {
    readyWebviews.current.add(webviewId);
    console.log('[PreviewPlayback] Webview marked as ready:', webviewId);
  }, []);

  return { setWebviewPreviewPlayback, markWebviewReady };
}
