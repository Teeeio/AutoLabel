# 可见性控制功能说明

## 功能概述

为BuilderPage添加了智能的可见性控制,根据视频来源自动设置和禁用可见性选项:

- **本地来源视频**: 强制为私有,选择器禁用(变灰)
- **B站来源视频**: 默认为公开,可自由切换

## 实现细节

### 1. BuilderPage.jsx 改进

#### 可见性选择器增强

```jsx
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
```

**特性**:
- 当 `searchSourceType === "local"` 时,选择器被禁用
- 视觉反馈:透明度降低至50%,光标变为 `not-allowed`
- 动态提示文字根据来源显示不同说明

#### 提示文字优化

```jsx
<div className="builder-hint">
  {app.searchSourceType === "local" ? (
    <>本地来源的视频片段强制为私有，无法分享。</>
  ) : (
    <>私有片段仅保存在本地，公开片段可分享。</>
  )}
</div>
```

**不同来源的提示**:
- **本地源**: "本地来源的视频片段强制为私有,无法分享。"
- **B站源**: "私有片段仅保存在本地,公开片段可分享。"

### 2. App.jsx 逻辑增强

#### 自动设置默认可见性

```jsx
const [searchSourceType, setSearchSourceType] = useState("bilibili");

// 当切换视频来源时,自动设置默认可见性
useEffect(() => {
  setForm((prev) => ({
    ...prev,
    visibility: searchSourceType === "local" ? "private" : "public"
  }));
}, [searchSourceType]);
```

**工作流程**:
1. 用户切换视频来源(B站 ↔ 本地)
2. `useEffect` 监听到 `searchSourceType` 变化
3. 自动更新表单的 `visibility` 字段:
   - `local` → `"private"`
   - `bilibili` → `"public"`

### 3. index.css 样式增强

#### 禁用状态样式

```css
.builder-select:disabled {
  background: #f1f5f9;
  color: #64748b;
  cursor: not-allowed;
  border-color: #e2e8f0;
}

.builder-select:disabled:hover {
  border-color: #e2e8f0;
  cursor: not-allowed;
}
```

**视觉效果**:
- 背景变为浅灰色 (`#f1f5f9`)
- 文字颜色变淡 (`#64748b`)
- 鼠标悬停时不显示可交互状态
- 边框颜色保持灰色,不会变蓝

## 用户体验

### 场景1: 选择本地视频

1. 用户点击"本地"按钮切换来源
2. 可见性选择器自动变为"私有"且禁用(变灰)
3. 提示文字变为"本地来源的视频片段强制为私有,无法分享。"
4. 用户无法修改可见性设置

### 场景2: 选择B站视频

1. 用户点击"B站"按钮切换来源
2. 可见性选择器自动变为"公开"且可用
3. 提示文字变为"私有片段仅保存在本地,公开片段可分享。"
4. 用户可以自由切换可见性

### 场景3: 已有卡片编辑

编辑已有卡片时,可见性保持原值:
- 本地来源卡片: 始终显示为私有,选择器禁用
- B站来源卡片: 显示原有可见性,可修改

## 安全保障

### 前端层面
1. **UI禁用**: 选择器被禁用,用户无法操作
2. **自动设置**: 切换来源时自动重置为正确值
3. **视觉提示**: 清晰的灰显状态和说明文字

### 后端层面
1. **API验证**: 服务器拒绝本地来源卡片的公开设置
2. **强制私有**: 创建/更新时强制本地卡片为私有
3. **错误提示**: 返回明确的错误信息

## 数据一致性

| 操作 | 本地视频 | B站视频 |
|------|---------|---------|
| 创建卡片 | 强制 `private` | 默认 `public` |
| 切换来源 | 自动设为 `private` | 自动设为 `public` |
| UI状态 | 禁用选择器 | 可选择 |
| 服务器存储 | 拒绝接收 | 正常备份 |

## 相关文件

### 修改的文件
1. `apps/webui/src/pages/BuilderPage.jsx` - UI和交互逻辑
2. `apps/webui/src/App.jsx` - 自动设置默认值
3. `apps/webui/src/index.css` - 禁用状态样式

### 相关文件
1. `apps/server/index.js` - 后端验证(已在之前重构中完成)
2. `apps/webui/src/utils/localCardStorage.js` - 本地存储工具
3. `apps/webui/src/hooks/useCardSync.js` - 同步逻辑

## 测试建议

1. **切换来源测试**
   - B站 → 本地: 验证自动变为私有且禁用
   - 本地 → B站: 验证自动变为公开且可用

2. **保存测试**
   - 保存本地卡片: 验证服务器拒绝
   - 保存B站卡片(私有): 验证正常保存
   - 保存B站卡片(公开): 验证正常保存并上传

3. **编辑测试**
   - 编辑本地卡片: 验证选择器禁用
   - 编辑B站卡片: 验证可以修改可见性

4. **视觉测试**
   - 验证禁用状态的视觉效果
   - 验证提示文字正确显示
   - 验证光标状态
