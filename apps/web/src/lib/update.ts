/**
 * 应用内更新：检查 GitHub Releases 最新版本，手机端下载 APK 覆盖安装，桌面端交主进程处理。
 *
 * 版本号来自构建时注入的 __APP_VERSION__（见 vite.config.ts），
 * 仓库地址来自 VITE_GITHUB_REPO（形如 owner/repo），未配置时界面会提示不支持更新。
 *
 * 更新源优先读仓库里的 version.json（raw.githubusercontent / jsDelivr，都不受 GitHub API
 * 60 次/小时限流影响），拿不到才退回 api.github.com —— 手机走运营商共享出口 IP，
 * 匿名 API 配额经常一早就被别的设备用光，之前就因此报过 HTTP 403。
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

/** 发布页（浏览器 / 兜底下载用） */
export function releasePageUrl(version?: string): string {
  if (!GITHUB_REPO) return 'https://github.com';
  return version
    ? `https://github.com/${GITHUB_REPO}/releases/tag/v${version}`
    : `https://github.com/${GITHUB_REPO}/releases/latest`;
}

type Manifest = {
  version?: string;
  notes?: string;
  releasedAt?: string;
  android?: string;
  windows?: string;
};

/** 清单镜像：都带 CORS，且不受 API 限流。按顺序试，第一个成功的就用。 */
function manifestUrls(): string[] {
  if (!GITHUB_REPO) return [];
  const bust = `t=${Date.now()}`;
  return [
    `https://raw.githubusercontent.com/${GITHUB_REPO}/main/version.json?${bust}`,
    `https://cdn.jsdelivr.net/gh/${GITHUB_REPO}@main/version.json?${bust}`,
  ];
}

async function fetchManifest(): Promise<Manifest | null> {
  for (const url of manifestUrls()) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) continue;
      const json = (await res.json()) as Manifest;
      if (json && typeof json.version === 'string' && json.version.trim()) return json;
    } catch {
      // 单个镜像失败就换下一个，全部失败由调用方给出统一提示
    }
  }
  return null;
}

/** 由版本号拼出 Release 资产地址（命名规则见 .github/workflows/release.yml） */
function assetUrl(version: string, fileName: string, manifestName?: string): string | null {
  if (!GITHUB_REPO) return null;
  const name = manifestName?.trim() || fileName;
  return `https://github.com/${GITHUB_REPO}/releases/download/v${version}/${name}`;
}

function toReleaseInfo(version: string, manifest?: Manifest): ReleaseInfo {
  return {
    version,
    notes: manifest?.notes ?? '',
    publishedAt: manifest?.releasedAt ?? '',
    pageUrl: releasePageUrl(version),
    apkUrl: assetUrl(version, `DDL-${version}-android.apk`, manifest?.android),
    installerUrl: assetUrl(version, `DDL-${version}-x64.exe`, manifest?.windows),
  };
}

/** 老路子：GitHub API（可能被 60 次/小时的匿名限流挡住） */
async function fetchFromApi(): Promise<ReleaseInfo | null> {
  if (!GITHUB_REPO) return null;
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json' },
    cache: 'no-store',
  });
  if (res.status === 404) return null;
  if (res.status === 403) {
    const remaining = res.headers.get('x-ratelimit-remaining');
    throw new Error(
      remaining === '0'
        ? 'GitHub API 触发限流（匿名访问每小时 60 次，手机网络多为共用出口），请稍后重试，或直接到发布页手动下载'
        : 'GitHub 拒绝访问（HTTP 403），可稍后重试或到发布页手动下载',
    );
  }
  if (!res.ok) throw new Error(`查询版本失败（HTTP ${res.status}）`);

  const json = (await res.json()) as {
    tag_name?: string;
    body?: string;
    published_at?: string;
    html_url?: string;
    assets?: Array<{ name?: string; browser_download_url?: string }>;
  };
  const version = (json.tag_name ?? '').replace(/^v/i, '');
  if (!version) return null;
  const assets = json.assets ?? [];
  const pick = (pattern: RegExp) =>
    assets.find((asset) => pattern.test(asset.name ?? ''))?.browser_download_url ?? null;

  return {
    version,
    notes: json.body ?? '',
    publishedAt: json.published_at ?? '',
    pageUrl: json.html_url ?? releasePageUrl(version),
    apkUrl: pick(/\.apk$/i),
    installerUrl: pick(/\.exe$/i),
  };
}

export async function fetchLatestRelease(): Promise<ReleaseInfo | null> {
  const manifest = await fetchManifest();
  if (manifest?.version) {
    return toReleaseInfo(manifest.version.trim().replace(/^v/i, ''), manifest);
  }
  return fetchFromApi();
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
