# 预览区间同步经验总结

## 背景
- 现象：拖动预览播放器的区间滑块后，UI 里的 Preview Range 仍停留在 0~30。
- 预期：拖动后预览栏与 Card Builder 中的区间信息实时同步。

## 原因定位
- 仅依赖 preload 脚本里 `player:range` 事件回传不稳定。
- 某些情况下事件未触发或未被接收，导致 `rangeStart/rangeEnd` 状态没有更新。

## 修复方案
1) 统一区间更新入口
- 新增 `updateRangeState(start, end)`，集中更新 `rangeStart/rangeEnd` 并同步卡片。
- 将拖动/点击/IPC 更新都指向该函数，避免状态更新分散。

2) 增加主动拉取（轮询）兜底
- 通过 `webview.executeJavaScript` 读取播放器进度条 DOM 上的 `dataset.clipStart/clipEnd`。
- 周期性对比当前 `rangeStart/rangeEnd`，若变化则调用 `updateRangeState`。
- 这样即使 `player:range` 没触发，也能同步到最新区间。

3) 保留 IPC 更新路径
- `player:range` 正常触发时仍会更新，并刷新 `lastRangeUpdateRef`，避免轮询抖动。

## 关键实现位置
- `apps/webui/src/App.jsx`
  - `updateRangeState`：统一写入区间状态。
  - 轮询逻辑：`webview.executeJavaScript` 读取 `clipStart/clipEnd`。
- `apps/desktop/src/main/bilibili-page-preload.cjs`
  - 保留 `player:range` 事件发送逻辑作为主要通道。

## 注意事项
- 轮询间隔过短会增加 webview 负担，当前设置在 300~400ms 级别。
- 只有在 `previewUrl` 存在时才轮询，避免无意义执行。
- 如果 Bilibili DOM 结构变动，需要更新进度条选择器。

## 验证步骤
1) 打开预览，拖动区间滑块。
2) 观察预览标题下方与 Card Builder 的 Preview Range 数值是否同步变化。
3) 若不变化，检查 webview 中是否存在 `.bpx-player-progress` 或 `.bpx-player-progress-wrap`。
