// 播放哨兵 - 定期检查所有社区卡片预览的播放状态
// 如果发现未hover的卡片在播放，立即暂停

class PlaybackSentinel {
  constructor() {
    this.checkInterval = null;
    this.checkIntervalMs = 500; // 每500ms检查一次
    this.isRunning = false;
  }

  // 获取当前hover的卡片ID
  getHoveredCardId() {
    return window.__hoveredCommunityId || null;
  }

  // 检查并暂停未hover的视频
  checkAndPauseUnhovered() {
    const hoveredCardId = this.getHoveredCardId();
    const hoveredManageId = window.__hoveredManageId || null;

    // 获取所有社区预览webview和管理页面预览webview
    const communityWebviews = document.querySelectorAll('webview[id^="community-preview-"]');
    const manageWebviews = document.querySelectorAll('webview[id^="manage-preview-"]');

    // 检查社区页面卡片
    communityWebviews.forEach((webview) => {
      const cardId = webview.getAttribute('data-card-id');
      if (!cardId) return;

      // 如果这个webview对应的卡片没有被hover，检查是否在播放
      if (cardId !== hoveredCardId) {
        this.checkAndPauseWebview(webview, cardId);
      }
    });

    // 检查管理页面卡片
    manageWebviews.forEach((webview) => {
      const cardId = webview.getAttribute('data-card-id');
      if (!cardId) return;

      // 如果这个webview对应的卡片没有被hover，检查是否在播放
      if (cardId !== hoveredManageId) {
        this.checkAndPauseWebview(webview, cardId);
      }
    });
  }

  // 检查单个webview并暂停
  checkAndPauseWebview(webview, cardId) {
    if (!webview.getURL()) return; // webview还未加载

    webview.executeJavaScript(`
      (function() {
        const video = document.querySelector('video');
        if (!video) return { playing: false, hasVideo: false };

        const isPlaying = !video.paused && !video.ended && video.currentTime > 0;
        return {
          playing: isPlaying,
          hasVideo: true,
          currentTime: video.currentTime,
          paused: video.paused
        };
      })();
    `).then((result) => {
      if (result && result.hasVideo && result.playing) {
        console.log(`[Sentinel] Card ${cardId} is playing without hover, pausing...`);
        this.forcePause(webview, cardId);
      }
    }).catch((err) => {
      // 忽略错误（webview可能还未准备好）
    });
  }

  // 强制暂停视频
  forcePause(webview, cardId) {
    webview.executeJavaScript(`
      (function() {
        const video = document.querySelector('video');
        if (video) {
          video.pause();
          console.log('[Sentinel] Force paused video for card ` + cardId + `');
          return true;
        }
        return false;
      })();
    `).catch((err) => {
      console.warn(`[Sentinel] Failed to pause card ${cardId}:`, err);
    });
  }

  // 启动哨兵
  start() {
    if (this.isRunning) {
      console.warn('[Sentinel] Already running');
      return;
    }

    console.log('[Sentinel] Starting playback sentinel');
    this.isRunning = true;
    this.checkInterval = setInterval(() => {
      this.checkAndPauseUnhovered();
    }, this.checkIntervalMs);
  }

  // 停止哨兵
  stop() {
    if (!this.isRunning) {
      return;
    }

    console.log('[Sentinel] Stopping playback sentinel');
    this.isRunning = false;
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  // 设置当前hover的卡片ID（供外部调用）
  setHoveredCardId(cardId) {
    window.__hoveredCommunityId = cardId || null;
  }
}

// 导出单例
export const playbackSentinel = new PlaybackSentinel();
