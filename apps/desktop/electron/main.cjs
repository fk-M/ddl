// Electron 主进程：先拉起内嵌的本地服务（Fastify + PGlite），就绪后再打开窗口
const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const { fork } = require('node:child_process');

const isDev = !app.isPackaged;
const APP_TITLE = '截止日';

/** 自动更新：只有打包版才可用（开发态没有 app-update.yml） */
let autoUpdater = null;
if (app.isPackaged) {
  try {
    ({ autoUpdater } = require('electron-updater'));
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
  } catch (error) {
    autoUpdater = null;
    console.warn('[update] electron-updater 不可用：', error?.message ?? error);
  }
}

// 打包后资源在 resources/app-resources，开发态在 apps/desktop/resources
const resourcesRoot = isDev
  ? path.join(__dirname, '..', 'resources')
  : path.join(process.resourcesPath, 'app-resources');

let serverProcess = null;
let mainWindow = null;
let logStream = null;

function writeLog(chunk) {
  if (logStream) logStream.write(chunk);
}

/** 申请一个由系统分配的空闲端口，避免和其它软件抢 3001 */
function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function pingHealth(port) {
  return new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port, path: '/health', timeout: 1500 },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      },
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForServer(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (serverProcess && serverProcess.exitCode !== null) return false;
    if (await pingHealth(port)) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function startServer() {
  const serverEntry = path.join(resourcesRoot, 'server', 'server.mjs');
  if (!fs.existsSync(serverEntry)) {
    throw new Error(`缺少服务端文件：${serverEntry}`);
  }

  const port = await getFreePort();
  const dataRoot = path.join(app.getPath('userData'), 'data');
  fs.mkdirSync(dataRoot, { recursive: true });

  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    NODE_ENV: 'production',
    HOST: '127.0.0.1',
    PORT: String(port),
    LOG_LEVEL: 'warn',
    PGLITE_DIR: path.join(dataRoot, 'pglite'),
    WEB_DIST: path.join(resourcesRoot, 'renderer'),
    MIGRATION_DIR: path.join(resourcesRoot, 'server', 'drizzle'),
    CORS_ORIGINS: `http://127.0.0.1:${port}`,
    AUTO_MIGRATE: 'true',
    // 采集轮询在桌面端保持默认；设为 0 可关掉
  };
  // 父进程残留的同名变量会污染子进程，这里显式清一遍
  delete env.ELECTRON_ENABLE_LOGGING;

  serverProcess = fork(serverEntry, [], {
    cwd: path.dirname(serverEntry),
    env,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    silent: true,
  });

  serverProcess.stdout?.on('data', (buf) => writeLog(`[server] ${buf}`));
  serverProcess.stderr?.on('data', (buf) => writeLog(`[server:err] ${buf}`));
  serverProcess.on('exit', (code) => {
    writeLog(`[server] 进程退出，代码 ${code}\n`);
    serverProcess = null;
  });

  const ok = await waitForServer(port, 90_000);
  if (!ok) {
    throw new Error('本地服务启动超时，请查看日志文件了解详情');
  }
  return port;
}

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 960,
    minHeight: 620,
    title: APP_TITLE,
    backgroundColor: '#ffffff',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 站外链接交给系统浏览器，不在应用内开新窗口
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(`http://127.0.0.1:${port}`)) {
      event.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });

  const url = `http://127.0.0.1:${port}/`;
  writeLog(`[app] 载入 ${url}\n`);
  mainWindow.loadURL(url).catch((error) => {
    writeLog(`[app] 页面载入失败：${error}\n`);
  });
}

/** 更新状态推给渲染进程（进度、完成、错误） */
function sendUpdateEvent(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('ddl:update:event', payload);
  }
}

function setupUpdaterIpc() {
  if (!autoUpdater) return;

  autoUpdater.on('download-progress', (progress) => {
    sendUpdateEvent({ type: 'progress', percent: progress.percent });
  });
  autoUpdater.on('update-downloaded', (info) => {
    sendUpdateEvent({ type: 'downloaded', version: info?.version });
  });
  autoUpdater.on('error', (error) => {
    writeLog(`[update] ${error?.message ?? error}\n`);
    sendUpdateEvent({ type: 'error', message: error?.message ?? '更新失败' });
  });

  ipcMain.handle('ddl:update:check', async () => {
    if (!autoUpdater) return { status: 'unsupported', message: '当前版本不支持自动更新' };
    try {
      const result = await autoUpdater.checkForUpdates();
      if (!result?.isUpdateAvailable) {
        return { status: 'none', version: result?.updateInfo?.version };
      }
      const notes = result.updateInfo?.releaseNotes;
      return {
        status: 'available',
        version: result.updateInfo.version,
        notes: typeof notes === 'string' ? notes : '',
      };
    } catch (error) {
      return { status: 'error', message: error?.message ?? '检查更新失败' };
    }
  });

  ipcMain.handle('ddl:update:download', async () => {
    try {
      await autoUpdater.downloadUpdate();
      return { ok: true };
    } catch (error) {
      return { ok: false, message: error?.message ?? '下载失败' };
    }
  });

  ipcMain.handle('ddl:update:install', async () => {
    try {
      // 先停掉内嵌服务，避免 PGlite 被安装程序强杀
      stopServer();
      setImmediate(() => autoUpdater.quitAndInstall(false, true));
      return { ok: true };
    } catch {
      return { ok: false };
    }
  });
}

function buildMenu() {
  // 隐藏菜单栏但保留快捷键：刷新 / 缩放 / 开发者工具
  const template = [
    {
      label: '文件',
      submenu: [{ role: 'quit', label: '退出' }],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '刷新' },
        { role: 'forceReload', label: '强制刷新' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
        { role: 'toggleDevTools', label: '开发者工具' },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function stopServer() {
  if (serverProcess && serverProcess.exitCode === null) {
    try {
      serverProcess.kill();
    } catch {
      // 忽略：进程可能已自行退出
    }
    serverProcess = null;
  }
}

// 只允许单实例，重复启动时聚焦已有窗口
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    app.setAppUserModelId('com.ddl.desktop');
    buildMenu();
    setupUpdaterIpc();

    const logPath = path.join(app.getPath('userData'), 'desktop.log');
    logStream = fs.createWriteStream(logPath, { flags: 'a' });
    writeLog(`\n===== ${new Date().toISOString()} 启动 =====\n`);

    try {
      const port = await startServer();
      createWindow(port);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      writeLog(`[app] 启动失败：${message}\n`);
      dialog.showErrorBox(
        `${APP_TITLE} 启动失败`,
        `${message}\n\n日志：${logPath}`,
      );
      app.quit();
    }
  });

  app.on('window-all-closed', () => {
    stopServer();
    app.quit();
  });

  app.on('before-quit', () => {
    stopServer();
    if (logStream) {
      logStream.end();
      logStream = null;
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && serverProcess) {
      // macOS 习惯：点 Dock 图标重开窗口
      const [win] = BrowserWindow.getAllWindows();
      if (win) win.show();
    }
  });
}

process.on('exit', stopServer);
