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
  getThumbnail: (path, size) => ipcRenderer.invoke('get-thumbnail', path, size),
  readLocalFile: (filePath, options) => ipcRenderer.invoke('read-local-file', filePath, options),
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  generateLingwuImage: (options) => ipcRenderer.invoke('generate-lingwu-image', options),
  checkOssStorage: (ossConfig) => ipcRenderer.invoke('check-oss-storage', ossConfig),
  executeOssCleanup: (ossConfig) => ipcRenderer.invoke('execute-oss-cleanup', ossConfig),
  generateLingwuVideo: (options) => ipcRenderer.invoke('generate-lingwu-video', options),
  queryNetworkJob: (localJobId) => ipcRenderer.invoke('query-network-job', localJobId),
  listNetworkJobs: () => ipcRenderer.invoke('list-network-jobs'),
  retryDownloadJob: (localJobId) => ipcRenderer.invoke('retry-download-job', localJobId),
  openLocalFile: (localPath) => ipcRenderer.invoke('open-local-file', localPath),
  openInPhotoshop: (filePath, psPath) => ipcRenderer.invoke('open-in-photoshop', filePath, psPath),
  deleteNetworkJob: (localJobId) => ipcRenderer.invoke('delete-network-job', localJobId),
  continueNetworkJobPolling: (localJobId) => ipcRenderer.invoke('continue-network-job-polling', localJobId),
  onNetworkJobUpdated: (callback) => {
    const handler = (_event, job) => callback(job);
    ipcRenderer.on('network-job-updated', handler);
    return () => {
      ipcRenderer.removeListener('network-job-updated', handler);
    };
  }
});

