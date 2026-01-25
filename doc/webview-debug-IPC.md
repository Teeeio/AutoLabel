# Electron Webview 调试和 IPC 通信经验总结

## 问题描述

在为 B 站预览的 webview 中添加 Z/X 快捷键功能时，遇到以下问题：
1. 功能完全没反应
2. 控制台没有任何日志输出

## 根本原因分析

### 1. Webview 沙箱隔离

**问题**：Electron 的 webview 运行在独立的沙箱进程中，preload 脚本中的 `console.log()` 不会显示在主应用的开发者工具中。

**解决**：需要通过 IPC 将日志从 webview 的 preload 脚本发送到主进程，然后再显示在主应用的控制台。

**实现**：
```javascript
// 在 bilibili-page-preload.cjs 中
const bilibiliLog = (message, ...args) => {
  try {
    ipcRenderer.sendToHost('bilibili:log', { message, args });
  } catch (e) {
    // IPC 还没准备好，忽略
  }
};

// 使用 bilibiliLog 替代 console.log
bilibiliLog('[Bilibili Preload] Script loaded successfully!');
```

**接收端**：
```javascript
// 在 usePreviewWebviewLifecycle.js 的 handleMessage 中
if (event.channel === "bilibili:log") {
  const data = event.args?.[0] || {};
  const { message, args } = data;
  console.log('[B站预览日志]', message, ...(args || []));
  return;
}
```

### 2. 事件监听器冲突

**问题**：尝试在 `initClipRange()` 函数中为 `hStart` 和 `hEnd` 元素添加新的 `pointerdown` 事件监听器，但这些元素已经有 `pointerdown` 监听器了（line 901-902）。

**原因**：
- 现有的 `pointerdown` 监听器调用了 `onPointerDown("start", e)` 和 `onPointerDown("end", e)`
- 这些监听器使用了 `e.preventDefault()`, `e.stopPropagation()`, `e.stopImmediatePropagation()`
- 新添加的监听器可能被阻止触发，或者执行顺序有问题

**错误做法**：
```javascript
// 这样添加的新监听器不会生效
hStart.addEventListener("pointerdown", (e) => {
  frameAdjustState.lastDragHandle = "start";
}, true);
```

**正确做法**：直接在现有的 `onPointerDown` 函数中添加逻辑
```javascript
function onPointerDown(kind, e) {
  if (e.button !== 0) return;

  // 保存最近拖拽的手柄，供 Z/X 快捷键使用
  if (frameAdjustState) {
    frameAdjustState.lastDragHandle = kind;
    bilibiliLog('[Bilibili Z/X] onPointerDown: saved lastDragHandle =', kind);
  }

  // ... 原有逻辑
}
```

## 调试技巧

### 1. 分层调试法

当 webview 功能完全没反应时，按以下顺序排查：

**第一层：确认 preload 脚本是否加载**
```javascript
// 在脚本最开头添加
bilibiliLog('[Bilibili Preload] Script loaded successfully!');
```

**第二层：确认关键函数是否被调用**
```javascript
function initClipRange() {
  bilibiliLog('[Bilibili Z/X] initClipRange called, clipApi:', !!clipApi, 'videoEl:', !!videoEl);
  // ...
}
```

**第三层：确认事件监听器是否添加成功**
```javascript
bilibiliLog('[Bilibili Z/X] Frame adjust state initialized');
bilibiliLog('[Bilibili Z/X] Setting up ZX keyboard event listeners');
```

**第四层：确认事件是否触发**
```javascript
window.addEventListener("keydown", (e) => {
  const lowerKey = e.key?.toLowerCase?.();
  if (["z", "x"].includes(lowerKey)) {
    bilibiliLog('[Bilibili Z/X] Z/X key detected:', lowerKey);
  }
  // ...
});
```

### 2. 检查现有代码

在添加新功能前，先搜索现有代码中是否已经有相关的事件监听器：
```bash
# 搜索是否已有 pointerdown 监听器
grep -n "pointerdown" bilibili-page-preload.cjs
```

如果有，优先修改现有逻辑而不是添加新监听器。

### 3. 避免重复声明

在重构时要小心不要创建重复的变量声明：
```javascript
// 错误：声明了两次
let frameAdjustState = { /*...*/ };
// ... 其他代码
let frameAdjustState = { /*...*/ }; // 重复了！

// 正确：只声明一次
let frameAdjustState = { /*...*/ };
```

## 关键经验

1. **Webview 调试必须使用 IPC 日志转发**
   - preload 脚本的 console.log 不会显示在主应用控制台
   - 必须通过 `ipcRenderer.sendToHost()` 发送
   - 在主进程中监听对应频道并打印

2. **优先修改现有逻辑而非添加新监听器**
   - 检查是否已有相关事件监听器
   - 如果有，直接在现有处理函数中添加逻辑
   - 避免事件监听器冲突

3. **分层添加调试日志**
   - 从脚本加载开始，逐步深入
   - 每一层都要有明确的日志标识
   - 通过日志输出确认执行流程

4. **capture phase (true 参数) 的重要性**
   ```javascript
   // 使用 capture phase (第三个参数为 true)
   element.addEventListener("pointerdown", handler, true);
   ```
   这样可以确保在其他监听器之前捕获事件。

5. **注意事件停止传播**
   - 如果现有代码调用了 `stopPropagation()` 或 `stopImmediatePropagation()`
   - 新添加的监听器可能不会触发
   - 应该修改现有代码而不是添加新监听器

## 文件清单

涉及的关键文件：
- `apps/desktop/src/main/bilibili-page-preload.cjs` - B 端 webview 的 preload 脚本
- `apps/webui/src/hooks/usePreviewWebviewLifecycle.js` - Webview 生命周期和 IPC 消息处理
- `apps/webui/src/pages/BuilderPage.jsx` - Builder 页面组件

## 相关技术点

1. **IPC 通信**
   - `ipcRenderer.sendToHost()` - 从 webview preload 发送到主进程
   - `event.channel` - IPC 消息频道标识
   - `event.args` - IPC 消息参数数组

2. **Webview 事件监听**
   - `ipc-message` 事件 - 监听来自 webview 的 IPC 消息
   - React webview 元素不支持直接的事件属性，需要通过 ref 和 DOM API 添加

3. **事件捕获和冒泡**
   - Capture phase：`addEventListener(eventName, handler, true)`
   - Bubble phase：`addEventListener(eventName, handler, false)` 或省略第三个参数

## 总结

在 Electron webview 中添加功能时：
1. 首先确保有正确的日志输出机制（IPC 日志转发）
2. 检查现有代码中是否已有相关逻辑
3. 优先修改现有逻辑而不是添加新的监听器
4. 分层添加调试日志，逐步排查问题
5. 注意事件传播机制和潜在的冲突

按照这个方法，原本需要多次尝试的问题可以在第一次就定位并解决。
