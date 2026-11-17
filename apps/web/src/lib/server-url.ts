/**
 * 服务端地址解析。单独成文件是为了让同步引擎不依赖 api.ts，避免循环引用。
 */
const ENV_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';
const SERVER_URL_KEY = 'ddl.serverUrl';

/** 只粘贴 IP 时自动补 http:// 与默认端口，并去掉结尾斜杠 */
export function normalizeServerUrl(value: string, defaultPort?: number): string {
  let next = value.trim().replace(/\/+$/, '');
  if (!next) return '';
  if (!/^https?:\/\//i.test(next)) next = `http://${next}`;
  try {
    const url = new URL(next);
    if (defaultPort && !url.port) url.port = String(defaultPort);
    return url.toString().replace(/\/+$/, '');
  } catch {
    return next;
  }
}

export function getServerUrl(): string {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(SERVER_URL_KEY);
  } catch {
    stored = null;
  }
  // 只有手填的局域网地址才补默认端口，构建注入的完整地址原样尊重
  return normalizeServerUrl(stored ?? ENV_BASE_URL, stored ? 3001 : undefined);
}

export function setServerUrl(url: string): void {
  const normalized = normalizeServerUrl(url, 3001);
  try {
    if (normalized) localStorage.setItem(SERVER_URL_KEY, normalized);
    else localStorage.removeItem(SERVER_URL_KEY);
  } catch {
    // 隐私模式下不可写，忽略即可
  }
}

export const defaultServerUrl = ENV_BASE_URL;

/**
 * 手机端（Capacitor WebView）启用「本地优先」：数据先落在 IndexedDB，
 * 只有探测到电脑服务可达时才同步。桌面 Electron 直连内嵌服务，保持原行为。
 */
export function isLocalFirst(): boolean {
  if (typeof window === 'undefined') return false;
  if (Boolean((window as unknown as { Capacitor?: unknown }).Capacitor)) return true;
  // 检测页用：浏览器里加 ?localfirst=1 可复现手机端「本地优先」链路，
  // 方便不装 APK 就在电脑/手机浏览器里验证离线行为。
  try {
    return new URLSearchParams(window.location.search).get('localfirst') === '1';
  } catch {
    return false;
  }
}

/**
 * 真正的手机 App（Android / iOS 原生壳）。
 *
 * 注意 `@capacitor/core` 一旦被静态引入就会挂 `window.Capacitor`，桌面 Electron
 * 和普通浏览器里同样存在，所以 isLocalFirst() 在那里也是 true —— 判断「是不是手机」
 * 必须看 getPlatform()，不能只看 Capacitor 是否存在。
 */
export function isNativeApp(): boolean {
  if (typeof window === 'undefined') return false;
  const cap = (window as unknown as { Capacitor?: { getPlatform?: () => string } }).Capacitor;
  const platform = typeof cap?.getPlatform === 'function' ? cap.getPlatform() : '';
  return platform === 'android' || platform === 'ios';
}

/**
 * 信息源 / 候选池只在手机上落本机，桌面端与网页版继续用服务端的采集链路。
 *
 * 原因：服务端有后台轮询（COLLECT_TICK_SECONDS）在采集，候选池是「服务端产出、
 * 客户端确认」的单向流；桌面端也改成读 IndexedDB 的话，会看不到服务端已经采到的
 * 候选，还会让两边的订阅列表分叉。
 */
export function isLocalCollectDevice(): boolean {
  if (isNativeApp()) return true;
  // 检测页/网页预览：允许用 ?localfirst=1 复现手机端的本机采集链路
  try {
    return new URLSearchParams(window.location.search).get('localfirst') === '1';
  } catch {
    return false;
  }
}
