import { useAppContext } from "../context/AppContext";
import { useState, useCallback, useRef, useEffect } from "react";
import CardItem from "../components/CardItem";

export default function ManagePage() {
  const app = useAppContext();
  if (!app) return null;

  // 跟踪正在拖动的进度条
  const [draggingCardId, setDraggingCardId] = useState(null);
  const dragStartTimeRef = useRef(null);
  const dragStartXRef = useRef(0);

  // 更新视频播放时间的通用函数
  const updateVideoTime = useCallback((cardId, newTime) => {
    const webviewId = `manage-preview-${cardId}`;
    const webview = document.getElementById(webviewId);

    if (webview) {
      try {
        webview.executeJavaScript(`
          (function() {
            const video = document.querySelector('video');
            if (video) {
              video.currentTime = ${newTime};
              console.log('[Progress] Jumped to time:', ${newTime});
            }
          })();
        `).catch((err) => {
          console.warn('[Progress] Failed to seek video:', err);
        });
      } catch (err) {
        console.warn('[Progress] Failed to execute JavaScript:', err);
      }
    }

    // 更新当前时间显示
    app.setPreviewCurrentTime((prev) => new Map(prev).set(cardId, newTime));
  }, [app]);

  // 处理进度条点击/拖动开始
  const handleProgressMouseDown = useCallback((card, e) => {
    e.stopPropagation();
    const progressBar = e.currentTarget;
    const rect = progressBar.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, clickX / rect.width));
    const newTime = card.start + percentage * (card.end - card.start);

    // 立即跳转到点击位置
    updateVideoTime(card.id, newTime);

    // 设置拖动状态
    setDraggingCardId(card.id);
    dragStartTimeRef.current = newTime;
    dragStartXRef.current = e.clientX;
  }, [updateVideoTime]);

  // 处理拖动过程中的移动
  const handleMouseMove = useCallback((e) => {
    if (draggingCardId === null) return;

    // 找到对应的卡片数据
    const card = app.communityMyCards.find(c => c.id === draggingCardId);
    if (!card) return;

    // 计算新的时间
    const progressBar = document.querySelector(`[data-card-id="${draggingCardId}"] .preview-progress-bar`);
    if (!progressBar) return;

    const rect = progressBar.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const percentage = x / rect.width;
    const newTime = card.start + percentage * (card.end - card.start);

    // 更新视频时间
    updateVideoTime(draggingCardId, newTime);
  }, [draggingCardId, app.communityMyCards, updateVideoTime]);

  // 处理拖动结束
  const handleMouseUp = useCallback(() => {
    if (draggingCardId !== null) {
      setDraggingCardId(null);
      dragStartTimeRef.current = null;
      dragStartXRef.current = 0;
    }
  }, [draggingCardId]);

  // 添加全局鼠标事件监听
  useEffect(() => {
    if (draggingCardId !== null) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);

      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [draggingCardId, handleMouseMove, handleMouseUp]);

  return (
    <section className="panel panel-community">
      <div className="manage-layout">
        <aside className="manage-sidebar">
          <div className="manage-section">
            <div className="manage-section-title">账号</div>
            {app.communitySession ? (
              <div className="community-row">
                <div>
                  <div className="community-title">已登录</div>
                  <div className="community-meta">{app.communitySession.username}</div>
                </div>
                <button type="button" className="ghost" onClick={app.handleCommunityLogout}>
                  退出登录
                </button>
              </div>
            ) : (
              <div className="manage-empty">
                <div className="community-meta">登录后可管理卡片。</div>
                <div className="manage-row-actions">
                  <button type="button" className="ghost" onClick={app.openCommunityLogin}>
                    登录
                  </button>
                  <button type="button" className="ghost" onClick={app.openCommunityRegister}>
                    注册
                  </button>
                </div>
              </div>
            )}
            {app.communityStatus.error ? (
              <div className="community-error">{app.communityStatus.error}</div>
            ) : null}
          </div>

          <div className="manage-section">
            <div className="manage-section-title">筛选</div>
            <div className="manage-filters">
              <button
                type="button"
                className={"manage-filter" + (app.manageFilter === "all" ? " is-active" : "")}
                onClick={() => app.setManageFilter("all")}
              >
                全部
              </button>
              <button
                type="button"
                className={"manage-filter" + (app.manageFilter === "public" ? " is-active" : "")}
                onClick={() => app.setManageFilter("public")}
              >
                公开
              </button>
              <button
                type="button"
                className={"manage-filter" + (app.manageFilter === "private" ? " is-active" : "")}
                onClick={() => app.setManageFilter("private")}
              >
                私有
              </button>
            </div>
          </div>
        </aside>

        <div className="manage-content">
          {!app.communitySession ? (
            <div className="manage-alert">
              登录后可管理卡片。
              <button type="button" className="ghost" onClick={app.openCommunityLogin}>
                登录
              </button>
            </div>
          ) : null}

          <div className="manage-toolbar">
            <div className="manage-search">
              <input
                value={app.manageSearch}
                onChange={(event) => app.setManageSearch(event.target.value)}
                placeholder="搜索我的卡片"
              />
            </div>
            <div className="manage-actions">
              <button type="button" className="ghost" onClick={app.handleSelectAllManageTags}>
                全选
              </button>
              <button type="button" className="ghost" onClick={app.handleClearManageSelection}>
                清空
              </button>
              <button
                type="button"
                className="ghost"
                onClick={app.handleRevalidateCards}
                disabled={!app.communityMyCards.length || app.communityStatus.loading}
              >
                重新验证
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => app.handleBulkVisibility("public")}
                disabled={!app.manageSelected.length}
              >
                设为公开
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => app.handleBulkVisibility("private")}
                disabled={!app.manageSelected.length}
              >
                设为私有
              </button>
            </div>
          </div>

          <div className="manage-list manage-cards">
            {app.filteredManageCards.length ? (
              app.filteredManageCards.map((card) => {
                const progress =
                  card.end > card.start
                    ? ((app.previewCurrentTime.get(card.id) || card.start) - card.start) /
                      (card.end - card.start)
                    : 0;
                const progressPercent = Math.max(0, Math.min(100, progress * 100));
                const isDragging = draggingCardId === card.id;

                return (
                  <div
                    key={card.id}
                    className="manage-card"
                    data-card-id={card.id}
                    onClick={() => app.setActiveId && app.setActiveId(card.id)}
                    style={{ cursor: 'pointer' }}
                  >
                    <div className="manage-card-head">
                      <label className="manage-check" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={app.manageSelected.includes(card.id)}
                          onChange={() => app.handleToggleManageSelect(card.id)}
                        />
                      </label>

                      <div className="manage-card-head-row">
                        <div className="manage-card-head-left">
                          <div className="manage-card-info">
                            <div
                              className="manage-card-title"
                              onMouseEnter={(e) => {
                                const rect = e.currentTarget.getBoundingClientRect();
                                app.setTooltip({
                                  visible: true,
                                  text: card.title || "未命名卡片",
                                  x: rect.left,
                                  y: rect.bottom + 8
                                });
                              }}
                              onMouseLeave={() => {
                                app.setTooltip((prev) => ({ ...prev, visible: false }));
                              }}
                            >
                              {card.title || "未命名卡片"}
                            </div>
                            <div
                              className="save-item-meta"
                              dangerouslySetInnerHTML={{
                                __html: `<span class="save-item-duration">⏱ ${app.formatTime(card.end - card.start)}</span><span class="save-item-source">${card.source === 'local' ? '📁 本地' : '🎵 B站'}</span>`
                              }}
                            />
                            {card.validation && card.validation.status === "invalid" && (
                              <div className="validation-status validation-status-invalid" title="无效来源">
                                !
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="manage-card-head-right">
                          {card.source !== "local" && (
                            <div className={"manage-visibility " + card.visibility}>
                              {card.visibility === "public" ? "🌐 公开" : "🔒 私有"}
                            </div>
                          )}
                          <div className="manage-card-actions">
                            <button
                              type="button"
                              className="ghost manage-card-action-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                app.handleToggleCardFavorite(card);
                              }}
                              title={app.favoriteCardIds.has(card.id) ? "取消收藏" : "收藏"}
                            >
                              {app.favoriteCardIds.has(card.id) ? "★" : "☆"}
                            </button>
                            <button
                              type="button"
                              className="ghost manage-card-action-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                app.handleOpenCardDetail(card);
                              }}
                              title="查看详情"
                            >
                              📖
                            </button>
                            <button
                              type="button"
                              className="ghost manage-card-action-btn"
                              onClick={(e) => {
                                e.stopPropagation();
                                app.handleDeleteCard(card);
                              }}
                              title="删除卡片"
                            >
                              ✕
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div
                      className="manage-card-preview"
                      onMouseEnter={() => app.handleManageHoverStart(card)}
                      onMouseLeave={() => app.handleManageHoverEnd(card)}
                    >
                      <div className="preview-container">
                        {app.webviewManageIds.has(card.id) ? (
                          <>
                            {card.source === "local" && card.localPath ? (
                              <app.LocalCardPreview
                                card={card}
                                videoId={`manage-preview-${card.id}`}
                                className="card-preview-webview"
                                muted={false}
                                isHovered={app.hoveredManageId === card.id}
                                onTimeUpdate={(time) => {
                                  app.setPreviewCurrentTime((prev) => new Map(prev).set(card.id, time));
                                }}
                              />
                            ) : (
                              <webview
                                id={`manage-preview-${card.id}`}
                                data-card-id={card.id}
                                data-bvid={card.bvid}
                                data-start={card.start}
                                data-end={card.end}
                                src={app.buildCardPreviewUrl({
                                  bvid: card.bvid,
                                  start: card.start,
                                  end: card.end
                                })}
                                className="card-preview-webview"
                                allowpopups="true"
                                httpreferrer="https://www.bilibili.com"
                                useragent={app.bilibiliUserAgent}
                                partition="temp:bili"
                                preload={window.env?.bilibiliPagePreload}
                                style={{ opacity: 1, width: "100%", height: "100%" }}
                              />
                            )}
                            <div className="preview-bottom-shield" />
                            <div
                              className="preview-progress-bar"
                              onMouseDown={(e) => handleProgressMouseDown(card, e)}
                              style={{ cursor: isDragging ? 'grabbing' : 'pointer' }}
                            >
                              <div className="preview-progress-track" />
                              <div
                                className="preview-progress-handle"
                                style={{
                                  left: `${progressPercent}%`,
                                  cursor: isDragging ? 'grabbing' : 'grab'
                                }}
                              />
                              <div
                                className="preview-progress-track"
                                style={{ width: `${progressPercent}%` }}
                              />
                            </div>
                            <div className="preview-range-markers">
                              <div className="preview-range-marker">
                                {app.formatTime(
                                  Math.floor(
                                    (app.previewCurrentTime.get(card.id) || card.start) - card.start
                                  )
                                )}
                              </div>
                              <div className="preview-range-marker">
                                {app.formatTime(Math.floor(card.end - card.start))}
                              </div>
                            </div>
                          </>
                        ) : (
                          <div className="preview-placeholder">
                            <div className="preview-placeholder-content">
                              <div className="preview-placeholder-icon"></div>
                              <div className="preview-placeholder-text">悬停预览</div>
                            </div>
                          </div>
                        )}
                        {app.manageLoadingState.get(card.id)?.webviewLoading &&
                        app.webviewManageIds.has(card.id) &&
                        card.source !== "local" ? (
                          <div className="preview-overlay">
                            <div className="preview-overlay-spinner" />
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="manage-empty">未找到卡片。</div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
