import { useEffect } from "react";

export default function useDetailWebview({
  detailCard,
  setDetailWebviewLoading,
  setDetailWebviewLoadStartTime,
  patchWebviewIframeHeight
}) {
  useEffect(() => {
    if (!detailCard) return;

    setDetailWebviewLoading(true);
    setDetailWebviewLoadStartTime(Date.now());

    const webviewId = `detail-preview-${detailCard.bvid}`;
    const webview = document.getElementById(webviewId);
    if (!webview) return;

    const handler = () => {
      console.log("Detail webview dom-ready");

      patchWebviewIframeHeight(webview);
      setDetailWebviewLoading(false);

      const startTime = Number.isFinite(detailCard.start) ? detailCard.start : 0;
      const endTime = Number.isFinite(detailCard.end) ? detailCard.end : undefined;

      const initializeVideo = () => {
        const currentWebview = document.getElementById(webviewId);
        if (!currentWebview) {
          console.log("Detail webview no longer exists, skipping initialization");
          return;
        }

        currentWebview.executeJavaScript(`          (function() {            const video = document.querySelector('video');            const player = document.querySelector('#bilibili-player');            if (video) {              // 设置起位?             video.currentTime = ${startTime};              video.pause().catch(e => console.log('Auto-pause failed:', e));              // 添加撔范围限制（循玒放）              video.addEventListener('timeupdate', function() {                // 徎撔：到达结束时回到起位置                if (${endTime} !== undefined && video.currentTime >= ${endTime}) {                  video.currentTime = ${startTime};                  // 如果视正在撔，继绒放\n                  if (!video.paused) {                    video.play().catch(e => console.log('Auto-loop play failed:', e));                  }                }              });            }            if (player) {              // 用控制栏的点击，保留视区域的?             const controlWrap = player.querySelector('.bpx-player-control-wrap');              if (controlWrap) {                controlWrap.style.pointerEvents = 'none';              }            }            return true;          })();        `).catch((err) => {
          console.error("Failed to initialize detail webview:", err);
        });
      };

      setTimeout(initializeVideo, 500);
      setTimeout(initializeVideo, 2000);
    };

    webview.addEventListener("dom-ready", handler);

    return () => {
      webview.removeEventListener("dom-ready", handler);
    };
  }, [detailCard, patchWebviewIframeHeight, setDetailWebviewLoadStartTime, setDetailWebviewLoading]);
}
