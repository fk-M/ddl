// 以局域网模式启动服务端：监听所有网卡、托管前端产物，并自检手机端所需的连通性与 CORS
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { connect } from 'node:net';
import { homedir, networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = process.env.PORT ?? '3001';
const base = `http://127.0.0.1:${port}`;
const webDist = path.join(root, 'apps', 'web', 'dist');

// Capacitor WebView 的 Origin 在不同系统版本 / 不同 scheme 下可能是这些变体，
// 任何一个不在白名单里，前端都只会显示笼统的「无法连接」。
const WEBVIEW_ORIGINS = [
  'http://localhost',
  'https://localhost',
  'capacitor://localhost',
  'null',
  'http://localhost:80',
];

function lanAddresses() {
  const result = [];
  for (const [name, list] of Object.entries(networkInterfaces())) {
    for (const info of list ?? []) {
      if (info.family === 'IPv4' && !info.internal) {
        // 169.254.x.x 是没拿到 DHCP 时的 APIPA 地址，手机不可能连上，别误导用户
        if (info.address.startsWith('169.254.')) continue;
        result.push({ name, address: info.address });
      }
    }
  }
  return result;
}

/**
 * 桌面 App 的数据库目录（Electron 的 userData/data/pglite）。
 * 只有那里已经建过库才返回，否则返回空串，让服务端用默认目录 —— 免得新机器上一开始就指向空目录。
 */
function sharedPgliteDir() {
  if (process.env.PGLITE_DIR) return process.env.PGLITE_DIR;
  let base;
  if (process.platform === 'win32') {
    base = path.join(process.env.APPDATA ?? path.join(homedir(), 'AppData', 'Roaming'), 'DDL', 'data');
  } else if (process.platform === 'darwin') {
    base = path.join(homedir(), 'Library', 'Application Support', 'DDL', 'data');
  } else {
    base = path.join(process.env.XDG_CONFIG_HOME ?? path.join(homedir(), '.config'), 'DDL', 'data');
  }
  const dir = path.join(base, 'pglite');
  return existsSync(path.join(dir, 'PG_VERSION')) ? dir : '';
}

/** 纯 TCP 探测端口占用，比 /health 更准（旧服务若是别的程序也能发现） */
function portInUse() {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port: Number(port) });
    socket.setTimeout(1000);
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function waitForServer(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(1200) });
      if (res.ok) return true;
    } catch {
      // 还没起来，继续等
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
}

function printUsage(addresses, webServed) {
  console.log('\n========== 手机端连接信息 ==========');
  if (addresses.length === 0) {
    console.log('  未检测到可用的局域网地址，请确认电脑已连接 Wi-Fi 或有线网络');
  } else {
    for (const item of addresses) {
      console.log(`  http://${item.address}:${port}   (${item.name})`);
    }
    const ip = addresses[0].address;
    console.log('\n  第一步（最重要，先绕开 App 测网络）：用手机浏览器打开');
    console.log(`    ${webServed ? `http://${ip}:${port}/` : `http://${ip}:${port}/health`}`);
    if (webServed) {
      console.log('  能看到完整界面 = 网络通且服务正确；这时手机浏览器本身就能当客户端用。');
    } else {
      console.log('  能看到 JSON = 网络通且服务正确。');
    }
    console.log('  打不开 = 网络不通：检查是否同一个 Wi-Fi；校园网 / 公共 Wi-Fi 常有');
    console.log('           「客户端隔离」，此时改用电脑开「移动热点」给手机连，再重跑本脚本取新 IP。');
    console.log('\n  第二步：App「设置 → 服务端连接」填上面任一地址，点「测试连接」。');
  }
  console.log('=====================================\n');
}

async function selfCheck(addresses, webServed) {
  const ready = await waitForServer();
  console.log('\n========== 启动自检 ==========');
  if (!ready) {
    console.log('  [失败] 服务 20 秒内未就绪，请看上面的错误日志。');
    console.log('==============================\n');
    return;
  }
  console.log(`  [通过] /health 已响应 (${base}/health)`);

  let passed = 0;
  for (const origin of WEBVIEW_ORIGINS) {
    try {
      const res = await fetch(`${base}/api/tasks?limit=1`, {
        method: 'OPTIONS',
        headers: {
          Origin: origin,
          'Access-Control-Request-Method': 'GET',
          'Access-Control-Request-Headers': 'content-type',
        },
        signal: AbortSignal.timeout(2000),
      });
      const allow = res.headers.get('access-control-allow-origin');
      const good = res.status >= 200 && res.status < 300 && allow !== null;
      if (good) passed += 1;
      console.log(
        `  ${good ? '[通过]' : '[失败]'} CORS 预检 ${origin.padEnd(24)} HTTP ${res.status} allow-origin=${allow ?? '(无)'}`,
      );
    } catch (error) {
      console.log(`  [失败] CORS 预检 ${origin.padEnd(24)} ${String(error)}`);
    }
  }
  console.log(`  CORS 合计：${passed}/${WEBVIEW_ORIGINS.length} 通过`);
  if (passed < WEBVIEW_ORIGINS.length) {
    console.log('  ！若这里没全通过，说明本次启动的 CORS 配置没生效（多半仍有旧的 3001 服务占着端口）。');
  }
  console.log(`  静态页面：${webServed ? '已托管（手机浏览器可直接打开完整界面）' : '未托管（仅接口）'}`);
  console.log('==============================');

  // 服务日志会持续刷屏，把地址放在自检后面更醒目
  printUsage(addresses, webServed);
}

// 刚结束旧进程时端口释放需要一小段时间，重试几次避免误判
async function waitPortFree(retries = 5) {
  for (let i = 0; i < retries; i += 1) {
    if (!(await portInUse())) return true;
    if (i < retries - 1) await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return false;
}

/**
 * 端口被占用时先看看是不是「已经跑着的新版 DDL 服务」。
 * 直接复用比再起一个进程安全得多：PGlite 的数据目录不支持多进程并发写，
 * 两个服务同时打开同一个目录会把它写坏（表现为下次启动 _pg_initdb abort）。
 */
async function probeExistingService() {
  try {
    const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return 'none';
    const body = await res.json().catch(() => null);
    if (!body || body.status !== 'ok') return 'none';
    const xfo = (res.headers.get('x-frame-options') || '').toUpperCase();
    // DENY 是旧代码（可视化检测页需要 SAMEORIGIN），必须重启
    return xfo === 'DENY' ? 'stale' : 'current';
  } catch {
    return 'none';
  }
}

if (!(await waitPortFree())) {
  const existing = await probeExistingService();
  if (existing === 'current') {
    const currentAddresses = lanAddresses();
    console.log(`\n[提示] 端口 ${port} 上已有一个可用的新版 DDL 服务，直接复用，不再启动第二个进程。`);
    console.log('       （两个进程同时写同一个 PGlite 数据目录会把数据库写坏）\n');
    await selfCheck(currentAddresses, existsSync(path.join(webDist, 'index.html')));
    console.log('\n========== 检测页地址 ==========');
    console.log(`  http://127.0.0.1:${port}/diagnostics.html`);
    for (const item of currentAddresses) {
      console.log(`  http://${item.address}:${port}/diagnostics.html   (${item.name})`);
    }
    console.log('================================\n');
    process.exit(0);
  }
  console.error(`\n[错误] 端口 ${port} 已被占用（${existing === 'stale' ? '是旧版服务，需要重启' : '可能是别的服务或旧黑窗口'}）。`);
  console.error('请在旧黑窗口里按 Ctrl+C 正常退出（让 PGlite 落盘），再重新双击 start-lan.bat。');
  console.error('本脚本不会强制结束旧进程：强制结束会损坏 PGlite 数据目录，且旧数据可能无法恢复。\n');
  process.exit(1);
}

const webServed = existsSync(path.join(webDist, 'index.html'));
const addresses = lanAddresses();
const sharedPglite = sharedPgliteDir();

const child = spawn(
  process.execPath,
  [path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'src/index.ts'],
  {
    cwd: path.join(root, 'apps', 'server'),
    stdio: 'inherit',
    // 手机 WebView 的 Origin 变体太多，任一不在白名单都会让预检失败而前端只报「无法连接」。
    // 局域网模式专供自家手机、无 cookie 与认证，这里放宽来源以消除整类不确定性；
    // 桌面内嵌服务仍是严格白名单，不受影响。
    env: {
      ...process.env,
      HOST: '0.0.0.0',
      PORT: port,
      CORS_ORIGINS: '*',
      // 和桌面 App 共用同一份数据库。以前这里用的是 apps/server/data/pglite，
      // 结果「桌面 App 里记的任务」和「手机同步到的任务」是两份互不相通的数据。
      // 注意：PGlite 是单进程独占的，跑这个脚本前必须先完全退出桌面 App。
      ...(sharedPglite && { PGLITE_DIR: sharedPglite }),
      // 同时托管前端：手机浏览器打开根路径即可直接用完整界面，也便于先验证网络再装 APK
      ...(webServed ? { WEB_DIST: webDist } : {}),
    },
  },
);

child.on('exit', (code) => process.exit(code ?? 0));
process.on('SIGINT', () => child.kill('SIGINT'));

selfCheck(addresses, webServed).catch((error) => {
  console.error('[自检异常]', error);
});
