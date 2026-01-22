/**
 * 本地视频处理模块
 * 提供本地文件选择、元数据提取等功能
 */

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { dialog } = require("electron");
const ffmpegPath = require("ffmpeg-static");
const ffprobePath = require("ffprobe-static");

/**
 * 检查文件是否存在
 * @param {string} filePath - 文件路径
 * @returns {boolean} 文件是否存在
 */
function checkFileExists(filePath) {
  try {
    return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  } catch (error) {
    return false;
  }
}

/**
 * 打开文件夹选择对话框
 * @param {Object} mainWindow - Electron主窗口
 * @returns {Promise<string|null>} 选中的文件夹路径,取消则返回null
 */
async function selectVideoFolder(mainWindow) {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "选择包含视频的文件夹",
    properties: ["openDirectory"]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0];
}

/**
 * 扫描文件夹中的视频文件
 * @param {string} folderPath - 文件夹路径
 * @returns {Promise<Array>} 视频文件列表
 */
async function scanVideoFiles(folderPath) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(folderPath)) {
      reject(new Error("文件夹不存在"));
      return;
    }

    const videoExtensions = [".mp4", ".mkv", ".avi", ".mov", ".flv", ".wmv", ".webm", ".m4v"];
    const videoFiles = [];

    try {
      const files = fs.readdirSync(folderPath);

      for (const file of files) {
        const ext = path.extname(file).toLowerCase();
        if (videoExtensions.includes(ext)) {
          const fullPath = path.join(folderPath, file);
          const stats = fs.statSync(fullPath);

          videoFiles.push({
            name: file,
            path: fullPath,
            size: stats.size,
            modifiedTime: stats.mtime
          });
        }
      }

      // 按文件名排序
      videoFiles.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));

      resolve(videoFiles);
    } catch (error) {
      reject(new Error(`扫描文件夹失败: ${error.message}`));
    }
  });
}

/**
 * 打开文件选择对话框
 * @param {Object} mainWindow - Electron主窗口
 * @returns {Promise<string|null>} 选中的文件路径,取消则返回null
 */
async function selectVideoFile(mainWindow) {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "选择视频文件",
    properties: ["openFile"],
    filters: [
      { name: "视频文件", extensions: ["mp4", "mkv", "avi", "mov", "flv", "wmv", "webm", "m4v"] },
      { name: "所有文件", extensions: ["*"] }
    ]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0];
}

/**
 * 使用FFmpeg获取视频元数据
 * @param {string} filePath - 视频文件路径
 * @returns {Promise<Object>} 视频元数据
 */
async function getVideoMetadata(filePath) {
  return new Promise((resolve, reject) => {
    if (!checkFileExists(filePath)) {
      reject(new Error("文件不存在"));
      return;
    }

    // ffmpeg-static返回的是对象,需要提取.path
    const ffprobeExecutable = typeof ffprobePath === 'string' ? ffprobePath : ffprobePath.path;

    console.log('使用FFprobe获取元数据:', filePath);
    console.log('FFprobe路径:', ffprobeExecutable);

    const args = [
      "-v", "error",
      "-show_entries", "format=duration,size",
      "-show_entries", "stream=width,height,codec_name,codec_type",
      "-of", "json",
      filePath
    ];

    console.log('FFprobe参数:', args);

    let ffprobe;
    try {
      ffprobe = spawn(ffprobeExecutable, args);
    } catch (error) {
      console.error('启动FFprobe进程失败:', error);
      reject(new Error(`启动FFprobe进程失败: ${error.message}`));
      return;
    }

    let stdout = "";
    let stderr = "";
    let isResolved = false;

    // 超时保护：30秒后强制结束
    const timeout = setTimeout(() => {
      if (isResolved) return;
      isResolved = true;
      console.error('FFprobe执行超时');
      ffprobe.kill();
      reject(new Error('FFprobe执行超时(30秒)'));
    }, 30000);

    ffprobe.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    ffprobe.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    ffprobe.on("close", (code) => {
      clearTimeout(timeout);
      if (isResolved) return;
      isResolved = true;

      console.log('FFprobe进程退出,代码:', code);

      if (code !== 0) {
        console.error('FFprobe执行失败:', stderr);
        reject(new Error(`FFprobe执行失败: ${stderr}`));
        return;
      }

      try {
        const metadata = JSON.parse(stdout);
        console.log('FFprobe返回的元数据:', metadata);

        // 提取时长
        const duration = parseFloat(metadata.format?.duration) || 0;

        // 提取文件大小
        const fileSize = parseInt(metadata.format?.size) || 0;

        // 查找视频流
        const videoStream = metadata.streams?.find(s => s.codec_type === "video");

        // 提取分辨率
        const width = videoStream?.width || 0;
        const height = videoStream?.height || 0;

        // 提取编码
        const codec = videoStream?.codec_name || "";

        console.log('成功解析元数据:', { duration, width, height, codec });

        resolve({
          duration,
          fileSize,
          width,
          height,
          codec,
          filePath
        });
      } catch (error) {
        console.error('解析元数据失败:', error);
        reject(new Error(`解析元数据失败: ${error.message}`));
      }
    });

    ffprobe.on("error", (error) => {
      clearTimeout(timeout);
      if (isResolved) return;
      isResolved = true;
      console.error('FFprobe进程错误:', error);
      reject(new Error(`FFprobe进程错误: ${error.message}`));
    });
  });
}

/**
 * 获取视频文件的简略信息(用于快速验证)
 * @param {string} filePath - 视频文件路径
 * @returns {Promise<Object>} 视频信息
 */
async function getVideoInfoQuick(filePath) {
  if (!checkFileExists(filePath)) {
    return {
      exists: false,
      error: "文件不存在"
    };
  }

  try {
    const metadata = await getVideoMetadata(filePath);
    return {
      exists: true,
      duration: metadata.duration,
      fileSize: metadata.fileSize,
      width: metadata.width,
      height: metadata.height
    };
  } catch (error) {
    return {
      exists: true,
      error: error.message
    };
  }
}

module.exports = {
  checkFileExists,
  selectVideoFolder,
  scanVideoFiles,
  selectVideoFile,
  getVideoMetadata,
  getVideoInfoQuick
};
