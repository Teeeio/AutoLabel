# 生成器故障排除指南

## 问题：B站视频下载失败

### 错误信息
```
卡片 "c-XXX" 处理失败: yt-dlp failed with code 1
```

### 原因分析
B站视频需要登录 cookies 才能下载。`yt-dlp` 默认使用 `--cookies-from-browser chrome`，但这需要：
1. Chrome 浏览器已安装
2. 已在 Chrome 中登录 B站 账号
3. 视频不是会员专属（或已开通大会员）

### 解决方案

#### 方案 1: 使用本地视频测试（推荐）

1. **创建本地视频卡片**：
   - 进入"卡片制作"页面
   - 选择"本地视频"源
   - 选择一个视频文件（MP4 格式）
   - 设置时间段并保存

2. **测试生成**：
   - 进入"生成视频"页面
   - 选择刚创建的本地视频卡片
   - 点击"开始生成"

3. **查看结果**：
   - 本地视频会直接裁剪，无需下载
   - 输出文件在 `Downloads/随机随舞生成器/dance_XXX.mp4`

#### 方案 2: 配置 B站 Cookies

1. **导出 B站 Cookies**（从 Chrome）：
   ```bash
   # 安装 cookie 导出工具
   npm install -g yt-dlp-export-cookies

   # 或手动导出
   # 1. 安装 "Get cookies.txt" Chrome 扩展
   # 2. 访问 bilibili.com
   # 3. 点击扩展，导出 cookies
   # 4. 保存为: C:\Users\YourName\AppData\Roaming\random-dance-generator\rdg-cookie.txt
   ```

2. **使用 cookies.txt 文件**：
   ```
   将 cookies.txt 文件放在以下位置：
   Windows: C:\Users\YourName\AppData\Roaming\random-dance-generator\rdg-cookie.txt
   macOS: ~/Library/Application Support/random-dance-generator/rdg-cookie.txt
   Linux: ~/.config/random-dance-generator/rdg-cookie.txt
   ```

3. **测试下载**：
   ```bash
   # 手动测试 yt-dlp 是否能下载
   yt-dlp --cookies rdg-cookie.txt -o test.mp4 https://www.bilibili.com/video/BV1xx411c7mD
   ```

#### 方案 3: 使用账号密码（不推荐）

B站 已经限制了账号密码登录方式，建议使用方案 2。

## 测试步骤

### 测试本地视频生成

1. **准备测试视频**：
   - 任意 MP4 视频文件
   - 建议时长 > 10秒

2. **创建卡片**：
   - 进入"卡片制作"
   - 选择"本地视频"
   - 选择视频文件
   - 设置开始: 0秒, 结束: 5秒

3. **生成测试**：
   - 选择该卡片
   - 点击"开始生成"
   - 等待完成

4. **验证输出**：
   ```
   应该看到：
   [Generator] 裁剪本地视频: /path/to/video.mp4
   [Generator] 时间范围: 0s - 5s
   [FFmpeg] 执行命令: ffmpeg -ss 0 -i /path/to/video.mp4 -t 5 -c copy ...
   [Generator] 裁剪完成: ..., 大小: XXX bytes
   [Generator] 输出路径: C:\Users\...\Downloads\随机随舞生成器\dance_XXX.mp4
   ```

### 测试 B站视频生成（需要 cookies）

1. **准备 cookies.txt**（参考方案 2）

2. **创建 B站卡片**：
   - 搜索 B站视频
   - 选择片段
   - 保存卡片

3. **生成测试**：
   - 选择该卡片
   - 点击"开始生成"

4. **查看日志**：
   ```
   [Generator] 下载B站视频: BV1xx411c7mD
   [yt-dlp] 执行命令: yt-dlp -f ... --cookies /path/to/cookie.txt ...
   [yt-dlp] [download] 10.0% ...
   [yt-dlp] [download] 100.0% ...
   [yt-dlp] 下载完成: /tmp/...
   ```

## 常见错误

### 错误 1: `yt-dlp: command not found`
**解决**: 安装 yt-dlp
```bash
# Windows (使用 scoop)
scoop install yt-dlp

# 或手动下载
# https://github.com/yt-dlp/yt-dlp/releases
```

### 错误 2: `本地视频文件不存在`
**解决**: 检查卡片中的 `localPath` 是否正确
- 确保文件存在
- 使用绝对路径
- 路径中没有特殊字符

### 错误 3: `裁剪失败`
**原因**:
- 视频格式不支持
- 时间段超出视频长度
- FFmpeg 错误

**解决**: 查看完整的 FFmpeg 错误输出

### 错误 4: `拼接失败`
**原因**:
- 所有片段编码格式不一致
- 临时文件损坏

**解决**:
- 确保所有视频使用相同的编码
- 重新生成

## 调试技巧

### 启用详细日志

所有日志都已在控制台输出，查看：
- **浏览器控制台** (F12): 前端日志
- **Electron 终端**: 后端日志

### 手动测试 FFmpeg

```bash
# 测试裁剪
ffmpeg -ss 0 -i input.mp4 -t 5 -c copy output.mp4

# 测试拼接
echo "file 'clip1.mp4'" > concat.txt
echo "file 'clip2.mp4'" >> concat.txt
ffmpeg -f concat -safe 0 -i concat.txt -c copy output.mp4
```

### 手动测试 yt-dlp

```bash
# 测试下载
yt-dlp -f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best" \
  --cookies cookies.txt \
  -o output.mp4 \
  https://www.bilibili.com/video/BV1xx411c7mD
```

## 成功标志

生成成功后应该看到：

1. **浏览器界面**：
   - ✓ 生成完成！
   - 输出文件: C:\Users\...\Downloads\随机随舞生成器\dance_XXX.mp4

2. **终端日志**：
   ```
   [Generator] 临时目录: C:\Users\...\AppData\Local\Temp\rdg-generator
   [Generator] 裁剪本地视频: ...
   [FFmpeg] 执行命令: ...
   [Generator] 裁剪完成: ..., 大小: XXX bytes
   [Generator] 拼接完成: ..., 大小: XXX bytes
   [Generator] Generation complete: ...
   ```

3. **输出文件**：
   - 文件存在
   - 可以播放
   - 内容正确

## 建议测试顺序

1. ✅ **先测试本地视频**（1个卡片）
2. ✅ **测试多个本地视频**（2-3个卡片）
3. ✅ **测试拼接模式**（顺序/混洗/随机）
4. ✅ **最后测试 B站视频**（配置 cookies 后）

这样可以逐步验证功能，快速定位问题。
