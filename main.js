// main.js （ES Module 版本）
process.noDeprecation = true; // 忽略 Node.js 废弃警告 (如 punycode)
import { app, BrowserWindow, protocol, ipcMain, nativeImage, dialog, shell } from 'electron';
import path from 'path';
import isDev from 'electron-is-dev';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';

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
           } else if (imgUrl.startsWith('data:image/')) {
             try {
                // Parse base64
                const matches = imgUrl.match(/^data:(image\/\w+);base64,(.+)$/);
                if (matches && matches.length === 3) {
                  const ext = matches[1].split('/')[1] || 'png';
                  const base64Data = matches[2];
                  const buffer = Buffer.from(base64Data, 'base64');
                  const { app } = await import('electron');
                  const tempPath = path.join(app.getPath('temp'), `temp_upload_${Date.now()}.${ext}`);
                  fs.writeFileSync(tempPath, buffer);
                  const record = await uploader.upload(tempPath);
                  uploadedImages.push(record.cloud_url);
                } else {
                  uploadedImages.push(imgUrl);
                }
             } catch(err) {
                console.error('Failed to upload base64 image:', err);
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

  ipcMain.handle('generate-lingwu-video', async (event, options) => {
    try {
       const { prompt, model, params, images, videos, audio, apiKey, endpoint, ossConfig } = options;
       
       let uploader = null;
       if (ossConfig && ossConfig.accessKeyId) {
          const { OssImageUploader } = await import('./oss_uploader.js');
          uploader = new OssImageUploader(ossConfig);
       }

       const uploadMediaList = async (mediaList) => {
         if (!mediaList || !Array.isArray(mediaList)) return [];
         let out = [];
         for (const itemUrl of mediaList) {
            let actualUrl = itemUrl;
            if (actualUrl.startsWith('file://')) actualUrl = safeFileURLToPath(actualUrl);
            else if (actualUrl.startsWith('local-img://')) actualUrl = decodeURIComponent(actualUrl.replace('local-img://', ''));
            else if (actualUrl.startsWith('local-video://')) actualUrl = decodeURIComponent(actualUrl.replace('local-video://', ''));

            if (uploader && (actualUrl.startsWith('data:') || fs.existsSync(actualUrl))) {
                if (actualUrl.startsWith('data:')) {
                   const matches = actualUrl.match(/^data:(\w+\/\w+);base64,(.+)$/);
                   if (matches && matches.length === 3) {
                       const ext = matches[1].split('/')[1] || 'bin';
                       const buffer = Buffer.from(matches[2], 'base64');
                       const { app } = await import('electron');
                       const tempPath = path.join(app.getPath('temp'), `temp_upload_${Date.now()}.${ext}`);
                       fs.writeFileSync(tempPath, buffer);
                       try {
                          const record = await uploader.upload(tempPath);
                          out.push(record.cloud_url);
                       } catch(e) { console.error(e); }
                   } else out.push(itemUrl);
                } else {
                   try {
                      const record = await uploader.upload(actualUrl);
                      out.push(record.cloud_url);
                   } catch(e) { console.error('Upload fail:', actualUrl, e); }
                }
            } else {
               out.push(itemUrl);
            }
         }
         return out;
       };

       const payload = { model, prompt };
       const uploadedImages = await uploadMediaList(images);
       const uploadedVideos = await uploadMediaList(videos);
       const uploadedAudio = await uploadMediaList(audio);
       
       if (uploadedImages.length > 0) params.images = uploadedImages;
       if (uploadedVideos.length > 0) params.videos = uploadedVideos;
       if (uploadedAudio.length > 0) params.audio = uploadedAudio;
       
       if (params && Object.keys(params).length > 0) {
           const { mapVideoParams } = await import('./video_param_mapper.js');
           payload.params = mapVideoParams(model, params);
       }

       const fetch = (await import('node-fetch')).default || globalThis.fetch;
       
       let baseUrl = endpoint || 'https://api.ai6700.com/api';
       baseUrl = baseUrl.replace(/\/+$/, ''); // Strip trailing slash
       
       const reqHeaders = {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
       };

       console.log('generate-lingwu-video request:', JSON.stringify(payload));
       const startResp = await fetch(`${baseUrl}/v1/media/generate`, {
         method: 'POST',
         headers: reqHeaders,
         body: JSON.stringify(payload)
       });
       const startData = await startResp.json();
       
       let dataObj = startData.data || startData;
       const taskId = (dataObj['任务ids'] && dataObj['任务ids'][0]) || dataObj['任务id'] || dataObj['task_id'];

       if (!taskId) {
           console.log('Failed startResp:', startData);
          throw new Error("Failed to get task ID: " + JSON.stringify(startData));
       }

       // Polling
       const startTime = Date.now();
       const timeout = 600 * 1000 * 3; // 30 minutes timeout for video
       
       // sleep 10s initially
       await new Promise(r => setTimeout(r, 10000));
       
       while (Date.now() - startTime < timeout) {
          const urlObj = new URL(`${baseUrl}/v1/skills/task-status`);
          urlObj.searchParams.append('task_id', taskId);
          
          const statResp = await fetch(urlObj.toString(), {
             method: 'GET',
             headers: reqHeaders
          });
          const statDataRow = await statResp.json();
          const status = statDataRow.data || statDataRow;
          
          const state = status.state || status.status;

          if (state === 'success' || state === 'completed' || status.is_final) {
             const resultOutput = status.result_url || status.url || status.output || (status.result && status.result.video) || (status.result && status.result.videos && status.result.videos[0]) || (status.result_urls && status.result_urls[0]);
             if (resultOutput) {
                 return resultOutput; // Could be string or array
             }
             if (status.is_final && !resultOutput) {
                 throw new Error(status.error || status.message || status.msg || "Generation failed without error message");
             }
          }
          
          if (state === 'failed' || state === 'error') {
              throw new Error(status.error || status.message || status.msg || "Generation failed");
          }
          
          await new Promise(r => setTimeout(r, 5000));
       }
       
       throw new Error("Polling timeout");

    } catch (err) {
       console.error("generate-lingwu-video error:", err);
       throw err;
    }
  });

  ipcMain.handle('read-local-file', async (event, filePath, options = {}) => {
    try {
      if (filePath.startsWith('file://')) {
        filePath = safeFileURLToPath(filePath);
      } else if (filePath.startsWith('local-img://')) {
        filePath = decodeURIComponent(filePath.replace('local-img://', ''));
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

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});