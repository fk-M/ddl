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

// 桌面小部件（独立无边框窗口）的控制接口；主窗口和窗口本身都用这一份
contextBridge.exposeInMainWorld('widget', {
  open: () => ipcRenderer.invoke('ddl:widget:open'),
  close: () => ipcRenderer.invoke('ddl:widget:close'),
  isOpen: () => ipcRenderer.invoke('ddl:widget:is-open'),
  focusMain: () => ipcRenderer.invoke('ddl:widget:focus-main'),
  setPinned: (pinned) => ipcRenderer.invoke('ddl:widget:set-pinned', pinned),
  getPinned: () => ipcRenderer.invoke('ddl:widget:get-pinned'),
});
