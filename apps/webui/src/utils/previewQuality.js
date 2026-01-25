// 设置预览画质的 JavaScript 代码片段
export const setPreviewQualityCode = `
  (function() {
    try {
      const player = document.querySelector('.bpx-player-container');
      if (player && player.__player__) {
        const qualities = player.__player__.quality || [];
        // 尝试设置画质：优先360p(16)，其次480p(32)，最后720p(64)
        const quality16 = qualities.find(q => q.qn === 16);
        const quality32 = qualities.find(q => q.qn === 32);
        const quality64 = qualities.find(q => q.qn === 64);

        if (quality16) {
          player.__player__.switchQuality(16);
          console.log('[Preview] Quality set to 360p');
        } else if (quality32) {
          player.__player__.switchQuality(32);
          console.log('[Preview] Quality set to 480p');
        } else if (quality64) {
          player.__player__.switchQuality(64);
          console.log('[Preview] Quality set to 720p');
        }
      }

      // 限制视频元素尺寸以降低带宽
      const video = document.querySelector('video');
      if (video) {
        video.style.maxWidth = '640px';
        video.style.maxHeight = '360px';
      }
    } catch (e) {
      console.log('[Preview] Could not set quality:', e);
    }
  })();
`;
