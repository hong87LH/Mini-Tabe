// main.js （ES Module 版本）
import { app, BrowserWindow, protocol, ipcMain, nativeImage } from 'electron';
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
    win.webContents.openDevTools({ mode: 'detach' });
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
      // 1. 如果配置了目标文件夹，确保文件夹存在
      if (folderPath && !fs.existsSync(folderPath)) {
        fs.mkdirSync(folderPath, { recursive: true });
      }
      
      const targetDir = folderPath ? folderPath : app.getPath('downloads');
      const initialPath = path.join(targetDir, filename);

      // 2. 通过防覆盖逻辑获取"千真万确不会撞车"的最终路径
      const finalTargetPath = getUniqueFilePath(initialPath);

      // 3. 落盘
      if (url.startsWith('data:')) {
        const base64Data = url.split(',')[1];
        const buffer = Buffer.from(base64Data, 'base64');
        fs.writeFileSync(finalTargetPath, buffer);
      } else {
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        fs.writeFileSync(finalTargetPath, buffer);
      }

      console.log(`[成功] 图片已静默保存至: ${finalTargetPath}`);
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