import { useEffect } from "react";

export default function useDetailWebview({
  detailCard,
  setDetailWebviewLoading,
  setDetailWebviewLoadStartTime,
  patchWebviewIframeHeight,
  setCurrentTime
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

      console.log('[Detail Webview] Sending seek command via IPC:', startTime);

      // 通过IPC发送seek命令，而不是直接执行JavaScript
      webview.send("player:command", { type: "seek", time: startTime });

      // 通过IPC发送range命令设置播放范围
      if (endTime !== undefined) {
        webview.send("player:command", { type: "range", start: startTime, end: endTime });
      }

      // 通过IPC发送pause命令确保视频暂停
      webview.send("player:command", { type: "pause" });
    };

    webview.addEventListener("dom-ready", handler);

    return () => {
      webview.removeEventListener("dom-ready", handler);
    };
  }, [detailCard, patchWebviewIframeHeight, setDetailWebviewLoadStartTime, setDetailWebviewLoading]);

  // 监听webview发送的player:state消息，同步currentTime
  useEffect(() => {
    if (!detailCard) return;

    const webviewId = `detail-preview-${detailCard.bvid}`;
    const webview = document.getElementById(webviewId);
    if (!webview) return;

    const handlePlayerState = (event) => {
      console.log('[Detail Webview] Received ipc-message:', event.channel, event.args);

      if (event.channel !== "player:state") return;

      const payload = event.args?.[0] || {};
      console.log('[Detail Webview] Received player:state payload:', payload);

      if (Number.isFinite(payload.currentTime)) {
        console.log('[Detail Webview] Setting currentTime to:', payload.currentTime);
        setCurrentTime(payload.currentTime);
      }
    };

    webview.addEventListener("ipc-message", handlePlayerState);

    console.log('[Detail Webview] Added ipc-message listener to webview:', webviewId);

    return () => {
      webview.removeEventListener("ipc-message", handlePlayerState);
      console.log('[Detail Webview] Removed ipc-message listener from webview:', webviewId);
    };
  }, [detailCard, setCurrentTime]);
}
