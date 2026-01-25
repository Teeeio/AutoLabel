# 卡片设计更新 - 故障排查指南

## 更新内容

已成功更新 BuilderPage（编辑器页面）的卡片设计：

### 新设计特点：
- **上方**：16:9 预览窗口（带渐变背景占位）
- **中间**：标题、可见性标签、时长、来源
- **下方**：操作按钮（加载、删除）
- **布局**：响应式网格（`repeat(auto-fill, minmax(280px, 1fr))`）
- **删除了**：CV ID 和 BVID 显示（这些只在详情页显示）

## 为什么看不到更新？

### 可能原因及解决方案：

#### 1. ⚠️ 最常见：需要完全重启应用
**问题**：浏览器刷新（F5 或 Ctrl+R）**不会**更新 Electron 应用
**解决**：
1. 完全关闭应用（Alt+F4 或点击关闭按钮）
2. 重新启动应用
3. 导航到**编辑器**页面（不是管理页面）

#### 2. 🔍 查看错误的页面
**问题**：管理页面和编辑器页面有不同的卡片设计
**解决**：
- 确保你在**编辑器页面**（BuilderPage）
- 新设计只影响编辑器页面的"最近片段"部分
- 管理页面的卡片设计没有改变

#### 3. 🌐 浏览器缓存
**问题**：浏览器缓存了旧的 CSS/JS 文件
**解决**：
1. 打开开发者工具（Ctrl+Shift+I 或 F12）
2. 右键点击浏览器刷新按钮
3. 选择"清空缓存并硬性重新加载"
4. 或使用快捷键：`Ctrl+Shift+R`（Windows）/ `Cmd+Shift+R`（Mac）

#### 4. 📦 构建未生效
**问题**：构建文件未正确生成
**解决**：
1. 检查 `apps/webui/dist/assets/` 目录
2. 确认文件时间戳是最近的
3. 重新运行：`npm run build:webui`

## 验证步骤

### 1. 检查构建输出

文件 `apps/webui/dist/assets/` 应包含：
- `index-DEDn8hdz.css`（或类似名称，约 60KB）
- `index-DBgOw8sA.js`（或类似名称，约 377KB）

### 2. 检查控制台日志

打开开发者工具（F12），应该看到：
```
[BuilderPage] Rendered with new card design X cards
```

### 3. 检查网络请求

在开发者工具的 Network 标签页：
1. 刷新页面
2. 查找 `index-*.js` 和 `index-*.css` 请求
3. 确认状态码是 200
4. 确认文件大小正确（JS 约 377KB，CSS 约 60KB）

### 4. 验证 HTML 结构

在开发者工具的 Elements 标签页：
1. 找到 `.save-items` 容器
2. 展开 `.save-item` 元素
3. 应该看到：
   ```html
   <div class="save-item">
     <div class="save-item-preview">
       <div class="save-item-video-placeholder">...</div>
     </div>
     <div class="save-item-info">
       <div class="save-item-header">...</div>
       <div class="save-item-meta">...</div>
       <div class="save-item-actions">...</div>
     </div>
   </div>
   ```

### 5. 验证 CSS 加载

在开发者工具的 Elements 标签页：
1. 选中任意 `.save-item` 元素
2. 在右侧 Styles 面板查看
3. 应该看到以下样式已应用：
   - `display: flex`
   - `flex-direction: column`
   - `border-radius: 12px`
   - `grid-template-columns: repeat(auto-fill, minmax(280px, 1fr))`（在父元素上）

## 新设计预览

已创建预览文件：`CARD_DESIGN_PREVIEW.html`

在浏览器中打开此文件可查看新设计的外观：
```
CARD_DESIGN_PREVIEW.html
```

## 技术细节

### 修改的文件：

1. **`apps/webui/src/pages/BuilderPage.jsx`**
   - 行 8: 添加了调试日志
   - 行 386-425: 完全重构了卡片 HTML 结构

2. **`apps/webui/src/index.css`**
   - 行 1949-2101: 添加了新的卡片样式

### CSS 网格布局：
```css
.save-items {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
}
```

这会创建一个响应式网格：
- 最小列宽：280px
- 自动填充可用空间
- 列间距：16px

### 卡片结构：
```
save-item (列, flex-direction: column)
├── save-item-preview (16:9 宽高比)
│   └── save-item-video-placeholder (渐变背景)
└── save-item-info (padding: 12px, flex column)
    ├── save-item-header (flex row, space-between)
    │   ├── save-item-title (标题, 2行截断)
    │   └── save-item-visibility (可见性徽章)
    ├── save-item-meta (时长、来源)
    └── save-item-actions (按钮, 上边框分隔)
```

## 如果还是不行

### 最后的调试步骤：

1. **清除所有缓存**：
   ```bash
   # 在项目目录运行
   rm -rf apps/webui/dist
   npm run build:webui
   ```

2. **检查 Electron 加载的 URL**：
   - 打开开发者工具
   - 在 Console 中运行：`window.location.href`
   - 确认指向正确的 `dist/index.html`

3. **强制重新加载**：
   - 完全关闭应用
   - 等待 5 秒
   - 重新启动应用
   - 使用 `Ctrl+Shift+R` 硬性刷新

4. **查看实际渲染**：
   - 打开 `CARD_DESIGN_PREVIEW.html` 文件
   - 这是新设计的独立预览
   - 如果这个看起来正常，说明 CSS 是正确的

## 成功标志

当更新成功后，你应该看到：
- ✅ 卡片以网格布局排列（不是单列）
- ✅ 每个卡片上方有 16:9 的渐变色预览区域
- ✅ 标题最多显示 2 行，超出会被截断（...）
- ✅ 可见性标签在右上角（🌐 公开 或 🔒 私有）
- ✅ 时长显示格式：⏱ 01:23 - 02:45
- ✅ 来源显示：🎵 B站 或 📁 本地
- ✅ 底部有两个按钮：📋 加载 和 🗑 删除
- ✅ 悬停时卡片会轻微上移并显示蓝色阴影

## 截图对比

### 旧设计（单列布局）：
```
┌─────────────────────────┐
│ 卡片标题                 │
│ ⏱ 01:23 - 02:45         │
│ 🎵 B站                   │
└─────────────────────────┘
```

### 新设计（网格布局）：
```
┌──────────┐  ┌──────────┐  ┌──────────┐
│          │  │          │  │          │
│  预览    │  │  预览    │  │  预览    │
│          │  │          │  │          │
├──────────┤  ├──────────┤  ├──────────┤
│ 标题...  │  │ 标题...  │  │ 标题...  │
│ ⏱ 1:23.. │  │ ⏱ 1:23.. │  │ ⏱ 1:23.. │
│ [加载][删]│  │ [加载][删]│  │ [加载][删]│
└──────────┘  └──────────┘  └──────────┘
```
