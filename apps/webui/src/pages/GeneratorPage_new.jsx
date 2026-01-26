import { useCallback, useState } from "react";
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
