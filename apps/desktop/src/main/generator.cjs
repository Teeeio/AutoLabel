const { spawn, execSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const os = require("os");
const ffmpegPath = require("ffmpeg-static");
const { app } = require("electron");
const { ipcMain } = require("electron");
const { getVideoMetadata } = require("./local-video.cjs");

// 简单的并发限制器（替代 p-limit，避免 ESM 兼容性问题）
function createConcurrencyLimit(maxConcurrency) {
  let running = 0;
  const queue = [];

  return function(fn) {
    return new Promise((resolve, reject) => {
      const run = async () => {
        running++;
        try {
          const result = await fn();
          resolve(result);
        } catch (error) {
          reject(error);
        } finally {
          running--;
          if (queue.length > 0) {
            const next = queue.shift();
            next();
          }
        }
      };

      if (running < maxConcurrency) {
        run();
      } else {
        queue.push(run);
      }
    });
  };
}

// 日志辅助函数
let logEvent = null;
let logFn = null;

// 统一日志格式
function formatLog(level, message) {
  const timestamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  const emoji = {
    'info': '📋',
    'success': '✅',
    'warning': '⚠️',
    'error': '❌',
    'debug': '🔧'
  };
  return `[${timestamp}] ${emoji[level] || ''} ${message}`;
}

function sendLog(level, message) {
  const logMessage = formatLog(level, message);
  console.log(`[Generator] ${logMessage}`);
  if (logEvent) {
    logEvent.sender.send("generator:log", logMessage);
  }
  if (logFn) {
    logFn(message);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

async function runFFmpeg(args) {
  return new Promise((resolve, reject) => {
    const ffmpegExecutable = typeof ffmpegPath === 'string' ? ffmpegPath : ffmpegPath.path;

    // 调试：打印完整命令
    console.log('[FFmpeg] 执行命令:');
    console.log('  ', ffmpegExecutable);
    console.log('  ', args.join(' '));

    const child = spawn(ffmpegExecutable, args, { windowsHide: true });
    let stderr = "";
    let stdout = "";

    child.stderr.on("data", (data) => {
      const text = data.toString();
      stderr += text;
      // 实时输出每一行
      text.split('\n').forEach(line => {
        if (line.trim()) {
          console.log('[FFmpeg stderr]', line.trim());
        }
      });
    });

    child.stdout.on("data", (data) => {
      const text = data.toString();
      stdout += text;
      // 实时输出每一行
      text.split('\n').forEach(line => {
        if (line.trim()) {
          console.log('[FFmpeg stdout]', line.trim());
        }
      });
    });

    child.on("error", (err) => {
      sendLog('error', `FFmpeg 启动失败: ${err.message}`);
      reject(err);
    });

    child.on("close", (code) => {
      if (code !== 0) {
        // 输出完整的错误信息
        console.error('[FFmpeg] ========================================');
        console.error('[FFmpeg] 执行失败，退出代码:', code);
        console.error('[FFmpeg] 完整错误输出:');
        console.error(stderr);
        console.error('[FFmpeg] ========================================');

        // 查找实际的错误信息
        const errorLines = stderr.split('\n').filter(l => l.trim().length > 0);
        let actualError = '未知错误';
        for (const line of errorLines) {
          if (line.includes('Error') || line.includes('Invalid') || line.includes('Option not found')) {
            actualError = line.trim();
            break;
          }
        }

        sendLog('error', `FFmpeg 失败: ${actualError}`);
        reject(new Error(`FFmpeg failed with code ${code}: ${actualError}`));
        return;
      }
      console.log('[FFmpeg] 执行成功');
      resolve();
    });
  });
}

/**
 * 检测视频文件是否包含音频流
 * @param {string} filePath - 视频文件路径
 * @returns {Promise<boolean>} 是否包含音频流
 */
async function checkAudioStream(filePath) {
  return new Promise((resolve, reject) => {
    const ffprobePath = require("ffprobe-static");
    const ffprobeExecutable = typeof ffprobePath === 'string' ? ffprobePath : ffprobePath.path;

    const args = [
      "-v", "error",
      "-select_streams", "a",  // 只选择音频流
      "-show_entries", "stream=codec_type",
      "-of", "csv=p=0",
      filePath
    ];

    const child = spawn(ffprobeExecutable, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("error", (err) => {
      console.error('[checkAudioStream] 检测失败:', err.message);
      resolve(false);  // 出错时假设无音频
    });

    child.on("close", (code) => {
      // 如果有音频流，stdout 会包含 "audio"
      const hasAudio = stdout.trim().includes('audio');
      resolve(hasAudio);
    });
  });
}

// ====================================================================
// Map-Reduce 架构：标准化 + 拼接
// ====================================================================
// 参考：https://github.com/ffmpeg-timebase-standardization
// 优势：速度快 3-5x，可处理几百个片段，稳定性高
// ====================================================================

// 所有中间片段必须严格遵守这些参数
const STANDARD_ARGS = [
  '-c:v', 'libx264',      // 视频编码：H.264
  '-preset', 'ultrafast', // 编码速度：极速 (用体积换速度)
  // '-profile:v', 'high', // 移除：让 FFmpeg 自动选择 profile（兼容 4:2:2 输入）
  '-level:v', '4.1',      // 兼容性等级
  '-crf', '23',           // 画质控制 (18-28，越小画质越好)
  '-r', '30',             // 强制帧率：30fps
  '-c:a', 'aac',          // 音频编码：AAC
  '-ar', '44100',         // 音频采样率：44.1kHz
  '-ac', '2',             // 声道数：双声道
  '-video_track_timescale', '90000' // 统一时基，防止拼接时时间轴错乱
];

/**
 * Map 阶段：处理单个片段 (标准化)
 * @param {Object} clip - { path, start, end, duration, title }
 * @param {String} outputPath - 输出 .ts 文件路径
 * @param {Function} logFn - 日志回调
 * @param {Object} outputSettings - { quality, fadeInDuration, fadeOutDuration }
 */
async function processSingleClip(clip, outputPath, logFn, outputSettings = {}) {
  console.log(`[Map] 处理: ${clip.title}`);
  console.log(`[Map] 输入: path=${clip.path}, start=${clip.start}s, end=${clip.end}s, duration=${clip.duration}s`);

  // 转场视频不应用淡入淡出效果
  const isTransition = clip.isTransition || false;
  if (isTransition) {
    console.log(`[Map] ⚠ 这是转场视频，跳过淡入淡出处理`);
    logFn(`🎬 转场视频: ${clip.duration.toFixed(2)}s`);
  }

  // 检测音频流
  const hasAudio = await checkAudioStream(clip.path);

  // 获取淡入淡出时长（秒）（转场视频不应用）
  const fadeInDuration = isTransition ? 0 : (outputSettings.fadeInDuration || 0);
  const fadeOutDuration = isTransition ? 0 : (outputSettings.fadeOutDuration || 0);
  const fps = 30; // 统一帧率

  console.log(`[Map] 片段信息: 原始时长=${clip.duration}s, 淡入=${fadeInDuration}s, 淡出=${fadeOutDuration}s, 有音频=${hasAudio}`);

  // 验证淡入淡出时长是否合理
  const minRequiredDuration = fadeInDuration + fadeOutDuration + 0.5; // 至少留0.5秒中间内容
  if (fadeOutDuration > 0 && clip.duration < minRequiredDuration) {
    console.log(`[Map] ⚠️ 片段时长(${clip.duration}s)不足以同时应用淡入(${fadeInDuration}s)和淡出(${fadeOutDuration}s)`);
    logFn(`⚠️ 片段太短，跳过淡出效果`);
    // 继续处理，但只应用淡入
  }

  // 计算淡入淡出的帧数（基于标准化后的 30fps）
  const fadeInFrames = Math.round(fadeInDuration * fps);
  const fadeOutFrames = Math.round(fadeOutDuration * fps);
  const estimatedTotalFrames = Math.round(clip.duration * fps);  // 估算的总帧数

  console.log(`[Map] 估算: 标准化后约${estimatedTotalFrames}帧@30fps, 淡入${fadeInFrames}帧, 淡出${fadeOutFrames}帧`);

  // 构建基础视频滤镜链：将视频缩放放入 1920x1080 的框内，保持比例，不足的地方填黑边
  // 顺序：先标准化(fps)，再淡入淡出
  let vfFilters = [
    'scale=1920:1080:force_original_aspect_ratio=decrease',
    'pad=1920:1080:(ow-iw)/2:(oh-ih)/2',
    'setsar=1',
    'fps=30'  // 第4步：统一为30fps
  ];

  // 构建音频滤镜链
  let afFilters = [];

  // 添加淡入淡出滤镜（使用时间参数，避免帧率转换导致的帧数不一致问题）
  const fadeOutStartTime = Math.max(0, clip.duration - fadeOutDuration);
  const canApplyFadeOut = fadeOutStartTime > fadeInDuration;

  console.log(`[Map] 淡出判断: 起始时间${fadeOutStartTime.toFixed(2)}s vs 淡入结束时间${fadeInDuration}s, 可应用=${canApplyFadeOut}`);

  // 视频淡入
  if (fadeInDuration > 0) {
    const fadeInFrames = Math.round(fadeInDuration * fps);
    vfFilters.push(`fade=t=in:s=0:n=${fadeInFrames}`);
    console.log(`[Map] ✓ 添加视频淡入: 0-${fadeInDuration}s (${fadeInFrames}帧)`);
  }

  // 视频淡出（只有当起始时间在淡入结束时才开始）
  if (fadeOutDuration > 0 && canApplyFadeOut) {
    const fadeOutStartFrames = Math.round(fadeOutStartTime * fps);
    const fadeOutFrames = Math.round(fadeOutDuration * fps);

    // 使用时间参数（st）而不是帧数参数（s），避免帧率转换问题
    vfFilters.push(`fade=t=out:st=${fadeOutStartTime}:d=${fadeOutDuration}`);
    console.log(`[Map] ✓ 添加视频淡出: ${fadeOutStartTime.toFixed(2)}s-结尾 (${fadeOutStartFrames}-${fadeOutStartFrames + fadeOutFrames}帧)`);

    // 音频淡出（使用相同的时间参数）
    afFilters.push(`afade=t=out:st=${fadeOutStartTime}:d=${fadeOutDuration}`);
    console.log(`[Map] ✓ 添加音频淡出: ${fadeOutStartTime.toFixed(2)}s-结尾`);
  }

  // 音频淡入
  if (fadeInDuration > 0) {
    afFilters.push(`afade=t=in:st=0:d=${fadeInDuration}`);
    console.log(`[Map] ✓ 添加音频淡入: 0-${fadeInDuration}s`);
  }

  const vfGraph = vfFilters.join(',');
  const afGraph = afFilters.length > 0 ? afFilters.join(',') : null;

  console.log(`[Map] 视频滤镜链 (${vfFilters.length}个): ${vfGraph}`);
  if (afGraph) {
    console.log(`[Map] 音频滤镜链 (${afFilters.length}个): ${afGraph}`);
  }

  let args;

  if (!hasAudio) {
    // 无音频：添加静音音频输入
    console.log(`[Map] ${clip.title} 无音频，添加静音轨道`);
    args = [
      '-ss', clip.start.toString(),       // 裁剪起点（快速定位）
      '-i', clip.path,                    // 视频输入
      '-t', clip.duration.toString(),     // 持续时间
      '-f', 'lavfi',                      // 音频格式：lavfi（滤镜源）
      '-i', 'anullsrc=r=44100:cl=stereo', // 音频输入：静音
      '-map', '0:v',                      // 使用第 0 个输入的视频流
      '-map', '1:a',                      // 使用第 1 个输入的音频流
      '-vf', vfGraph,                     // 应用画面标准化滤镜（包括淡入淡出）
      ...STANDARD_ARGS,                   // 应用统一编码参数
      '-y',                               // 覆盖文件
      '-f', 'mpegts',                     // TS 容器
      outputPath
    ];
  } else {
    // 有音频：使用快速裁剪模式（-ss 在 -i 之前）
    // 这样可以确保滤镜的时间基准是裁剪后的视频
    args = [
      '-ss', clip.start.toString(),       // 裁剪起点（在 -i 之前，快速模式）
      '-i', clip.path,                    // 输入文件
      '-t', clip.duration.toString(),     // 持续时间
      '-vf', vfGraph                      // 应用画面标准化滤镜（包括淡入淡出）
    ];

    // 如果有音频滤镜，添加 -af 参数
    if (afGraph) {
      args.push('-af', afGraph);
    }

    args.push(
      ...STANDARD_ARGS,                   // 应用统一编码参数
      '-y',                               // 覆盖文件
      '-f', 'mpegts',                     // TS 容器
      outputPath
    );
  }

  await runFFmpeg(args);

  console.log(`[Map] ✅ ${clip.title} → ${path.basename(outputPath)}`);
}

/**
 * Reduce 阶段：极速拼接 (Concat)
 * @param {Array<String>} tempFiles - .ts 文件路径数组
 * @param {String} finalOutput - 最终输出路径
 * @param {Function} logFn - 日志回调
 */
async function concatClips(tempFiles, finalOutput, logFn) {
  console.log('[Reduce] 开始拼接...');
  console.log(`[Reduce] 拼接 ${tempFiles.length} 个片段`);

  logFn(`拼接 ${tempFiles.length} 个片段...`);

  // 生成 concat 列表文件
  const listFilePath = path.join(path.dirname(tempFiles[0]), 'concat_list.txt');
  // Windows 路径需要转义，把反斜杠换成斜杠
  const fileContent = tempFiles
    .map(f => `file '${f.replace(/\\/g, '/')}'`)
    .join('\n');

  fs.writeFileSync(listFilePath, fileContent);
  console.log(`[Reduce] 列表文件: ${listFilePath}`);
  console.log(`[Reduce] 列表内容: ${fileContent.substring(0, 200)}...`);

  // 启动 FFmpeg 进行流复制
  const args = [
    '-f', 'concat',           // 拼接模式
    '-safe', '0',             // 允许读取任意路径
    '-i', listFilePath,       // 输入列表
    '-c', 'copy',             // 核心！直接复制流，不重新编码 -> 极速
    '-bsf:a', 'aac_adtstoasc', // 修复 TS 转 MP4 时的音频流格式
    '-y',
    finalOutput
  ];

  try {
    await runFFmpeg(args);
    console.log('[Reduce] ✅ 拼接完成');
  } finally {
    // 清理列表文件
    try {
      fs.unlinkSync(listFilePath);
    } catch (e) {
      console.error('[Reduce] 清理列表文件失败:', e.message);
    }
  }
}

/**
 * Map-Reduce 主控制器
 * @param {Array} inputVideos - 输入视频数组 [{ path, start, end, duration, title }]
 * @param {String} outputPath - 最终输出路径
 * @param {Function} logFn - 日志回调
 * @param {Function} sendProgress - 进度回调
 * @param {Object} outputSettings - 输出设置 { quality, fadeInDuration, fadeOutDuration }
 */
async function mapReduceGeneration(inputVideos, outputPath, logFn, sendProgress, outputSettings = {}) {
  console.log('[MapReduce] ========================================');
  console.log('[MapReduce] 开始 Map-Reduce 处理...');
  console.log(`[MapReduce] 片段数量: ${inputVideos.length}`);

  const tempDir = path.join(app.getPath("temp"), "rdg-mapreduce");
  ensureDir(tempDir);

  // 并发控制：保留一个核心给系统
  const cpuCount = os.cpus().length;
  const concurrency = Math.max(2, cpuCount - 1);
  const limit = createConcurrencyLimit(concurrency);

  logFn(`🚀 Map-Reduce 模式: 并发数 ${concurrency}`);
  console.log(`[MapReduce] CPU 核心数: ${cpuCount}, 并发数: ${concurrency}`);

  const tempFiles = [];

  try {
    // ==========================================
    // Map 阶段：并行处理所有片段
    // ==========================================
    console.log('[MapReduce] Map 阶段: 标准化所有片段...');
    logFn('📋 标准化处理所有片段...');

    const tasks = inputVideos.map((video, index) => {
      return limit(async () => {
        const tempFile = path.join(tempDir, `segment_${Date.now()}_${index}.ts`);
        tempFiles[index] = tempFile; // 按顺序存储

        console.log(`[MapReduce] 排队处理 ${index + 1}/${inputVideos.length}: ${video.title} (${video.path})`);
        logFn(`处理片段 ${index + 1}/${inputVideos.length}: ${video.title}`);
        sendProgress?.({
          step: "processing",
          label: `处理片段 ${index + 1}/${inputVideos.length}`,
          current: index + 1,
          total: inputVideos.length,
          percent: Math.round(((index + 1) / inputVideos.length) * 50) // Map 占 50% 进度
        });

        await processSingleClip(video, tempFile, logFn, outputSettings);
        console.log(`[MapReduce] ✅ 片段 ${index + 1} 处理完成: ${path.basename(tempFile)}`);
      });
    });

    await Promise.all(tasks);

    console.log(`[MapReduce] 所有片段处理完成，生成 ${tempFiles.length} 个临时文件`);

    // ==========================================
    // Reduce 阶段：拼接所有片段
    // ==========================================
    console.log('[MapReduce] Reduce 阶段: 拼接所有片段...');
    logFn('📦 拼接所有片段...');

    sendProgress?.({
      step: "concatenating",
      label: "拼接所有片段...",
      current: inputVideos.length,
      total: inputVideos.length,
      percent: 75 // Reduce 占 25% 进度
    });

    await concatClips(tempFiles, outputPath, logFn);

    sendProgress?.({
      step: "complete",
      label: "生成完成!",
      current: inputVideos.length,
      total: inputVideos.length,
      percent: 100
    });

  } catch (error) {
    console.error('[MapReduce] ❌ 处理失败:', error.message);
    throw error;
  } finally {
    // ==========================================
    // 清理临时文件 (非常重要，否则 C 盘会爆)
    // ==========================================
    console.log('[MapReduce] 清理临时文件...');
    logFn('🧹 清理临时文件...');

    let cleanedCount = 0;
    tempFiles.forEach(f => {
      try {
        if (fs.existsSync(f)) {
          fs.unlinkSync(f);
          cleanedCount++;
        }
      } catch (e) {
        console.error(`[MapReduce] 清理失败: ${f}`, e.message);
      }
    });

    console.log(`[MapReduce] ✅ 清理完成: ${cleanedCount}/${tempFiles.length} 个文件`);
  }

  console.log('[MapReduce] ========================================');
  console.log(`[MapReduce] ✅ 完成: ${outputPath}`);
}

async function downloadBilibiliVideo(card, outputPath, progressCallback) {
  // 使用 yt-dlp 下载B站视频
  // 格式选择：首选 H.264 编码 + AAC 音频，强制 MP4 输出
  const args = [
    "-f", "bestvideo[vcodec^=avc]+bestaudio[acodec^=mp4a]/best[ext=mp4]/best",
    "--merge-output-format", "mp4",  // 强制合并为 MP4
    "--user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "--referer", "https://www.bilibili.com/",
    "--no-check-certificates",  // 跳过证书验证
    "-o", outputPath,
    `https://www.bilibili.com/video/${card.bvid}`
  ];

  return downloadBilibiliVideoWithArgs(card, outputPath, args, progressCallback);
}

async function downloadBilibiliVideoWithArgs(card, outputPath, args, progressCallback) {
  return new Promise((resolve, reject) => {
    console.log('[yt-dlp] 执行命令:', 'yt-dlp', args.join(' '));
    const child = spawn("yt-dlp", args, { windowsHide: true });
    let stderr = "";
    let stdout = "";

    child.stdout.on("data", (data) => {
      const line = data.toString();
      stdout += line;
      console.log('[yt-dlp]', line.trim());

      // 解析进度
      const downloadMatch = line.match(/\[download\]\s+(\d+\.?\d*)%/);
      if (downloadMatch) {
        const percent = parseFloat(downloadMatch[1]);
        if (progressCallback) {
          progressCallback(percent);
        }
      }
    });

    child.stderr.on("data", (data) => {
      const line = data.toString();
      stderr += line;
      console.log('[yt-dlp STDERR]', line.trim());
    });

    child.on("error", (err) => {
      console.error('[yt-dlp] 错误:', err);
      reject(err);
    });

    child.on("close", (code) => {
      if (code !== 0) {
        console.error('[yt-dlp] 错误输出:', stderr);
        reject(new Error(`yt-dlp failed with code ${code}\n\n${stderr}`));
        return;
      }
      console.log('[yt-dlp] 下载完成:', outputPath);
      resolve(outputPath);
    });
  });
}

async function clipVideo(inputPath, outputPath, startTime, endTime, logFn) {
  // 检查源视频音频
  const ffprobeExecutable = typeof ffmpegPath === 'string' ? ffmpegPath : ffmpegPath.path;
  const ffprobePath = ffprobeExecutable.replace('ffmpeg', 'ffprobe');

  let sourceHasAudio = false;
  try {
    const probeOutput = execSync(
      `"${ffprobePath}" -v error -select_streams a -show_entries stream=codec_type -of csv=p=0 "${inputPath}"`,
      { encoding: "utf8", windowsHide: true, timeout: 3000 }
    );
    sourceHasAudio = probeOutput.trim().includes("audio");
    logFn(sourceHasAudio ? '检测到音频流' : '未检测到音频流');
  } catch (probeError) {
    logFn('音频检测超时，假设有音频');
    sourceHasAudio = true;
  }

  const duration = endTime - startTime;

  // 调试日志：验证时间参数
  logFn(`裁剪参数: 开始=${startTime.toFixed(2)}s, 结束=${endTime.toFixed(2)}s, 时长=${duration.toFixed(2)}s`);

  // 对于特殊格式的视频（如 yuvj422p），流复制可能失败，需要重新编码
  // 由于 ffprobe 在中文路径下会失败，我们先用流复制尝试，如果输出文件为空则重新编码
  let needsReencoding = false;

  // 检查源视频是否是 yuvj422p 格式（这种格式流复制通常失败）
  // 通过文件名或启发式方法判断（如果 ffprobe 不可用）
  try {
    const pixFmtOutput = execSync(
      `"${ffprobePath}" -v error -select_streams v:0 -show_entries stream=pix_fmt -of csv=p=0 "${inputPath}"`,
      { encoding: "utf8", windowsHide: true, timeout: 3000 }
    );
    const pixFmt = pixFmtOutput.trim().toLowerCase();
    logFn(`视频色彩空间: ${pixFmt}`);

    // yuvj422p、yuv422p、yuv444p 等格式流复制通常失败
    if (pixFmt.includes('422p') || pixFmt.includes('444p')) {
      logFn('检测到特殊色彩空间，将使用重新编码');
      needsReencoding = true;
    }
  } catch (e) {
    // ffprobe 失败（可能是中文路径问题），先尝试流复制，失败后自动重新编码
    logFn('无法检测色彩空间（ffprobe 不可用），将先尝试流复制');
  }

  // 根据是否有音频选择不同的处理方式
  if (sourceHasAudio && !needsReencoding) {
    // 对于拼接用的裁剪，始终使用精确模式以确保时长准确
    // 速度不是问题，精度才是关键
    const useAccurateMode = true;  // 强制使用精确模式

    const argsCopy = useAccurateMode ? [
      "-i", inputPath,
      "-ss", startTime.toString(),  // 在 -i 之后（精确定位，帧级准确）
      "-t", duration.toString(),
      "-c", "copy",
      "-avoid_negative_ts", "make_zero",
      "-y",
      outputPath
    ] : [
      "-ss", startTime.toString(),  // 在 -i 之前（快速定位，关键帧级）
      "-i", inputPath,
      "-t", duration.toString(),
      "-c", "copy",
      "-avoid_negative_ts", "1",
      "-y",
      outputPath
    ];

    logFn(`使用${useAccurateMode ? '精确' : '快速'}裁剪模式`);

    try {
      await runFFmpeg(argsCopy);

      // 验证输出文件是否为空或过小（小于 1KB 通常意味着失败）
      const stats = fs.statSync(outputPath);
      if (stats.size === 0 || stats.size < 1024) {
        logFn(`输出文件过小 (${stats.size} bytes)，可能失败`);
        throw new Error('输出文件为空或过小');
      }

      // 验证输出文件时长（如果 ffprobe 可用）
      try {
        const durationCheck = execSync(
          `"${ffprobePath}" -v error -show_entries format=duration -of csv=p=0 "${outputPath}"`,
          { encoding: "utf8", windowsHide: true, timeout: 3000 }
        );
        const actualDuration = parseFloat(durationCheck.trim());
        logFn(`输出验证: 期望 ${duration.toFixed(2)}s, 实际 ${actualDuration.toFixed(2)}s`);

        // 如果时长小于 0.5 秒或差异超过 5%，说明裁剪精度不够
        // 降低阈值从 10% 到 5%，因为 4.8% 的误差已经导致明显的问题
        if (actualDuration < 0.5 || Math.abs(actualDuration - duration) / duration > 0.05) {
          logFn(`警告: 裁剪时长偏差过大 (${((actualDuration - duration) / duration * 100).toFixed(1)}%)，将重新编码`);
          fs.unlinkSync(outputPath);
          throw new Error('时长偏差超过 5%');
        }
      } catch (durationError) {
        // ffprobe 不可用时，只检查文件大小
        if (stats.size >= 1024) {
          logFn('文件大小正常，跳过时长验证');
        } else {
          throw new Error('验证失败');
        }
      }

      logFn('流复制完成');
      return { hasAudio: true };

    } catch (error) {
      logFn(`流复制失败: ${error.message.substring(0, 50)}`);
      if (fs.existsSync(outputPath)) {
        fs.unlinkSync(outputPath);
      }
      needsReencoding = true; // 标记需要重新编码
      logFn('标记需要重新编码');
    }
  }

  // 重新编码以确保精确时长（使用更快的预设）
  // 或者在流复制失败/需要特殊处理时使用
  logFn(`编码决策: needsReencoding=${needsReencoding}, sourceHasAudio=${sourceHasAudio}`);

  if (needsReencoding || !sourceHasAudio) {
    if (!sourceHasAudio) {
      // 无音频：添加静音音频轨道
      logFn('添加静音轨道');

      // 方案：生成静音音频并与视频合并
      const argsWithSilent = [
        "-i", inputPath,  // -i 在 -ss 之前（重新编码，精确定位）
        "-ss", startTime.toString(),
        "-t", duration.toString(),
        "-f", "lavfi", "-i", `anullsrc=r=44100:cl=stereo`,
        "-c:v", "libx264",
        "-preset", "superfast",
        "-crf", "23",
        "-c:a", "aac",
        "-b:a", "128k",
        "-ar", "44100",
        "-map", "0:v",
        "-map", "1:a",
        "-shortest",
        "-movflags", "+faststart",
        "-avoid_negative_ts", "make_zero",
        "-y",
        outputPath
      ];

      try {
        await runFFmpeg(argsWithSilent);
        logFn('静音轨道添加完成');
        return { hasAudio: false, addedSilent: true };
      } catch (error) {
        // 静音轨道失败，仅复制视频
        logFn('静音轨道添加失败，仅复制视频');
        const argsVideoOnly = [
          "-i", inputPath,
          "-ss", startTime.toString(),
          "-t", duration.toString(),
          "-c:v", "copy",
          "-an",
          "-avoid_negative_ts", "make_zero",
          "-y",
          outputPath
        ];
        await runFFmpeg(argsVideoOnly);
        logFn('仅视频复制完成');
        return { hasAudio: false, addedSilent: false };
      }
    } else {
      // 有音频但需要重新编码
      // 或者无音频需要添加静音轨道（以便拼接时兼容）

      // 检查输出文件是否有音频流
      let needsSilentAudio = false;
      try {
        const probeOutput = execSync(
          `"${ffprobePath}" -v error -select_streams a -show_entries stream=codec_type -of csv=p=0 "${outputPath}"`,
          { encoding: "utf8", windowsHide: true, timeout: 3000 }
        );
        // 如果没有音频流，probeOutput 会为空
        if (!probeOutput.trim().includes("audio")) {
          needsSilentAudio = true;
        }
      } catch (e) {
        // ffprobe 失败，假设没有音频
        needsSilentAudio = true;
      }

      if (needsSilentAudio) {
        // 无音频：添加静音轨道
        logFn('检测到无音频，添加静音轨道');

        // 删除旧的无音频文件
        if (fs.existsSync(outputPath)) {
          fs.unlinkSync(outputPath);
        }

        const argsWithSilent = [
          "-ss", startTime.toString(),
          "-i", inputPath,
          "-t", duration.toString(),
          "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
          "-map", "0:v",
          "-map", "1:a",
          "-c:v", "libx264",
          "-preset", "superfast",
          "-crf", "23",
          "-pix_fmt", "yuv420p",
          // 不指定 -r 参数，让 FFmpeg 保持源视频的原始帧率
          "-c:a", "aac",
          "-b:a", "128k",
          "-ar", "44100",
          "-shortest",
          "-movflags", "+faststart",
          "-avoid_negative_ts", "make_zero",
          "-y",
          outputPath
        ];

        await runFFmpeg(argsWithSilent);
        logFn('静音轨道添加完成');
      } else {
        // 有音频：正常重新编码
        logFn('重新编码视频（有音频）');

        const argsEncode = [
          "-ss", startTime.toString(),
          "-i", inputPath,
          "-t", duration.toString(),
          "-map", "0:v",
          "-map", "0:a?",
          "-c:v", "libx264",
          "-preset", "superfast",
          "-crf", "23",
          "-pix_fmt", "yuv420p",
          "-c:a", "aac",
          "-b:a", "128k",
          "-ar", "44100",
          "-movflags", "+faststart",
          "-avoid_negative_ts", "make_zero",
          "-y",
          outputPath
        ];

        await runFFmpeg(argsEncode);
        logFn('重新编码完成');
      }

      // 验证重新编码后的时长
      try {
        const durationCheck = execSync(
          `"${ffprobePath}" -v error -show_entries format=duration -of csv=p=0 "${outputPath}"`,
          { encoding: "utf8", windowsHide: true, timeout: 3000 }
        );
        const actualDuration = parseFloat(durationCheck.trim());
        logFn(`编码验证: 期望 ${duration.toFixed(2)}s, 实际 ${actualDuration.toFixed(2)}s`);
      } catch (e) {
        // 忽略验证失败
      }

      return { hasAudio: true };
    }
  }
}

async function stitchVideos(videoPaths, outputPath) {
  const ffprobeExecutable = typeof ffmpegPath === 'string' ? ffmpegPath : ffmpegPath.path;
  const ffprobePath = ffprobeExecutable.replace('ffmpeg', 'ffprobe');

  // 确保输出目录存在
  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    console.log('[Stitch] 创建输出目录:', outputDir);
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // 诊断：检查每个片段的元数据和有效性
  console.log('[Stitch] 检查片段文件...');
  const validPaths = [];
  for (let i = 0; i < videoPaths.length; i++) {
    const filePath = videoPaths[i];

    // 检查文件是否存在
    if (!fs.existsSync(filePath)) {
      console.log(`[Stitch] ❌ 片段 ${i + 1}: 文件不存在 ${filePath}`);
      continue;
    }

    // 检查文件大小
    const stats = fs.statSync(filePath);
    if (stats.size === 0) {
      console.log(`[Stitch] ❌ 片段 ${i + 1}: 文件为空 ${filePath}`);
      fs.unlinkSync(filePath); // 删除空文件
      continue;
    }

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
        validPaths.push(filePath);
      } else {
        console.log(`[Stitch] ❌ 片段 ${i + 1}: 文件过小或无效 (${stats.size} bytes) ${filePath}`);
        continue;
      }
    }
  }

  // 如果没有有效文件，抛出错误
  if (validPaths.length === 0) {
    throw new Error('没有有效的视频片段可以拼接');
  }

  if (validPaths.length < videoPaths.length) {
    console.log(`[Stitch] ⚠️ 警告: ${videoPaths.length - validPaths.length} 个片段无效，被跳过`);
  }

  console.log('[Stitch] 输出文件:', outputPath);

  // ====================================================================
  // 使用 Filter Complex 方案（正确处理异构视频）
  // ====================================================================
  //
  // 问题诊断：
  // ❌ concat demuxer (-f concat) + -c:v copy = 互斥操作
  //    - concat demuxer 工作在容器层，不会重写视频内部时间戳
  //    - 不同帧率视频拼接后，播放器沿用第一个片段的时间基准
  //    - 24fps 时间基准衡量 25fps 视频 = 慢速播放
  //
  // 正确方案：
  // ✅ 使用 filter complex 引擎
  //    - 统一所有输入的参数（分辨率、帧率、采样率）
  //    - concat filter 重新计算 PTS，生成连续时间轴
  //    - 消除时间漂移和停顿帧
  //
  // ====================================================================

  console.log('[Stitch] 使用 filter complex 方案（处理异构视频）');

  // 检测每个裁剪片段的实际时长（通过文件名估算）
  console.log('[Stitch] 输入片段:');
  for (let i = 0; i < validPaths.length; i++) {
    const filePath = validPaths[i];
    const stats = fs.statSync(filePath);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
    console.log(`[Stitch]   片段 ${i + 1}: ${sizeMB} MB`);
  }

  // 检测所有视频的最高帧率和最大分辨率
  let maxFps = 24;
  let maxWidth = 0;
  let maxHeight = 0;

  for (const filePath of validPaths) {
    try {
      const stats = fs.statSync(filePath);
      if (stats.size > 10240) {  // 合理的文件大小
        // 注意：ffprobe 不可用时，使用默认值
        maxFps = Math.max(maxFps, 30);  // 默认 30fps
        maxWidth = Math.max(maxWidth, 1920);
        maxHeight = Math.max(maxHeight, 1080);
      }
    } catch (e) {
      console.log(`[Stitch] ⚠️ 无法检测 ${filePath}，使用默认值`);
    }
  }

  // 使用最高帧率，避免高刷视频丢帧
  const targetFps = Math.max(maxFps, 30);
  const targetWidth = 1920;
  const targetHeight = 1080;

  console.log(`[Stitch] 目标参数: ${targetFps}fps, ${targetWidth}x${targetHeight}`);

  // 构建 filter complex
  // 1. 标准化每个视频（分辨率、帧率、像素格式）
  // 2. 标准化每个音频（采样率、声道）
  // 3. 拼接所有视频和音频
  const filterParts = validPaths.map((_, i) => {
    return [
      // 视频处理：缩放 + 填充黑边 + 统一像素格式
      // 注意：不统一帧率，保持原始播放速度
      `[${i}:v]`,
      `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease,`,
      `pad=${targetWidth}:${targetHeight}:(ow-iw)/2:(oh-ih)/2,`,
      `format=yuv420p[v${i}]`
    ].join('');
  });

  const audioFilterParts = validPaths.map((_, i) => {
    return [
      // 音频处理：统一采样率 + 统一声道
      `[${i}:a]`,
      `aformat=sample_rates=48000:channel_layouts=stereo[a${i}]`
    ].join('');
  });

  // 合并所有 filter
  // filter complex 语法：每个 filter chain 用分号分隔
  // 格式: [input1]filter1[out1];[input2]filter2[out2];[in1][in2]concat[out]

  const videoFilters = filterParts.join(';');
  const audioFilters = audioFilterParts.join(';');
  const concatInput = validPaths.map((_, i) => `[v${i}][a${i}]`).join('');
  const concatFilter = `${concatInput}concat=n=${validPaths.length}:v=1:a=1[v][a]`;

  const filterComplex = `${videoFilters};${audioFilters};${concatFilter}`;

  const argsFilter = [
    // 所有输入文件
    ...validPaths.flatMap(filePath => ["-i", filePath]),
    // filter complex
    "-filter_complex", filterComplex,
    // 映射输出流
    "-map", "[v]",
    "-map", "[a]",
    // 视频编码
    "-c:v", "libx264",
    "-preset", "medium",  // 平衡速度和质量
    "-crf", "23",
    "-profile:v", "high",
    "-level", "4.1",
    "-pix_fmt", "yuv420p",
    // 音频编码
    "-c:a", "aac",
    "-b:a", "192k",
    "-ar", "48000",
    "-ac", "2",
    // 优化选项
    "-movflags", "+faststart",
    "-y",
    outputPath
  ];

  try {
    await runFFmpeg(argsFilter);
    console.log('[Stitch] ✅ 拼接完成');

    // 诊断：检查输出文件时长
    try {
      const outputStats = fs.statSync(outputPath);
      const sizeMB = (outputStats.size / 1024 / 1024).toFixed(2);
      console.log(`[Stitch] 📊 输出文件: ${sizeMB} MB`);
      console.log(`[Stitch] 📊 输出路径: ${outputPath}`);
    } catch (e) {
      console.log('[Stitch] ⚠️ 无法读取输出文件信息');
    }
  } catch (error) {
    console.log('[Stitch] ❌ 拼接失败:', error.message);
    throw error;
  }

  console.log(`[Stitch] ✅ 拼接完成: ${outputPath}`);
}

async function runGeneration({ mode, selection, rules, output, transitions }, sendProgress, eventSender) {
  // 设置日志发送器
  logEvent = eventSender;
  const logs = [];

  const log = (message) => {
    logs.push(message);
    sendLog('info', message);
  };

  // 立即记录接收到的 payload 参数
  console.log('[runGeneration] 接收到的参数:');
  console.log('[runGeneration]   mode:', mode);
  console.log('[runGeneration]   selection:', selection.length, '个片段');
  console.log('[runGeneration]   rules:', JSON.stringify(rules));
  console.log('[runGeneration]   output:', JSON.stringify(output));
  console.log('[runGeneration]   transitions:', transitions);
  console.log('[runGeneration]   transitions 类型:', typeof transitions);
  console.log('[runGeneration]   transitions.enabled:', transitions?.enabled);
  console.log('[runGeneration]   transitions.defaultTransition:', transitions?.defaultTransition);

  sendLog('info', `开始生成: ${selection.length} 个片段`);

  // 记录淡入淡出设置
  if (output.fadeInDuration > 0 || output.fadeOutDuration > 0) {
    sendLog('info', `淡入淡出效果: 淡入 ${output.fadeInDuration}s, 淡出 ${output.fadeOutDuration}s`);
  }

  if (!selection || selection.length === 0) {
    throw new Error("没有选择任何卡片");
  }

  // 创建临时目录
  const tempDir = path.join(app.getPath("temp"), "rdg-generator");
  ensureDir(tempDir);

  const timestamp = Date.now();
  const noAudioCards = [];

  try {
    // 步骤 1: 验证和准备视频源
    sendProgress({
      step: "validate",
      label: "验证卡片片段",
      current: 1,
      total: 3,
      selectionCount: selection.length
    });

    const inputVideos = [];

    for (let i = 0; i < selection.length; i++) {
      const card = selection[i];
      sendLog('info', `处理 ${i + 1}/${selection.length}: ${card.title || card.id}`);

      let inputPath;

      if (card.source === "local") {
        // 本地视频：直接使用
        if (!card.localPath || !fs.existsSync(card.localPath)) {
          throw new Error(`本地视频文件不存在: ${card.localPath}`);
        }
        inputPath = card.localPath;
        sendLog('debug', `使用本地视频: ${path.basename(card.localPath)}`);
      } else if (card.bvid) {
        // B站视频：使用 yt-dlp 下载到临时文件
        inputPath = path.join(tempDir, `source_${timestamp}_${i}.mp4`);
        sendLog('info', `下载B站视频: ${card.bvid}`);

        // 使用 yt-dlp 下载
        await downloadBilibiliVideo(card, inputPath, (percent) => {
          sendProgress?.({
            step: "downloading",
            label: `下载B站视频 ${card.bvid} (${percent.toFixed(0)}%)`,
            current: i,
            total: selection.length,
            progress: percent
          });
        });

        if (!fs.existsSync(inputPath)) {
          throw new Error(`B站视频下载失败: ${card.bvid}`);
        }

        sendLog('success', `下载完成: ${(fs.statSync(inputPath).size / 1024 / 1024).toFixed(2)} MB`);
      } else {
        throw new Error(`卡片 ${i + 1} 缺少视频源信息`);
      }

      // 收集视频信息
      inputVideos.push({
        index: i,
        path: inputPath,
        start: card.start,
        end: card.end,
        duration: card.end - card.start,
        title: card.title || card.id,
        tags: card.tags || [],
        clipTags: card.clipTags || []
      });

      log(`  视频 ${i + 1}: ${card.start.toFixed(1)}s - ${card.end.toFixed(1)}s (${(card.end - card.start).toFixed(1)}s)`);

      // 更新进度
      const progress = ((i + 1) / selection.length) * 100;
      sendProgress({
        step: "validate",
        label: `准备视频源 (${i + 1}/${selection.length})`,
        current: 1,
        total: 3,
        selectionCount: selection.length,
        progress: progress
      });
    }

    sendLog('success', `视频源准备完成: ${inputVideos.length} 个`);

    // ==========================================
    // 转场视频诊断
    // ==========================================
    sendLog('info', `========== 转场配置诊断 ==========`);
    sendLog('info', `transitions 对象存在: ${!!transitions}`);
    if (transitions) {
      sendLog('info', `transitions.enabled: ${transitions.enabled}`);
      sendLog('info', `transitions.defaultTransition: ${transitions.defaultTransition || '(未设置)'}`);
      sendLog('info', `transitions.tagTransitionGroups: ${JSON.stringify(transitions.tagTransitionGroups)}`);
    }
    sendLog('info', `====================================`);

    // 插入转场视频
    if (transitions && transitions.enabled && transitions.defaultTransition) {
      sendLog('info', `✅ 转场已启用,插入转场视频...`);
      sendLog('info', `默认转场视频: ${transitions.defaultTransition}`);
      sendLog('info', `标签转场组数量: ${transitions.tagTransitionGroups?.length || 0}`);

      const videoWithTransitions = [];
      let transitionCount = 0;

      // ==========================================
      // 辅助函数: 根据视频标签匹配转场视频
      // ==========================================
      const getTransitionForVideo = (video) => {
        let transitionPath = transitions.defaultTransition;
        let matchedTag = null;

        const videoTags = [
          ...(video.tags || []),
          ...(video.clipTags || [])
        ];

        sendLog('debug', `检查视频标签: ${videoTags.join(', ') || '(无)'}`);

        if (videoTags.length > 0 &&
            transitions.tagTransitionGroups && Array.isArray(transitions.tagTransitionGroups)) {
          for (const group of transitions.tagTransitionGroups) {
            if (group.tags && Array.isArray(group.tags) && group.transitionPath) {
              const hasMatch = videoTags.some(tag => group.tags.includes(tag));
              if (hasMatch) {
                transitionPath = group.transitionPath;
                matchedTag = videoTags.find(tag => group.tags.includes(tag));
                sendLog('info', `标签组匹配: "${matchedTag}" (组: ${group.tags.join(', ')}) -> ${path.basename(transitionPath)}`);
                break;
              }
            }
          }
        }

        return { transitionPath, matchedTag };
      };

      // ==========================================
      // 步骤 1: 在第一个片段之前插入开场转场
      // ==========================================
      if (inputVideos.length > 0) {
        const firstVideo = inputVideos[0];
        const { transitionPath, matchedTag } = getTransitionForVideo(firstVideo);

        if (transitionPath && fs.existsSync(transitionPath)) {
          try {
            const metadata = await getVideoMetadata(transitionPath);
            const transitionDuration = metadata.duration;

            sendLog('info', `插入开场转场: ${path.basename(transitionPath)} (${transitionDuration.toFixed(2)}s)`);
            log(`  开场转场: ${path.basename(transitionPath)} (${transitionDuration.toFixed(2)}s)`);

            videoWithTransitions.push({
              index: `transition_opening`,
              path: transitionPath,
              start: 0,
              end: transitionDuration,
              duration: transitionDuration,
              title: `开场转场${matchedTag ? ` (${matchedTag})` : ''}`,
              isTransition: true
            });
            transitionCount++;
          } catch (error) {
            sendLog('error', `获取开场转场视频元数据失败: ${error.message}`);
          }
        } else {
          sendLog('warn', `开场转场文件不存在: ${transitionPath}`);
        }
      }

      // ==========================================
      // 步骤 2: 插入所有视频片段，并在它们之间插入转场
      // ==========================================
      for (let i = 0; i < inputVideos.length; i++) {
        // 添加当前视频
        videoWithTransitions.push(inputVideos[i]);
        sendLog('debug', `添加片段 ${i + 1}: ${inputVideos[i].title}`);

        // 如果不是最后一个视频,添加转场
        if (i < inputVideos.length - 1) {
          const nextVideo = inputVideos[i + 1];
          const { transitionPath, matchedTag } = getTransitionForVideo(nextVideo);

          // 验证转场文件存在并获取实际时长
          if (transitionPath && fs.existsSync(transitionPath)) {
            try {
              // 获取转场视频的实际时长
              const metadata = await getVideoMetadata(transitionPath);
              const transitionDuration = metadata.duration;

              sendLog('info', `插入转场 ${transitionCount + 1}: ${path.basename(transitionPath)} (${transitionDuration.toFixed(2)}s)`);
              log(`  转场视频: ${path.basename(transitionPath)} (${transitionDuration.toFixed(2)}s)`);

              videoWithTransitions.push({
                index: `transition_${i}`,
                path: transitionPath,
                start: 0,
                end: transitionDuration,
                duration: transitionDuration,
                title: `转场 ${i + 1}${matchedTag ? ` (${matchedTag})` : ''}`,
                isTransition: true
              });
              transitionCount++;
            } catch (error) {
              sendLog('error', `获取转场视频元数据失败: ${error.message}`);
            }
          } else {
            sendLog('warn', `转场文件不存在: ${transitionPath}`);
          }
        }
      }

      // 替换原数组
      inputVideos.length = 0;
      inputVideos.push(...videoWithTransitions);

      sendLog('success', `插入转场完成: 共 ${transitionCount} 个转场, 总 ${inputVideos.length} 个片段`);
    } else {
      sendLog('warning', `⚠️ 转场未插入 - 可能的原因:`);
      if (!transitions) {
        sendLog('warning', `  - transitions 对象不存在`);
      } else {
        if (!transitions.enabled) {
          sendLog('warning', `  - 转场未启用 (transitions.enabled = false)`);
        }
        if (!transitions.defaultTransition) {
          sendLog('warning', `  - 未设置默认转场视频 (transitions.defaultTransition 为空)`);
        }
      }
      sendLog('info', `继续使用原始 ${inputVideos.length} 个片段进行拼接`);
    }

    // 步骤 2: 使用 filter complex 一次性处理所有视频
    sendProgress({
      step: "stitch",
      label: "生成最终视频",
      current: 2,
      total: 3,
      selectionCount: selection.length
    });

    // 输出到临时目录
    const outputDir = path.join(app.getPath("temp"), "rdg-output");
    ensureDir(outputDir);
    const outputPath = path.join(outputDir, `dance_${timestamp}.mp4`);

    // 确保输出文件不存在
    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }

    sendLog('info', `输出: ${path.basename(outputPath)}`);
    sendLog('info', `输出路径: ${outputPath}`);
    sendLog('info', `🚀 使用 Map-Reduce 模式 (${inputVideos.length} 个片段，并发加速)`);
    sendLog('info', '开始处理...');

    // Map-Reduce 模式：标准化 + 拼接
    await mapReduceGeneration(inputVideos, outputPath, log, sendProgress, output);

    // 验证输出文件
    if (!fs.existsSync(outputPath)) {
      throw new Error(`生成失败`);
    }
    const outputStats = fs.statSync(outputPath);
    sendLog('success', `生成完成: ${(outputStats.size / 1024 / 1024).toFixed(2)} MB`);

    // 步骤 3: 完成
    sendProgress({
      step: "complete",
      label: "生成完成!",
      current: 3,
      total: 3,
      selectionCount: selection.length
    });

    sendLog('success', `✨ 文件已保存: ${outputPath}`);

    // 清理下载的完整视频文件（保留用户原始本地文件）
    log('清理下载的临时文件...');
    for (const video of inputVideos) {
      if (video.path.includes('source_') && fs.existsSync(video.path)) {
        try {
          fs.unlinkSync(video.path);
          log(`  已删除: ${video.path}`);
        } catch (e) {
          console.error('[Generator] 删除失败:', video.path, e.message);
        }
      }
    }

    return {
      ok: true,
      message: "生成完成！",
      outputPath: outputPath,
      warnings: noAudioCards.length > 0 ? [
        `${noAudioCards.length}个视频没有音频，已添加静音轨道`,
        ...noAudioCards.map(card => `卡片 "${card}" 无音频`)
      ] : [],
      logs: logs
    };

  } catch (error) {
    console.error('[Generator] 错误:', error);
    throw error;
  }
}

module.exports = {
  runGeneration
};

