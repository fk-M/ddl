/**
 * 应用内更新：检查 GitHub Releases 最新版本，手机端下载 APK 覆盖安装，桌面端交主进程处理。
 *
 * 版本号来自构建时注入的 __APP_VERSION__（见 vite.config.ts），
 * 仓库地址来自 VITE_GITHUB_REPO（形如 owner/repo），未配置时界面会提示不支持更新。
 */
import { Capacitor, registerPlugin } from '@capacitor/core';

declare const __APP_VERSION__: string;

export const CURRENT_VERSION: string =
  typeof __APP_VERSION__ === 'string' && __APP_VERSION__ ? __APP_VERSION__ : '0.0.0';

export const GITHUB_REPO: string = import.meta.env.VITE_GITHUB_REPO ?? '';

export type ReleaseInfo = {
  version: string;
  notes: string;
  publishedAt: string;
  pageUrl: string;
  apkUrl: string | null;
  installerUrl: string | null;
};

export type UpdateCheck =
  | { status: 'unsupported'; reason: string }
  | { status: 'up-to-date'; current: string; latest: string }
  | { status: 'available'; current: string; latest: ReleaseInfo };

type UpdatePlugin = {
  canInstall(): Promise<{ allowed: boolean }>;
  requestInstallPermission(): Promise<void>;
  install(options: { url: string; fileName?: string }): Promise<{ ok: boolean }>;
};

/** 自定义原生插件（apps/mobile/android .../DdlUpdaterPlugin.java） */
const DdlUpdater = registerPlugin<UpdatePlugin>('DdlUpdater');

/** 语义化版本比较：返回 >0 表示 a 比 b 新 */
export function compareVersions(a: string, b: string): number {
  const normalize = (value: string) =>
    value
      .trim()
      .replace(/^v/i, '')
      .split(/[.+-]/)
      .map((part) => Number.parseInt(part, 10))
      .map((part) => (Number.isFinite(part) ? part : 0));
  const left = normalize(a);
  const right = normalize(b);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function pickAsset(assets: Array<{ name?: string; browser_download_url?: string }>, pattern: RegExp) {
  const found = assets.find((asset) => pattern.test(asset.name ?? ''));
  return found?.browser_download_url ?? null;
}

export async function fetchLatestRelease(): Promise<ReleaseInfo | null> {
  if (!GITHUB_REPO) return null;
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json' },
    // 避免拿到被缓存的旧响应
    cache: 'no-store',
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`查询版本失败（HTTP ${res.status}）`);
  const json = (await res.json()) as {
    tag_name?: string;
    body?: string;
    published_at?: string;
    html_url?: string;
    assets?: Array<{ name?: string; browser_download_url?: string }>;
  };
  const assets = json.assets ?? [];
  return {
    version: (json.tag_name ?? '').replace(/^v/i, ''),
    notes: json.body ?? '',
    publishedAt: json.published_at ?? '',
    pageUrl: json.html_url ?? '',
    apkUrl: pickAsset(assets, /\.apk$/i),
    installerUrl: pickAsset(assets, /\.exe$/i),
  };
}

export async function checkForUpdate(): Promise<UpdateCheck> {
  if (!GITHUB_REPO) {
    return { status: 'unsupported', reason: '尚未配置更新源（VITE_GITHUB_REPO）' };
  }
  const latest = await fetchLatestRelease();
  if (!latest || !latest.version) {
    return { status: 'unsupported', reason: '还没有发布任何版本' };
  }
  if (compareVersions(latest.version, CURRENT_VERSION) <= 0) {
    return { status: 'up-to-date', current: CURRENT_VERSION, latest: latest.version };
  }
  return { status: 'available', current: CURRENT_VERSION, latest };
}

/** 手机端：下载 APK 并拉起系统安装器 */
export async function installAndroidUpdate(release: ReleaseInfo): Promise<void> {
  if (!release.apkUrl) throw new Error('该版本没有附带 APK');
  if (!Capacitor.isNativePlatform()) throw new Error('仅手机端支持应用内安装');
  const permission = await DdlUpdater.canInstall();
  if (!permission.allowed) {
    await DdlUpdater.requestInstallPermission();
    throw new Error('请先允许「安装未知应用」，然后再点一次更新');
  }
  await DdlUpdater.install({
    url: release.apkUrl,
    fileName: `ddl-${release.version}.apk`,
  });
}

export function isNativeApp(): boolean {
  return typeof window !== 'undefined' && Capacitor.isNativePlatform();
}

export function isDesktopApp(): boolean {
  return typeof window !== 'undefined' && Boolean((window as { ddlDesktop?: unknown }).ddlDesktop);
}
