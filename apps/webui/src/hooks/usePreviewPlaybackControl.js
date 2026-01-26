import { useCallback, useRef } from "react";

export default function usePreviewPlaybackControl() {
  // 跟踪已准备好的 webview
  const readyWebviews = useRef(new Set());

  const setWebviewPreviewPlayback = useCallback((cardId, startTime, shouldPlay, endTime) => {
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
    const end = Number.isFinite(endTime) ? endTime : null;

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
          const end = ${JSON.stringify(end)};

          console.log('[PreviewPlayback] Found video, shouldPlay:', shouldPlay, ', start:', start, ', end:', end, ', currentTime:', video.currentTime, ', paused:', video.paused);

          // 标记是否需要取消静音
          const shouldUnmute = video.muted;

          // 移除之前的监听器（如果存在）
          if (video._previewTimeUpdateHandler) {
            video.removeEventListener('timeupdate', video._previewTimeUpdateHandler);
            video._previewTimeUpdateHandler = null;
          }

          if (shouldPlay) {
            // 首先静音以确保能自动播放
            video.muted = true;

            // 设置播放位置
            if (Math.abs(video.currentTime - start) > 0.5) {
              video.currentTime = start;
              console.log('[PreviewPlayback] Seeked to', start);
            }

            // 如果有结束时间，添加监听器限制播放范围
            if (end !== null) {
              video._previewTimeUpdateHandler = function() {
                if (video.currentTime >= end) {
                  video.pause();
                  video.currentTime = start;
                  console.log('[PreviewPlayback] Reached end time', end, ', resetting to', start);
                }
              };
              video.addEventListener('timeupdate', video._previewTimeUpdateHandler);
              console.log('[PreviewPlayback] Added timeupdate listener, end time:', end);
            }

            // 尝试播放
            const playPromise = video.play();
            if (playPromise) {
              playPromise.then(() => {
                console.log('[PreviewPlayback] Playback started successfully');

                // 播放成功后，尝试取消静音
                setTimeout(() => {
                  video.muted = false;
                  console.log('[PreviewPlayback] Unmuted video after successful playback');
                }, 100);
              }).catch((err) => {
                console.warn('[PreviewPlayback] Play failed:', err.name, err.message);
                // 如果播放失败，保持静音状态
              });
            }
          } else {
            // 暂停并重置到起始位置
            video.pause();
            if (Math.abs(video.currentTime - start) > 0.5) {
              video.currentTime = start;
              console.log('[PreviewPlayback] Reset to', start);
            }

            // 移除监听器
            if (video._previewTimeUpdateHandler) {
              video.removeEventListener('timeupdate', video._previewTimeUpdateHandler);
              video._previewTimeUpdateHandler = null;
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
