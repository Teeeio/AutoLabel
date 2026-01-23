# 本地预览播放器拖动问题原因与修复总结

日期：2026-01-22

## 问题现象
- 本地预览播放器的左右手柄无法拖动，或只能生效一帧。
- 控制台能看到 `move` 事件持续触发，但 `apply` 只触发一次。

## 根因分析
1. **拖动更新依赖 RAF**
   - 拖动逻辑主要靠 `requestAnimationFrame` 的 `tickDrag` 调用 `applyDragAtX`。
   - 在 Electron/React 组合下，`pointermove` 事件触发正常，但 RAF 回调并没有稳定持续触发，导致拖动只能“应用一次”。

2. **事件通道混用导致拖动链条断裂**
   - 之前混用 `mousemove` + `pointermove`，但缺少严格的 pointer capture 与 pointerId 管理，会导致拖动过程中事件被外层或浏览器吞掉。

## 修复策略
- 引入 **pointer capture** 与 pointerId 记录，保证拖动期间事件稳定归属。
- 在 `handleMove` 中 **直接调用 `applyDragAtX`**，即使 RAF 不触发，也能实时更新手柄位置。
- 保留 RAF 作为平滑层，但不再依赖它作为唯一更新来源。

## 关键改动点
- `apps/webui/src/App.jsx`
  - 新增 `dragPidRef` / `dragTargetRef`，记录 pointerId 与 target。
  - `onPointerDown` 里设置 pointer capture。
  - `handleMove` 中直接调用 `applyDragAtX(dragRef.current.targetX)`。

## 结果
- 左右手柄拖动恢复正常，拖动过程持续更新。
- 缩放逻辑不再在按下时触发，只在拖动结束后触发。

---

如需进一步完全对齐 B 站注入脚本，可考虑：
- 移除 mouse 事件，仅保留 pointer 事件通道。
- 统一在 pointer 事件内处理阻尼与缩放。
