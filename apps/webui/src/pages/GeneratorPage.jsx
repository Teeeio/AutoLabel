import { useCallback, useState, useEffect } from "react";
import { useAppContext } from "../context/AppContext";
import useGenerator from "../hooks/useGenerator";

export default function GeneratorPage() {
  const app = useAppContext();
  if (!app) return null;

  const generator = useGenerator({
    myCards: app.communityMyCards || [],
    favorites: app.favoriteCards || []
  });

  const [tooltip, setTooltip] = useState(null);
  const [showLogs, setShowLogs] = useState(false);
  const [tagSearchGroupId, setTagSearchGroupId] = useState(null);
  const [tagSearchText, setTagSearchText] = useState("");
  const [activeTab, setActiveTab] = useState("selected"); // 新增：活动选项卡
  const [hoveredGeneratorId, setHoveredGeneratorId] = useState(""); // 新增：生成器页面hover状态

  const showTooltip = useCallback((e, content) => {
    setTooltip({
      content,
      x: e.clientX,
      y: e.clientY
    });
  }, []);

  const hideTooltip = useCallback(() => {
    setTooltip(null);
  }, []);

  const handleRunGenerator = useCallback(async () => {
    setShowLogs(true);
    setActiveTab("preview"); // 生成时自动切换到预览选项卡

    const result = await generator.runGenerator();

    if (result && result.logs) {
      console.log('[GeneratorPage] Generation complete. Logs:', result.logs.length, 'entries');
    }

    return result;
  }, [generator]);

  const handleToggleLogs = useCallback(() => {
    setShowLogs(prev => !prev);
  }, []);

  const tabs = [
    { id: "selected", label: "已选卡片", icon: "📋", count: generator.selectedCards.length },
    { id: "rules", label: "拼接规则", icon: "🔀" },
    { id: "output", label: "输出设置", icon: "⚙️" },
    { id: "transitions", label: "转场设置", icon: "🎬" },
    { id: "preview", label: "预览与生成", icon: "▶️" }
  ];

  // 更新哨兵的hover状态 - 生成器页面
  useEffect(() => {
    window.__hoveredGeneratorId = hoveredGeneratorId || null;
  }, [hoveredGeneratorId]);

  return (
    <section className="panel panel-generator">
      <div className="generator-layout-new">
        {/* 左侧: 卡片池 */}
        <div className="generator-pool">
          <div className="pool-header">
            <h2>卡片池</h2>
            <div className="pool-tabs">
              <button
                className={"pool-tab" + (generator.cardSource === "my" ? " is-active" : "")}
                onClick={() => generator.setCardSource("my")}
              >
                我的卡片 ({app.communityMyCards?.length || 0})
              </button>
              <button
                className={"pool-tab" + (generator.cardSource === "favorites" ? " is-active" : "")}
                onClick={() => generator.setCardSource("favorites")}
              >
                收藏夹 ({app.favoriteCards?.length || 0})
              </button>
            </div>
          </div>

          <div className="pool-search">
            <input
              type="text"
              placeholder="搜索卡片..."
              value={generator.searchQuery}
              onChange={(e) => generator.setSearchQuery(e.target.value)}
            />
          </div>

          <div className="pool-list">
            {generator.filteredCards.length > 0 ? (
              generator.filteredCards.map(card => (
                <div
                  key={card.id}
                  className={
                    "generator-card-item" +
                    (generator.selectedCardIds.includes(card.id) ? " is-selected" : "")
                  }
                  onClick={() => generator.toggleCard(card.id)}
                >
                  <div className="card-checkbox">
                    {generator.selectedCardIds.includes(card.id) && "✓"}
                  </div>
                  <div className="card-info">
                    <div className="card-title">{card.title || "未命名卡片"}</div>
                    <div className="card-meta">
                      {card.bvid || "本地视频"} · {app.formatTime(card.start)}-{app.formatTime(card.end)}
                      <span className="card-duration">
                        ({app.formatTime(card.end - card.start)})
                      </span>
                    </div>
                  </div>

                  {/* 预览按钮 */}
                  <button
                    className="card-preview-button"
                    onMouseEnter={() => {
                      setHoveredGeneratorId(card.id);
                      if (app.handleManageHoverStart) app.handleManageHoverStart(card);
                    }}
                    onMouseLeave={() => {
                      setHoveredGeneratorId("");
                      if (app.handleManageHoverEnd) app.handleManageHoverEnd(card);
                    }}
                    onClick={(e) => {
                      e.stopPropagation(); // 防止触发卡片选择
                    }}
                    title="预览视频"
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                      <path d="M8 5v14l11-7z"/>
                    </svg>
                  </button>

                  {/* 添加预览层 */}
                  <div className="card-preview-layer">
                    {app.webviewManageIds && app.webviewManageIds.has(card.id) && hoveredGeneratorId === card.id ? (
                      <>
                        {card.source === "local" && card.localPath ? (
                          <app.LocalCardPreview
                            card={card}
                            videoId={`generator-preview-${card.id}`}
                            className="card-preview-webview"
                            muted={false}
                            isHovered={hoveredGeneratorId === card.id}
                            onTimeUpdate={(time) => {
                              if (app.setPreviewCurrentTime) {
                                app.setPreviewCurrentTime((prev) => new Map(prev).set(card.id, time));
                              }
                            }}
                          />
                        ) : (
                          <webview
                            id={`generator-preview-${card.id}`}
                            data-card-id={card.id}
                            data-bvid={card.bvid}
                            data-start={card.start}
                            data-end={card.end}
                            src={app.buildCardPreviewUrl ? app.buildCardPreviewUrl({
                              bvid: card.bvid,
                              start: card.start,
                              end: card.end
                            }) : `https://www.bilibili.com/video/${card.bvid}`}
                            className="card-preview-webview"
                            allowpopups="true"
                            httpreferrer="https://www.bilibili.com"
                            useragent={app.bilibiliUserAgent}
                            partition="temp:gen-preview"
                            preload={window.env?.bilibiliPagePreload}
                            style={{
                              width: "100%",
                              height: "100%",
                              border: "none",
                              borderRadius: "8px"
                            }}
                          />
                        )}
                      </>
                    ) : null}
                  </div>
                </div>
              ))
            ) : (
              <div className="pool-empty">没有找到卡片</div>
            )}
          </div>

          <div className="pool-actions">
            <button type="button" className="ghost" onClick={generator.selectAll}>
              全选
            </button>
            <button type="button" className="ghost" onClick={generator.clearSelection}>
              清空
            </button>
            <button type="button" className="ghost" onClick={generator.invertSelection}>
              反选
            </button>
          </div>
        </div>

        {/* 中间: 选项卡式配置面板 */}
        <div className="generator-main">
          {/* 选项卡导航 */}
          <div className="generator-tabs-nav">
            {tabs.map(tab => (
              <button
                key={tab.id}
                className={`generator-tab ${activeTab === tab.id ? 'is-active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <span className="tab-icon">{tab.icon}</span>
                <span className="tab-label">{tab.label}</span>
                {tab.count !== undefined && (
                  <span className="tab-count">{tab.count}</span>
                )}
              </button>
            ))}
          </div>

          {/* 选项卡内容区 */}
          <div className="generator-tabs-content">
            {/* 已选卡片选项卡 */}
            {activeTab === "selected" && (
              <div className="tab-panel tab-panel-selected">
                <div className="panel-header">
                  <h3>已选卡片 ({generator.selectedCards.length})</h3>
                  <div className="panel-stats">
                    总时长: {generator.stats.totalDuration}s | 平均: {generator.stats.avgDuration}s
                  </div>
                </div>

                {generator.selectedCards.length > 0 ? (
                  <div className="selected-list">
                    {generator.selectedCards.map((card, index) => (
                      <div key={card.id} className="selected-card-item">
                        <div className="card-order">{index + 1}</div>
                        <div className="card-info">
                          <div className="card-title">{card.title || "未命名卡片"}</div>
                          <div className="card-meta">
                            {card.bvid || "本地"} · {app.formatTime(card.start)}-{app.formatTime(card.end)}
                          </div>
                        </div>
                        <button
                          type="button"
                          className="ghost card-remove"
                          onClick={() => generator.toggleCard(card.id)}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="selected-empty">
                    从左侧选择卡片添加到序列中
                  </div>
                )}
              </div>
            )}

            {/* 拼接规则选项卡 */}
            {activeTab === "rules" && (
              <div className="tab-panel tab-panel-rules">
                <div className="panel-header">
                  <h3>拼接规则</h3>
                </div>

                <div className="rule-mode">
                  <label
                    className="radio-label"
                    onMouseEnter={(e) => showTooltip(e, "按照卡片列表的当前顺序进行拼接,保持原有顺序不变")}
                    onMouseLeave={hideTooltip}
                  >
                    <input
                      type="radio"
                      name="mode"
                      value="sequential"
                      checked={generator.rules.mode === "sequential"}
                      onChange={() => generator.setRules({ ...generator.rules, mode: "sequential" })}
                    />
                    <div className="radio-content">
                      <strong>顺序模式</strong>
                      <p>按当前顺序拼接</p>
                    </div>
                  </label>

                  <label
                    className="radio-label"
                    onMouseEnter={(e) => showTooltip(e, "使用 Fisher-Yates 算法打乱卡片顺序,然后按新顺序拼接")}
                    onMouseLeave={hideTooltip}
                  >
                    <input
                      type="radio"
                      name="mode"
                      value="shuffle"
                      checked={generator.rules.mode === "shuffle"}
                      onChange={() => generator.setRules({ ...generator.rules, mode: "shuffle" })}
                    />
                    <div className="radio-content">
                      <strong>混洗模式</strong>
                      <p>打乱顺序后拼接</p>
                    </div>
                  </label>

                  <label
                    className="radio-label"
                    onMouseEnter={(e) => showTooltip(e, "从选中的卡片中随机选择部分卡片,并打乱顺序拼接")}
                    onMouseLeave={hideTooltip}
                  >
                    <input
                      type="radio"
                      name="mode"
                      value="random"
                      checked={generator.rules.mode === "random"}
                      onChange={() => generator.setRules({ ...generator.rules, mode: "random" })}
                    />
                    <div className="radio-content">
                      <strong>随机模式</strong>
                      <p>随机选择并打乱顺序</p>
                    </div>
                  </label>
                </div>

                <div className="rule-options">
                  <label
                    className="checkbox-label"
                    onMouseEnter={(e) => showTooltip(e, "让相同剪辑标签的视频尽量分散出现，避免连续播放。按标签轮询排列卡片。")}
                    onMouseLeave={hideTooltip}
                  >
                    <input
                      type="checkbox"
                      checked={generator.rules.distributeClipTags || false}
                      onChange={(e) => generator.setRules({ ...generator.rules, distributeClipTags: e.target.checked })}
                    />
                    <div className="checkbox-content">
                      <strong>均匀分布剪辑标签</strong>
                      <p>相同标签的视频尽量分散</p>
                    </div>
                  </label>
                </div>
              </div>
            )}

            {/* 输出设置选项卡 */}
            {activeTab === "output" && (
              <div className="tab-panel tab-panel-output">
                <div className="panel-header">
                  <h3>输出设置</h3>
                </div>

                <div className="config-group">
                  <h4>质量设置</h4>
                  <div className="output-params">
                    <div className="param-item">
                      <label>质量</label>
                      <select
                        value={generator.output.quality}
                        onChange={(e) => generator.setOutput({ ...generator.output, quality: e.target.value })}
                      >
                        <option value="low">低 (720p, 30fps)</option>
                        <option value="medium">中 (1080p, 60fps)</option>
                        <option value="high">高 (1080p, 60fps, 高码率)</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div className="config-group">
                  <h4>淡入淡出效果</h4>
                  <div className="output-params">
                    <div className="param-item">
                      <label
                        onMouseEnter={(e) => showTooltip(e, "片段开始时逐渐显示的时长，设置为0表示不应用淡入效果")}
                        onMouseLeave={hideTooltip}
                      >
                        淡入时长 (秒)
                      </label>
                      <input
                        type="number"
                        value={generator.output.fadeInDuration || 0}
                        onChange={(e) => generator.setOutput({ ...generator.output, fadeInDuration: parseFloat(e.target.value) || 0 })}
                        min="0"
                        max="5"
                        step="0.1"
                      />
                    </div>

                    <div className="param-item">
                      <label
                        onMouseEnter={(e) => showTooltip(e, "片段结束时逐渐隐藏的时长，设置为0表示不应用淡出效果")}
                        onMouseLeave={hideTooltip}
                      >
                        淡出时长 (秒)
                      </label>
                      <input
                        type="number"
                        value={generator.output.fadeOutDuration || 0}
                        onChange={(e) => generator.setOutput({ ...generator.output, fadeOutDuration: parseFloat(e.target.value) || 0 })}
                        min="0"
                        max="5"
                        step="0.1"
                      />
                    </div>
                  </div>
                </div>

                <div className="config-group">
                  <h4>音量均衡设置</h4>

                  <div className="output-params">
                    <div className="param-item">
                      <label
                        onMouseEnter={(e) => showTooltip(e, "自动调整所有视频片段的音量，使它们保持一致，避免某些片段声音过大或过小")}
                        onMouseLeave={hideTooltip}
                      >
                        <input
                          type="checkbox"
                          checked={generator.volumeBalance.enabled || false}
                          onChange={(e) => generator.setVolumeBalance({ ...generator.volumeBalance, enabled: e.target.checked })}
                        />
                        启用音量均衡
                      </label>
                    </div>

                    {generator.volumeBalance.enabled && (
                      <>
                        <div className="param-item">
                          <label
                            onMouseEnter={(e) => showTooltip(e, "选择音量均衡的策略")}
                            onMouseLeave={hideTooltip}
                          >
                            均衡策略
                          </label>
                          <select
                            value={generator.volumeBalance.strategy}
                            onChange={(e) => generator.setVolumeBalance({ ...generator.volumeBalance, strategy: e.target.value })}
                          >
                            <option value="average">平均值（所有片段的平均音量）</option>
                            <option value="median">中位数（不受极端值影响）</option>
                            <option value="fixed">固定值（自定义目标音量）</option>
                          </select>
                        </div>

                        {generator.volumeBalance.strategy === 'fixed' && (
                          <div className="param-item">
                            <label
                              onMouseEnter={(e) => showTooltip(e, "目标音量值（dB），通常为-16到-20之间。数值越大音量越大。")}
                              onMouseLeave={hideTooltip}
                            >
                              目标音量 (dB)
                            </label>
                            <input
                              type="number"
                              value={generator.volumeBalance.targetDb}
                              onChange={(e) => generator.setVolumeBalance({ ...generator.volumeBalance, targetDb: parseFloat(e.target.value) || -16 })}
                              min="-30"
                              max="-5"
                              step="1"
                            />
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* 转场设置选项卡 */}
            {activeTab === "transitions" && (
              <div className="tab-panel tab-panel-transitions">
                <div className="panel-header">
                  <h3>转场设置</h3>
                </div>

                <div className="output-params">
                  <div className="param-item">
                    <label
                      onMouseEnter={(e) => showTooltip(e, "是否在片段之间插入转场视频")}
                      onMouseLeave={hideTooltip}
                    >
                      <input
                        type="checkbox"
                        checked={generator.transitions.enabled}
                        onChange={(e) => generator.setTransitions({ ...generator.transitions, enabled: e.target.checked })}
                      />
                      启用转场
                    </label>
                  </div>

                  {generator.transitions.enabled && (
                    <>
                      <div className="param-item">
                        <label>默认转场视频</label>
                        <div className="file-picker">
                          <input
                            type="text"
                            value={generator.transitions.defaultTransition || ""}
                            placeholder="未选择文件"
                            readOnly
                          />
                          <button
                            type="button"
                            className="secondary"
                            onClick={async () => {
                              try {
                                const result = await window.localVideo?.selectFile?.([{ name: 'MP4 Video', extensions: ['mp4'] }]);
                                if (result && !result.canceled && result.filePaths && result.filePaths.length > 0) {
                                  generator.setTransitions({
                                    ...generator.transitions,
                                    defaultTransition: result.filePaths[0]
                                  });
                                }
                              } catch (error) {
                                console.error('[默认转场选择文件] 错误:', error);
                              }
                            }}
                          >
                            选择文件
                          </button>
                        </div>
                      </div>

                      <div className="param-item">
                        <label
                          onMouseEnter={(e) => showTooltip(e, "为特定标签的卡片配置专属转场视频")}
                          onMouseLeave={hideTooltip}
                        >
                          标签转场配置
                        </label>
                        <div className="tag-transition-groups">
                          {generator.transitions.tagTransitionGroups.map((group, groupIndex) => (
                            <div key={group.id} className="tag-transition-group">
                              <div className="group-header">
                                <span>标签组 {groupIndex + 1}</span>
                                <button
                                  type="button"
                                  className="ghost tag-remove"
                                  onClick={() => {
                                    const newGroups = generator.transitions.tagTransitionGroups.filter(g => g.id !== group.id);
                                    generator.setTransitions({
                                      ...generator.transitions,
                                      tagTransitionGroups: newGroups
                                    });
                                  }}
                                >
                                  删除
                                </button>
                              </div>
                              <div className="group-tags">
                                {group.tags.map((tag, tagIndex) => (
                                  <div key={tagIndex} className="tag-item">
                                    {tag}
                                    <button
                                      type="button"
                                      className="ghost tag-remove"
                                      onClick={() => {
                                        const newGroups = [...generator.transitions.tagTransitionGroups];
                                        newGroups[groupIndex] = {
                                          ...group,
                                          tags: group.tags.filter((_, i) => i !== tagIndex)
                                        };
                                        generator.setTransitions({
                                          ...generator.transitions,
                                          tagTransitionGroups: newGroups
                                        });
                                      }}
                                    >
                                      ×
                                    </button>
                                  </div>
                                ))}
                                <button
                                  type="button"
                                  className="ghost tag-add"
                                  onClick={() => {
                                    setTagSearchGroupId(group.id);
                                    setTagSearchText("");
                                  }}
                                >
                                  + 添加标签
                                </button>
                              </div>
                              <div className="group-transition">
                                <input
                                  type="text"
                                  value={group.transitionPath || ""}
                                  placeholder="选择转场视频"
                                  readOnly
                                />
                                <button
                                  type="button"
                                  className="secondary"
                                  onClick={async () => {
                                    try {
                                      const result = await window.localVideo?.selectFile?.([{ name: 'MP4 Video', extensions: ['mp4'] }]);
                                      if (result && !result.canceled && result.filePaths && result.filePaths.length > 0) {
                                        const newGroups = [...generator.transitions.tagTransitionGroups];
                                        newGroups[groupIndex] = {
                                          ...group,
                                          transitionPath: result.filePaths[0]
                                        };
                                        generator.setTransitions({
                                          ...generator.transitions,
                                          tagTransitionGroups: newGroups
                                        });
                                      }
                                    } catch (error) {
                                      console.error('[标签组选择文件] 错误:', error);
                                    }
                                  }}
                                >
                                  选择文件
                                </button>
                              </div>
                            </div>
                          ))}
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => {
                              generator.setTransitions({
                                ...generator.transitions,
                                tagTransitionGroups: [
                                  ...generator.transitions.tagTransitionGroups,
                                  { id: Date.now(), tags: [], transitionPath: null }
                                ]
                              });
                            }}
                          >
                            + 添加标签组
                          </button>
                        </div>
                      </div>

                      {tagSearchGroupId && (
                        <div className="tag-selector-modal" onClick={(e) => {
                          if (e.target.className === 'tag-selector-modal') {
                            setTagSearchGroupId(null);
                            setTagSearchText("");
                          }
                        }}>
                          <div className="tag-selector-content">
                            <div className="tag-selector-header">
                              <h4>选择标签</h4>
                              <input
                                type="text"
                                placeholder="搜索标签..."
                                value={tagSearchText}
                                autoFocus
                                onChange={(e) => setTagSearchText(e.target.value)}
                              />
                              <button
                                type="button"
                                className="ghost"
                                onClick={() => {
                                  setTagSearchGroupId(null);
                                  setTagSearchText("");
                                }}
                              >
                                关闭
                              </button>
                            </div>
                            <div className="tag-selector-list">
                              {generator.allTags
                                .filter(tag => tag.toLowerCase().includes(tagSearchText.toLowerCase()))
                                .map((tag) => {
                                  const groupIndex = generator.transitions.tagTransitionGroups.findIndex(g => g.id === tagSearchGroupId);
                                  const group = generator.transitions.tagTransitionGroups[groupIndex];
                                  const isSelected = group && group.tags && group.tags.includes(tag);

                                  return (
                                    <div
                                      key={tag}
                                      className={`tag-option ${isSelected ? 'is-selected' : ''}`}
                                      onClick={() => {
                                        if (groupIndex !== -1) {
                                          const currentGroup = generator.transitions.tagTransitionGroups[groupIndex];
                                          if (!currentGroup.tags.includes(tag)) {
                                            const newGroups = [...generator.transitions.tagTransitionGroups];
                                            newGroups[groupIndex] = {
                                              ...currentGroup,
                                              tags: [...currentGroup.tags, tag]
                                            };
                                            generator.setTransitions({
                                              ...generator.transitions,
                                              tagTransitionGroups: newGroups
                                            });
                                          }
                                        }
                                        setTagSearchGroupId(null);
                                        setTagSearchText("");
                                      }}
                                    >
                                      <span className="tag-option-icon">#{isSelected ? '✓' : ''}</span>
                                      <span className="tag-option-text">{tag}</span>
                                    </div>
                                  );
                                })}
                            </div>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}

            {/* 预览与生成选项卡 */}
            {activeTab === "preview" && (
              <div className="tab-panel tab-panel-preview">
                <div className="panel-header">
                  <h3>预览与生成</h3>
                </div>

                {/* 序列预览 */}
                <div className="config-group">
                  <h4>序列预览</h4>
                  {generator.previewSequence.length > 0 ? (
                    <>
                      <div className="sequence-stats">
                        <div className="stat-item">
                          <label>片段数量</label>
                          <span>{generator.previewSequence.length}</span>
                        </div>
                        <div className="stat-item">
                          <label>总时长</label>
                          <span>{app.formatTime(generator.previewSequence.length > 0 ? generator.previewSequence[generator.previewSequence.length - 1].endTime : 0)}</span>
                        </div>
                      </div>

                      <div className="sequence-list">
                        {generator.previewSequence.map((item, index) => (
                          <div key={item.id} className="sequence-item">
                            <div className="sequence-order">{index + 1}</div>
                            <div className="sequence-info">
                              <div className="sequence-title">{item.title}</div>
                              <div className="sequence-time">
                                {app.formatTime(item.startTime)} - {app.formatTime(item.endTime)}
                              </div>
                            </div>
                            <div className="sequence-duration">
                              {Math.round(item.duration)}s
                            </div>
                          </div>
                        ))}
                      </div>

                      <button
                        type="button"
                        className="secondary full-width"
                        onClick={generator.generatePreview}
                      >
                        刷新预览
                      </button>
                    </>
                  ) : (
                    <div className="preview-placeholder">
                      <p>点击下方按钮生成序列预览</p>
                      <button
                        type="button"
                        className="secondary"
                        onClick={generator.generatePreview}
                        disabled={generator.selectedCards.length === 0}
                      >
                        预览序列
                      </button>
                    </div>
                  )}
                </div>

                {/* 生成操作 */}
                <div className="config-group">
                  <h4>生成视频</h4>
                  <div className="generator-actions">
                    <button
                      type="button"
                      className="secondary"
                      onClick={handleToggleLogs}
                    >
                      {showLogs ? "隐藏日志" : "查看日志"}
                    </button>
                    <button
                      type="button"
                      className="primary large"
                      onClick={handleRunGenerator}
                      disabled={generator.selectedCards.length === 0 || generator.generating}
                    >
                      {generator.generating ? "生成中..." : "开始生成"}
                    </button>
                  </div>
                </div>

                {/* 进度显示 */}
                {generator.progress && (
                  <div className="config-group">
                    <h4>生成进度</h4>
                    <div className="generator-progress">
                      <div className="progress-header">
                        {generator.progress.label}
                      </div>
                      <div className="progress-bar">
                        <div
                          className="progress-fill"
                          style={{ width: `${(generator.progress.current / generator.progress.total) * 100}%` }}
                        />
                      </div>
                      <div className="progress-text">
                        {generator.progress.current} / {generator.progress.total}
                      </div>
                    </div>
                  </div>
                )}

                {/* 生成结果 */}
                {generator.generationResult && (
                  <div className="config-group">
                    <h4>生成结果</h4>
                    <div className="generator-result">
                      <div className="result-success">
                        ✓ {generator.generationResult.message}
                      </div>
                      {generator.generationResult.outputPath && (
                        <div className="result-path">
                          输出文件: {generator.generationResult.outputPath}
                        </div>
                      )}
                      {generator.generationResult.warnings && generator.generationResult.warnings.length > 0 && (
                        <div className="result-warnings">
                          ⚠️ {generator.generationResult.warnings.join("; ")}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* 日志显示 */}
                {showLogs && (
                  <div className="config-group">
                    <div className="logs-header">
                      <h4>生成日志</h4>
                      <button
                        type="button"
                        className="ghost"
                        onClick={() => generator.setGenerationResult(null)}
                      >
                        清空日志
                      </button>
                    </div>
                    <div className="logs-content">
                      {generator.generationResult?.logs && generator.generationResult.logs.length > 0 ? (
                        generator.generationResult.logs.map((log, index) => (
                          <div key={index} className="log-entry">
                            {log}
                          </div>
                        ))
                      ) : (
                        <div className="logs-empty">
                          {generator.generating ? "等待日志..." : "暂无日志，请先运行生成器"}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {tooltip && (
          <div
            className="generator-tooltip"
            style={{
              left: `${tooltip.x + 10}px`,
              top: `${tooltip.y + 10}px`
            }}
          >
            {tooltip.content}
          </div>
        )}
      </div>
    </section>
  );
}
