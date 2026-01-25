import { useMemo } from "react";

import { useAppContext } from "../context/AppContext";

export default function BuilderPage() {
  const app = useAppContext();

  const folderName = useMemo(() => {
    if (!app?.localVideoFolder) return "";
    const parts = app.localVideoFolder.split(/[/\\]/);
    return parts[parts.length - 1] || app.localVideoFolder;
  }, [app?.localVideoFolder]);

  const sourceLabel = useMemo(() => {
    if (!app) return "";
    if (app.searchSourceType === "bilibili") {
      return app.activeCard ? app.activeCard.bvid || "无BV" : "未选择视频";
    }
    return app.selectedLocalFile?.path || "未选择本地视频";
  }, [app]);

  if (!app) return null;

  return (
    <>
      <section className="panel panel-sources">
        <div className="search-type-selector">
          <button
            type="button"
            className={"search-type-btn" + (app.searchSourceType === "bilibili" ? " is-active" : "")}
            onClick={() => app.setSearchSourceType("bilibili")}
          >
            B站
          </button>
          <button
            type="button"
            className={"search-type-btn" + (app.searchSourceType === "local" ? " is-active" : "")}
            onClick={() => app.setSearchSourceType("local")}
          >
            本地
          </button>
        </div>

        {app.searchSourceType === "bilibili" && (
          <>
            <form className="search-form" onSubmit={app.handleSearchSubmit}>
              <div className="search-input-wrap">
                <input
                  className="search-input"
                  value={app.searchQuery}
                  onChange={(event) => app.setSearchQuery(event.target.value)}
                  placeholder={app.searchSuggestion}
                />
              </div>
              <button type="submit">搜索</button>
            </form>
            <div className="search-hint">搜索B站视频并选择素材。</div>
            <div className="search-frame">
              <webview
                ref={app.searchWebviewRef}
                src={app.searchUrl}
                className={"search-webview" + (app.isSearchLoading ? " is-loading" : "")}
                style={{ width: "100%", height: "100%", minHeight: "100%" }}
                allowpopups="true"
                httpreferrer="https://www.bilibili.com"
                useragent={app.bilibiliUserAgent}
                partition="persist:bili"
              />
              {app.showSearchOverlay ? (
                <div className="search-overlay">
                  <div className="search-overlay-spinner" />
                  <div className="search-overlay-text">加载中...</div>
                </div>
              ) : null}
            </div>
          </>
        )}

        {app.searchSourceType === "local" && (
          <>
            <div className="local-folder-section">
              <button
                type="button"
                className="ghost"
                onClick={async () => {
                  const result = await window.localVideo?.selectFolder?.();
                  if (result?.ok && result.folderPath) {
                    app.setLocalVideoFolder(result.folderPath);
                    localStorage.setItem("lastLocalVideoFolder", result.folderPath);
                    const scanResult = await window.localVideo?.scanFolder?.(result.folderPath);
                    if (scanResult?.ok && scanResult.files) {
                      app.setLocalVideoList(scanResult.files);
                    }
                  }
                }}
              >
                选择本地文件夹
              </button>
              {app.localVideoFolder ? (
                <div className="folder-info">文件夹：{folderName}</div>
              ) : null}
            </div>

            {app.localVideoList.length > 0 && (
              <div className="local-video-list">
                <div className="search-hint">找到 {app.localVideoList.length} 个视频</div>
                <div className="video-file-list">
                  {app.localVideoList.map((file) => (
                    <div
                      key={file.path}
                      className={
                        "video-file-item" +
                        (app.selectedLocalFile?.path === file.path ? " is-selected" : "")
                      }
                      onClick={async () => {
                        console.log("Select local file:", file);
                        app.setSelectedLocalFile(file);
                        try {
                          console.log("Load metadata...");
                          const metadataPromise = window.localVideo?.getMetadata?.(file.path);
                          const timeoutPromise = new Promise((_, reject) =>
                            setTimeout(() => reject(new Error("读取元数据超时（30秒）")), 30000)
                          );
                          const metadataResult = await Promise.race([metadataPromise, timeoutPromise]);
                          console.log("Metadata:", metadataResult);
                          if (metadataResult?.ok && metadataResult.metadata) {
                            const metadata = metadataResult.metadata;
                            app.setLocalVideoInfo(metadata);
                            const duration = metadata.duration || 300;
                            app.setRangeStart(0);
                            app.setRangeEnd(duration);
                            app.setDuration(duration);
                            app.setSourceDuration(duration);
                            const localId = `local-${Date.now()}`;
                            app.setActiveId(localId);
                            app.setPreviewSource({
                              id: localId,
                              source: "local",
                              localPath: file.path,
                              title: file.name,
                              start: 0,
                              end: duration
                            });
                            console.log("Local source ready");
                          } else {
                            console.error("Metadata failed:", metadataResult);
                            alert(
                              `读取元数据失败：${metadataResult?.error || "未知错误"}`
                            );
                          }
                        } catch (error) {
                          console.error("Local metadata error:", error);
                          alert(`本地元数据错误：${error.message}`);
                        }
                      }}
                    >
                      <div className="video-file-name">
                        {file.name}
                        {app.selectedLocalFile?.path === file.path && app.localVideoInfo === null && (
                          <span className="loading-text">（加载中...）</span>
                        )}
                      </div>
                      <div className="video-file-size">
                        {(file.size / 1024 / 1024).toFixed(2)} MB
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </section>

      <section className="panel panel-preview" key={app.previewPanelKey}>
        <div className="preview-head">
          <div className="preview-title">
            <h2>{app.activeCard?.title || "预览"}</h2>
            <div
              className="preview-range"
              dangerouslySetInnerHTML={{
                __html: app.activeCard
                  ? `${app.formatTime(app.rangeStart, app.timeHighlight)} - ${app.formatTime(app.rangeEnd, app.timeHighlight)}`
                  : "--:-- - --:--"
              }}
            />
          </div>
        </div>

        {app.activeCard ? (
          <div className="preview-body">
            {app.activeCard.source === "local" && app.activeCard.localPath ? (
              <app.LocalVideoPlayer
                key={app.activeCard.localPath}
                localPath={app.activeCard.localPath}
                localVideoRef={app.localVideoRef}
                setDuration={app.setDuration}
                setIsPlaying={app.setIsPlaying}
                syncCardRange={app.syncCardRange}
                activeCard={app.activeCard}
                setTimeHighlight={app.setTimeHighlight}
              />
            ) : app.previewUrl ? (
              <webview
                key={`${app.activeId || "preview"}-${app.previewEpoch}`}
                ref={app.webviewRef}
                src={app.previewUrl}
                className={"player-webview embed-player " + (app.isLoadingPreview ? "is-loading" : "")}
                style={{ width: "100%", height: "100%", minHeight: "100%" }}
                allowpopups="true"
                httpreferrer="https://www.bilibili.com"
                useragent={app.bilibiliUserAgent}
                partition="persist:bili"
                preload={window.env?.bilibiliPagePreload}
              />
            ) : (
              <div className="placeholder">暂无预览</div>
            )}

            {app.isLoadingPreview || app.isResolving ? (
              <div className="preview-loading">
                <div className="preview-loading-spinner" />
                <div className="preview-loading-text">预览加载中...</div>
              </div>
            ) : null}

            {app.previewError && !app.isLoadingPreview && !app.isResolving ? (
              <div className="preview-error">
                <button onClick={app.handleResolvePreview}>重试</button>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="placeholder">请选择素材进行预览</div>
        )}
      </section>

      <section className="panel panel-editor">
        <div className="editor-section">
          <div className="builder-flow">
            <div className="builder-stage">
              <div className="builder-stage-title">
                <span className="builder-step">01</span>
                <span>选择素材</span>
              </div>
              <div className="builder-grid builder-grid--preview">
                <div className="builder-card">
                  <div className="builder-label">卡片名称 <span className="required">*</span></div>
                  <input
                    className="builder-input"
                    type="text"
                    value={app.form.title || ""}
                    onChange={(event) =>
                      app.setForm((prev) => ({ ...prev, title: event.target.value }))
                    }
                    placeholder="请输入卡片名称（必填）"
                    maxLength={100}
                  />
                  <div className="builder-hint">为这个片段起个名字，方便识别。</div>
                  <div className="builder-label" style={{ marginTop: "12px" }}>预览区间</div>
                  <div
                    className="builder-range"
                    dangerouslySetInnerHTML={{
                      __html: `${app.formatTime(app.rangeStart, app.timeHighlight)} - ${app.formatTime(app.rangeEnd, app.timeHighlight)}`
                    }}
                  />
                  <div className="builder-hint">保存前调整区间。</div>
                  <div className="builder-hint">来源：{sourceLabel}</div>
                </div>
              </div>
            </div>

            <div className="builder-stage">
              <div className="builder-stage-title">
                <span className="builder-step">02</span>
                <span>添加标签</span>
              </div>
              <div className="builder-grid builder-grid--tags">
                <div className="builder-card">
                  <div className="tag-hint">使用标签整理片段。</div>
                  <div className="tag-input-row">
                    <input
                      value={app.tagInput}
                      onChange={(event) => app.setTagInput(event.target.value)}
                      onKeyDown={app.handleTagKeyDown}
                      placeholder="添加标签，回车确认"
                    />
                    <button type="button" className="ghost" onClick={app.handleAddTag}>
                      添加
                    </button>
                  </div>
                  <div className="tag-chip-list">
                    {app.tagList.length ? (
                      app.tagList.map((tag) => (
                        <span key={tag} className="tag-chip">
                          <span className="tag-chip-text">#{tag}</span>
                          <button type="button" onClick={() => app.handleRemoveTag(tag)}>
                            ×
                          </button>
                        </span>
                      ))
                    ) : (
                      <div className="tag-empty">暂无标签。</div>
                    )}
                  </div>
                  <div className="tag-hint">标签用于搜索与分组。</div>
                </div>

                <div className="builder-card">
                  <div className="builder-label">剪辑标签</div>
                  {app.clipTagGroups.map((group) => (
                    <div key={group.label} className="clip-tag-group">
                      <div className="clip-tag-title">
                        {group.label}
                        {group.single ? "（单选）" : ""}
                      </div>
                      <div className="clip-tag-list">
                        {group.options.map((tag) => {
                          const isSelected = app.clipTags.includes(tag);
                          return (
                            <button
                              key={tag}
                              type="button"
                              className={"clip-tag" + (isSelected ? " is-selected" : "")}
                              onClick={() => app.toggleClipTag(group, tag)}
                            >
                              {tag}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="builder-card">
                  <div className="builder-label">备注</div>
                  <textarea
                    className="builder-textarea"
                    value={app.form.notes}
                    onChange={(event) =>
                      app.setForm((prev) => ({ ...prev, notes: event.target.value }))
                    }
                    placeholder="填写该片段备注"
                  />

                  <div className="builder-label">可见性</div>
                  <select
                    className="builder-select"
                    value={app.form.visibility}
                    onChange={(event) =>
                      app.setForm((prev) => ({ ...prev, visibility: event.target.value }))
                    }
                    disabled={app.searchSourceType === "local"}
                    style={{
                      opacity: app.searchSourceType === "local" ? 0.5 : 1,
                      cursor: app.searchSourceType === "local" ? "not-allowed" : "pointer"
                    }}
                  >
                    <option value="private">私有</option>
                    <option value="public">公开</option>
                  </select>
                  <div className="builder-hint">
                    {app.searchSourceType === "local" ? (
                      <>本地来源的视频片段强制为私有，无法分享。</>
                    ) : (
                      <>私有片段仅保存在本地，公开片段可分享。</>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="builder-actions">
            <button className="primary" onClick={app.handleAddCard}>
              保存片段
            </button>
            {app.communityStatus.error ? (
              <div className="community-error">{app.communityStatus.error}</div>
            ) : null}
            {app.saveNotice ? <div className="save-notice">{app.saveNotice}</div> : null}
          </div>
        </div>
      </section>
    </>
  );
}
