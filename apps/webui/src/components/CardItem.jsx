import { useAppContext } from "../context/AppContext";

export default function CardItem({ card, onLoad, onDelete, onToggleFavorite, onOpenDetail }) {
  const app = useAppContext();

  if (!app) return null;

  return (
    <div className="save-item">
      <div className="save-item-preview">
        <div className="save-item-video-placeholder">
          <span className="play-icon">▶</span>
          <span className="preview-hint">预览</span>
        </div>
      </div>
      <div className="save-item-info">
        <div className="save-item-header">
          <div className="save-item-title">{card.title || "未命名卡片"}</div>
          <div className="save-item-visibility">
            {card.visibility === 'public' ? '🌐 公开' : '🔒 私有'}
          </div>
        </div>
        <div className="save-item-meta">
          <span className="save-item-duration">
            ⏱ {app.formatTime(card.start)} - {app.formatTime(card.end)}
          </span>
          <span className="save-item-source">
            {card.source === 'local' ? '📁 本地' : '🎵 B站'}
          </span>
        </div>
        <div className="save-item-actions">
          {onLoad && (
            <button
              className="save-item-btn load-btn"
              onClick={() => onLoad(card)}
              title="加载到编辑器"
            >
              📋 加载
            </button>
          )}
          {onToggleFavorite && (
            <button
              className="save-item-btn"
              onClick={() => onToggleFavorite(card)}
              title={app.favoriteCardIds.has(card.id) ? "取消收藏" : "收藏"}
            >
              {app.favoriteCardIds.has(card.id) ? "★ 收藏" : "☆ 收藏"}
            </button>
          )}
          {onOpenDetail && (
            <button
              className="save-item-btn"
              onClick={() => onOpenDetail(card)}
              title="查看详情"
            >
              📖 详情
            </button>
          )}
          {onDelete && (
            <button
              className="save-item-btn delete-btn"
              onClick={() => onDelete(card)}
              title="删除"
            >
              🗑 删除
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
