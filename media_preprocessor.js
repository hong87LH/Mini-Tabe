import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const CACHE_VERSION = 'trim-v1';
const inFlight = new Map();

function normalizeLocalReference(value) {
  let normalized = String(value || '').trim();
  if (!normalized) return '';

  if (/^file:\/\//i.test(normalized)) {
    try {
      return fileURLToPath(normalized);
    } catch {
      normalized = decodeURIComponent(normalized.replace(/^file:\/\//i, ''));
    }
  }

  for (const prefix of ['local-img://', 'local-video://', 'local-audio://']) {
    if (normalized.toLowerCase().startsWith(prefix)) {
      normalized = decodeURIComponent(normalized.slice(prefix.length));
      break;
    }
  }

  if (/^\/[A-Za-z]:\//.test(normalized)) normalized = normalized.slice(1);
  return normalized;
}

function getBinaryFilename(name) {
  return process.platform === 'win32' ? `${name}.exe` : name;
}

function uniqueExistingDirectories(values) {
  const seen = new Set();
  return values.filter(Boolean).filter(value => {
    const normalized = path.resolve(String(value));
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

/**
 * FFmpeg is intentionally treated as an external portable library, not app code.
 * Standard portable layout for v2.6.1:
 *
 * Hongs_AI_Table_Studio/
 *   npmnode/        (if your portable package already keeps Node here)
 *   ffmpeg/         (independent media runtime; never mixed into scripts/)
 *     bin/
 *       ffmpeg.exe
 *       ffprobe.exe
 *   scripts/
 *   main.js ...
 *
 * Compatibility rules:
 * 1. Prefer ffmpeg/bin (new standard).
 * 2. Still accept the old ffmpeg root layout from early v2.6.1 packages.
 * 3. Accept a sibling ../ffmpeg/bin library for shared portable environments.
 * 4. HONGS_FFMPEG_DIR may point either to ffmpeg/ or directly to ffmpeg/bin/.
 * 5. System PATH remains the last developer fallback.
 */
export function getFfmpegSearchDirectories() {
  const execDir = path.dirname(process.execPath || '');
  const resourcesDir = process.resourcesPath || '';
  const envDir = String(process.env.HONGS_FFMPEG_DIR || '').trim();

  const ffmpegRoots = uniqueExistingDirectories([
    path.resolve(MODULE_DIR, 'ffmpeg'),
    path.resolve(process.cwd(), 'ffmpeg'),
    path.resolve(MODULE_DIR, '..', 'ffmpeg'),
    path.resolve(process.cwd(), '..', 'ffmpeg'),
    resourcesDir ? path.resolve(resourcesDir, '..', 'ffmpeg') : '',
    resourcesDir ? path.resolve(resourcesDir, 'ffmpeg') : '',
    execDir ? path.resolve(execDir, 'ffmpeg') : '',
    execDir ? path.resolve(execDir, '..', 'ffmpeg') : ''
  ]);

  return uniqueExistingDirectories([
    // Environment override can be either the library root or its bin folder.
    envDir ? path.resolve(envDir, 'bin') : '',
    envDir,
    // New v2.6.1 standard: ffmpeg/bin/ffmpeg.exe + ffprobe.exe.
    ...ffmpegRoots.map(root => path.join(root, 'bin')),
    // Backward compatibility with the first v2.6.1 draft layout.
    ...ffmpegRoots
  ]);
}

export function resolveMediaToolBinary(name) {
  const filename = getBinaryFilename(name);
  for (const dir of getFfmpegSearchDirectories()) {
    const candidate = path.join(dir, filename);
    if (fs.existsSync(candidate)) return candidate;
  }
  // PATH fallback is useful for developers, but normal users never need to configure PATH.
  return name;
}

function runBinary(command, args, options = {}) {
  const timeoutMs = Number(options.timeoutMs || 10 * 60 * 1000);
  return new Promise((resolve, reject) => {
    let settled = false;
    let stderr = '';
    let stdout = '';
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill('SIGKILL'); } catch {}
      const error = new Error(`媒体预处理超时（${Math.round(timeoutMs / 1000)} 秒）`);
      error.code = 'MEDIA_PREPROCESS_TIMEOUT';
      error.stage = 'preprocess';
      reject(error);
    }, timeoutMs);

    child.stdout?.on('data', chunk => {
      stdout += String(chunk);
      if (stdout.length > 200_000) stdout = stdout.slice(-200_000);
    });
    child.stderr?.on('data', chunk => {
      stderr += String(chunk);
      if (stderr.length > 200_000) stderr = stderr.slice(-200_000);
    });

    child.on('error', error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const wrapped = new Error(error?.code === 'ENOENT'
        ? `未找到 ${path.basename(command)}。请将 FFmpeg 独立库放到 AI Table Studio 项目根目录的 ffmpeg/bin/ 下（ffmpeg/bin/ffmpeg.exe 与 ffmpeg/bin/ffprobe.exe）。`
        : `无法启动媒体工具：${error.message}`);
      wrapped.code = 'MEDIA_TOOL_NOT_FOUND';
      wrapped.stage = 'preprocess';
      wrapped.cause = error;
      reject(wrapped);
    });

    child.on('close', code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const error = new Error(`媒体预处理失败（exit ${code}）：${stderr.trim().slice(-3000) || 'FFmpeg 未返回详细错误'}`);
      error.code = 'MEDIA_PREPROCESS_FAILED';
      error.stage = 'preprocess';
      reject(error);
    });
  });
}

async function getCacheDirectory() {
  try {
    const { app } = await import('electron');
    const dir = path.join(app.getPath('userData'), 'media-cache', 'trim');
    await fs.promises.mkdir(dir, { recursive: true });
    return dir;
  } catch {
    const dir = path.join(process.cwd(), '.media-cache', 'trim');
    await fs.promises.mkdir(dir, { recursive: true });
    return dir;
  }
}

function seconds(ms) {
  return (Math.max(0, Number(ms) || 0) / 1000).toFixed(3);
}

function dataUrlExtension(mime, mediaType) {
  const normalized = String(mime || '').toLowerCase();
  if (normalized.includes('webm')) return 'webm';
  if (normalized.includes('quicktime')) return 'mov';
  if (normalized.includes('mpeg')) return mediaType === 'audio' ? 'mp3' : 'mpeg';
  if (normalized.includes('wav')) return 'wav';
  if (normalized.includes('flac')) return 'flac';
  if (normalized.includes('ogg')) return 'ogg';
  if (normalized.includes('mp4')) return mediaType === 'audio' ? 'm4a' : 'mp4';
  return mediaType === 'audio' ? 'wav' : 'mp4';
}

async function materializeDataUrl(source, mediaType, cacheDir) {
  const match = String(source).match(/^data:([^;,]+);base64,(.+)$/s);
  if (!match) throw new Error('不支持的 data URL 媒体格式');
  const mime = match[1];
  const buffer = Buffer.from(match[2], 'base64');
  const digest = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 24);
  const ext = dataUrlExtension(mime, mediaType);
  const localPath = path.join(cacheDir, `source_${digest}.${ext}`);
  if (!fs.existsSync(localPath)) await fs.promises.writeFile(localPath, buffer);
  return localPath;
}

async function sourceIdentity(source, localSource) {
  if (/^https?:\/\//i.test(source)) return `url:${source}`;
  if (/^data:/i.test(source)) {
    return `data:${crypto.createHash('sha256').update(source).digest('hex')}`;
  }
  try {
    const stat = await fs.promises.stat(localSource);
    return `file:${path.resolve(localSource)}:${stat.size}:${Math.round(stat.mtimeMs)}`;
  } catch {
    return `file:${path.resolve(localSource)}`;
  }
}

async function probeDurationMs(input) {
  const ffprobe = resolveMediaToolBinary('ffprobe');
  try {
    const { stdout } = await runBinary(ffprobe, [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      input
    ], { timeoutMs: 60_000 });
    const duration = Number(String(stdout).trim());
    return Number.isFinite(duration) && duration > 0 ? Math.round(duration * 1000) : null;
  } catch (error) {
    // ffprobe is helpful but optional when trimData already contains a valid B point.
    if (error?.code !== 'MEDIA_TOOL_NOT_FOUND') console.warn('ffprobe duration check failed:', error?.message || error);
    return null;
  }
}

function normalizeTrimData(raw, durationMs = null) {
  if (!raw || typeof raw !== 'object') return null;

  let startMs = Number.isFinite(Number(raw.startMs)) ? Math.round(Number(raw.startMs)) : 0;
  let endMs = Number.isFinite(Number(raw.endMs)) ? Math.round(Number(raw.endMs)) : null;
  startMs = Math.max(0, startMs);

  if (durationMs && durationMs > 0) {
    startMs = Math.min(startMs, Math.max(0, durationMs - 1));
    if (endMs == null || endMs <= 0) endMs = durationMs;
    endMs = Math.min(Math.max(0, endMs), durationMs);
  }

  // Backend safety rule mirrors the UI's foolproof A/B behavior.
  // A without B -> media end. B without A -> 0.
  if (endMs == null || endMs <= 0) {
    if (durationMs && durationMs > startMs) endMs = durationMs;
    else return null;
  }

  if (endMs <= startMs) {
    if (durationMs && durationMs > startMs) endMs = durationMs;
    else if (endMs > 0) startMs = 0;
  }

  if (!(endMs > startMs)) return null;

  return {
    startMs,
    endMs,
    mode: raw.mode === 'preset' ? 'preset' : 'manual',
    ...(Number.isFinite(Number(raw.presetDurationMs)) && Number(raw.presetDurationMs) > 0
      ? { presetDurationMs: Math.round(Number(raw.presetDurationMs)) }
      : {})
  };
}

async function prepareReferenceMediaItem(item, mediaType) {
  if (!item) return '';
  const source = typeof item === 'string' ? item : String(item.url || item.path || '');
  if (!source) return '';
  const rawTrim = typeof item === 'object' ? item.trimData : null;
  if (!rawTrim) return source;

  const cacheDir = await getCacheDirectory();
  let input = source;
  if (/^data:/i.test(source)) {
    input = await materializeDataUrl(source, mediaType, cacheDir);
  } else if (!/^https?:\/\//i.test(source)) {
    input = normalizeLocalReference(source);
    if (!fs.existsSync(input)) {
      const error = new Error(`时间裁切源文件不存在：${input}`);
      error.code = 'TRIM_SOURCE_NOT_FOUND';
      error.stage = 'preprocess';
      throw error;
    }
  }

  const durationMs = await probeDurationMs(input);
  const trim = normalizeTrimData(rawTrim, durationMs);
  if (!trim) return source;

  const identity = await sourceIdentity(source, input);
  const profile = mediaType === 'audio' ? 'wav-pcm48k' : 'mp4-h264-aac-crf18';
  const cacheKey = crypto.createHash('sha256')
    .update([CACHE_VERSION, mediaType, identity, trim.startMs, trim.endMs, profile].join('|'))
    .digest('hex');
  const ext = mediaType === 'audio' ? 'wav' : 'mp4';
  const outputPath = path.join(cacheDir, `${cacheKey}.${ext}`);
  if (fs.existsSync(outputPath)) {
    if (fs.statSync(outputPath).size > 0) return outputPath;
    try { await fs.promises.unlink(outputPath); } catch {}
  }

  if (inFlight.has(cacheKey)) return await inFlight.get(cacheKey);

  const task = (async () => {
    const ffmpeg = resolveMediaToolBinary('ffmpeg');
    const partialPath = path.join(cacheDir, `${cacheKey}.part.${ext}`);
    try { await fs.promises.unlink(partialPath); } catch {}

    const args = [
      '-y',
      '-hide_banner',
      '-loglevel', 'error',
      '-ss', seconds(trim.startMs),
      '-i', input,
      '-t', seconds(trim.endMs - trim.startMs)
    ];

    if (mediaType === 'audio') {
      args.push(
        '-vn',
        '-c:a', 'pcm_s16le',
        '-ar', '48000',
        partialPath
      );
    } else {
      args.push(
        '-map', '0:v:0?',
        '-map', '0:a:0?',
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '18',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-movflags', '+faststart',
        partialPath
      );
    }

    await runBinary(ffmpeg, args);
    const stat = await fs.promises.stat(partialPath).catch(() => null);
    if (!stat || stat.size <= 0) {
      const error = new Error('FFmpeg 没有生成有效的裁切媒体文件');
      error.code = 'TRIM_OUTPUT_EMPTY';
      error.stage = 'preprocess';
      throw error;
    }
    await fs.promises.rename(partialPath, outputPath);
    return outputPath;
  })();

  inFlight.set(cacheKey, task);
  try {
    return await task;
  } finally {
    inFlight.delete(cacheKey);
  }
}

export async function prepareReferenceMediaList(mediaList, mediaType) {
  if (!Array.isArray(mediaList) || mediaList.length === 0) return [];
  const output = [];
  for (const item of mediaList) {
    const prepared = await prepareReferenceMediaItem(item, mediaType);
    if (prepared) output.push(prepared);
  }
  return output;
}
