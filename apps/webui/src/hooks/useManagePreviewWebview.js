import { useEffect } from "react";
import { setPreviewQualityCode } from "../utils/previewQuality.js";

export default function useManagePreviewWebview({
  webviewManageIds,
  communityMyCards,
  manageLoadingState,
  setManageLoadingState,
  setPreviewCurrentTime,
  markWebviewReady
}) {
  useEffect(() => {
    const initializedWebviews = new Set();

    webviewManageIds.forEach((cardId) => {
      if (initializedWebviews.has(cardId)) return;

      const card = communityMyCards.find((c) => c.id === cardId);
      if (!card) return;

      const webview = document.getElementById(`manage-preview-${cardId}`);
      if (!webview) return;

      initializedWebviews.add(cardId);

      const handler = () => {
        // Mark webview as ready for playback control
        const webviewId = `manage-preview-${cardId}`;
        markWebviewReady?.(webviewId);

        const loadTime = Date.now() - (manageLoadingState.get(cardId)?.webviewStartTime || Date.now());
        setManageLoadingState((prev) => new Map(prev).set(cardId, {
          ...prev.get(cardId),
          webviewLoading: false,
          webviewReady: true,
          webviewLoadTime: loadTime
        }));

        const startTime = Number.isFinite(card.start) ? card.start : 0;
        const endTime = Number.isFinite(card.end) ? card.end : undefined;

        const initializeVideo = () => {
          const currentWebview = document.getElementById(webview.id);
          if (!currentWebview) {
            console.log("Webview no longer exists, skipping initialization");
            return;
          }

          webview.executeJavaScript(`            (function() {              const video = document.querySelector('video');              const player = document.querySelector('.bpx-player-container');              const controller = document.querySelector('.bpx-player-control-wrap');              const danmaku = document.querySelector('.bpx-player-dm-layer');              console.log('Initializing video at:', ${startTime}, 'video:', !!video);              // 闂呮劘妫岄幘顓熸杹閸ｃ劍锟?             if (controller) {                controller.style.display = 'none';              }              if (danmaku) {                danmaku.style.display = 'none';              }              // 鐠哄疇娴嗛崚鎷屾崳婵缍呯純顔艰嫙閹绢厽鏂佹禒銉︽▔缁€铏规暰闂堫晜n              if (video) {                video.pause(); // 仅暂停，不设置静音                // 閸忓牊鎸遍弨鍙ヤ簰閸旂姾娴囬悽濠氭桨                video.currentTime = ${startTime};                video.pause();                const playPromise = null;                if (false) {                  playPromise.then(() => {                    // 閹绢厽鏂侀幋鎰閸氬海鐝涢崡铏畯閸嬫泛n                    setTimeout(() => {                      video.pause();                      video.currentTime = ${startTime};                      video.muted = false; // 閹垹顦查棅鎶藉櫤                    }, 100);                  }).catch(err => {                    console.log('Autoplay prevented, trying alternative:', err);                    // 婵″倹鐏夐懛顏勫З閹绢厽鏂佺悮顐︽▎濮濐澁绱濈亸婵婄槸闂堟瑩鐓堕幘顓熸杹                    video.muted = true;                    video.play().then(() => {                      setTimeout(() => {                        video.pause();                        video.currentTime = ${startTime};                      }, 100);                    }).catch(e => {                      console.error('Play failed:', e);                    });                  });                }                // 濞ｈ濮為幘顓熸杹閼煎啫娲梽鎰煑閸滃本妞傞梻瀛樻纯                video.addEventListener('timeupdate', function() {                  // 闁氨鐓￠悥鍓佺矋娴犺埖娲弬鐗堟                  if (window.electronIPC) {                    window.electronIPC.sendMessage('preview-timeupdate', {                      cardId: '${cardId}',                      currentTime: video.currentTime,                      startTime: ${startTime},                      endTime: ${endTime}                    });                  }                  // 瀵邦亞骞嗛幘顓熸杹閿涙艾鍩屾潏鍓х波閺夌喐妞傞崶鐐插煂鐠у嘲顫愭担宥囩枂                  if (${endTime} !== undefined && video.currentTime >= ${endTime}) {                    video.currentTime = ${startTime};                    // 婵″倹鐏夌憴鍡涱暥濮濓絽婀幘顓熸杹閿涘瞼鎴风紒顓熸尡閺€缍穘                    if (!video.paused) {                      video.play().catch(e => console.log('Auto-loop play failed:', e));                    }                  }                });              }              if (player) {                // 閸欘亞顩﹂悽銊﹀付閸掕埖鐖惃鍕仯閸戜紮绱濇穱婵堟殌鐟欏棝顣堕崠鍝勭厵閻ㄥ嫪锟?               const controlWrap = player.querySelector('.bpx-player-control-wrap');                if (controlWrap) {                  controlWrap.style.pointerEvents = 'none';                }              }              return {                video: !!video,                currentTime: video ? video.currentTime : 0              };            })();          `).then((result) => {
            console.log("Webview initialized:", result);
          }).catch((err) => {
            console.error("Failed to initialize webview:", err);
          });
        };

        setTimeout(initializeVideo, 500);
        setTimeout(initializeVideo, 2000);

        // 设置预览画质为360p
        setTimeout(() => {
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

      return () => {
        webview.removeEventListener("dom-ready", handler);
      };
    });
  }, [
    webviewManageIds,
    manageLoadingState,
    communityMyCards,
    setManageLoadingState,
    setPreviewCurrentTime,
    markWebviewReady
  ]);
}
