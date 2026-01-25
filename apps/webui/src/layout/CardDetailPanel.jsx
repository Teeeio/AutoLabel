import { useEffect } from "react";
import LocalVideoPlayer from "../components/LocalVideoPlayer";

export default function CardDetailPanel({ card, onClose, app }) {
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  if (!card) return null;

  const isLocal = card.source === "local";

  // 标准化标签为数组
  const normalizeTags = (tags) => {
    if (Array.isArray(tags)) return tags;
    if (typeof tags === "string") return tags.split(",").map(t => t.trim()).filter(Boolean);
    return [];
  };

  const tags = normalizeTags(card.tags);
  const clipTags = normalizeTags(card.clipTags);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal--detail" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">卡片详情</div>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="关闭"
          >
            ×
          </button>
        </div>

        <div className="modal-body modal-body--detail">
          <div className="detail-layout">
            {/* 左侧：预览播放器 */}
            <div className="detail-preview-section">
              <div className="detail-preview">
                {isLocal && card.localPath ? (
                  <LocalVideoPlayer
                    localPath={card.localPath}
                    localVideoRef={app.localVideoRef}
                    setDuration={app.setDuration}
                    setIsPlaying={app.setIsPlaying}
                    syncCardRange={() => {}}
                    activeCard={card}
                  />
                ) : (
                  <webview
                    id={`detail-preview-${card.bvid}`}
                    src={`https://www.bilibili.com/video/${card.bvid}`}
                    className="detail-webview"
                    allowpopups="true"
                    httpreferrer="https://www.bilibili.com"
                    useragent={app.bilibiliUserAgent}
                    partition="temp:bili"
                    preload={window.env?.bilibiliPagePreload}
                    style={{
                      width: "100%",
                      height: "100%",
                      border: "none",
                      borderRadius: "8px"
                    }}
                  />
                )}
              </div>
            </div>

            {/* 右侧：卡片信息 */}
            <div className="detail-info-section">
              <div className="detail-info">
                <div className="detail-section">
                  <div className="detail-label">标题</div>
                  <div className="detail-value">{card.title || "未命名卡片"}</div>
                </div>

                {app.isValidCVId && app.isValidCVId(card.id) && (
                  <div className="detail-section">
                    <div className="detail-label">卡片ID</div>
                    <div className="detail-value detail-value--cv-id">{card.id}</div>
                  </div>
                )}

                <div className="detail-section">
                  <div className="detail-label">来源</div>
                  <div className="detail-value">
                    {isLocal ? "本地视频" : `B站: ${card.bvid}`}
                  </div>
                </div>

                {isLocal && card.localPath && (
                  <div className="detail-section">
                    <div className="detail-label">本地路径</div>
                    <div className="detail-value detail-value--path">{card.localPath}</div>
                  </div>
                )}

                <div className="detail-section">
                  <div className="detail-label">时间范围</div>
                  <div className="detail-value">
                    {app.formatTime(card.start)} - {app.formatTime(card.end)}
                    {isLocal && card.localDuration && (
                      <span className="detail-meta"> (总时长: {app.formatTime(card.localDuration)})</span>
                    )}
                  </div>
                </div>

                {tags.length > 0 && (
                  <div className="detail-section">
                    <div className="detail-label">搜索标签</div>
                    <div className="detail-value">
                      {tags.join(" / ")}
                    </div>
                  </div>
                )}

                {clipTags.length > 0 && (
                  <div className="detail-section">
                    <div className="detail-label">剪辑标签</div>
                    <div className="detail-value">
                      {clipTags.join(" / ")}
                    </div>
                  </div>
                )}

                {card.bpm && (
                  <div className="detail-section">
                    <div className="detail-label">BPM</div>
                    <div className="detail-value">{card.bpm}</div>
                  </div>
                )}

                {card.notes && (
                  <div className="detail-section">
                    <div className="detail-label">备注</div>
                    <div className="detail-value">{card.notes}</div>
                  </div>
                )}

                {isLocal && (
                  <>
                    {card.localWidth && card.localHeight && (
                      <div className="detail-section">
                        <div className="detail-label">分辨率</div>
                        <div className="detail-value">{card.localWidth} × {card.localHeight}</div>
                      </div>
                    )}
                    {card.localFileSize && (
                      <div className="detail-section">
                        <div className="detail-label">文件大小</div>
                        <div className="detail-value">
                          {(card.localFileSize / 1024 / 1024).toFixed(2)} MB
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
