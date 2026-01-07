const { spawn } = require("child_process");
const { app } = require("electron");
const fs = require("fs");
const https = require("https");
const path = require("path");

const cache = new Map();
const playUrlCache = new Map();
const metaCache = new Map();
const chunkCache = new Map();
const dashCache = new Map();
const segmentCacheTtlMs = 60 * 60 * 1000;
const metaCacheTtlMs = 24 * 60 * 60 * 1000;
const playUrlFallbackTtlMs = 30 * 60 * 1000;
const chunkSecondsDefault = 3;
const chunkSecondsMin = 1;

function runYtDlp(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("yt-dlp", args, { windowsHide: true });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("error", (err) => {
      reject(err);
    });

    child.on("close", (code) => {
      if (code !== 0) {
        const message = stderr || `yt-dlp exited with code ${code}`;
        reject(new Error(message));
        return;
      }
      const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      if (!lines.length) {
        reject(new Error("yt-dlp returned no preview URL."));
        return;
      }
      resolve(lines);
    });
  });
}

function pickPlayableUrl(lines) {
  if (lines.length === 1) return lines[0];
  const m3u8 = lines.find((line) => line.includes(".m3u8"));
  if (m3u8) return m3u8;
  const mp4 = lines.find((line) => line.includes(".mp4"));
  if (mp4) return mp4;
  return lines[0];
}

function findDirectPlayableUrl(lines) {
  return lines.find((line) => /\.m3u8(\?|$)/.test(line) || /\.mp4(\?|$)/.test(line));
}

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function cookieFromNetscape(cookieFilePath) {
  if (!cookieFilePath || !fs.existsSync(cookieFilePath)) return "";
  const content = fs.readFileSync(cookieFilePath, "utf8");
  const lines = content.split(/\r?\n/).filter((line) => line && !line.startsWith("#"));
  const parts = lines.map((line) => {
    const cols = line.split("\t");
    if (cols.length < 7) return "";
    const name = cols[5];
    const value = cols[6];
    return name && value ? `${name}=${value}` : "";
  });
  return parts.filter(Boolean).join("; ");
}

function buildHeaders(rawCookie, cookieFilePath) {
  const cookieValue = (rawCookie || "").trim().replace(/\r?\n/g, " ") || cookieFromNetscape(cookieFilePath);
  const headers = [
    "Referer: https://www.bilibili.com/",
    "Origin: https://www.bilibili.com",
    "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    cookieValue ? `Cookie: ${cookieValue}` : ""
  ].filter(Boolean);
  return headers.join("\r\n");
}

function buildHeaderObject(rawCookie, cookieFilePath) {
  const cookieValue = (rawCookie || "").trim().replace(/\r?\n/g, " ") || cookieFromNetscape(cookieFilePath);
  const headers = {
    Referer: "https://www.bilibili.com/",
    Origin: "https://www.bilibili.com",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  };
  if (cookieValue) {
    headers.Cookie = cookieValue;
  }
  return headers;
}

function buildCookieArgs(rawCookie, cookieFilePath) {
  const normalizedCookie = (rawCookie || "").trim().replace(/\r?\n/g, " ");
  if (normalizedCookie) {
    return { cookieArgs: ["--add-header", `Cookie: ${normalizedCookie}`], normalizedCookie };
  }
  if (cookieFilePath) {
    return { cookieArgs: ["--cookies", cookieFilePath], normalizedCookie: "" };
  }
  return { cookieArgs: [], normalizedCookie: "" };
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });
    child.on("error", (err) => {
      reject(err);
    });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `ffmpeg exited with code ${code}`));
        return;
      }
      resolve(true);
    });
  });
}

async function clipStreamToFile(url, outputPath, startSeconds, durationSeconds, rawCookie, cookieFilePath) {
  const headers = buildHeaders(rawCookie, cookieFilePath);
  const baseArgs = [
    "-y",
    "-ss",
    String(startSeconds),
    "-t",
    String(durationSeconds),
    "-headers",
    headers,
    "-i",
    url
  ];
  const copyArgs = [...baseArgs, "-c", "copy", "-movflags", "+faststart", outputPath];
  try {
    await runFfmpeg(copyArgs);
  } catch (err) {
    const encodeArgs = [
      ...baseArgs,
      "-c:v",
      "libx264",
      "-c:a",
      "aac",
      "-preset",
      "veryfast",
      "-crf",
      "23",
      "-movflags",
      "+faststart",
      outputPath
    ];
    await runFfmpeg(encodeArgs);
  }
  return outputPath;
}

async function clipStreamsToFile(videoUrl, audioUrl, outputPath, startSeconds, durationSeconds, rawCookie, cookieFilePath) {
  const headers = buildHeaders(rawCookie, cookieFilePath);
  const baseArgs = [
    "-y",
    "-ss",
    String(startSeconds),
    "-t",
    String(durationSeconds),
    "-headers",
    headers,
    "-i",
    videoUrl,
    "-ss",
    String(startSeconds),
    "-t",
    String(durationSeconds),
    "-headers",
    headers,
    "-i",
    audioUrl
  ];
  const copyArgs = [...baseArgs, "-c", "copy", "-movflags", "+faststart", outputPath];
  try {
    await runFfmpeg(copyArgs);
  } catch (err) {
    const encodeArgs = [
      ...baseArgs,
      "-c:v",
      "libx264",
      "-c:a",
      "aac",
      "-preset",
      "veryfast",
      "-crf",
      "23",
      "-movflags",
      "+faststart",
      outputPath
    ];
    await runFfmpeg(encodeArgs);
  }
  return outputPath;
}

function cleanupPreviewDir(previewDir) {
  if (!fs.existsSync(previewDir)) return;
  const now = Date.now();
  for (const entry of fs.readdirSync(previewDir)) {
    const filePath = path.join(previewDir, entry);
    try {
      const stats = fs.statSync(filePath);
      if (now - stats.mtimeMs > segmentCacheTtlMs) {
        fs.unlinkSync(filePath);
      }
    } catch (err) {
      // ignore cleanup errors
    }
  }
}

function buildFormatAttempts(quality) {
  if (!quality || quality === "auto") {
    return [
      "best[ext=mp4][acodec!=none]/best[acodec!=none]",
      "best[protocol*=m3u8][acodec!=none]/best[acodec!=none]",
      "b[acodec!=none]/b"
    ];
  }

  const heightMap = {
    "1080p": 1080,
    "720p": 720,
    "480p": 480,
    "360p": 360
  };
  const maxHeight = heightMap[quality] || 720;
  return [
    `best[ext=mp4][height<=${maxHeight}][acodec!=none]/best[acodec!=none]`,
    `best[protocol*=m3u8][height<=${maxHeight}][acodec!=none]/best[acodec!=none]`,
    `b[height<=${maxHeight}][acodec!=none]/b`
  ];
}

function buildKeyBase(bvid, quality) {
  return `${bvid}:${quality || "auto"}`;
}

function parseDeadline(url) {
  try {
    const parsed = new URL(url);
    const deadline = Number(parsed.searchParams.get("deadline"));
    if (Number.isFinite(deadline) && deadline > 0) {
      return deadline * 1000;
    }
  } catch (err) {
    // ignore parse errors
  }
  return 0;
}

function fetchJson(url, headers) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        fetchJson(res.headers.location, headers).then(resolve, reject);
        return;
      }
      if (res.statusCode && res.statusCode >= 400) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        try {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve(JSON.parse(text));
        } catch (err) {
          reject(err);
        }
      });
    });
    request.on("error", reject);
  });
}

function fetchRange(url, headers, start, end) {
  return new Promise((resolve, reject) => {
    const rangeHeaders = { ...headers, Range: `bytes=${start}-${end}` };
    const request = https.get(url, { headers: rangeHeaders }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        fetchRange(res.headers.location, headers, start, end).then(resolve, reject);
        return;
      }
      if (res.statusCode && res.statusCode >= 400) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve(Buffer.concat(chunks)));
    });
    request.on("error", reject);
  });
}

function normalizePathForConcat(filePath) {
  return filePath.replace(/\\/g, "/").replace(/'/g, "'\\''");
}

function parseRange(value) {
  if (!value || typeof value !== "string") return null;
  const parts = value.split("-").map((part) => Number(part));
  if (parts.length !== 2 || parts.some((part) => Number.isNaN(part))) return null;
  return { start: parts[0], end: parts[1] };
}

function readUint64(view, offset) {
  const high = view.getUint32(offset);
  const low = view.getUint32(offset + 4);
  return high * 2 ** 32 + low;
}

function parseSidx(buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let offset = 0;
  let size = view.getUint32(offset);
  offset += 4;
  const type =
    String.fromCharCode(view.getUint8(offset)) +
    String.fromCharCode(view.getUint8(offset + 1)) +
    String.fromCharCode(view.getUint8(offset + 2)) +
    String.fromCharCode(view.getUint8(offset + 3));
  offset += 4;
  if (size === 1) {
    size = readUint64(view, offset);
    offset += 8;
  }
  if (type !== "sidx") {
    throw new Error("Invalid sidx box.");
  }
  const version = view.getUint8(offset);
  offset += 1;
  offset += 3;
  view.getUint32(offset);
  offset += 4;
  const timescale = view.getUint32(offset);
  offset += 4;
  let earliest = 0;
  let firstOffset = 0;
  if (version === 0) {
    earliest = view.getUint32(offset);
    offset += 4;
    firstOffset = view.getUint32(offset);
    offset += 4;
  } else {
    earliest = readUint64(view, offset);
    offset += 8;
    firstOffset = readUint64(view, offset);
    offset += 8;
  }
  offset += 2;
  const refCount = view.getUint16(offset);
  offset += 2;
  const references = [];
  for (let i = 0; i < refCount; i += 1) {
    const ref = view.getUint32(offset);
    offset += 4;
    const refSize = ref & 0x7fffffff;
    const duration = view.getUint32(offset);
    offset += 4;
    offset += 4;
    references.push({ size: refSize, duration });
  }
  return { size, timescale, earliest, firstOffset, references };
}

function buildSegmentsFromSidx(sidx, indexRangeStart) {
  const segments = [];
  const baseOffset = indexRangeStart + sidx.size + sidx.firstOffset;
  let offset = baseOffset;
  let time = sidx.earliest / sidx.timescale;
  for (const ref of sidx.references) {
    const duration = ref.duration / sidx.timescale;
    segments.push({
      rangeStart: offset,
      rangeEnd: offset + ref.size - 1,
      time,
      duration
    });
    offset += ref.size;
    time += duration;
  }
  return segments;
}

async function resolvePlayUrls({ bvid, cookiePath, rawCookie, quality }) {
  const key = buildKeyBase(bvid, quality);
  const cached = playUrlCache.get(key);
  if (cached && cached.expiresAt && Date.now() < cached.expiresAt) {
    return cached;
  }
  const videoUrl = `https://www.bilibili.com/video/${bvid}`;
  const { cookieArgs, normalizedCookie } = buildCookieArgs(rawCookie, cookiePath);
  const formats = buildFormatAttempts(quality);
  const attempts = [
    ["-g", "-f", formats[0], "--no-playlist", ...cookieArgs, videoUrl],
    ["-g", "-f", formats[1], "--no-playlist", ...cookieArgs, videoUrl],
    ["-g", "-f", formats[2], "--no-playlist", ...cookieArgs, videoUrl],
    ["-g", "--no-playlist", ...cookieArgs, videoUrl]
  ];
  let lastError = null;
  for (const args of attempts) {
    try {
      const lines = await runYtDlp(args);
      const deadlines = lines.map(parseDeadline).filter(Boolean);
      const soonestDeadline = deadlines.length ? Math.min(...deadlines) : 0;
      const expiresAt = soonestDeadline
        ? Math.max(Date.now() + 60 * 1000, soonestDeadline - 60 * 1000)
        : Date.now() + playUrlFallbackTtlMs;
      const entry = {
        lines,
        source: videoUrl,
        cookie: normalizedCookie || rawCookie,
        expiresAt
      };
      playUrlCache.set(key, entry);
      return entry;
    } catch (err) {
      lastError = err;
    }
  }
  if (lastError && lastError.message && lastError.message.includes("spawn")) {
    throw new Error("yt-dlp not found. Please install yt-dlp and ensure it is in PATH.");
  }
  throw lastError || new Error("Failed to resolve preview URL.");
}

function qualityToQn(quality) {
  if (!quality || quality === "auto") return 64;
  const map = {
    "1080p": 80,
    "720p": 64,
    "480p": 32,
    "360p": 16
  };
  return map[quality] || 64;
}

function pickDashVideo(list, qn) {
  if (!Array.isArray(list) || !list.length) return null;
  const candidates = list.filter((item) => Number.isFinite(item.id));
  const eligible = candidates.filter((item) => item.id <= qn);
  const target = eligible.length ? eligible : candidates;
  return target.reduce((best, item) => (item.id > best.id ? item : best), target[0]);
}

function pickDashAudio(list) {
  if (!Array.isArray(list) || !list.length) return null;
  return list.reduce((best, item) => (item.bandwidth > best.bandwidth ? item : best), list[0]);
}

async function getDashInfo({ bvid, quality, cookiePath, rawCookie }) {
  const key = buildKeyBase(bvid, quality);
  const cached = dashCache.get(key);
  if (cached && cached.expiresAt && Date.now() < cached.expiresAt) {
    return cached.info;
  }
  const headers = buildHeaderObject(rawCookie, cookiePath);
  const pageUrl = `https://api.bilibili.com/x/player/pagelist?bvid=${bvid}`;
  const pageJson = await fetchJson(pageUrl, headers);
  const cid = pageJson?.data?.[0]?.cid;
  if (!cid) {
    throw new Error("Failed to resolve cid.");
  }
  const qn = qualityToQn(quality);
  const playUrl = `https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${cid}&fnval=4048&qn=${qn}`;
  const playJson = await fetchJson(playUrl, headers);
  const dash = playJson?.data?.dash;
  if (!dash) {
    throw new Error("DASH info not available.");
  }
  const videoTrack = pickDashVideo(dash.video || [], qn);
  const audioTrack = pickDashAudio(dash.audio || []);
  if (!videoTrack || !audioTrack) {
    throw new Error("Missing DASH tracks.");
  }
  const videoBaseUrl = videoTrack.baseUrl || videoTrack.base_url;
  const audioBaseUrl = audioTrack.baseUrl || audioTrack.base_url;
  const videoSegmentBase = videoTrack.segment_base || videoTrack.SegmentBase;
  const audioSegmentBase = audioTrack.segment_base || audioTrack.SegmentBase;
  const videoInit = parseRange(videoSegmentBase?.initialization || videoSegmentBase?.Initialization);
  const videoIndex = parseRange(videoSegmentBase?.index_range || videoSegmentBase?.indexRange);
  const audioInit = parseRange(audioSegmentBase?.initialization || audioSegmentBase?.Initialization);
  const audioIndex = parseRange(audioSegmentBase?.index_range || audioSegmentBase?.indexRange);
  if (!videoBaseUrl || !audioBaseUrl || !videoInit || !videoIndex || !audioInit || !audioIndex) {
    throw new Error("DASH segment ranges not available.");
  }
  const videoSidxBuffer = await fetchRange(videoBaseUrl, headers, videoIndex.start, videoIndex.end);
  const audioSidxBuffer = await fetchRange(audioBaseUrl, headers, audioIndex.start, audioIndex.end);
  const videoSidx = parseSidx(videoSidxBuffer);
  const audioSidx = parseSidx(audioSidxBuffer);
  const videoSegments = buildSegmentsFromSidx(videoSidx, videoIndex.start);
  const audioSegments = buildSegmentsFromSidx(audioSidx, audioIndex.start);
  const dashDuration = Number(dash.duration);
  let duration = Number.isFinite(dashDuration) ? dashDuration : (playJson?.data?.timelength || 0) / 1000;
  if (!Number.isFinite(duration) || duration <= 0) {
    const lastVideo = videoSegments[videoSegments.length - 1];
    const lastAudio = audioSegments[audioSegments.length - 1];
    const videoEnd = lastVideo ? lastVideo.time + lastVideo.duration : 0;
    const audioEnd = lastAudio ? lastAudio.time + lastAudio.duration : 0;
    const fallback = Math.max(videoEnd, audioEnd);
    if (fallback > 0) {
      duration = fallback;
    }
  }
  const expiresAt = parseDeadline(videoBaseUrl) || Date.now() + playUrlFallbackTtlMs;
  const info = {
    duration,
    video: {
      baseUrl: videoBaseUrl,
      initRange: videoInit,
      indexRange: videoIndex,
      mimeType: videoTrack.mimeType || videoTrack.mime_type || "video/mp4",
      codecs: videoTrack.codecs,
      segments: videoSegments
    },
    audio: {
      baseUrl: audioBaseUrl,
      initRange: audioInit,
      indexRange: audioIndex,
      mimeType: audioTrack.mimeType || audioTrack.mime_type || "audio/mp4",
      codecs: audioTrack.codecs,
      segments: audioSegments
    }
  };
  dashCache.set(key, { info, expiresAt });
  return info;
}

function getChunkCache(key) {
  const cached = chunkCache.get(key);
  if (!cached) return null;
  if (!cached.filePath || !fs.existsSync(cached.filePath)) {
    chunkCache.delete(key);
    return null;
  }
  if (Date.now() - cached.timestamp > segmentCacheTtlMs) {
    chunkCache.delete(key);
    return null;
  }
  return cached;
}

async function clipLocalFile(inputPath, outputPath, startSeconds, durationSeconds) {
  const baseArgs = ["-y", "-ss", String(startSeconds), "-t", String(durationSeconds), "-i", inputPath];
  const copyArgs = [...baseArgs, "-c", "copy", "-movflags", "+faststart", outputPath];
  try {
    await runFfmpeg(copyArgs);
  } catch (err) {
    const encodeArgs = [
      ...baseArgs,
      "-c:v",
      "libx264",
      "-c:a",
      "aac",
      "-preset",
      "veryfast",
      "-crf",
      "26",
      "-movflags",
      "+faststart",
      outputPath
    ];
    await runFfmpeg(encodeArgs);
  }
  return outputPath;
}

async function concatFiles(filePaths, outputPath) {
  const listPath = `${outputPath}.txt`;
  const listContent = filePaths
    .map((filePath) => `file '${normalizePathForConcat(filePath)}'`)
    .join("\n");
  fs.writeFileSync(listPath, `${listContent}\n`, "utf8");
  const baseArgs = ["-y", "-f", "concat", "-safe", "0", "-i", listPath];
  const copyArgs = [...baseArgs, "-c", "copy", "-movflags", "+faststart", outputPath];
  try {
    await runFfmpeg(copyArgs);
  } catch (err) {
    const encodeArgs = [
      ...baseArgs,
      "-c:v",
      "libx264",
      "-c:a",
      "aac",
      "-preset",
      "veryfast",
      "-crf",
      "26",
      "-movflags",
      "+faststart",
      outputPath
    ];
    await runFfmpeg(encodeArgs);
  } finally {
    try {
      fs.unlinkSync(listPath);
    } catch (err) {
      // ignore cleanup errors
    }
  }
  return outputPath;
}

async function ensureChunks({
  bvid,
  quality,
  segmentStart,
  segmentEnd,
  meta,
  cookiePath,
  rawCookie,
  previewDir
}) {
  const segmentDuration = Math.max(0.1, segmentEnd - segmentStart);
  const chunkSeconds =
    segmentDuration <= chunkSecondsDefault ? chunkSecondsMin : chunkSecondsDefault;
  const keyBase = buildKeyBase(bvid, quality);
  const chunkStartIndex = Math.floor(segmentStart / chunkSeconds);
  const chunkEndIndex = Math.floor((segmentEnd - 0.001) / chunkSeconds);
  const chunkEntries = [];
  const cachedRanges = [];
  let playInfo = null;

  ensureDir(previewDir);
  cleanupPreviewDir(previewDir);

  for (let index = chunkStartIndex; index <= chunkEndIndex; index += 1) {
    const chunkStart = index * chunkSeconds;
    const rawChunkEnd = chunkStart + chunkSeconds;
    const chunkEnd = meta.duration > 0 ? Math.min(rawChunkEnd, meta.duration) : rawChunkEnd;
    if (chunkEnd <= chunkStart) continue;
    const chunkKey = `${keyBase}:chunk:${chunkStart.toFixed(1)}-${chunkEnd.toFixed(1)}`;
    const fileNameChunk = `${bvid}-${quality || "auto"}-chunk-${Math.round(
      chunkStart * 1000
    )}-${Math.round(chunkEnd * 1000)}.mp4`;
    const chunkPath = path.join(previewDir, fileNameChunk);
    const cachedChunk = getChunkCache(chunkKey);
    if (cachedChunk) {
      chunkEntries.push({ start: chunkStart, end: chunkEnd, filePath: cachedChunk.filePath });
      cachedRanges.push({ start: chunkStart, end: chunkEnd });
      continue;
    }
    if (fs.existsSync(chunkPath)) {
      const stats = fs.statSync(chunkPath);
      if (Date.now() - stats.mtimeMs < segmentCacheTtlMs) {
        chunkCache.set(chunkKey, {
          filePath: chunkPath,
          start: chunkStart,
          end: chunkEnd,
          timestamp: Date.now()
        });
        chunkEntries.push({ start: chunkStart, end: chunkEnd, filePath: chunkPath });
        cachedRanges.push({ start: chunkStart, end: chunkEnd });
        continue;
      }
    }
    if (!playInfo) {
      playInfo = await resolvePlayUrls({ bvid, cookiePath, rawCookie, quality });
    }
    const lines = playInfo.lines || [];
    const durationSeconds = Math.max(0.1, chunkEnd - chunkStart);
    if (lines.length >= 2) {
      await clipStreamsToFile(
        lines[0],
        lines[1],
        chunkPath,
        chunkStart,
        durationSeconds,
        playInfo.cookie || rawCookie,
        cookiePath
      );
    } else {
      const url = findDirectPlayableUrl(lines) || pickPlayableUrl(lines);
      if (!url) {
        throw new Error("Failed to resolve preview URL.");
      }
      await clipStreamToFile(
        url,
        chunkPath,
        chunkStart,
        durationSeconds,
        playInfo.cookie || rawCookie,
        cookiePath
      );
    }
    chunkCache.set(chunkKey, {
      filePath: chunkPath,
      start: chunkStart,
      end: chunkEnd,
      timestamp: Date.now()
    });
    chunkEntries.push({ start: chunkStart, end: chunkEnd, filePath: chunkPath });
    cachedRanges.push({ start: chunkStart, end: chunkEnd });
  }

  return { chunkEntries, cachedRanges, chunkSeconds };
}

async function resolvePreviewUrl({ bvid, cookiePath, rawCookie, quality, start, end }) {
  if (!bvid) {
    throw new Error("Missing BV id.");
  }

  const meta = await safeResolveMeta({ bvid, cookiePath, rawCookie });
  const baseStart = Math.max(0, Number.isFinite(start) ? Number(start) : 0);
  const parsedEnd = Number.isFinite(end) ? Number(end) : baseStart + 30;
  const cappedEnd = meta.duration > 0 ? Math.min(parsedEnd, meta.duration) : parsedEnd;
  const segmentStart = baseStart;
  const segmentEnd =
    cappedEnd > segmentStart
      ? cappedEnd
      : meta.duration > 0
        ? Math.min(segmentStart + 30, meta.duration)
        : segmentStart + 30;
  const segmentDuration = Math.max(0.1, segmentEnd - segmentStart);
  const keyBase = buildKeyBase(bvid, quality);
  const segmentKey = `${segmentStart.toFixed(1)}-${segmentEnd.toFixed(1)}`;
  const cacheKey = `${keyBase}:${segmentKey}`;
  const cached = cache.get(cacheKey);
  if (
    cached &&
    Date.now() - cached.timestamp < segmentCacheTtlMs &&
    cached.filePath &&
    fs.existsSync(cached.filePath)
  ) {
    if (!cached.title || !cached.duration) {
      cached.title = meta.title || cached.title || "";
      cached.duration = Number.isFinite(meta.duration) ? meta.duration : cached.duration;
      cache.set(cacheKey, { ...cached, timestamp: cached.timestamp });
    }
    return {
      url: cached.url,
      source: cached.source,
      title: cached.title || "",
      duration: cached.duration || 0,
      cached: true,
      segmentStart,
      segmentEnd,
      cachedRanges: cached.cachedRanges || []
    };
  }

  const previewDir = path.join(app.getPath("userData"), "preview");
  const fileName = `${bvid}-${quality || "auto"}-${Math.round(segmentStart * 1000)}-${Math.round(
    segmentEnd * 1000
  )}.mp4`;
  const outputPath = path.join(previewDir, fileName);
  const outputUrl = `rdg://preview/${encodeURIComponent(fileName)}`;

  if (fs.existsSync(outputPath)) {
    const stats = fs.statSync(outputPath);
    if (Date.now() - stats.mtimeMs < segmentCacheTtlMs) {
      cache.set(cacheKey, {
        url: outputUrl,
        source: `https://www.bilibili.com/video/${bvid}`,
        title: meta.title,
        duration: meta.duration,
        timestamp: Date.now(),
        filePath: outputPath,
        cachedRanges: [{ start: segmentStart, end: segmentEnd }]
      });
      return {
        url: outputUrl,
        source: `https://www.bilibili.com/video/${bvid}`,
        title: meta.title,
        duration: meta.duration,
        segmentStart,
        segmentEnd,
        cachedRanges: [{ start: segmentStart, end: segmentEnd }]
      };
    }
  }

  const { chunkEntries, cachedRanges } = await ensureChunks({
    bvid,
    quality,
    segmentStart,
    segmentEnd,
    meta,
    cookiePath,
    rawCookie,
    previewDir
  });

  if (!chunkEntries.length) {
    throw new Error("Failed to build preview chunks.");
  }

  if (chunkEntries.length === 1) {
    const only = chunkEntries[0];
    const localStart = Math.max(0, segmentStart - only.start);
    await clipLocalFile(only.filePath, outputPath, localStart, segmentDuration);
  } else {
    const concatPath = path.join(
      previewDir,
      `${bvid}-${quality || "auto"}-concat-${Date.now()}.mp4`
    );
    await concatFiles(
      chunkEntries.map((entry) => entry.filePath),
      concatPath
    );
    const localStart = Math.max(0, segmentStart - chunkEntries[0].start);
    await clipLocalFile(concatPath, outputPath, localStart, segmentDuration);
    try {
      fs.unlinkSync(concatPath);
    } catch (err) {
      // ignore cleanup errors
    }
  }

  cache.set(cacheKey, {
    url: outputUrl,
    source: `https://www.bilibili.com/video/${bvid}`,
    title: meta.title,
    duration: meta.duration,
    timestamp: Date.now(),
    filePath: outputPath,
    cachedRanges
  });
  return {
    url: outputUrl,
    source: `https://www.bilibili.com/video/${bvid}`,
    title: meta.title,
    duration: meta.duration,
    segmentStart,
    segmentEnd,
    cachedRanges
  };
}

async function prefetchPreviewChunks({ bvid, cookiePath, rawCookie, quality, start, end }) {
  if (!bvid) {
    throw new Error("Missing BV id.");
  }
  const meta = await safeResolveMeta({ bvid, cookiePath, rawCookie });
  const baseStart = Math.max(0, Number.isFinite(start) ? Number(start) : 0);
  const parsedEnd = Number.isFinite(end) ? Number(end) : baseStart + 30;
  const cappedEnd = meta.duration > 0 ? Math.min(parsedEnd, meta.duration) : parsedEnd;
  const segmentStart = baseStart;
  const segmentEnd =
    cappedEnd > segmentStart
      ? cappedEnd
      : meta.duration > 0
        ? Math.min(segmentStart + 30, meta.duration)
        : segmentStart + 30;
  const previewDir = path.join(app.getPath("userData"), "preview");
  const { cachedRanges } = await ensureChunks({
    bvid,
    quality,
    segmentStart,
    segmentEnd,
    meta,
    cookiePath,
    rawCookie,
    previewDir
  });
  return {
    title: meta.title,
    duration: meta.duration,
    segmentStart,
    segmentEnd,
    cachedRanges
  };
}

async function fetchDashSegment({ bvid, cookiePath, rawCookie, quality, kind, index, init }) {
  const info = await getDashInfo({ bvid, quality, cookiePath, rawCookie });
  const headers = buildHeaderObject(rawCookie, cookiePath);
  const track = kind === "audio" ? info.audio : info.video;
  if (!track) {
    throw new Error("Missing DASH track.");
  }
  if (init) {
    const { start, end } = track.initRange;
    return fetchRange(track.baseUrl, headers, start, end);
  }
  const segment = track.segments?.[index];
  if (!segment) {
    throw new Error("Missing DASH segment.");
  }
  return fetchRange(track.baseUrl, headers, segment.rangeStart, segment.rangeEnd);
}

function parseDurationString(value) {
  if (!value || typeof value !== "string") return 0;
  const parts = value.trim().split(":").map((part) => Number(part));
  if (parts.some((part) => Number.isNaN(part))) return 0;
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return 0;
}

async function resolveVideoMeta({ bvid, cookiePath, rawCookie }) {
  const cached = metaCache.get(bvid);
  if (cached && Date.now() - cached.timestamp < metaCacheTtlMs) {
    return { title: cached.title, duration: cached.duration };
  }
  const videoUrl = `https://www.bilibili.com/video/${bvid}`;
  const { cookieArgs } = buildCookieArgs(rawCookie, cookiePath);
  const args = [
    "--print",
    "%(title)s",
    "--print",
    "%(duration)s",
    "--print",
    "%(duration_string)s",
    "--no-playlist",
    ...cookieArgs,
    videoUrl
  ];
  const lines = await runYtDlp(args);
  const title = lines[0] || "";
  const durationValue = Number(lines[1]);
  const fallbackDuration = parseDurationString(lines[2]);
  const duration = Number.isFinite(durationValue) && durationValue > 0 ? durationValue : fallbackDuration;
  const normalizedDuration = Number.isFinite(duration) ? duration : 0;
  metaCache.set(bvid, { title, duration: normalizedDuration, timestamp: Date.now() });
  return { title, duration: normalizedDuration };
}

async function getVideoInfo({ bvid, cookiePath, rawCookie }) {
  const cached = metaCache.get(bvid);
  if (cached && Date.now() - cached.timestamp < metaCacheTtlMs) {
    return {
      title: cached.title,
      duration: cached.duration,
      aid: cached.aid,
      cid: cached.cid
    };
  }
  const headers = buildHeaderObject(rawCookie, cookiePath);
  const infoUrl = `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`;
  const infoJson = await fetchJson(infoUrl, headers);
  const data = infoJson?.data;
  if (!data) {
    throw new Error("Failed to resolve video info.");
  }
  const title = data.title || "";
  const duration = Number(data.duration) || 0;
  const aid = data.aid ? String(data.aid) : "";
  const cid = data.cid ? String(data.cid) : "";
  metaCache.set(bvid, { title, duration, aid, cid, timestamp: Date.now() });
  return { title, duration, aid, cid };
}

async function safeResolveMeta({ bvid, cookiePath, rawCookie }) {
  try {
    return await resolveVideoMeta({ bvid, cookiePath, rawCookie });
  } catch (err) {
    return { title: "", duration: 0 };
  }
}

module.exports = {
  getVideoInfo,
  resolvePreviewUrl,
  prefetchPreviewChunks,
  getDashInfo,
  fetchDashSegment
};
