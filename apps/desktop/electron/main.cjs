// Electron 主进程：先拉起内嵌的本地服务（Fastify + PGlite），就绪后再打开窗口
const { app, BrowserWindow, Menu, dialog, ipcMain, screen, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
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
let serverPort = 0;
/** '0.0.0.0' 表示已允许手机连入，'127.0.0.1' 表示只在本机 */
let serverHost = '127.0.0.1';
let logStream = null;

/**
 * 桌面小部件可以同时存在多块（每块一个独立窗口），用实例 id 索引。
 * 同一个类型允许开多块：有人喜欢把「今天」放两块在不同显示器上。
 * value: { kind, win }
 */
const widgetWindows = new Map();
let widgetSeq = 0;

/* ============================ 桌面小部件状态 ============================ */

/** 每种小部件打开时的默认尺寸；和前端 lib/widget.ts 的 WIDGET_KINDS 保持一致 */
const WIDGET_SIZES = {
  quadrant: { width: 380, height: 460 },
  today: { width: 320, height: 430 },
  inbox: { width: 320, height: 430 },
  next7: { width: 320, height: 460 },
};

function widgetSize(kind) {
  return WIDGET_SIZES[kind] ?? WIDGET_SIZES.quadrant;
}

/**
 * 每一块小部件的种类、位置、尺寸、置顶状态要跨启动记住，存在 userData 下的一个小 JSON 里。
 * 单独存而不塞进数据库：它属于「这台机器的窗口偏好」，不该跟着同步跑到手机上。
 * 结构：{ windows: [{ id, kind, x, y, width, height, pinned }] }
 */
const widgetStatePath = () => path.join(app.getPath('userData'), 'widget-windows.json');

function readWidgetState() {
  try {
    const raw = fs.readFileSync(widgetStatePath(), 'utf8');
    const parsed = JSON.parse(raw);
    const rows = Array.isArray(parsed?.windows) ? parsed.windows : [];
    return { windows: rows.filter((row) => row && typeof row.kind === 'string') };
  } catch {
    return { windows: [] };
  }
}

function writeWidgetState(windows) {
  try {
    fs.writeFileSync(widgetStatePath(), JSON.stringify({ windows }));
  } catch (error) {
    writeLog(`[widget] 状态保存失败：${error?.message ?? error}\n`);
  }
}

/** 把当前活着的窗口拍成快照落盘 */
function persistWidgetState() {
  const windows = [];
  for (const [id, entry] of widgetWindows) {
    const win = entry.win;
    if (!win || win.isDestroyed()) continue;
    const [x, y] = win.getPosition();
    const [width, height] = win.getSize();
    windows.push({ id, kind: entry.kind, x, y, width, height, pinned: Boolean(entry.pinned) });
  }
  writeWidgetState(windows);
}

/** 上次记录的坐标可能落在已经拔掉的显示器上，救回主屏内 */
function clampToScreen(x, y, width, height) {
  try {
    const area = screen.getDisplayMatching({ x, y, width, height }).workArea;
    const left = Math.min(Math.max(x, area.x), area.x + Math.max(0, area.width - width));
    const top = Math.min(Math.max(y, area.y), area.y + Math.max(0, area.height - height));
    return { x: left, y: top };
  } catch {
    return { x, y };
  }
}

function writeLog(chunk) {
  if (logStream) logStream.write(chunk);
}

/* ============================ 桌面偏好（手机连接） ============================ */

/**
 * 桌面端偏好存成单独的 JSON，而不是放进 PGlite：主进程要在启动服务之前
 * 就知道「要不要监听 0.0.0.0」，这时数据库还没打开。
 */
const DEFAULT_PREFS = {
  /** 允许手机 / 平板通过局域网连进来。关掉则只监听 127.0.0.1 */
  lanAccess: true,
  /** 优先用 3001，这样手机端地址不用记随机端口；被占用时自动退回随机端口 */
  preferredPort: 3001,
};

function prefsFile() {
  return path.join(app.getPath('userData'), 'desktop-prefs.json');
}

function readPrefs() {
  try {
    const raw = JSON.parse(fs.readFileSync(prefsFile(), 'utf8'));
    return { ...DEFAULT_PREFS, ...raw };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

function writePrefs(patch) {
  const next = { ...readPrefs(), ...patch };
  try {
    fs.mkdirSync(path.dirname(prefsFile()), { recursive: true });
    fs.writeFileSync(prefsFile(), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  } catch (error) {
    writeLog(`[prefs] 写入失败：${error?.message ?? error}\n`);
  }
  return next;
}

/**
 * 虚拟网卡不可能是手机能连的地址（VMware / VirtualBox / Hyper-V / Docker），
 * 列出来只会让用户填错。但如果过滤完一个都不剩（有人确实只有虚拟网卡），
 * 就退回显示全部，免得界面上写「没有可用地址」。
 */
const VIRTUAL_NIC = /vmware|virtualbox|vethernet|hyper-?v|docker|loopback|npcap/i;

/** 所有可给手机用的局域网地址；Tailscale 网卡单独标出来，方便直接抄 */
function lanAddresses() {
  const all = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const info of list ?? []) {
      if (info.family !== 'IPv4' || info.internal) continue;
      // 169.254.x.x 是没拿到 DHCP 时的自动地址，手机不可能连上
      if (info.address.startsWith('169.254.')) continue;
      all.push({
        name,
        address: info.address,
        kind: /tailscale/i.test(name) ? 'tailscale' : 'lan',
      });
    }
  }
  const physical = all.filter((item) => !VIRTUAL_NIC.test(item.name));
  // Tailscale 放在最前面：出门在外只有这一条能用
  return (physical.length > 0 ? physical : all).sort((a, b) =>
    a.kind === b.kind ? 0 : a.kind === 'tailscale' ? -1 : 1,
  );
}

/** 申请一个由系统分配的空闲端口，避免和其它软件抢 3001 */
function getFreePort(host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, host, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/** 指定端口空闲就用它，否则交给系统挑 */
function pickPort(preferred, host) {
  return new Promise((resolve) => {
    if (!preferred) {
      void getFreePort(host).then(resolve);
      return;
    }
    const srv = net.createServer();
    srv.unref();
    srv.once('error', () => {
      void getFreePort(host).then(resolve);
    });
    srv.listen(preferred, host, () => {
      srv.close(() => resolve(preferred));
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

  const prefs = readPrefs();
  const host = prefs.lanAccess ? '0.0.0.0' : '127.0.0.1';
  const port = await pickPort(prefs.preferredPort, host);
  serverHost = host;
  const dataRoot = path.join(app.getPath('userData'), 'data');
  fs.mkdirSync(dataRoot, { recursive: true });

  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    NODE_ENV: 'production',
    HOST: host,
    PORT: String(port),
    LOG_LEVEL: 'warn',
    PGLITE_DIR: path.join(dataRoot, 'pglite'),
    WEB_DIST: path.join(resourcesRoot, 'renderer'),
    MIGRATION_DIR: path.join(resourcesRoot, 'server', 'drizzle'),
    // 手机 APK 的 WebView 源是 http://localhost，跨源访问这里时必须放行，
    // 否则手机上只会看到笼统的「无法连接」。
    CORS_ORIGINS: [
      `http://127.0.0.1:${port}`,
      `http://localhost:${port}`,
      'http://localhost',
      'https://localhost',
      'capacitor://localhost',
    ].join(','),
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
  writeLog(`[server] 监听 ${host}:${port}\n`);
  if (host === '0.0.0.0') {
    for (const item of lanAddresses()) {
      writeLog(`[server] 手机可连接：http://${item.address}:${port}  (${item.name})\n`);
    }
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
    // 主窗口关掉就整体退出：留着孤立的小部件会让人找不到入口，
    // 而且内嵌服务一停它也没数据可显示。
    closeAllWidgets();
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

/**
 * 桌面小部件：无边框透明窗口，加载同一份前端的 ?widget=<kind> 屏。
 * 不占任务栏、可拖动、默认不置顶（用户点了图钉才置顶）。
 *
 * 可以同时存在多块：每块一个独立窗口 + 独立实例 id（wid），
 * 关闭/置顶/记忆位置都按实例走，互不影响。
 */
function createWidgetWindow(kind = 'quadrant', restore = null) {
  if (!serverPort) return null;

  const size = widgetSize(kind);
  const id = restore?.id ?? `w${(widgetSeq += 1)}-${Date.now().toString(36)}`;
  const width = Number.isFinite(restore?.width) ? restore.width : size.width;
  const height = Number.isFinite(restore?.height) ? restore.height : size.height;
  // 没记录过位置就居中偏右上，避免多块窗口完全重叠
  const offset = widgetWindows.size * 28;
  const fallbackX = Math.round((screen.getPrimaryDisplay().workArea.x ?? 0) + 80 + offset);
  const fallbackY = Math.round((screen.getPrimaryDisplay().workArea.y ?? 0) + 80 + offset);
  const { x, y } = clampToScreen(
    Number.isFinite(restore?.x) ? restore.x : fallbackX,
    Number.isFinite(restore?.y) ? restore.y : fallbackY,
    width,
    height,
  );

  const win = new BrowserWindow({
    width,
    height,
    x,
    y,
    minWidth: 260,
    minHeight: 220,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: Boolean(restore?.pinned),
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  const entry = { kind, win, pinned: Boolean(restore?.pinned) };
  widgetWindows.set(id, entry);

  if (entry.pinned) win.setAlwaysOnTop(true, 'floating');
  win.setMenuBarVisibility(false);
  win.once('ready-to-show', () => win.show());

  // 拖动/改大小都立刻落盘，异常退出也不会丢
  let saveTimer = null;
  const rememberLater = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => persistWidgetState(), 400);
  };
  win.on('moved', rememberLater);
  win.on('resized', rememberLater);

  win.on('closed', () => {
    widgetWindows.delete(id);
    persistWidgetState();
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  win
    .loadURL(`http://127.0.0.1:${serverPort}/?widget=${encodeURIComponent(kind)}&wid=${encodeURIComponent(id)}`)
    .catch((error) => {
      writeLog(`[widget] 页面载入失败：${error}\n`);
    });
  writeLog(`[widget] 小部件窗口已创建：${id}（${kind}）\n`);
  return { id, kind };
}

function closeWidgetWindow(id) {
  const entry = widgetWindows.get(id);
  if (!entry) return false;
  const win = entry.win;
  widgetWindows.delete(id);
  if (win && !win.isDestroyed()) win.destroy();
  persistWidgetState();
  return true;
}

function closeWidgetsByKind(kind) {
  let closed = 0;
  for (const [id, entry] of Array.from(widgetWindows)) {
    if (entry.kind !== kind) continue;
    const win = entry.win;
    widgetWindows.delete(id);
    if (win && !win.isDestroyed()) win.destroy();
    closed += 1;
  }
  if (closed > 0) persistWidgetState();
  return closed;
}

function closeAllWidgets() {
  for (const [id, entry] of Array.from(widgetWindows)) {
    const win = entry.win;
    widgetWindows.delete(id);
    if (win && !win.isDestroyed()) win.destroy();
  }
  persistWidgetState();
}

/** 启动时把上次还开着的小部件恢复出来（用户没关 = 还想看） */
function restoreWidgetWindows() {
  const { windows } = readWidgetState();
  for (const row of windows) {
    try {
      createWidgetWindow(row.kind, row);
    } catch (error) {
      writeLog(`[widget] 恢复失败：${error?.message ?? error}\n`);
    }
  }
}

function listWidgetWindows() {
  const rows = [];
  for (const [id, entry] of widgetWindows) {
    if (!entry.win || entry.win.isDestroyed()) continue;
    rows.push({ id, kind: entry.kind, pinned: Boolean(entry.pinned) });
  }
  return rows;
}

/** 渲染进程（设置页与窗口自身）控制小部件的入口 */
function setupServerIpc() {
  ipcMain.handle('ddl:server:info', () => {
    const prefs = readPrefs();
    const lanEnabled = serverHost === '0.0.0.0';
    return {
      port: serverPort,
      host: serverHost,
      lanEnabled,
      // 只在本机监听时，列出来的地址手机也用不上，直接给空数组避免误导
      addresses: lanEnabled
        ? lanAddresses().map((item) => ({ ...item, url: `http://${item.address}:${serverPort}` }))
        : [],
    };
  });

  ipcMain.handle('ddl:prefs:get', () => readPrefs());

  ipcMain.handle('ddl:prefs:set', (_event, patch) => {
    const before = readPrefs();
    const next = writePrefs(patch ?? {});
    const needRestart =
      Boolean(before.lanAccess) !== Boolean(next.lanAccess) ||
      Number(before.preferredPort) !== Number(next.preferredPort);
    return { ok: true, prefs: next, needRestart };
  });
}

function setupWidgetIpc() {
  ipcMain.handle('ddl:widget:list', () => listWidgetWindows());

  ipcMain.handle('ddl:widget:open', (_event, kind) => {
    const created = createWidgetWindow(typeof kind === 'string' ? kind : 'quadrant');
    if (created) persistWidgetState();
    return created;
  });

  ipcMain.handle('ddl:widget:close', (_event, id) => closeWidgetWindow(id));

  ipcMain.handle('ddl:widget:close-kind', (_event, kind) => closeWidgetsByKind(kind));

  ipcMain.handle('ddl:widget:close-all', () => {
    closeAllWidgets();
    return true;
  });

  ipcMain.handle('ddl:widget:focus-main', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return false;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    return true;
  });

  ipcMain.handle('ddl:widget:set-pinned', (_event, id, pinned) => {
    const entry = widgetWindows.get(id);
    const next = Boolean(pinned);
    if (entry) {
      entry.pinned = next;
      if (entry.win && !entry.win.isDestroyed()) {
        entry.win.setAlwaysOnTop(next, next ? 'floating' : 'normal');
      }
      persistWidgetState();
    }
    return next;
  });

  ipcMain.handle('ddl:widget:get-pinned', (_event, id) => Boolean(widgetWindows.get(id)?.pinned));

  // 注意：小部件窗口不能调 refreshElectron，这里只暴露只读状态
}

/** 更新状态推给渲染进程（进度、完成、错误） */
function sendUpdateEvent(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('ddl:update:event', payload);
  }
}

function setupUpdaterIpc() {
  // 没有 autoUpdater（开发态 / 未打包）时也要把 handler 注册上，
  // 否则渲染进程发来的 checkForUpdate 会以「No handler registered」告警收场。
  if (!autoUpdater) {
    ipcMain.handle('ddl:update:check', () => ({
      status: 'unsupported',
      message: '开发模式或未配置更新源，不检查更新',
    }));
    ipcMain.handle('ddl:update:download', () => ({ ok: false, message: '当前环境不支持自动更新' }));
    ipcMain.handle('ddl:update:install', () => ({ ok: false }));
    return;
  }

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

/** 菜单里开一块新的小部件（同类型可以开多块，位置错开） */
function openWidgetFromMenu(kind) {
  const created = createWidgetWindow(kind);
  if (created) persistWidgetState();
}

function buildMenu() {
  // 隐藏菜单栏但保留快捷键：刷新 / 缩放 / 开发者工具
  const template = [
    {
      label: '文件',
      submenu: [
        {
          label: '桌面小部件',
          submenu: [
            {
              label: '四象限',
              accelerator: 'CmdOrCtrl+Shift+D',
              click: () => openWidgetFromMenu('quadrant'),
            },
            { label: '今天', click: () => openWidgetFromMenu('today') },
            { label: '收件箱', click: () => openWidgetFromMenu('inbox') },
            { label: '最近 7 天', click: () => openWidgetFromMenu('next7') },
            { type: 'separator' },
            { label: '关闭全部小部件', click: () => closeAllWidgets() },
          ],
        },
        { type: 'separator' },
        { role: 'quit', label: '退出' },
      ],
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
    setupWidgetIpc();
    setupServerIpc();

    const logPath = path.join(app.getPath('userData'), 'desktop.log');
    logStream = fs.createWriteStream(logPath, { flags: 'a' });
    writeLog(`\n===== ${new Date().toISOString()} 启动 =====\n`);

    try {
      const port = await startServer();
      serverPort = port;
      createWindow(port);
      // 上次退出时还开着的小部件继续摆出来（用户没关就是还想看）
      restoreWidgetWindows();
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
