// main.js （ES Module 版本）
process.noDeprecation = true; // 忽略 Node.js 废弃警告 (如 punycode)
import { app, BrowserWindow, protocol, ipcMain, nativeImage, dialog } from 'electron';
import path from 'path';
import isDev from 'electron-is-dev';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ▼▼▼ 核心算法：检查重名，如果存在则自动增加后缀 -1, -2 ▼▼▼
function getUniqueFilePath(originalPath) {
  if (!fs.existsSync(originalPath)) {
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
  
  // 核心防止死循环：直到找到一个在磁盘上不存在的名字
  while (fs.existsSync(newPath)) {
    counter++;
    newPath = path.join(dirName, `${baseName}-${counter}${ext}`);
  }

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

app.whenReady().then(() => {
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

  // ▼▼▼ 监听前端请求，抓取系统级原生缩略图 (解决内存崩溃神兵利器) ▼▼▼
  ipcMain.handle('generate-lingwu-image', async (event, { prompt, model, params, count, apiKey, endpoint, ossConfig }) => {
    try {
      if (ossConfig) {
        console.log("[generate-lingwu-image] Received ossConfig from UI:");
        console.log("  akId:", ossConfig.accessKeyId ? "***" : "MISSING");
        console.log("  akSecret:", ossConfig.accessKeySecret ? "***" : "MISSING");
        console.log("  bucket:", ossConfig.bucket || "MISSING");
        console.log("  domain:", ossConfig.domain || "MISSING");
      } else {
        console.log("[generate-lingwu-image] No ossConfig received from UI!");
      }
      const { OssImageUploader } = await import('./oss_uploader.js');
      const uploader = new OssImageUploader(ossConfig);
      
      // Upload references if needed (params.images)
      let uploadedImages = [];
      if (params && params.images && Array.isArray(params.images)) {
        for (const imgUrl of params.images) {
           if (imgUrl.startsWith('file://') || imgUrl.startsWith('local-img://') || fs.existsSync(imgUrl)) {
             try {
                const record = await uploader.upload(imgUrl);
                uploadedImages.push(record.cloud_url);
             } catch(err) {
                console.error('Failed to upload image:', imgUrl, err);
             }
           } else {
             uploadedImages.push(imgUrl);
           }
        }
        params.images = uploadedImages;
      }

      // Need to adjust params based on the size maps and mapping rules as in Python example
      // (The python example says there's a 3-layer mapping, but let's just pass `size` roughly if not present, and map exact ones)
      
      const payload = {
         model: model || 'gpt-image-2',
         prompt,
         count: count || 1
      };
      if (params) {
         // GPT image series size mapping (naive map, the user mentioned exact 1536x1024 etc)
         if (params.imageSize && params.aspectRatio && !params.size) {
            const key = `${params.imageSize}_${params.aspectRatio}`.toLowerCase();
            const EXACT_MAP = {
                "1k_1:1": "1024x1024",
                "1k_3:2": "1536x1024",
                "1k_2:3": "1024x1536",
                "2k_1:1": "2048x2048",
                "2k_16:9": "2048x1152",
                "2k_9:16": "1152x2048",
                "4k_16:9": "3840x2160",
                "4k_9:16": "2160x3840",
            };
            const APPROX_MAP = {
                "1k_4:3": "1536x1024",
                "1k_3:4": "1024x1536",
                "2k_2:3": "1152x2048",
                "4k_1:1": "auto"
            };
            params.size = EXACT_MAP[key] || APPROX_MAP[key] || (params.imageSize.includes('x') ? params.imageSize : "auto");
            delete params.imageSize;
            delete params.aspectRatio;
         }
         
         payload.params = params;
      }

      const fetch = (await import('node-fetch')).default || globalThis.fetch;
      
      let baseUrl = endpoint || 'https://api.lingwu.example.com';
      baseUrl = baseUrl.replace(/\/+$/, ''); // Strip trailing slash
      
      const reqHeaders = {
         "Authorization": `Bearer ${apiKey}`,
         "Content-Type": "application/json"
      };

      const startResp = await fetch(`${baseUrl}/v1/media/generate`, {
        method: 'POST',
        headers: reqHeaders,
        body: JSON.stringify(payload)
      });
      const startData = await startResp.json();
      
      let dataObj = startData.data || startData;
      const taskId = (dataObj['任务ids'] && dataObj['任务ids'][0]) || dataObj['任务id'] || dataObj['task_id'];

      if (!taskId) {
         throw new Error("Failed to get task ID: " + JSON.stringify(startData));
      }

      // Polling
      const startTime = Date.now();
      const timeout = 600 * 1000;
      
      // sleep 8s
      await new Promise(r => setTimeout(r, 8000));
      
      while (Date.now() - startTime < timeout) {
         const urlObj = new URL(`${baseUrl}/v1/skills/task-status`);
         urlObj.searchParams.append('task_id', taskId);
         
         const statResp = await fetch(urlObj.toString(), {
            method: 'GET',
            headers: reqHeaders
         });
         const statDataRow = await statResp.json();
         const status = statDataRow.data || statDataRow;
         
         if (status.is_final) {
            if (status.result_url) {
               return status.result_url;
            } else if (status.result_urls && status.result_urls.length > 0) {
               return status.result_urls[0];
            } else {
               throw new Error(status.error || "Generation failed");
            }
         }
         
         await new Promise(r => setTimeout(r, 5000));
      }
      
      throw new Error("Polling timeout");

    } catch (err) {
       console.error("generate-lingwu-image error:", err);
       throw err;
    }
  });

  ipcMain.handle('read-local-file', async (event, filePath) => {
    try {
      if (filePath.startsWith('file://')) {
        filePath = fileURLToPath(filePath);
      } else if (filePath.startsWith('local-img://')) {
        filePath = decodeURIComponent(filePath.replace('local-img://', ''));
      }
      if (fs.existsSync(filePath)) {
        const buffer = fs.readFileSync(filePath);
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

  ipcMain.handle('get-thumbnail', async (event, filePath, size = { width: 150, height: 150 }) => {
    try {
      if (!fs.existsSync(filePath)) return null;
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
    try {
      let finalTargetPath;

      // 1. 如果配置了目标文件夹，直接静默保存。如果没有配置，则弹出另存为窗口
      if (!folderPath) {
        const win = BrowserWindow.getFocusedWindow();
        const { canceled, filePath } = await dialog.showSaveDialog(win, {
           defaultPath: path.join(app.getPath('downloads'), filename),
        });
        if (canceled || !filePath) return null;
        finalTargetPath = filePath;
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
        let srcPath = fileURLToPath(url);
        await fs.promises.copyFile(srcPath, finalTargetPath);
      } else if (url.startsWith('local-img://')) {
        let srcPath = decodeURIComponent(url.replace('local-img://', ''));
        await fs.promises.copyFile(srcPath, finalTargetPath);
      } else if (fs.existsSync(url)) {
        await fs.promises.copyFile(url, finalTargetPath);
      } else {
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        await fs.promises.writeFile(finalTargetPath, buffer);
      }

      console.log(`[成功] 图片已保存至: ${finalTargetPath}`);
      // 返回后端最终敲定的路径给前端
      return finalTargetPath; 
    } catch (err) {
      console.error('[失败] 无法保存图片:', err);
      throw err;
    }
  });
  // ▲▲▲ ▲▲▲

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});