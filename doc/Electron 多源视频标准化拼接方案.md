Electron 多源视频标准化拼接方案

1. 核心架构设计
   UI 层 (Vue/React + Electron Renderer): 负责文件选择、拖拽排序、显示进度条。

通信层 (IPC): 使用 ipcRenderer.invoke 发送任务，ipcMain 处理任务，并通过 webContents.send 回传进度。

逻辑层 (Node.js Main Process):

使用 fluent-ffmpeg 库封装 FFmpeg 命令。

使用 ffmpeg-static 和 ffprobe-static 提供二进制文件（避免用户手动安装环境）。

2. 依赖安装
   在你的 Electron 项目根目录下安装以下 NPM 包：

Bash
npm install fluent-ffmpeg
npm install ffmpeg-static ffprobe-static
fluent-ffmpeg: 这是一个 Node.js 库，它将复杂的 FFmpeg 命令行参数抽象为链式调用。

ffmpeg-static / ffprobe-static: 包含了预编译好的二进制文件，打包应用时会一起打包，确保用户电脑上没装 FFmpeg 也能运行。

3. 实现代码 (主进程 Main Process)
   建议新建一个专门的服务文件，例如 videoProcessor.js，然后在 main.js 中引入。

3.1 视频处理核心逻辑 (videoProcessor.js)
这段代码实现了自动检测音频流、补充静音轨道、标准化画面 (1080P) 和响度统一。

JavaScript
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static').replace('app.asar', 'app.asar.unpacked');
const ffprobePath = require('ffprobe-static').path.replace('app.asar', 'app.asar.unpacked');
const path = require('path');

// 设置二进制路径（关键：解决打包后的路径问题）
ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffprobePath);

/\*\*

- 获取视频元数据，判断是否有音频流
  \*/
  const checkAudioStream = (filePath) => {
  return new Promise((resolve, reject) => {
  ffmpeg.ffprobe(filePath, (err, metadata) => {
  if (err) return reject(err);
  // 查找 codec_type 为 'audio' 的流
  const hasAudio = metadata.streams.some(s => s.codec_type === 'audio');
  resolve(hasAudio);
  });
  });
  };

/\*\*

- 执行拼接任务
- @param {string[]} inputFiles - 输入文件绝对路径数组
- @param {string} outputPath - 输出文件绝对路径
- @param {function} onProgress - 进度回调函数
  \*/
  const stitchVideos = async (inputFiles, outputPath, onProgress) => {
  // 1. 预先检查所有文件是否有音频
  const filesWithMeta = await Promise.all(inputFiles.map(async (file) => {
  return {
  path: file,
  hasAudio: await checkAudioStream(file)
  };
  }));

// 2. 构建复杂滤镜 (Filter Complex)
let filterComplex = [];
let inputArgs = [];
let outputMapV = [];
let outputMapA = [];

// 目标参数
const TARGET_W = 1920;
const TARGET_H = 1080;
const TARGET_FPS = 30; // 强制30帧解决不同步

filesWithMeta.forEach((file, i) => {
// === 视频处理逻辑 ===
// scale: 缩放并保持比例 (decrease避免放大模糊)
// pad: 填充黑边居中
// setsar: 修正像素比
// fps: 统一帧率
const vFilter = `[${i}:v]scale=${TARGET_W}:${TARGET_H}:force_original_aspect_ratio=decrease,pad=${TARGET_W}:${TARGET_H}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=${TARGET_FPS},format=yuv420p[v${i}]`;
filterComplex.push(vFilter);
outputMapV.push(`[v${i}]`);

    // === 音频处理逻辑 ===
    if (file.hasAudio) {
      // 有音频：重采样 -> 统一单/双声道 -> 响度均衡 (EBU R128)
      const aFilter = `[${i}:a]aformat=sample_rates=48000:channel_layouts=stereo,loudnorm=I=-16:TP=-1.5:LRA=11[a${i}]`;
      filterComplex.push(aFilter);
      outputMapA.push(`[a${i}]`);
    } else {
      // 无音频：生成静音流 (anullsrc) -> 截取长度与当前视频一致 -> 赋予标号
      // 注意：anullsrc 是一个源，不能直接放在滤镜链中间，这里用简单方法：
      // 直接生成一个极短的静音然后 pad 长度比较复杂。
      // **更稳健的方法**：利用 aevalsrc=0 生成静音，并通过 apad 或 shortest 匹配视频长度。
      // 这里使用复杂的 filter 语法来“凭空”造出一段匹配长度的静音：
      const aFilter = `anullsrc=channel_layout=stereo:sample_rate=48000[silence${i}];[silence${i}][${i}:v]shortest=1[raw_a${i}];[raw_a${i}]loudnorm=I=-16:TP=-1.5:LRA=11[a${i}]`;
      filterComplex.push(aFilter);
      outputMapA.push(`[a${i}]`);
    }

});

// === 拼接逻辑 ===
const concatV = outputMapV.join('');
const concatA = outputMapA.join('');
// 拼接所有的 [vi] 和 [ai]
filterComplex.push(`${concatV}${concatA}concat=n=${inputFiles.length}:v=1:a=1[outv][outa]`);

// 3. 执行 FFmpeg 命令
return new Promise((resolve, reject) => {
const command = ffmpeg();

    // 添加输入文件
    inputFiles.forEach(f => command.input(f));

    command
      .complexFilter(filterComplex)
      .outputOptions([
        '-map [outv]',       // 映射最终视频流
        '-map [outa]',       // 映射最终音频流
        '-c:v libx264',      // 视频编码 H.264
        '-crf 23',           // 质量系数
        '-preset medium',    // 编码速度
        '-c:a aac',          // 音频编码 AAC
        '-b:a 192k',         // 音频码率
        '-movflags +faststart' // Web 优化
      ])
      .on('start', (cmdLine) => {
        console.log('FFmpeg 开始执行:', cmdLine);
      })
      .on('progress', (progress) => {
        // progress.percent 在复杂滤镜下可能不准，通常用 timemark
        if (onProgress) onProgress(progress);
      })
      .on('error', (err) => {
        console.error('处理失败:', err);
        reject(err);
      })
      .on('end', () => {
        console.log('处理完成');
        resolve(outputPath);
      })
      .save(outputPath);

});
};

module.exports = { stitchVideos };
3.2 接入 IPC (main.js / background.js)
在主进程入口文件中注册监听事件。

JavaScript
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { stitchVideos } = require('./videoProcessor'); // 引入上面的文件

// ... 创建窗口代码 ...

// 监听渲染进程的请求
ipcMain.handle('start-processing', async (event, { files, outputPath }) => {
const win = BrowserWindow.fromWebContents(event.sender);

try {
await stitchVideos(files, outputPath, (progress) => {
// 发送进度回渲染进程
// 注意：progress.percent 可能不可靠，建议结合 timemark 显示 "正在处理..."
win.webContents.send('process-progress', progress);
});
return { success: true };
} catch (error) {
return { success: false, error: error.message };
}
});

// 处理文件保存对话框（让用户选输出位置）
ipcMain.handle('select-output-path', async () => {
const { filePath } = await dialog.showSaveDialog({
filters: [{ name: 'Movies', extensions: ['mp4'] }]
});
return filePath;
}); 4. 前端调用 (Preload & Renderer)
4.1 preload.js (桥接)
JavaScript
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
startProcessing: (data) => ipcRenderer.invoke('start-processing', data),
selectOutputPath: () => ipcRenderer.invoke('select-output-path'),
onProgress: (callback) => ipcRenderer.on('process-progress', (\_event, value) => callback(value))
});
4.2 Vue/React 组件示例
JavaScript
// 伪代码示例
const handleExport = async () => {
if (files.length === 0) return;

// 1. 让用户选保存路径
const outputPath = await window.electronAPI.selectOutputPath();
if (!outputPath) return;

setIsProcessing(true);

// 2. 监听进度
window.electronAPI.onProgress((progress) => {
console.log("处理中...", progress);
// 这里更新 UI 进度条
setProgressText(`已处理时间: ${progress.timemark}`);
});

// 3. 开始任务
const result = await window.electronAPI.startProcessing({
files: files.map(f => f.path), // 传递绝对路径
outputPath
});

setIsProcessing(false);

if (result.success) {
alert("拼接成功！");
} else {
alert("失败: " + result.error);
}
}; 5. 关键坑点与解决方案
在 Electron 中开发此类功能，有三个必须要处理的“坑”：

5.1 路径中的 app.asar 问题
问题：Electron 打包后会将源码压缩进 app.asar 文件。但是 FFmpeg 是外部二进制程序，它无法读取 app.asar 内部的文件，也无法在压缩包内运行。 解决：

在 package.json 的 build 配置（如果你用 electron-builder）中，将二进制文件设为 extraResources，或者使用 asar.unpack。

这就是为什么我在代码里写了 .replace('app.asar', 'app.asar.unpacked')。这能确保代码指向解压后的真实物理路径。

5.2 性能卡顿
问题：如果在主进程（Main Thread）直接跑繁重的计算，UI可能会卡死。 解决：fluent-ffmpeg 实际上是 spawn 了一个子进程去跑 ffmpeg.exe，所以不会阻塞主线程。但是，大量的 IPC 通信（频繁发送进度）可能会轻微影响 UI。建议加上节流（Throttle），例如每 500ms 发送一次进度更新。

5.3 跨平台兼容
问题：Windows 和 Mac 的路径分隔符不同。 解决：始终使用 Node.js 的 path.join() 来处理路径，不要手动拼写字符串。

5.4 临时文件
问题：虽然这个方案尽量使用内存流，但如果 FFmpeg 产生大量日志或缓存，可能会填满临时文件夹。 解决：此方案是一次性过（One-pass），不生成中间视频文件，是目前最干净的写法。

6. 总结
   要在 Electron 中实现你的需求，核心不仅是 FFmpeg 命令的构建，更是进程管理的艺术。

Main Process 是指挥官，负责调用底层的 ffmpeg-static。

IPC 是传令兵，负责传递文件路径和进度。

Complex Filter 是核心武器，利用 scale、pad、loudnorm 解决分辨率、帧率和音量的一致性问题。

按照上述代码结构，你可以快速搭建一个工业级的视频拼接桌面应用。
