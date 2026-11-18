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
  // 手机连接相关：内嵌服务监听了哪个地址、要不要重启才生效
  serverInfo: () => ipcRenderer.invoke('ddl:server:info'),
  getPrefs: () => ipcRenderer.invoke('ddl:prefs:get'),
  setPrefs: (patch) => ipcRenderer.invoke('ddl:prefs:set', patch),
});

// 桌面小部件（独立无边框窗口）的控制接口；主窗口和窗口本身都用这一份。
// 可以同时存在多块，所以除了 open(kind) 之外，关闭/置顶都按实例 id 走。
contextBridge.exposeInMainWorld('widget', {
  open: (kind) => ipcRenderer.invoke('ddl:widget:open', kind),
  close: (id) => ipcRenderer.invoke('ddl:widget:close', id),
  closeKind: (kind) => ipcRenderer.invoke('ddl:widget:close-kind', kind),
  closeAll: () => ipcRenderer.invoke('ddl:widget:close-all'),
  list: () => ipcRenderer.invoke('ddl:widget:list'),
  focusMain: () => ipcRenderer.invoke('ddl:widget:focus-main'),
  setPinned: (id, pinned) => ipcRenderer.invoke('ddl:widget:set-pinned', id, pinned),
  getPinned: (id) => ipcRenderer.invoke('ddl:widget:get-pinned', id),
});
