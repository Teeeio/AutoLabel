# B站注入脚本滑块功能深入分析

## 文档概述

**文件**: `apps/desktop/src/main/bilibili-page-preload.cjs`
**函数**: `initClipRange()` (行213-1093)
**目的**: 在B站播放器中注入视频剪辑滑块功能

---

## 1. 整体架构

### 1.1 核心设计思想

B站的滑块功能采用了**直接DOM操作 + RAF动画循环**的架构：

```
用户操作 → 事件监听 → RAF阻尼系统 → 直接DOM操作 → 视觉反馈
                ↓
          Zoom系统
```

**关键特点**：
- ❌ **不使用**虚拟DOM或React状态管理
- ✅ **直接操作**DOM元素的style属性
- ✅ **使用**RAF (requestAnimationFrame) 实现丝滑动画
- ✅ **CSS变量系统**实现高性能样式更新

### 1.2 核心组件

```javascript
// 状态变量（闭包作用域）
let zoomScale = 1;           // 当前缩放比例
let zoomTranslateX = 0;      // 缩放偏移量
let zoomPending = false;     // 拖动时延迟缩放
let baselineLeft = null;     // 未缩放时的左边距
let baselineWidth = null;    // 未缩放时的宽度

// 拖动状态
let dragging = null;         // 当前拖动类型: 'start' | 'end' | 'range'
let dragTargetX = 0;         // 鼠标目标X位置
let dragSmoothX = 0;         // 平滑后的X位置
let dragDamp = 1;            // 阻尼系数
let dragRaf = null;          // RAF循环引用
let dragGrabOffset = 0;      // 鼠标抓取偏移
```

---

## 2. Zoom缩放机制

### 2.1 核心算法

**触发条件**：当选区范围小于阈值时自动放大

```javascript
const applyZoom = () => {
  const r = readRange();
  if (!r) return;
  const span = Math.max(0.05, r.e - r.s);  // 选区时长（秒）
  if (!Number.isFinite(r.d) || r.d <= 0) return;
  const baseWidth = getBaseWidth();
  if (!baseWidth) return;

  // 拖动时延迟缩放
  if (dragging) {
    zoomPending = true;
    return;
  }

  // 计算选区在进度条上的像素宽度
  const spanBasePx = Math.max(0.001, (span / r.d) * baseWidth);

  // 目标：让40像素代表选区
  const zoomTargetSpanPx = 40;
  const zoomMaxScale = 18;

  // 计算需要的缩放比例
  const targetScale = Math.max(
    1,
    Math.min(zoomMaxScale, zoomTargetSpanPx / spanBasePx)
  );

  setZoomScale(targetScale, r, true);
};
```

**关键参数**：
- `zoomTargetSpanPx = 40`：小范围放大到40px
- `zoomMaxScale = 18`：最大放大18倍
- `zoomEase = 0.18`：缩放缓动系数

### 2.2 Baseline系统

**问题**：缩放时需要保持选区中心不变，但DOM元素的`rect.left`会随transform变化

**解决方案**：记录未缩放时的基准状态

```javascript
const captureBaseline = () => {
  const rect = getBaseRect();
  if (!rect.width) return;

  if (zoomScale !== 1) {
    // 已经在缩放状态，不更新baseline
    if (baselineLeft == null || baselineWidth == null) {
      baselineLeft = rect.left - zoomTranslateX;
      baselineWidth = rect.width / zoomScale;
    }
    return;
  }

  // 未缩放状态，记录基准
  baselineLeft = rect.left;
  baselineWidth = rect.width;
};
```

**工作原理**：
```
未缩放时：
  rect.left = 100, rect.width = 1000
  → baselineLeft = 100, baselineWidth = 1000

缩放2倍后：
  rect.left = 100, rect.width = 2000 (transform导致)
  → 保持 baselineLeft = 100, baselineWidth = 1000
  → 使用baseline进行坐标转换
```

### 2.3 坐标转换系统

B站实现了三套坐标转换函数：

#### 2.3.1 screenXToBaseX - 屏幕坐标 → 基准坐标

```javascript
const screenXToBaseX = (clientX, r) => {
  const baseWidth = getBaseWidth();
  if (!baseWidth) return 0;
  captureBaseline();
  if (!baselineWidth) return 0;

  const rectLeft = baselineLeft + zoomTranslateX;
  const scaledWidth = baselineWidth * (zoomScale > 1.001 ? zoomScale : 1);
  const xScaled = clamp(clientX - rectLeft, 0, scaledWidth);

  if (zoomScale > 1.001) {
    return clamp(xScaled / zoomScale, 0, baseWidth);
  }
  return (xScaled / baselineWidth) * baseWidth;
};
```

**用途**：将鼠标位置转换为未缩放坐标系中的位置

#### 2.3.2 baseXToScreenX - 基准坐标 → 屏幕坐标

```javascript
const baseXToScreenX = (xBase, r) => {
  const baseWidth = getBaseWidth();
  captureBaseline();
  if (!baseWidth || !baselineWidth) return baselineLeft || 0;

  if (zoomScale > 1.001) {
    return baselineLeft + zoomTranslateX + xBase * zoomScale;
  }
  return baselineLeft + (xBase / baseWidth) * baselineWidth;
};
```

**用途**：计算元素在缩放后的屏幕位置

#### 2.3.3 baseXToScreenXScaled - 缩放后的屏幕坐标

```javascript
const baseXToScreenXScaled = (xBase) => {
  const baseWidth = getBaseWidth();
  const rect = getBaseRect();
  if (!baseWidth || !rect.width) return rect.left || 0;
  return rect.left + (xBase / baseWidth) * rect.width;
};
```

**用途**：计算tooltip和badge的实际显示位置

### 2.4 Zoom Transform应用

```javascript
const setZoomScale = (scale, r, immediate = false) => {
  const nextScale = immediate
    ? scale
    : zoomScale + (scale - zoomScale) * zoomEase;

  const baseWidth = getBaseWidth();

  // 计算锚点（选区中心）
  const anchorTime = (r.s + r.e) / 2;
  const anchorRatio = anchorTime / r.d;
  const anchorX = anchorRatio * baseWidth;

  captureBaseline();
  const left = baselineLeft ?? getBaseRect().left;
  zoomScale = nextScale;

  baseEl.style.setProperty("transform-origin", "left center", "important");
  baseEl.style.willChange = "transform";

  if (zoomScale === 1) {
    baseEl.style.removeProperty("transform");
    zoomTranslateX = 0;
  } else {
    // 计算translateX保持锚点不变
    const anchorScreen = (baselineLeft ?? left) +
      (baselineWidth ? (anchorX / baseWidth) * baselineWidth : anchorX);
    const translateX = anchorScreen - (baselineLeft ?? left) - anchorX * zoomScale;
    zoomTranslateX = translateX;

    baseEl.style.setProperty(
      "transform",
      `translateX(${zoomTranslateX}px) scaleX(${zoomScale})`,
      "important"
    );
  }

  // 更新滑块的scale
  const inverse = zoomScale ? 1 / zoomScale : 1;
  hStart?.style?.setProperty?.("--clip-scale", inverse);
  hEnd?.style?.setProperty?.("--clip-scale", inverse);
};
```

**关键点**：
1. 使用`translateX`补偿缩放导致的位移
2. 锚点系统保持选区中心不变
3. 使用`!important`覆盖B站原有的样式
4. 滑块使用反比例缩放（zoomScale↑ → clip-scale↓）

---

## 3. RAF阻尼拖动系统

### 3.1 双缓冲平滑算法

**核心思想**：鼠标移动是离散的，直接使用会导致卡顿

```javascript
let dragTargetX = 0;  // 鼠标实际位置（目标）
let dragSmoothX = 0;  // 平滑后的位置（显示）
let dragDamp = 1;     // 阻尼系数

// RAF循环
const tickDrag = () => {
  if (!dragging) return;

  // 计算目标与平滑位置的差值
  const delta = dragTargetX - dragSmoothX;

  // 如果差值很小，直接对齐
  if (Math.abs(delta) < 0.15) {
    dragSmoothX = dragTargetX;
  } else {
    // 使用阻尼系数逐步逼近
    dragSmoothX += delta * dragDamp;
  }

  // 应用平滑后的位置
  applyDragAtX(dragSmoothX);

  // 继续下一帧
  dragRaf = requestAnimationFrame(tickDrag);
};
```

**工作原理**：
```
帧1: targetX=100, smoothX=0
     delta=100, damp=0.33
     smoothX += 100 * 0.33 = 33

帧2: targetX=100, smoothX=33
     delta=67, damp=0.33
     smoothX += 67 * 0.33 = 55

帧3: targetX=100, smoothX=55
     delta=45, damp=0.33
     smoothX += 45 * 0.33 = 70

...逐渐逼近100
```

### 3.2 垂直阻尼（拉弓效果）

**功能**：向上拖动鼠标时减慢速度，模拟拉弓的手感

```javascript
function onPointerMove(e) {
  if (!dragging) return;

  // 更新目标X位置
  dragTargetX = e.clientX;

  // 计算垂直阻尼
  const maxLift = 200;  // 最大向上距离
  const lift = clamp(dragStartY - e.clientY, 0, maxLift);
  const ratio = lift / maxLift;
  const eased = 1 - ratio;
  const dragDamp = (0.02 + 0.98 * eased * eased) / 3;

  // 更新视觉变形
  const dampNorm = clamp(dragDamp * 3, 0, 1);
  const compress = clampActive ? 1 : 0.7 + 0.3 * dampNorm;
  const widen = Math.min(1.25, 1 / compress);

  dragTarget?.style?.setProperty?.("--clip-damp-scale", compress.toFixed(3));
  dragTarget?.style?.setProperty?.("--clip-damp-width", widen.toFixed(3));

  if (!dragRaf) {
    dragRaf = requestAnimationFrame(tickDrag);
  }
}
```

**阻尼公式**：
```
dragDamp = (0.02 + 0.98 * eased * eased) / 3

水平拖动（lift=0）:
  eased = 1 - 0 = 1
  dragDamp = (0.02 + 0.98 * 1) / 3 = 0.33 (正常速度)

向上拖动200px（lift=200）:
  ratio = 200/200 = 1
  eased = 1 - 1 = 0
  dragDamp = (0.02 + 0) / 3 = 0.0067 (极慢)
```

**视觉变形**：
```css
/* 滑块CSS变量 */
--clip-damp-scale: compress;  /* 高度压缩 */
--clip-damp-width: widen;      /* 宽度拉伸 */

width: calc(14px * var(--clip-damp-width));
height: calc(22px * var(--clip-damp-scale));
```

**效果**：
- 水平拖动：14×22px（正常）
- 向上拖动：10×30px（被压扁）
- 达到极限：18×15px（极度压缩）

---

## 4. 拖动状态机

### 4.1 状态转换

```
[空闲] → onPointerDown → [拖动中] → onPointerUp → [空闲]
  ↓                       ↓
[Zoom延迟]              [RAF动画]
```

### 4.2 Pointer Down处理

```javascript
function onPointerDown(kind, e) {
  if (e.button !== 0) return;  // 只响应左键

  // 初始化状态
  dragging = kind;  // 'start' | 'end' | 'range'
  dragPid = e.pointerId;
  dragTarget = e.currentTarget;
  dragStartX = e.clientX;
  dragStartY = e.clientY;
  dragTargetX = e.clientX;
  dragSmoothX = e.clientX;
  dragDamp = 1;

  // 计算抓取偏移
  const targetRect = dragTarget?.getBoundingClientRect?.();
  dragGrabOffset = targetRect && Number.isFinite(targetRect.left)
    ? e.clientX - (targetRect.left + targetRect.width / 2)
    : 0;

  // 记录起始范围
  const range = getRange();
  dragStartRange = range ? { s: range.s, e: range.e } : null;

  // 暂停Zoom RAF
  if (zoomRaf) {
    cancelAnimationFrame(zoomRaf);
    zoomRaf = null;
  }

  // 锁定当前缩放
  if (range) setZoomScale(zoomScale, range, true);

  // 记录播放状态
  wasPlayingOnDrag = !videoEl.paused;
  suppressClamp = true;

  // 捕获指针
  e.target.setPointerCapture(e.pointerId);

  // 立即应用初始位置
  applyDragAtX(e.clientX);

  // 启动RAF循环
  if (!dragRaf) {
    dragRaf = requestAnimationFrame(tickDrag);
  }
}
```

**关键点**：
1. **Pointer Capture**：防止鼠标移出浏览器丢失事件
2. **锁定Zoom**：拖动期间缩放比例不变
3. **抓取偏移**：点击滑块边缘时不会跳动
4. **立即应用**：第一帧不使用RAF，避免延迟感

### 4.3 Pointer Move处理

```javascript
function onPointerMove(e) {
  if (!dragging) return;
  if (dragPid != null && e.pointerId !== dragPid) return;  // 多触点支持

  // 只更新目标位置，不直接操作DOM
  dragTargetX = e.clientX;

  // 计算垂直阻尼
  const maxLift = 200;
  const lift = clamp(dragStartY - e.clientY, 0, maxLift);
  const ratio = lift / maxLift;
  const eased = 1 - ratio;
  const dragDamp = (0.02 + 0.98 * eased * eased) / 3;

  // 更新视觉变形
  const dampNorm = clamp(dragDamp * 3, 0, 1);
  const compress = clampActive ? 1 : 0.7 + 0.3 * dampNorm;
  const widen = Math.min(1.25, 1 / compress);

  dragTarget?.style?.setProperty?.("--clip-damp-scale", compress.toFixed(3));
  dragTarget?.style?.setProperty?.("--clip-damp-width", widen.toFixed(3));

  // RAF循环会在下一帧使用新的dragDamp
  if (!dragRaf) {
    dragRaf = requestAnimationFrame(tickDrag);
  }
}
```

**设计亮点**：
- 事件处理极简：只更新状态，不做DOM操作
- RAF独立运行：以自己的节奏更新界面
- 解耦设计：鼠标频率（60-120Hz）vs 显示频率（60Hz）

### 4.4 Pointer Up处理

```javascript
function onPointerUp(e) {
  if (!dragging) return;
  if (dragPid != null && e.pointerId !== dragPid) return;

  // 应用最终位置
  applyDragAtX(Number.isFinite(dragTargetX) ? dragTargetX : e.clientX);

  // 停止RAF
  if (dragRaf) {
    cancelAnimationFrame(dragRaf);
    dragRaf = null;
  }

  // 释放指针捕获
  if (dragTarget && dragTarget.releasePointerCapture) {
    dragTarget.releasePointerCapture(e.pointerId);
  }

  // 重置视觉变形
  dragTarget?.classList?.remove("__clip_dragging");
  dragTarget?.style?.setProperty?.("--clip-damp-scale", "1");
  dragTarget?.style?.setProperty?.("--clip-damp-width", "1");
  document.body.style.cursor = "";

  // 清理状态
  dragging = null;
  dragTarget = null;
  dragGrabOffset = 0;
  suppressClamp = false;

  // 恢复播放
  if (wasPlayingOnDrag) {
    const r = getRange();
    if (r && dragStartRange && dragStartRange.s !== r.s) {
      videoEl.currentTime = r.s;  // 跳到新的起始位置
      videoEl.play().catch(() => {});
    }
  }
}
```

---

## 5. 渲染系统

### 5.1 Render函数

```javascript
function render() {
  const r = readRange();
  if (!r) return;
  const baseWidth = getBaseWidth();
  if (!baseWidth) return;

  // 应用缩放
  applyZoom();

  // 计算位置（像素）
  const xS = (r.s / r.d) * baseWidth;
  const xE = (r.e / r.d) * baseWidth;

  // 直接设置style（最高效）
  hStart.style.left = `${xS}px`;
  hEnd.style.left = `${xE}px`;
  rangeBar.style.left = `${xS}px`;
  rangeBar.style.width = `${Math.max(0, xE - xS)}px`;
  zoomBand.style.left = `${xS}px`;
  zoomBand.style.width = `${Math.max(0, xE - xS)}px`;

  // Zoom Badge居中
  const center = (xS + xE) / 2;
  if (zoomBadge) {
    const badgeWidth = zoomBadge.offsetWidth || 0;
    const half = badgeWidth ? badgeWidth / 2 : 16;
    const minX = half;
    const maxX = Math.max(minX, baseWidth - half);
    const clamped = clamp(center, minX, maxX);
    zoomBadge.style.left = `${clamped}px`;
  }
}
```

**特点**：
- 直接操作DOM，无虚拟DOM开销
- 使用像素值，避免百分比重计算
- 每次范围变化后调用一次

### 5.2 数据驱动

```javascript
function setRange(s, e) {
  const d = dur();
  if (!d) return;
  const MIN = getMinSpan(d);
  s = clamp(s, 0, d);
  e = clamp(e, s + MIN, d);

  // 存储到DOM元素的dataset
  progressWrap.dataset.clipStart = String(s);
  progressWrap.dataset.clipEnd = String(e);

  render();           // 更新UI
  emitRangeUpdate();  // 通知主进程
}
```

---

## 6. 关键算法分析

### 6.1 最小跨度算法

```javascript
const getMinSpan = (d, baseWidth) => {
  // 基础最小值（取最小）
  const baseMin = Math.min(
    d,                      // 视频总时长
    minSpanMaxSeconds,     // 最大1秒
    Math.max(0.05, d * zoomAssistRatio, zoomAssistSeconds)
  );

  const width = baseWidth || getBaseWidth();
  if (!width || !Number.isFinite(zoomScale) || zoomScale <= 0) return baseMin;

  // Zoom状态下的最小像素时间
  const minPxTime = (minSpanPx / (width * Math.max(zoomScale, 1))) * d;

  return Math.min(d, Math.max(baseMin, minPxTime));
};
```

**参数**：
- `minSpanMaxSeconds = 1`：最大最小跨度1秒
- `minSpanPx = 2`：zoom状态下至少占2像素
- `zoomAssistRatio = 0`：辅助比例（未使用）
- `zoomAssistSeconds = 1`：辅助秒数（未使用）

**计算逻辑**：
```
未缩放（zoomScale=1）:
  minPxTime = (2 / (width * 1)) * duration
  例如：width=1000, duration=60
  minPxTime = (2/1000) * 60 = 0.12秒

缩放2倍（zoomScale=2）:
  minPxTime = (2 / (1000 * 2)) * 60 = 0.06秒

缩放10倍（zoomScale=10）:
  minPxTime = (2 / (1000 * 10)) * 60 = 0.012秒
```

### 6.2 边界保护算法

```javascript
function getRange() {
  const r = readRange();  // 读取dataset
  if (!r) return null;

  // 计算动态最小值
  const MIN = getMinSpan(r.d, baseWidth);
  let s = r.s;
  let e = r.e;

  // 限制范围
  s = clamp(s, 0, r.d);
  e = clamp(e, s + MIN, r.d);

  // 回写dataset
  progressWrap.dataset.clipStart = String(s);
  progressWrap.dataset.clipEnd = String(e);

  return { s, e, d: r.d };
}
```

**保护机制**：
1. **防交叉**：确保 start < end
2. **防越界**：0 ≤ start ≤ end ≤ duration
3. **最小跨度**：end ≥ start + MIN

---

## 7. CSS变量系统

### 7.1 滑块样式

```css
.__clip_handle {
  --clip-base-w: 14px;      /* 基础宽度 */
  --clip-base-h: 22px;      /* 基础高度 */
  --clip-damp-width: 1;     /* 宽度阻尼 */
  --clip-damp-scale: 1;     /* 高度阻尼 */
  --clip-scale: 1;          /* Zoom缩放 */

  width: calc(var(--clip-base-w) * var(--clip-damp-width, 1));
  height: calc(var(--clip-base-h) * var(--clip-damp-scale, 1));
  border-radius: calc(7px * var(--clip-damp-scale, 1));

  transform: translateX(-50%) scaleX(var(--clip-scale, 1)) translateZ(0);
  backface-visibility: hidden;
  will-change: transform;
  cursor: grab;
  transition: width 120ms ease, height 120ms ease, box-shadow 120ms ease;
}
```

### 7.2 动态更新

```javascript
// 垂直阻尼
dragTarget?.style?.setProperty?.("--clip-damp-scale", compress.toFixed(3));
dragTarget?.style?.setProperty?.("--clip-damp-width", widen.toFixed(3));

// Zoom缩放
hStart?.style?.setProperty?.("--clip-scale", inverse);
```

**优势**：
- 高性能：CSS变量更新不触发布局
- GPU加速：transform使用translateZ(0)
- 流畅：will-change提示浏览器优化

---

## 8. 事件处理架构

### 8.1 事件监听器绑定

```javascript
// 滑块事件（直接绑定到元素）
hStart.addEventListener("pointerdown", (e) => onPointerDown("start", e), true);
hEnd.addEventListener("pointerdown", (e) => onPointerDown("end", e), true);

// 阻止默认行为
hStart.addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();
  e.stopImmediatePropagation();
}, true);

// 全局事件（窗口级别）
window.addEventListener("pointermove", onPointerMove, true);
window.addEventListener("pointerup", onPointerUp, true);
window.addEventListener("blur", onPointerUp, true);
window.addEventListener("pointercancel", onPointerUp, true);
```

**关键点**：
1. **useCapture = true**：在捕获阶段处理，优先级最高
2. **Pointer Events**：统一鼠标和触摸事件
3. **Pointer Capture**：锁定指针，防止移出窗口

### 8.2 Pointer Events vs Mouse Events

B站使用Pointer Events的优势：

```javascript
// 传统方式
addEventListener('mousedown', handler);
addEventListener('touchstart', handler);

// Pointer Events（统一方式）
addEventListener('pointerdown', handler);
```

**Pointer Events提供**：
- `pointerId`：区分多触点
- `pointerType`：mouse/pen/touch
- `setPointerCapture()`：锁定指针
- `releasePointerCapture()`：释放指针

---

## 9. 性能优化技巧

### 9.1 RAF节流

**问题**：mousemove事件频率高（120-240Hz），直接操作DOM会导致卡顿

**解决**：使用RAF自然节流到60Hz

```javascript
// mousemove：可能120Hz
dragTargetX = e.clientX;  // 只更新变量

// RAF：固定60Hz
const tickDrag = () => {
  applyDragAtX(dragSmoothX);  // 实际操作DOM
  dragRaf = requestAnimationFrame(tickDrag);
};
```

### 9.2 基准缓存

**问题**：`getBoundingClientRect()`在缩放时返回不同值

**解决**：缓存未缩放时的基准值

```javascript
const captureBaseline = () => {
  const rect = getBaseRect();

  if (zoomScale !== 1) {
    // 已在缩放状态，使用缓存
    if (baselineLeft == null || baselineWidth == null) {
      baselineLeft = rect.left - zoomTranslateX;
      baselineWidth = rect.width / zoomScale;
    }
    return;  // 不更新缓存
  }

  // 未缩放状态，记录缓存
  baselineLeft = rect.left;
  baselineWidth = rect.width;
};
```

### 9.3 批量DOM操作

```javascript
// 错误：多次重绘
hStart.style.left = x1 + 'px';
hStart.style.transform = '...';
hStart.style.width = '...';

// 正确：一次重绘
hStart.style.cssText = `
  left: ${x1}px;
  transform: ...;
  width: ...;
`;
```

但B站使用了更高效的方式：

```javascript
// 使用CSS变量，不触发重排
hStart.style.setProperty("--clip-scale", inverse);
```

---

## 10. 与React实现的对比

| 特性 | B站注入脚本 | React实现 |
|------|-------------|-----------|
| **状态管理** | 闭包变量 | useState/useRef |
| **DOM操作** | 直接操作DOM | 通过虚拟DOM |
| **事件处理** | Pointer Events + Capture | 合成事件 + Bubble |
| **动画系统** | RAF + 双缓冲 | useState + useEffect |
| **样式更新** | CSS变量 | Inline style对象 |
| **性能** | 原生速度 | 虚拟DOM开销 |
| **复杂度** | 低（直接） | 高（抽象） |

### React适配的关键问题

1. **useEffect依赖地狱**
   ```javascript
   // ❌ 错误：依赖太多导致频繁重新绑定
   useEffect(() => { ... }, [rangeStart, rangeEnd, ...]);

   // ✅ 正确：只依赖duration
   useEffect(() => { ... }, [duration]);
   ```

2. **闭包陷阱**
   ```javascript
   // ❌ 错误：使用闭包中的旧值
   const applyDrag = () => {
     handleRangeChange(dragRef.current.start + delta, rangeEnd);
   };

   // ✅ 正确：通过ref获取最新值
   const applyDrag = () => {
     const currentEnd = endHandleRef.current?.getBoundingClientRect();
     handleRangeChange(dragRef.current.start + delta, currentEnd);
   };
   ```

3. **状态同步**
   ```javascript
   // ❌ 错误：React异步更新导致不一致
   setRangeStart(newStart);
   setRangeEnd(newEnd);
   render();  // 可能使用了旧值

   // ✅ 正确：直接操作DOM
   progressWrap.dataset.clipStart = newStart;
   progressWrap.dataset.clipEnd = newEnd;
   render();  // 立即生效
   ```

---

## 11. 核心算法总结

### 11.1 坐标转换流程

```
鼠标坐标（clientX）
  ↓ screenXToBaseX()
基准坐标（考虑缩放）
  ↓ baseXToScreenX()
屏幕坐标（应用缩放）
  ↓ DOM操作
元素位置
```

### 11.2 拖动流程

```
1. onPointerDown
   - 初始化状态
   - 计算grabOffset
   - 锁定Zoom
   - 启动RAF

2. onPointerMove
   - 更新dragTargetX
   - 计算垂直阻尼
   - 更新CSS变量
   - RAF自动运行

3. tickDrag (RAF)
   - 计算平滑位置
   - applyDragAtX()
   - 请求下一帧

4. onPointerUp
   - 应用最终位置
   - 恢复播放
   - 触发Zoom更新
```

### 11.3 Zoom流程

```
1. setRange() 改变范围
   ↓
2. render() 调用 applyZoom()
   ↓
3. applyZoom() 检查dragging
   - 如果正在拖动 → 设置zoomPending = true
   - 如果空闲 → 计算并应用缩放
   ↓
4. onPointerUp() 检查zoomPending
   - 如果为true → 调用applyZoom()
```

---

## 12. 最佳实践总结

### 12.1 DO's（推荐做法）

✅ **直接操作DOM**：对于高频更新的元素，直接操作style
✅ **RAF动画**：使用requestAnimationFrame实现60fps动画
✅ **Pointer Events**：统一鼠标和触摸事件处理
✅ **CSS变量**：用于动态样式，避免重排
✅ **基准缓存**：缓存不可变的基准值
✅ **双缓冲**：分离目标值和平滑值
✅ **Pointer Capture**：防止指针移出窗口

### 12.2 DON'Ts（避免做法）

❌ **虚拟DOM**：对于高频更新（60fps），虚拟DOM开销过大
❌ **useEffect过度依赖**：导致频繁重新绑定
❌ **闭包陷阱**：在回调中使用过时的状态值
❌ **同步RAF和React**：两者异步系统会冲突
❌ **忽略缓存**：重复计算getBoundingClientRect()

---

## 13. 代码质量分析

### 13.1 优点

1. **性能优异**：
   - 直接DOM操作，无虚拟DOM开销
   - RAF节流，自然限制到60fps
   - CSS变量更新不触发布局

2. **架构清晰**：
   - 单向数据流
   - 职责分离（zoom/drag/render独立）
   - 闭包封装，无全局污染

3. **用户体验好**：
   - RAF平滑：丝滑跟手
   - 垂直阻尼：拉弓手感
   - 视觉反馈：滑块变形

4. **兼容性强**：
   - Pointer Events统一鼠标触摸
   - getBoundingClientRect兼容性好
   - dataset属性广泛支持

### 13.2 改进空间

1. **类型安全**：缺少TypeScript类型定义
2. **错误处理**：缺少try-catch保护
3. **内存管理**：RAF未清理可能导致内存泄漏
4. **可测试性**：闭包封装难以单元测试

---

## 14. React迁移建议

基于B站的实现经验，在React中实现类似功能需要注意：

### 14.1 使用ref管理高频状态

```javascript
// ❌ 错误：useState导致重渲染
const [dragTargetX, setDragTargetX] = useState(0);

// ✅ 正确：useRef不触发重渲染
const dragTargetXRef = useRef(0);
const update = () => {
  dragTargetXRef.current = clientX;
};
```

### 14.2 最小化useEffect依赖

```javascript
// ❌ 错误：依赖太多导致频繁重新绑定
useEffect(() => {
  // ...事件处理
}, [rangeStart, rangeEnd, handleRangeChange, ...]);

// ✅ 正确：只依赖真正的外部值
useEffect(() => {
  // ...事件处理（通过ref获取最新值）
}, [duration]);  // duration在拖动期间不变
```

### 14.3 分离RAF和React

```javascript
// ❌ 错误：在useEffect中启动RAF
useEffect(() => {
  const raf = requestAnimationFrame(() => { ... });
  return () => cancelAnimationFrame(raf);
}, [state]);  // state变化会重启RAF

// ✅ 正确：RAF独立运行，通过ref通信
const rafRef = useRef(null);
const startRAF = () => {
  const tick = () => {
    // 使用ref.current获取最新状态
    tickRAF();
  };
  rafRef.current = requestAnimationFrame(tick);
};
```

---

## 15. 关键算法公式

### 15.1 Zoom缩放公式

```
目标：让选区占zoomTargetSpanPx像素

spanBasePx = (span / duration) * baseWidth
targetScale = clamp(zoomTargetSpanPx / spanBasePx, 1, zoomMaxScale)

translateX = anchorScreen - baselineLeft - anchorX * zoomScale
          = baselineLeft + (anchorX / baseWidth) * baselineWidth - baselineLeft - anchorX * zoomScale
          = anchorX * (baselineWidth / baseWidth) - anchorX * zoomScale
          = anchorX * (1 - zoomScale)  (当baselineWidth == baseWidth时)
```

### 15.2 垂直阻尼公式

```
lift = clamp(startY - currentY, 0, maxLift)
ratio = lift / maxLift
eased = 1 - ratio
damp = (0.02 + 0.98 * eased²) / 3

damp范围：[0.0067, 0.33]
- 水平：damp = 0.33
- 向上200px：damp = 0.0067

compress = 0.7 + 0.3 * (damp * 3)
widen = 1 / compress

compress范围：[0.7, 1]
- damp=0.0067：compress=0.7
- damp=0.33：compress=1
```

### 15.3 RAF平滑公式

```
delta = dragTargetX - dragSmoothX
if (|delta| < 0.15) {
  dragSmoothX = dragTargetX;  // 直接对齐
} else {
  dragSmoothX += delta * dragDamp;  // 逐步逼近
}
```

---

## 16. 与我们实现的差异对比

| 特性 | B站原版 | 我们实现 | 状态 |
|------|---------|---------|------|
| Zoom应用 | 直接DOM transform | React状态+useMemo | ❌ 已修复为直接DOM |
| RAF循环 | 独立运行 | useEffect依赖过多 | ❌ 已修复依赖 |
| 坐标转换 | baseline系统 | 简化计算 | ❌ 需要实现 |
| 垂直阻尼 | 完整实现 | 完整实现 | ✅ 正确 |
| 拖动平滑 | 双缓冲RAF | 双缓冲RAF | ✅ 正确 |

---

## 17. 核心要点总结

1. **直接DOM操作**：对于高频更新的UI元素，直接操作DOM比虚拟DOM更高效
2. **RAF动画**：使用requestAnimationFrame实现稳定的60fps动画
3. **基准系统**：缓存不可变的基准值，避免重复计算
4. **CSS变量**：用于动态样式，性能优于inline style
5. **双缓冲**：分离目标值和平滑值，实现丝滑跟手
6. **Pointer Events**：统一鼠标和触摸，支持多触点
7. **Pointer Capture**：锁定指针，防止移出窗口
8. **最小依赖**：useEffect只依赖真正的外部值

---

**文档版本**：1.0
**创建日期**：2025-01-21
**作者**：Claude Code
**分析文件**：`apps/desktop/src/main/bilibili-page-preload.cjs`
