import { useEffect } from "react";
import { setPreviewQualityCode } from "../utils/previewQuality.js";

export default function useCommunityPreviewWebview({
  webviewCommunityIds,
  communityCardResults,
  communityLoadingState,
  setCommunityLoadingState,
  setPreviewCurrentTime,
  markWebviewReady,
  hoveredCommunityId // 添加hover状态参数
}) {
  useEffect(() => {
    const initializedWebviews = new Set();

    webviewCommunityIds.forEach((cardId) => {
      if (initializedWebviews.has(cardId)) return;

      const card = communityCardResults.find((c) => c.id === cardId);
      if (!card) return;

      const webview = document.getElementById(`community-preview-${cardId}`);
      if (!webview) return;

      initializedWebviews.add(cardId);

      const handler = () => {
        // CRITICAL: Immediately pause video to prevent autoplay, regardless of hover state
        const currentWebview = document.getElementById(webview.id);
        if (!currentWebview) return;

        const pauseVideoWithRetry = (maxRetries = 5, delay = 100) => {
          const attemptPause = (retryCount) => {
            currentWebview.executeJavaScript(`
              (function() {
                const video = document.querySelector('video');
                if (video) {
                  video.pause();
                  console.log('[Preview] Video paused on attempt ` + retryCount + `');
                  return true;
                }
                return false;
              })();
            `).then((paused) => {
              if (!paused && retryCount < maxRetries) {
                console.log(`[Preview] Video not ready, retrying (${retryCount}/${maxRetries})...`);
                setTimeout(() => attemptPause(retryCount + 1), delay);
              } else if (!paused) {
                console.warn('[Preview] Failed to pause video after', maxRetries, 'attempts');
              }
            }).catch((err) => {
              console.warn('[Preview] Error pausing video:', err);
            });
          };
          attemptPause(1);
        };

        // First check if not hovered - pause and mark ready, then exit
        if (hoveredCommunityId !== cardId) {
          console.log(`[Preview] Card ${cardId} no longer hovered when dom-ready fired, pausing and skipping initialization`);

          // Pause the video with retry mechanism
          pauseVideoWithRetry();

          // Mark as ready for cleanup
          const webviewId = `community-preview-${cardId}`;
          markWebviewReady?.(webviewId);
          setCommunityLoadingState((prev) => new Map(prev).set(cardId, {
            ...prev.get(cardId),
            webviewLoading: false,
            webviewReady: true,
            webviewLoadTime: Date.now() - (communityLoadingState.get(cardId)?.webviewStartTime || Date.now())
          }));
          return;
        }

        // Mark webview as ready for playback control
        const webviewId = `community-preview-${cardId}`;
        markWebviewReady?.(webviewId);

        const loadTime = Date.now() - (communityLoadingState.get(cardId)?.webviewStartTime || Date.now());
        setCommunityLoadingState((prev) => new Map(prev).set(cardId, {
          ...prev.get(cardId),
          webviewLoading: false,
          webviewReady: true,
          webviewLoadTime: loadTime
        }));

        // Pause immediately to prevent any autoplay (with retry)
        pauseVideoWithRetry();

        const startTime = Number.isFinite(card.start) ? card.start : 0;
        const endTime = Number.isFinite(card.end) ? card.end : undefined;

        const initializeVideo = () => {
          // 检查是否还在hover状态
          if (hoveredCommunityId !== cardId) {
            console.log(`[Preview] Card ${cardId} no longer hovered, skipping initialization`);
            return;
          }

          const currentWebview = document.getElementById(webview.id);
          if (!currentWebview) {
            console.log("Community webview no longer exists, skipping initialization");
            return;
          }

          currentWebview.executeJavaScript(`            (function() {              const video = document.querySelector('video');              const player = document.querySelector('.bpx-player-container');              const controller = document.querySelector('.bpx-player-control-wrap');              const danmaku = document.querySelector('.bpx-player-dm-layer');              console.log('Initializing community video at:', ${startTime}, 'video:', !!video);              // 隐藏播放器控制器和弹幕              if (controller) {                controller.style.display = 'none';              }              if (danmaku) {                danmaku.style.display = 'none';              }              // 初始化视频：设置起始位置并暂停播放              if (video) {                video.pause();                // 不设置静音，保持声音正常                // 设置视频起始位置                video.currentTime = ${startTime};                const playPromise = null;                if (false) {                  playPromise.then(() => {                    // 自动播放成功后立即暂停并回到起始位置                    setTimeout(() => {                      video.pause();                      video.currentTime = ${startTime};                      video.muted = false; // 取消静音以获取完整体验                    }, 100);                  }).catch(err => {                    console.log('Autoplay prevented, trying alternative:', err);                    // 自动播放被阻止，尝试替代方案：静音播放                    video.muted = true;                    video.play().then(() => {                      setTimeout(() => {                        video.pause();                        video.currentTime = ${startTime};                      }, 100);                    }).catch(e => {                      console.error('Play failed:', e);                    });                  });                }                // 添加时间更新监听器以实现循环播放                video.addEventListener('timeupdate', function() {                  // 检查是否超出范围，超出则回到起始位置                  if (${endTime} !== undefined && video.currentTime >= ${endTime}) {                    video.currentTime = ${startTime};                    // 继续循环播放                    if (!video.paused) {                      video.play().catch(e => console.log('Auto-loop play failed:', e));                    }                  }                });              }              if (player) {                // 禁用默认控件和交互，实现自定义进度条                const controlWrap = player.querySelector('.bpx-player-control-wrap');                if (controlWrap) {                  controlWrap.style.pointerEvents = 'none';                }              }              return true;            })();          `).catch((err) => {
            console.error("Failed to initialize community webview:", err);
          });
        };

        // 延迟初始化，但要检查hover状态
        const scheduleInit = (delay) => {
          setTimeout(() => {
            if (hoveredCommunityId === cardId) {
              initializeVideo();
            }
          }, delay);
        };

        scheduleInit(500);
        scheduleInit(2000);

        // 设置预览画质为360p
        setTimeout(() => {
          // 再次检查hover状态
          if (hoveredCommunityId !== cardId) {
            return;
          }
          const currentWebview = document.getElementById(webview.id);
          if (!currentWebview) return;
          currentWebview.executeJavaScript(setPreviewQualityCode).catch(() => {});
        }, 1000);

        let updateInterval = null;

        const startTimeUpdate = () => {
          if (updateInterval) return;

          const updateTime = () => {
            const currentWebview = document.getElementById(webview.id);
            if (!currentWebview) {
              clearInterval(updateInterval);
              updateInterval = null;
              return;
            }

            currentWebview.executeJavaScript(`              (function() {                const video = document.querySelector('video');                return video ? video.currentTime : ${startTime};              })();            `).then((time) => {
              if (typeof time === "number") {
                setPreviewCurrentTime((prev) => new Map(prev).set(cardId, time));
              }
            }).catch((err) => {
              console.error("Time update error:", err);
            });
          };

          updateInterval = setInterval(updateTime, 500);
        };

        const readyTimer = setTimeout(() => {
          startTimeUpdate();
        }, 1500);

        return () => {
          clearTimeout(readyTimer);
          if (updateInterval) {
            clearInterval(updateInterval);
            updateInterval = null;
          }
        };
      };

      webview.addEventListener("dom-ready", handler);
    });

    return () => {
      initializedWebviews.forEach((cardId) => {
        const card = communityCardResults.find((c) => c.id === cardId);
        if (card) {
          const webview = document.getElementById(`community-preview-${cardId}`);
          if (webview) {
            // webview.style.opacity = '0';
          }
        }
      });
    };
  }, [
    webviewCommunityIds,
    communityLoadingState,
    communityCardResults,
    setCommunityLoadingState,
    setPreviewCurrentTime,
    markWebviewReady,
    hoveredCommunityId // 添加依赖
  ]);
}
