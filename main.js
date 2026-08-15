import crypto from "crypto";
// main.js （ES Module 版本）
process.noDeprecation = true; // 忽略 Node.js 废弃警告 (如 punycode)
import { app, BrowserWindow, protocol, ipcMain, nativeImage, dialog, shell } from 'electron';
import path from 'path';
import isDev from 'electron-is-dev';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { LingwuClient } from './lingwu_client.js';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { NetworkStageError } from "./network_utils.js";
import { startPolling, resumePendingJobs } from './network_polling.js';
import { NetworkJobStore } from './network_job_store.js';
import { createSkillManager } from './skill_manager.js';

const skillManager = createSkillManager();

let networkJobStore = null;
function getNetworkJobStore() {
  if (!networkJobStore) {
    networkJobStore = new NetworkJobStore();
  }
  return networkJobStore;
}


import { buildLingwuImageParams, getLingwuImageModelProfile } from './lingwu_image_model_profiles.js';


function safeFileURLToPath(urlStr) {
  try {
     return fileURLToPath(urlStr);
  } catch(e) {
     if (typeof urlStr === 'string' && urlStr.startsWith('file://')) {
        let p = decodeURIComponent(urlStr.substring(7));
        if (process.platform === 'win32') {
            if (p.startsWith('/')) {
                // handle /C:/... -> C:/
                if (p.length > 2 && p[2] === ':') {
                   p = p.substring(1);
                } else if (!p.startsWith('//')) {
                   // if it's a UNC path that was prefixed with /, make it //
                   p = '/' + p;
                }
            } else if (!p.match(/^[a-zA-Z]:/) && !p.startsWith('\\\\')) {
                // if it doesn't start with / or \\ and isn't a drive letter, it's likely a UNC path missing //
                p = '//' + p;
            }
            // Ensure backslashes for Windows
            p = p.replace(/\//g, '\\');
        }
        return p;
     }
     return urlStr;
  }
}

function readSynchsafeInt(buffer, offset) {
  return ((buffer[offset] & 0x7f) << 21) | ((buffer[offset + 1] & 0x7f) << 14) |
    ((buffer[offset + 2] & 0x7f) << 7) | (buffer[offset + 3] & 0x7f);
}

function imageMimeFromBuffer(buffer, fallback = 'image/jpeg') {
  if (buffer?.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (buffer?.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) return 'image/jpeg';
  if (buffer?.subarray(0, 4).toString('ascii') === 'RIFF' && buffer?.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return fallback || 'image/jpeg';
}

function extractId3Artwork(buffer) {
  if (buffer.subarray(0, 3).toString('ascii') !== 'ID3' || buffer.length < 10) return null;
  const version = buffer[3];
  const tagEnd = Math.min(buffer.length, 10 + readSynchsafeInt(buffer, 6));
  let offset = 10;
  while (offset + 10 <= tagEnd) {
    const id = buffer.subarray(offset, offset + 4).toString('ascii');
    if (!id.trim()) break;
    const size = version === 4 ? readSynchsafeInt(buffer, offset + 4) : buffer.readUInt32BE(offset + 4);
    const body = buffer.subarray(offset + 10, Math.min(tagEnd, offset + 10 + size));
    if (id === 'APIC' && body.length > 8) {
      const encoding = body[0];
      const mimeEnd = body.indexOf(0, 1);
      if (mimeEnd < 0) return null;
      const mime = body.subarray(1, mimeEnd).toString('latin1') || 'image/jpeg';
      let imageStart = mimeEnd + 2;
      const terminator = encoding === 1 || encoding === 2 ? Buffer.from([0, 0]) : Buffer.from([0]);
      const descriptionEnd = body.indexOf(terminator, imageStart);
      imageStart = descriptionEnd >= 0 ? descriptionEnd + terminator.length : imageStart;
      const artwork = body.subarray(imageStart);
      if (artwork.length > 32) return { mime: imageMimeFromBuffer(artwork, mime), buffer: artwork };
    }
    offset += 10 + size;
  }
  return null;
}

function extractFlacArtwork(buffer) {
  if (buffer.subarray(0, 4).toString('ascii') !== 'fLaC') return null;
  let offset = 4;
  while (offset + 4 <= buffer.length) {
    const header = buffer[offset];
    const type = header & 0x7f;
    const size = buffer.readUIntBE(offset + 1, 3);
    const body = buffer.subarray(offset + 4, offset + 4 + size);
    if (type === 6 && body.length > 32) {
      let cursor = 4;
      const mimeLength = body.readUInt32BE(cursor); cursor += 4;
      const mime = body.subarray(cursor, cursor + mimeLength).toString('utf8'); cursor += mimeLength;
      const descriptionLength = body.readUInt32BE(cursor); cursor += 4 + descriptionLength + 16;
      const dataLength = body.readUInt32BE(cursor); cursor += 4;
      const artwork = body.subarray(cursor, cursor + dataLength);
      if (artwork.length > 32) return { mime: imageMimeFromBuffer(artwork, mime), buffer: artwork };
    }
    offset += 4 + size;
    if (header & 0x80) break;
  }
  return null;
}

function extractMp4Artwork(buffer) {
  const covr = buffer.indexOf(Buffer.from('covr'));
  if (covr < 4) return null;
  const atomSize = buffer.readUInt32BE(covr - 4);
  const atomEnd = Math.min(buffer.length, covr - 4 + atomSize);
  const data = buffer.indexOf(Buffer.from('data'), covr + 4);
  if (data < 4 || data >= atomEnd) return null;
  const dataSize = buffer.readUInt32BE(data - 4);
  const artwork = buffer.subarray(data + 12, Math.min(atomEnd, data - 4 + dataSize));
  return artwork.length > 32 ? { mime: imageMimeFromBuffer(artwork), buffer: artwork } : null;
}

function extractEmbeddedAudioArtwork(filePath) {
  const buffer = fs.readFileSync(filePath);
  return extractId3Artwork(buffer) || extractFlacArtwork(buffer) || extractMp4Artwork(buffer);
}

const __filename = safeFileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Track paths being written to currently to avoid race conditions
const inFlightPaths = new Set();

// ▼▼▼ 核心算法：检查重名，如果存在则自动增加后缀 -1, -2 ▼▼▼
function getUniqueFilePath(originalPath) {
  const checkPath = (p) => fs.existsSync(p) || inFlightPaths.has(p);

  if (!checkPath(originalPath)) {
    inFlightPaths.add(originalPath);
    return originalPath; // 不存在重名，直接用
  }

  const ext = path.extname(originalPath); // 获取拓展名，例如 .png
  let baseName = path.basename(originalPath, ext);
  const dirName = path.dirname(originalPath);
  
  let counter = 1;
  // 如果传入的文件名本身就带如 '-1', 先剥离后缀继续递增
  const match = baseName.match(/-(\d+)$/);
  if (match) {
    counter = parseInt(match[1], 10) + 1; 
    baseName = baseName.substring(0, baseName.length - match[0].length);
  }

  let newPath = path.join(dirName, `${baseName}-${counter}${ext}`);
  
  // 核心防止死循环：直到找到一个在磁盘上不存在的名字且不在写入中
  while (checkPath(newPath)) {
    counter++;
    newPath = path.join(dirName, `${baseName}-${counter}${ext}`);
  }

  inFlightPaths.add(newPath);
  return newPath;
}
// ▲▲▲ ▲▲▲

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      nodeIntegration: false,     // 前端保持安全关闭
      contextIsolation: true,     // 前端环境隔离
      webSecurity: false,         // 允许跨域及本地协议
      preload: path.join(__dirname, 'preload.js') 
    }
  });

  win.loadURL(
    isDev
      ? 'http://localhost:5173'
      : `file://${path.join(__dirname, 'dist/index.html')}`
  );
  
  if (isDev) {
    //win.webContents.openDevTools({ mode: 'detach' });
  }
}

app.whenReady().then(async () => {
  try {
    const store = getNetworkJobStore();
    await store.cleanupOldJobs();
    await resumePendingJobs(store);
  } catch(e) {
    console.error("Failed to resume pending jobs", e);
  }

  // Trigger silent OSS cleanup if env vars are present
  try {
    const { OssStorageManager } = await import('./oss_storage_manager.js');
    if (process.env.OSS_ACCESS_KEY_ID && process.env.OSS_ACCESS_KEY_SECRET) {
      const manager = new OssStorageManager();
      manager.runAutomaticCleanup(0).catch(e => console.error('Startup OSS cleanup failed:', e));
    }
  } catch (e) {
    console.error('Failed to init OssStorageManager on startup:', e);
  }

  createWindow();

  // 自定义协议用于渲染本地图片
  protocol.registerFileProtocol('local-img', (request, callback) => {
    const url = request.url.replace('local-img://', '');
    try {
      return callback(decodeURIComponent(url));
    } catch (error) {
      console.error(error);
    }
  });

  // Skill System v1.0: scan/register, enable state, install/uninstall, structured context compile
  ipcMain.handle('list-skills', async () => {
    return skillManager.scanSkills();
  });

  ipcMain.handle('set-skill-enabled', async (_event, relativePath, enabled) => {
    return skillManager.setSkillEnabled(relativePath, enabled);
  });

  ipcMain.handle('install-skill-from-github', async (_event, sourceUrl) => {
    return await skillManager.installFromGithub(sourceUrl);
  });

  ipcMain.handle('uninstall-skill', async (_event, relativePath) => {
    return skillManager.uninstallSkill(relativePath);
  });

  ipcMain.handle('compile-skill-context', async (_event, options = {}) => {
    return skillManager.compileSkillContext(options);
  });

  // ▼▼▼ 监听前端请求，抓取系统级原生缩略图 (解决内存崩溃神兵利器) ▼▼▼
  ipcMain.handle('generate-lingwu-image', async (event, options) => {
    try {
      const { MediaJobRunner } = await import('./media_job_runner.js');
      const runner = new MediaJobRunner({ jobStore: getNetworkJobStore() });
      return await runner.createImageJob(options);
    } catch (err) {
       console.error("generate-lingwu-image error:", err);
       throw err;
    }
  });

  ipcMain.handle('check-oss-storage', async (event, ossConfig) => {
    try {
      const {
        OssStorageManager,
        OSS_STORAGE_POLICY,
        serializeCmsError
      } = await import('./oss_storage_manager.js');

      if (!ossConfig || !ossConfig.accessKeyId) throw new Error("Missing OSS Config");

      const manager = new OssStorageManager(ossConfig);
      const usageBytes = await manager.getBucketUsage();
      const plan = await manager.planCleanup(usageBytes, 0);

      let traffic = null;
      try {
        traffic = await manager.getMonthlyInternetTraffic();
      } catch (trafficError) {
        console.warn("check-oss-storage traffic query failed:", trafficError);
        traffic = {
          bucketName: ossConfig.bucket || '',
          bucketMonthlyInternetTxBytes: null,
          accountMonthlyInternetTxBytes: null,
          dataTimestamp: null,
          error: serializeCmsError(trafficError)
        };
      }

      return {
        usageBytes,
        policy: OSS_STORAGE_POLICY,
        plan,
        traffic
      };
    } catch (e) {
      console.error("check-oss-storage error:", e);
      throw e;
    }
  });

  ipcMain.handle('execute-oss-cleanup', async (event, ossConfig) => {
    try {
      const { OssStorageManager } = await import('./oss_storage_manager.js');
      if (!ossConfig || !ossConfig.accessKeyId) throw new Error("Missing OSS Config");
      const manager = new OssStorageManager(ossConfig);
      const usageBytes = await manager.getBucketUsage();
      const plan = await manager.planCleanup(usageBytes, 0);
      if (plan && plan.plannedDeletions && plan.plannedDeletions.length > 0) {
          await manager.executeCleanup(plan);
          const freedBytes = plan.plannedDeletions.reduce((acc, f) => acc + (f.bytes || 0), 0);
          return { freedBytes };
      }
      return { freedBytes: 0 };
    } catch (e) {
      console.error("execute-oss-cleanup error:", e);
      throw e;
    }
  });

  ipcMain.handle('generate-lingwu-video', async (event, options) => {
    try {
      const { MediaJobRunner } = await import('./media_job_runner.js');
      const runner = new MediaJobRunner({ jobStore: getNetworkJobStore() });
      return await runner.createVideoJob(options);
    } catch (err) {
       console.error("generate-lingwu-video error:", err);
       throw err;
    }
  });

  ipcMain.handle('check-comfyui', async (event, options = {}) => {
    try {
      const { ensureComfyUIAvailable } = await import('./comfyui_launcher.js');
      await ensureComfyUIAvailable({
        endpoint: options.endpoint || 'http://127.0.0.1:8188',
        batPath: options.comfyuiBatPath
      });
      const { ComfyUIClient } = await import('./comfyui/comfyui_client.js');
      const client = new ComfyUIClient('', options.endpoint || 'http://127.0.0.1:8188');
      return await client.healthCheck(options.model || 'minimax-h3-local');
    } catch (err) {
      console.error('check-comfyui error:', err);
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('read-local-file', async (event, filePath, options = {}) => {
    try {
      if (filePath.startsWith('file://')) {
        filePath = safeFileURLToPath(filePath);
      } else if (/^local-(?:img|video|audio):\/\//i.test(filePath)) {
        filePath = decodeURIComponent(filePath.replace(/^local-(?:img|video|audio):\/\//i, ''));
      }
      if (fs.existsSync(filePath)) {
        let buffer = fs.readFileSync(filePath);
        let mimeInfo = null;
        if (options && options.optimizeImage) {
           const ext = path.extname(filePath).toLowerCase();
           if (['.jpg', '.jpeg', '.png', '.webp', '.gif', '.tiff', '.avif', '.bmp'].includes(ext)) {
               try {
                  const sharpModule = await import('sharp');
                  const sharp = sharpModule.default || sharpModule;
                  buffer = await sharp(buffer)
                     .jpeg({ quality: 95 })
                     .toBuffer();
                  mimeInfo = 'image/jpeg';
               } catch (e) {
                  console.warn('sharp conversion failed in read-local-file:', e);
               }
           }
        }
        if (options && options.returnMime) {
           return { data: buffer.toString('base64'), mime: mimeInfo };
        }
        return buffer.toString('base64');
      }
      return null;
    } catch (err) {
      console.error('Failed to read file:', err);
      return null;
    }
  });

  ipcMain.handle('select-directory', async (event) => {
    const win = BrowserWindow.getFocusedWindow();
    const { canceled, filePaths } = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
    if (!canceled && filePaths.length > 0) return filePaths[0];
    return null;
  });

  ipcMain.handle('select-comfyui-bat', async () => {
    const win = BrowserWindow.getFocusedWindow();
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Select ComfyUI startup BAT',
      properties: ['openFile'],
      filters: [{ name: 'Windows batch file', extensions: ['bat'] }]
    });
    if (!canceled && filePaths.length > 0) return filePaths[0];
    return null;
  });

  ipcMain.handle('get-thumbnail', async (event, filePath, size = { width: 150, height: 150 }) => {
    try {
      if (!fs.existsSync(filePath)) return null;
      if (/\.(mp3|wav|flac|m4a|aac|ogg|opus)$/i.test(filePath)) {
        const artwork = extractEmbeddedAudioArtwork(filePath);
        return artwork ? `data:${artwork.mime};base64,${artwork.buffer.toString('base64')}` : null;
      }
      // 调用操作系统底层的缩略图服务！速度极快且省内存。
      const thumbnail = await nativeImage.createThumbnailFromPath(filePath, size);
      if(thumbnail && !thumbnail.isEmpty()) {
        return thumbnail.toDataURL(); // 返回 base64 给前端做渲染，完美规避读取完整10M大图
      }
      return null;
    } catch (error) {
      console.error('[原生缩略图获取失败]', error);
      return null;
    }
  });
  // ▲▲▲

  // ▼▼▼ 监听前端下载文件请求，执行真实的物理写入 ▼▼▼
  ipcMain.handle('download-file', async (event, { url, filename, folderPath }) => {
    let finalTargetPath = null;
    try {
      // 1. 如果配置了目标文件夹，直接静默保存。如果没有配置，则弹出另存为窗口
      if (!folderPath) {
        const win = BrowserWindow.getFocusedWindow();
        const { canceled, filePath } = await dialog.showSaveDialog(win, {
           defaultPath: path.join(app.getPath('downloads'), filename),
        });
        if (canceled || !filePath) return null;
        finalTargetPath = filePath;
        inFlightPaths.add(finalTargetPath);
      } else {
        if (!fs.existsSync(folderPath)) {
          await fs.promises.mkdir(folderPath, { recursive: true });
        }
        const initialPath = path.join(folderPath, filename);
        // 2. 通过防覆盖逻辑获取"千真万确不会撞车"的最终路径
        finalTargetPath = getUniqueFilePath(initialPath);
      }

      // 3. 落盘
      if (url.startsWith('data:')) {
        const base64Data = url.split(',')[1];
        const buffer = Buffer.from(base64Data, 'base64');
        await fs.promises.writeFile(finalTargetPath, buffer);
      } else if (url.startsWith('file://')) {
        let srcPath = safeFileURLToPath(url);
        await fs.promises.copyFile(srcPath, finalTargetPath);
      } else if (/^local-(?:img|video|audio):\/\//i.test(url)) {
        let srcPath = decodeURIComponent(url.replace(/^local-(?:img|video|audio):\/\//i, ''));
        await fs.promises.copyFile(srcPath, finalTargetPath);
      } else if (fs.existsSync(url)) {
        await fs.promises.copyFile(url, finalTargetPath);
      } else {
        const headRes = await fetch(url, { method: 'HEAD' });
        let startBytes = 0;
        const partPath = finalTargetPath + '.part';
        if (fs.existsSync(partPath)) {
          const stat = fs.statSync(partPath);
          startBytes = stat.size;
        }
        const headers = {};
        if (startBytes > 0) {
          headers['Range'] = `bytes=${startBytes}-`;
        }
        const res = await fetch(url, { headers });
        if (!res.ok) throw new Error('Download failed ' + res.status);
        const fileStream = fs.createWriteStream(partPath, { flags: startBytes > 0 && res.status === 206 ? 'a' : 'w' });
        
        let bodyStream;
        if (res.body && res.body.getReader) {
          bodyStream = Readable.fromWeb(res.body);
        } else {
          bodyStream = res.body;
        }
        
        await pipeline(bodyStream, fileStream);
        fs.renameSync(partPath, finalTargetPath);
      }

      console.log(`[成功] 图片已保存至: ${finalTargetPath}`);
      // 返回后端最终敲定的路径给前端
      return finalTargetPath; 
    } catch (err) {
      console.error('[失败] 无法保存图片:', err);
      throw err;
    } finally {
      if (finalTargetPath) {
          inFlightPaths.delete(finalTargetPath);
      }
    }
  });
  // ▲▲▲ ▲▲▲

  ipcMain.handle('open-in-photoshop', async (event, filePath, psPath) => {
    try {
      if (!fs.existsSync(filePath)) return false;
      let command = '';
      if (process.platform === 'darwin') {
         if (psPath && fs.existsSync(psPath)) {
            command = `open -a "${psPath}" "${filePath}"`;
         } else {
             await shell.openPath(filePath);
             return true;
         }
      } else if (process.platform === 'win32') {
         if (psPath && fs.existsSync(psPath)) {
            command = `"${psPath}" "${filePath}"`;
         } else {
             // Let the shell open it or somehow find PS. Let's just open without specific app if not provided
            await shell.openPath(filePath);
            return true;
         }
      } else {
         await shell.openPath(filePath);
         return true;
      }
      
      return new Promise((resolve, reject) => {
         exec(command, (error) => {
             if (error) {
                 console.error('Error opening with specified app:', error);
                 resolve(false);
             } else {
                 resolve(true);
             }
         });
      });
    } catch (e) {
      console.error('Failed to open in Photoshop:', e);
      return false;
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

function stripSensitiveInfo(job) {
  if (!job) return job;
  const { encryptedCredentials, credentials, ...safeJob } = job;
  if (credentials?.ossConfig?.bucket) {
    safeJob.ossBucket = credentials.ossConfig.bucket;
  }
  return safeJob;
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
ipcMain.handle('query-network-job', async (event, localJobId) => {
  const jobStore = getNetworkJobStore();
  const job = await jobStore.getJob(localJobId);
  return stripSensitiveInfo(job);
});

ipcMain.handle('open-local-file', async (event, localPath) => {
  const { shell } = await import('electron');
  return shell.showItemInFolder(localPath);
});

ipcMain.handle('retry-download-job', async (event, localJobId) => {
  const jobStore = getNetworkJobStore();
  const { startDownload } = await import('./network_polling.js');
  startDownload(localJobId, jobStore);
});

ipcMain.handle('list-network-jobs', async () => {
  const jobStore = getNetworkJobStore();
  const jobs = await jobStore.listAll();
  return jobs.map(j => stripSensitiveInfo(j));
});

ipcMain.handle('delete-network-job', async (event, localJobId) => {
  const jobStore = getNetworkJobStore();
  await jobStore.remove(localJobId);
});

ipcMain.handle('continue-network-job-polling', async (event, localJobId) => {
  const jobStore = getNetworkJobStore();
  const job = await jobStore.getJob(localJobId);
  if (job && job.taskId) {
    await jobStore.patch(localJobId, {
      phase: 'polling',
      pollingStartedAt: new Date().toISOString(),
      lastError: null
    });
    const { startPolling } = await import('./network_polling.js');
    startPolling(job.localJobId, job.taskId, jobStore);
    await notifyRenderer(jobStore, localJobId);
  }
});
