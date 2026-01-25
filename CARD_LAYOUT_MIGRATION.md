# ManagePage 和 CommunityPage 卡片布局改造指南

## 问题
当前 ManagePage 和 CommunityPage 使用的是 `manage-card` 布局（带复杂预览功能），
而 BuilderPage 的"最近片段"使用的是 `save-item` 布局（简洁的卡片+占位符样式）。

## 目标
将 ManagePage 和 CommunityPage 的卡片展示改为使用 `save-item` 样式

## 需要修改的文件
1. `apps/webui/src/pages/ManagePage.jsx`
2. `apps/webui/src/pages/CommunityPage.jsx`

## 修改方案

### ManagePage.jsx - 第 216-413 行

将整个 `<div className="manage-list manage-cards">` 内容替换为：

```jsx
<div className="manage-list manage-cards">
  {app.filteredManageCards.length ? (
    <div className="save-items">
      {app.filteredManageCards.map((card) => (
        <div
          key={card.id}
          className="save-item"
          data-card-id={card.id}
          onClick={() => app.setActiveId && app.setActiveId(card.id)}
        >
          {/* 预览占位符 */}
          <div className="save-item-preview">
            <div className="save-item-video-placeholder">
              <span className="play-icon">▶</span>
              <span className="preview-hint">预览</span>
            </div>
          </div>

          {/* 卡片信息 */}
          <div className="save-item-info">
            <div className="save-item-header">
              <div className="save-item-title">{card.title || "未命名卡片"}</div>
              {card.source !== "local" && (
                <div className="save-item-visibility">
                  {card.visibility === 'public' ? '🌐 公开' : '🔒 私有'}
                </div>
              )}
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
              <button
                className="save-item-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  app.handleToggleCardFavorite(card);
                }}
                title={app.favoriteCardIds.has(card.id) ? "取消收藏" : "收藏"}
              >
                {app.favoriteCardIds.has(card.id) ? "★ 收藏" : "☆ 收藏"}
              </button>
              <button
                className="save-item-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  app.handleOpenCardDetail(card);
                }}
                title="查看详情"
              >
                📖 详情
              </button>
              <button
                className="save-item-btn delete-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  app.handleDeleteCard(card);
                }}
                title="删除"
              >
                🗑 删除
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  ) : (
    <div className="manage-empty">未找到卡片。</div>
  )}
</div>
```

### CommunityPage.jsx - 第 185-300 行左右（卡片列表部分）

同样替换为使用 `.save-item` 样式的结构（同上）。

## 效果
- ✅ 统一的卡片外观
- ✅ 视频占位符（16:9，渐变背景）
- ✅ 清晰的信息层次
- ✅ 统一的操作按钮样式
- ✅ 悬停效果（边框高亮、阴影、轻微上移）

## 注意
- 移除了复选框和批量选择功能
- 移除了视频预览和进度条功能
- 保留了基本的卡片操作（收藏、详情、删除）
