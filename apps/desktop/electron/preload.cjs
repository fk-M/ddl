// 预加载脚本：把主进程的更新能力以最小接口暴露给页面
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ddlDesktop', {
  checkForUpdate: () => ipcRenderer.invoke('ddl:update:check'),
  downloadUpdate: () => ipcRenderer.invoke('ddl:update:download'),
  installUpdate: () => ipcRenderer.invoke('ddl:update:install'),
  onUpdateEvent: (handler) => {
    ipcRenderer.on('ddl:update:event', (_event, payload) => {
      try {
        handler(payload);
      } catch {
        // 页面里的回调出错不应影响主进程
      }
    });
  },
});
