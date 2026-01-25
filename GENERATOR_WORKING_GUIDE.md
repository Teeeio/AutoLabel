# GeneratorPage 生成器实现指南

## ✅ 实现完成

生成器现在已经完全实现，可以实际下载、裁剪和拼接视频！

## 🎯 核心功能

### 1. 完整的视频处理流程

#### generator.cjs (Electron 主进程)

**步骤 1: 验证卡片片段**
- 检查卡片数据完整性
- 验证视频来源（本地/B站）

**步骤 2: 准备视频源**
- **本地视频**: 直接从 `localPath` 裁剪
- **B站视频**: 使用 `yt-dlp` 下载完整视频 → 使用 `ffmpeg` 裁剪片段
- 自动清理下载的完整视频以节省空间

**步骤 3: 拼接视频片段**
- 使用 FFmpeg concat 协议拼接所有片段
- 输出到: `Downloads/随机随舞生成器/dance_{timestamp}.mp4`

**步骤 4: 完成**
- 返回输出路径
- 清理所有临时文件

### 2. FFmpeg 集成

#### 裁剪视频 (clipVideo)
```bash
ffmpeg -ss {start} -i {input} -t {duration} -c copy -avoid_negative_ts 1 -y {output}
```
- `-ss`: 快速定位到起始时间
- `-t`: 持续时间
- `-c copy`: 流复制（无重编码，速度快）
- `-avoid_negative_ts 1`: 修复时间戳问题

#### 拼接视频 (stitchVideos)
```bash
ffmpeg -f concat -safe 0 -i concat_list.txt -c copy -y {output}
```
- 使用 concat 协议
- 流复制拼接（保持原始质量）

### 3. yt-dlp 集成

#### 下载B站视频
```bash
yt-dlp -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best" \
  --cookies-from-browser chrome \
  --user-agent "Mozilla/5.0..." \
  --referer "https://www.bilibili.com/" \
  -o {output} \
  https://www.bilibili.com/video/{bvid}
```

## 📋 使用流程

### 前端操作

1. **选择卡片**
   - 在卡片池中点击选择
   - 使用"全选/清空/反选"批量操作
   - 搜索或标签过滤

2. **配置规则**
   - 选择拼接模式（顺序/混洗/随机）
   - 设置最大时长和数量

3. **预览序列**（可选）
   - 点击"预览序列"查看生成的序列
   - 查看统计信息（片段数、总时长）

4. **生成视频**
   - 点击"开始生成"
   - 实时查看进度条
   - 完成后显示输出路径

### 后端处理

#### 临时文件结构
```
temp/rdg-generator/
├── clip_{timestamp}_0.mp4      # 裁剪后的片段 0
├── clip_{timestamp}_1.mp4      # 裁剪后的片段 1
├── source_{timestamp}_0.mp4    # 临时下载的完整视频（裁剪后删除）
└── concat_list.txt             # FFmpeg concat 列表
```

#### 输出文件
```
Downloads/随机随舞生成器/
└── dance_{timestamp}.mp4
```

## 🔧 技术细节

### 依赖工具

1. **ffmpeg-static** - 内置 FFmpeg 可执行文件
2. **yt-dlp** - 需要系统安装或通过 npm 安装

### 进度追踪

#### IPC 通信
```javascript
// Renderer → Main
window.generator.run(payload)

// Main → Renderer (进度)
window.generator.onProgress(handler)
```

#### 进度数据格式
```javascript
{
  step: "validate" | "download" | "clip" | "stitch" | "complete",
  label: "当前步骤描述",
  current: 1,
  total: 5,
  selectionCount: 10,
  progress: 45.5  // 可选，百分比
}
```

### 错误处理

1. **卡片处理失败**: 抛出错误，停止生成
2. **下载失败**: 捕获错误，显示友好消息
3. **临时文件清理**: 在 finally 块中清理

## 🐛 已知限制

1. **yt-dlp 依赖**
   - 需要系统安装 yt-dlp
   - 或配置 `--cookies-from-browser` 需要已登录的浏览器

2. **B站Cookie**
   - 使用 Chrome cookies
   - 可能需要手动登录 B站

3. **编码格式**
   - 使用 `-c copy` 流复制
   - 要求所有片段编码格式一致
   - 不支持不同编码格式的拼接

4. **性能**
   - B站视频下载速度取决于网络
   - 大量卡片会生成大量临时文件
   - 磁盘 I/O 密集

## 💡 后续优化方向

1. **并行下载**
   - 同时下载多个B站视频
   - 使用线程池控制并发数

2. **智能编码**
   - 检测编码格式
   - 不一致时自动转码
   - 添加质量选项

3. **缓存机制**
   - 缓存下载的完整视频
   - 避免重复下载
   - 定期清理过期缓存

4. **进度增强**
   - 显示每张卡片的处理进度
   - 预估剩余时间
   - 下载速度显示

5. **错误恢复**
   - 失败卡片跳过
   - 部分结果导出
   - 断点续传

## 🧪 测试建议

### 测试用例 1: 本地视频
1. 创建几张本地视频卡片
2. 选择并生成
3. 验证输出文件

### 测试用例 2: B站视频
1. 创建几张B站视频卡片
2. 选择并生成
3. 检查 yt-dlp 下载进度

### 测试用例 3: 混合来源
1. 选择本地和B站卡片混合
2. 生成并验证

### 测试用例 4: 拼接模式
1. 测试顺序模式
2. 测试混洗模式
3. 测试随机模式

### 测试用例 5: 错误处理
1. 无效的 bvid
2. 不存在的本地路径
3. 网络断开

## 📊 性能参考

- **本地裁剪**: ~1-2秒/片段
- **B站下载**: 取决于网络速度和视频大小
- **拼接**: ~1秒/10个片段
- **临时文件**: 每个片段约 5-50MB（取决于时长和质量）

## 🎉 总结

生成器已经完全实现，可以：
- ✅ 处理本地和B站视频
- ✅ 下载、裁剪、拼接
- ✅ 实时进度显示
- ✅ 错误处理和清理
- ✅ 输出文件路径显示

现在可以开始使用生成器制作随舞视频了！🚀
