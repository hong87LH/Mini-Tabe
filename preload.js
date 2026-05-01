// preload.js
const { contextBridge, webUtils, ipcRenderer } = require('electron');

// 强烈推荐此方案：暴露具体的业务 API（例如 downloadFile），而不是通用的 ipcRenderer。
// 这样可以彻底切断前端主动伪造 channel 调用后端其它敏感行为的可能性。
contextBridge.exposeInMainWorld('electronAPI', {
  getPathForFile: (file) => {
    if (webUtils && webUtils.getPathForFile) {
      return webUtils.getPathForFile(file);
    }
    return file.path;
  },
  
  // 安全且直接的代码：对外暴露下载函数，并且在内部把 channel 锁死在 download-file 上
  downloadFile: (options) => ipcRenderer.invoke('download-file', options),

  // 抓取极速本地系统级缩略图
  getThumbnail: (path, size) => ipcRenderer.invoke('get-thumbnail', path, size)
});

