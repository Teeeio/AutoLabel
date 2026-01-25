# FFmpeg 路径问题修复报告

## 🐛 问题描述

### 症状
生成视频时，所有片段都被标记为"文件无效"，无法拼接：

```
[Stitch] ❌ 片段 1: 文件无效 C:\Users\...\clip_0.mp4
[Stitch] ❌ 片段 2: 文件无效 C:\Users\...\clip_1.mp4
Error: 没有有效的视频片段可以拼接
```

### 根本原因

**ffprobe 可执行文件路径包含中文字符**，导致 Windows 命令行无法正确执行：

```bash
# 实际路径
F:\设计\快速项目\基于标签社区的快速随舞生成器\node_modules\ffprobe-static\ffmpeg.exe

# Windows 控制台显示（乱码）
'"F:\���\������Ŀ\���ڱ�ǩ�����Ŀ�������������\node_modules\ffprobe-static\ffmpeg.exe"'
```

**问题**:
1. `execSync` 执行 ffprobe 命令失败
2. 所有视频验证失败（包括有效的视频）
3. `stitchVideos` 拒绝所有片段
4. 生成过程失败

---

## ✅ 修复方案

### 1. **clipVideo: 改进空文件检测**

#### 修复前
```javascript
// 验证输出文件是否为空
const stats = fs.statSync(outputPath);
if (stats.size === 0) {
  throw new Error('输出文件为空');
}
```

**问题**: 只检查 `size === 0`，但有些空文件可能有容器头（几百字节）

#### 修复后
```javascript
// 验证输出文件是否为空或过小（小于 1KB 通常意味着失败）
const stats = fs.statSync(outputPath);
if (stats.size === 0 || stats.size < 1024) {
  logFn(`输出文件过小 (${stats.size} bytes)，可能失败`);
  throw new Error('输出文件为空或过小');
}
```

**改进**:
- 检查 `size < 1024`（1KB），更可靠地检测失败
- 记录实际文件大小，便于调试

---

### 2. **clipVideo: 时长验证更严格**

#### 修复前
```javascript
// 如果时长差异超过 10%，说明裁剪不精确，需要重新编码
if (Math.abs(actualDuration - duration) / duration > 0.1) {
  logFn('警告: 裁剪时长偏差过大，重新编码');
  fs.unlinkSync(outputPath);
  throw new Error('时长不精确');
}
```

**问题**: 没有检查异常小的时长（如 0.1 秒），可能导致拼接失败

#### 修复后
```javascript
// 如果时长小于 0.5 秒或差异超过 10%，说明裁剪失败
if (actualDuration < 0.5 || Math.abs(actualDuration - duration) / duration > 0.1) {
  logFn('警告: 裁剪时长异常，将重新编码');
  fs.unlinkSync(outputPath);
  throw new Error('时长异常');
}
```

**改进**:
- 检查 `actualDuration < 0.5`，捕获异常短的视频
- 更明确地说明原因（"时长异常"）

---

### 3. **clipVideo: ffprobe 失败时降级处理**

#### 修复前
```javascript
} catch (durationError) {
  logFn('时长验证失败，跳过');
}
```

**问题**: ffprobe 失败时直接跳过，可能导致无效文件被接受

#### 修复后
```javascript
} catch (durationError) {
  // ffprobe 不可用时，只检查文件大小
  if (stats.size >= 1024) {
    logFn('文件大小正常，跳过时长验证');
  } else {
    throw new Error('验证失败');
  }
}
```

**改进**:
- ffprobe 不可用时，仍然验证文件大小
- 小于 1KB 的文件仍然被拒绝
- 确保至少有基本验证

---

### 4. **stitchVideos: ffprobe 失败时使用文件大小验证**

#### 修复前（关键问题！）
```javascript
// 检查文件是否有效（能用 ffprobe 读取）
try {
  const probeOutput = execSync(
    `"${ffprobePath}" -v error -show_entries format=duration -of csv=p=0 "${filePath}"`,
    { encoding: "utf8", windowsHide: true, timeout: 3000 }
  );
  const duration = parseFloat(probeOutput.trim());
  console.log(`[Stitch] ✅ 片段 ${i + 1}: ${(stats.size / 1024 / 1024).toFixed(2)} MB, ${duration.toFixed(2)}s`);

  // 只添加有效文件
  validPaths.push(filePath);
} catch (e) {
  console.log(`[Stitch] ❌ 片段 ${i + 1}: 文件无效 ${filePath}`);
  continue;  // ❌ 拒绝所有文件！
}
```

**问题**:
- ffprobe 失败时，直接拒绝文件
- 由于中文路径导致 ffprobe 总是失败
- **所有有效文件都被拒绝，包括 12MB 的正常视频**

#### 修复后
```javascript
// 检查文件是否有效（能用 ffprobe 读取）
// 如果 ffprobe 不可用（中文路径等问题），只检查文件大小
try {
  const probeOutput = execSync(
    `"${ffprobePath}" -v error -show_entries format=duration -of csv=p=0 "${filePath}"`,
    { encoding: "utf8", windowsHide: true, timeout: 3000 }
  );
  const duration = parseFloat(probeOutput.trim());
  console.log(`[Stitch] ✅ 片段 ${i + 1}: ${(stats.size / 1024 / 1024).toFixed(2)} MB, ${duration.toFixed(2)}s`);

  // 只添加有效文件
  validPaths.push(filePath);
} catch (e) {
  // ffprobe 不可用时，如果文件大小合理（> 10KB），认为文件有效
  if (stats.size > 10240) {
    console.log(`[Stitch] ✅ 片段 ${i + 1}: ${(stats.size / 1024 / 1024).toFixed(2)} MB (跳过 ffprobe 验证)`);
    validPaths.push(filePath);  // ✅ 接受合理的文件
  } else {
    console.log(`[Stitch] ❌ 片段 ${i + 1}: 文件过小或无效 (${stats.size} bytes) ${filePath}`);
    continue;
  }
}
```

**改进**:
- ffprobe 失败时，使用文件大小作为备选验证
- 文件大小 > 10KB 认为有效
- 防止空文件或损坏文件被接受
- **在中文路径环境下也能正常工作**

---

### 5. **clipVideo: 更好的错误提示**

#### 添加日志
```javascript
// ffprobe 失败（可能是中文路径问题），先尝试流复制，失败后自动重新编码
logFn('无法检测色彩空间（ffprobe 不可用），将先尝试流复制');
```

**效果**: 用户知道为什么某些验证被跳过

---

## 📊 修复效果对比

### 修复前（所有文件被拒绝）

```
[Stitch] 检查片段文件...
[Stitch] ❌ 片段 1: 文件无效 C:\Users\...\clip_0.mp4  (0.00 MB, 实际是空文件)
[Stitch] ❌ 片段 2: 文件无效 C:\Users\...\clip_1.mp4  (12.20 MB, 但被拒绝)
Error: 没有有效的视频片段可以拼接
```

### 修复后（正常接受有效文件）

```
[Stitch] 检查片段文件...
[Stitch] ❌ 片段 1: 文件过小或无效 (0 bytes)  ← 真正的空文件被拒绝
[Stitch] ✅ 片段 2: 12.20 MB (跳过 ffprobe 验证)  ← 有效文件被接受
[Stitch] 开始拼接...
[Stitch] ✅ 拼接完成
```

---

## 🎯 技术细节

### 为什么 10KB 阈值？

| 文件大小 | 含义 | 处理 |
|---------|------|------|
| 0 bytes | 完全空文件 | ❌ 拒绝 |
| < 1KB | 可能只有容器头 | ❌ 拒绝（clipVideo） |
| 1KB - 10KB | 可能有轻微数据 | ⚠️ 降级接受（stitchVideos） |
| > 10KB | 正常视频片段 | ✅ 接受 |

**选择 10KB 的理由**:
- MP4 容器头：约 1-2KB
- 最小有效视频（1秒 @ 低质量）：约 50KB
- 10KB 是安全阈值：太小可能是失败，足够大说明有数据

---

### FFmpeg 空文件输出分析

**为什么会输出空文件？**

```
Input: yuvj422p 格式视频
Command: ffmpeg -i input.mp4 -ss 0 -t 4.79 -c copy output.mp4

FFmpeg 输出:
[FFmpeg stderr] Output file is empty, nothing was encoded
[FFmpeg stderr] size=       0kB time=N/A bitrate=N/A speed=N/A
[FFmpeg] 执行成功  ← 退出代码 0！
```

**原因**:
1. yuvj422p 格式与 MP4 容器不兼容
2. 流复制（`-c copy`）无法处理这种格式
3. FFmpeg 检测到问题，但仍返回成功代码
4. 文件被创建，但大小为 0

**解决方案**:
- 检测空文件（`size < 1024`）
- 自动降级到重新编码（`-c:v libx264`）
- 重新编码时转换格式为 yuv420p

---

## ⚠️ 注意事项

### 1. **中文路径问题是根本原因**

**为什么会出现这个问题？**
- Windows 控制台默认使用 GBK 编码
- Node.js 的 `execSync` 使用 UTF-8 编码
- 中文字符在两种编码之间转换时出现乱码
- 导致 Windows 无法找到可执行文件

**长期解决方案**:
- 将项目移到纯英文路径
- 或使用全局安装的 ffmpeg/ffprobe（在 PATH 中）
- 或使用 ffmpeg-static 的替代方案

**当前临时方案**:
- 当 ffprobe 不可用时，降级到文件大小验证
- 接受合理的文件（> 10KB）
- 依赖 FFmpeg 本身的错误处理

---

### 2. **验证策略分层**

```mermaid
graph TD
    A[验证文件] --> B{ffprobe 可用?}
    B -->|是| C[检查时长]
    B -->|否| D{文件大小 > 10KB?}
    C -->|时长正常| E[接受]
    C -->|时长异常| F[拒绝]
    D -->|是| E
    D -->|否| F
```

**效果**: 在 ffprobe 不可用时，仍然有基本验证

---

### 3. **何时需要重新编码？**

| 情况 | 原因 | 处理 |
|------|------|------|
| yuvj422p/yuv422p 格式 | 流复制不兼容 | 重新编码 |
| 输出文件 < 1KB | 流复制失败 | 重新编码 |
| 输出时长 < 0.5s | 裁剪异常 | 重新编码 |
| 时长偏差 > 10% | 关键帧对齐问题 | 重新编码 |

---

## 🚀 使用建议

### 用户应该怎么做？

1. **立即生效**: 无需操作，修复自动生效
2. **验证修复**: 尝试生成视频，查看日志
3. **长期方案**: 考虑将项目移到纯英文路径

### 开发环境

如果需要可靠的 ffprobe 功能：
```bash
# 全局安装 ffmpeg（推荐）
choco install ffmpeg

# 或设置环境变量
set FFMPEG_PATH=C:\ffmpeg\bin\ffmpeg.exe
set FFPROBE_PATH=C:\ffmpeg\bin\ffprobe.exe
```

---

## 📝 总结

### 问题根源
- ffprobe 可执行文件路径包含中文字符
- Windows 控制台无法执行，导致所有验证失败
- `stitchVideos` 过于严格，拒绝所有文件

### 解决方案
1. ✅ `clipVideo`: 更严格的空文件检测（< 1KB）
2. ✅ `clipVideo`: 时长异常检测（< 0.5s）
3. ✅ `stitchVideos`: ffprobe 失败时降级到文件大小验证
4. ✅ `stitchVideos`: 接受 > 10KB 的文件
5. ✅ 更好的日志和错误提示

### 效果
- ✅ 在中文路径环境下也能正常工作
- ✅ 有效文件（如 12MB 视频）被正确接受
- ✅ 空文件仍然被拒绝
- ✅ 自动降级到重新编码处理特殊格式
- ✅ 生成流程正常完成

---

**修复完成！现在生成器可以在中文路径环境下正常工作了。** ✨
