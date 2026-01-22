# 本地实现 vs B站注入脚本 - 深度对比分析

## 文档目的

系统性对比本地视频播放器的滑块实现与B站注入脚本的实现，排查所有差异。

---

## 1. DOM结构对比

### B站注入脚本结构

```
progressWrap (.bpx-player-progress-wrap) - position: relative
├── baseEl (.bpx-player-progress) - position: relative
│   ├── root (__clip_root) - position: absolute, left:0, right:0, top:0, bottom:0
│   │   ├── rangeBar (__clip_range) - position: absolute
│   │   ├── hStart (__clip_handle __clip_start) - position: absolute, top: -10px
│   │   └── hEnd (__clip_handle __clip_end) - position: absolute, top: -10px
│   └── (B站原有的进度条UI元素)
└── zoomOverlay
    └── zoomBadge
```

**关键点**：
- baseEl是B站播放器的**原生进度条元素**
- root覆盖整个baseEl（`left:0, right:0, top:0, bottom:0`）
- 滑块位置：`top: -10px`，在进度条**上方**，不在内部
- baseEl应用transform缩放

### 本地实现结构

```
timeline (position: relative, height: 64px)
└── timelineBar (position: absolute, left:0, right:0)
    ├── selection (position: absolute)
    ├── startHandle (position: absolute, top: 50%, marginTop: -14px)
    └── endHandle (position: absolute, top: 50%, marginTop: -14px)
```

**当前状态**：
- timelineBar是**自定义的**进度条背景（灰色条）
- 滑块在timelineBar**内部**
- 滑块垂直居中：`top: 50%, marginTop: -14px`

---

## 2. 坐标系统对比

### B站实现

```javascript
// 第341-343行
const getBaseWidth = () => {
  const width = baseEl.offsetWidth;  // 优先使用offsetWidth
  if (Number.isFinite(width) && width > 0) return width;
  const rect = getBaseRect();
  return rect.width || null;
};

// 第340行
const getBaseRect = () => baseEl.getBoundingClientRect();

// 第679-682行（render函数）
const baseWidth = getBaseWidth();
const xS = (r.s / r.d) * baseWidth;  // 未缩放的像素值
hStart.style.left = `${xS}px`;
```

### 本地实现

```javascript
const getBaseWidth = () => {
  const width = timelineBarRef.current.offsetWidth;
  if (Number.isFinite(width) && width > 0) return width;
  const rect = timelineBarRef.current.getBoundingClientRect();
  return rect.width || null;
};

// ✅ 已修复为和B站一致

const xS = (rangeStart / duration) * baseWidth;
startHandleRef.current.style.left = `${xS}px`;
```

---

## 3. Transform应用对比

### B站实现

```javascript
// 第422-440行（setZoomScale函数）
baseEl.style.setProperty("transform-origin", "left center", "important");
baseEl.style.willChange = "transform";

if (zoomScale === 1) {
  baseEl.style.removeProperty("transform");
} else {
  const translateX = anchorScreen - baselineLeft - anchorX * zoomScale;
  baseEl.style.setProperty(
    "transform",
    `translateX(${zoomTranslateX}px) scaleX(${zoomScale})`,
    "important"
  );
}

// 第451-453行
const inverse = zoomScale ? 1 / zoomScale : 1;
hStart?.style?.setProperty?.("--clip-scale", inverse);
hEnd?.style?.setProperty?.("--clip-scale", inverse);
```

**关键点**：
- transform应用到baseEl（**整个进度条元素**）
- 使用 `!important` 覆盖原有样式
- 滑块的 `--clip-scale` 是反比例

### 本地实现

```javascript
// ✅ 完全一致
timelineBarRef.current.style.setProperty("transform-origin", "left center", "important");
timelineBarRef.current.style.willChange = "transform";

if (nextScale === 1) {
  timelineBarRef.current.style.removeProperty("transform");
} else {
  const transformValue = `translateX(${translateX}px) scaleX(${nextScale})`;
  timelineBarRef.current.style.setProperty("transform", transformValue, "important");
}

const inverse = nextScale ? 1 / nextScale : 1;
startHandleRef.current.style.setProperty("--clip-scale", String(inverse));
```

---

## 4. CSS样式对比

### B站注入脚本CSS

```css
/* 第232-249行 */
.__clip_handle {
  --clip-base-w: 14px;
  --clip-base-h: 22px;
  width: calc(var(--clip-base-w) * var(--clip-damp-width, 1));
  height: calc(var(--clip-base-h) * var(--clip-damp-scale, 1));
  border-radius: calc(7px * var(--clip-damp-scale, 1));
  background: linear-gradient(180deg, #e9f7ff 0%, #bfe9ff 100%);
  border: 2px solid #29b6ff;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3),
    inset 0 1px 0 rgba(255, 255, 255, 0.6);
  transform: translateX(-50%) scaleX(var(--clip-scale, 1)) translateZ(0);
  backface-visibility: hidden;
  will-change: transform;
  cursor: grab;
  transition: width 120ms ease, height 120ms ease, box-shadow 120ms ease;
}

/* 第594-597行 - inline style */
position: absolute,
top: "-10px",
pointerEvents: "auto",
cursor: "grab"
```

### 本地实现CSS

```css
/* local-video.css 第64-79行 */
.__clip_handle {
  --clip-base-w: 18px;  /* 增大了 */
  --clip-base-h: 28px;  /* 增大了 */
  width: calc(var(--clip-base-w) * var(--clip-damp-width, 1));
  height: calc(var(--clip-base-h) * var(--clip-damp-scale, 1));
  border-radius: calc(9px * var(--clip-damp-scale, 1));
  background: linear-gradient(180deg, #e9f7ff 0%, #bfe9ff 100%);
  border: 2px solid #29b6ff;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3),
    inset 0 1px 0 rgba(255, 255, 255, 0.6);
  transform: translateX(-50%) scaleX(var(--clip-scale, 1)) translateZ(0);
  backface-visibility: hidden;
  will-change: transform;
  cursor: grab;
  transition: width 120ms ease, height 120ms ease, box-shadow 120ms ease;
}
```

**差异**：
- 本地的滑块尺寸更大（18×28 vs 14×22）
- 本地的滑块位置：`top: 50%, marginTop: -14px`（居中）
- B站的滑块位置：`top: -10px`（在上方）

---

## 5. 关键差异总结

| 项目 | B站注入脚本 | 本地实现 | 状态 |
|------|-------------|---------|------|
| **baseEl** | B站原生进度条元素 | 自定义timelineBar | ⚠️ 不同 |
| **滑块位置** | `top: -10px`（在进度条上方） | `top: 50%, marginTop: -14px`（居中） | ❌ 不同 |
| **滑块尺寸** | 14×22px | 18×28px | ⚠️ 不同 |
| **DOM嵌套** | root覆盖baseEl（left:0, right:0, top:0, bottom:0） | 滑块在timelineBar内部 | ⚠️ 不同 |
| **getBaseWidth** | 优先用`offsetWidth` | 用`getBoundingClientRect().width` | ✅ 已修复 |
| **transform应用** | 完全一致 | 完全一致 | ✅ 一致 |
| **坐标计算** | 未缩放像素值 | 未缩放像素值 | ✅ 一致 |
| **--clip-scale** | 反比例缩放 | 反比例缩放 | ✅ 一致 |

---

## 6. 可能的问题点

### 问题1: 滑块位置差异

**B站**: `top: -10px` - 滑块在进度条**上方**
**本地**: `top: 50%, marginTop: -14px` - 滑块在进度条**内部居中**

**影响**：当timelineBar应用transform缩放时，如果滑块在内部，其定位也会受transform影响。

### 问题2: baseEl的本质差异

**B站**: baseEl是**B站播放器的原生进度条元素**，包含很多B站自身的UI元素
**本地**: timelineBar是**我们自定义的灰色背景条**

**影响**：B站的原生进度条可能有特定的样式或布局，而我们的灰色条可能缺少某些CSS属性。

### 问题3: root的覆盖范围

**B站**: root用 `left:0, right:0, top:0, bottom:0` 覆盖**整个**baseEl
**本地**: 滑块直接在timelineBar内部，没有root包裹层

**影响**：B站的root作为overlay层，可能提供了额外的定位参考系。

---

## 7. 建议的修复方向

### 选项A: 完全复制B站的DOM结构（推荐）

创建一个root层，完全复制B站的结构：

```javascript
// timelineBar作为baseEl
<div ref={timelineBarRef} style={{ position: 'relative' }}>
  {/* root覆盖层 */}
  <div className="__clip_root" style={{
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    pointerEvents: 'none'
  }}>
    <div ref={selectionRef} data-role="selection" style={{
      position: 'absolute',
      top: '0',
      bottom: '0',
      left: '0',
      width: '0'
    }} />
    <div ref={startHandleRef} data-role="start-handle" className="__clip_handle __clip_start" style={{
      position: 'absolute',
      top: '-10px',  // B站的位置
      pointerEvents: 'auto'
    }} />
    <div ref={endHandleRef} data-role="end-handle" className="__clip_handle __clip_end" style={{
      position: 'absolute',
      top: '-10px',
      pointerEvents: 'auto'
    }} />
  </div>
</div>
```

### 选项B: 调整滑块位置和timelineBar样式

保持当前结构，但：
1. 将滑块移到timelineBar外部
2. 调整timelineBar为透明或半透明
3. 滑块用 `top: -10px` 定位

---

## 8. 测试方法

1. **检查baseEl的宽度**：`console.log('baseWidth:', getBaseWidth())`
2. **检查滑块的left值**：`console.log('startHandle left:', startHandleRef.current.style.left)`
3. **检查transform是否正确应用**：`console.log('timelineBar transform:', timelineBarRef.current.style.transform)`
4. **检查--clip-scale**：`console.log('clip-scale:', getComputedStyle(startHandleRef.current).getPropertyValue('--clip-scale'))`
5. **视觉对比**：截图对比B站和本地的缩放效果

---

**文档版本**：1.0
**创建日期**：2025-01-21
**作者**：Claude Code
