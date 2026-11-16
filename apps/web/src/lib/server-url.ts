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
