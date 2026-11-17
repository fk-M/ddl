import { useEffect, useState } from 'react';
import { ArrowUpRight, Download, Loader2, Sparkles, X } from 'lucide-react';
import {
  CURRENT_VERSION,
  checkForUpdate,
  dismissUpdate,
  installAndroidUpdate,
  isDesktopApp,
  isNativeApp,
  isUpdateDismissed,
  releasePageUrl,
  type ReleaseInfo,
} from '../lib/update';

/**
 * 新版本提醒。
 *
 * 启动后静默查一次发布信息，有新版就在右下角浮出一张卡片：写明版本号、
 * 发布时间和「这一版改了什么」，由用户自己决定「立即更新 / 稍后 / 不再提示」。
 *
 * 三种环境的更新手段不一样，按钮文案跟着变：
 * - Windows 桌面端：主进程 electron-updater 下载，下载完提示重启安装；
 * - Android：原生插件下载 APK 并拉起系统安装器；
 * - 浏览器 / PWA：只能打开发布页手动下载。
 *
 * 注意这里**不打断任何操作**：卡片可关、可以点「稍后 3 天」，也不覆盖侧边栏，
 * 免得用户正在记东西时被顶走。
 */

type DesktopBridge = {
  checkForUpdate: () => Promise<{
    status: 'unsupported' | 'none' | 'available' | 'error';
    version?: string;
    notes?: string;
    message?: string;
  }>;
  downloadUpdate: () => Promise<{ ok: boolean; message?: string }>;
  installUpdate: () => Promise<{ ok: boolean }>;
  onUpdateEvent?: (
    handler: (payload: { type: string; percent?: number; message?: string }) => void,
  ) => void;
};

function desktopBridge(): DesktopBridge | undefined {
  return (window as { ddlDesktop?: DesktopBridge }).ddlDesktop;
}

type Phase = 'hidden' | 'loading' | 'shown' | 'working' | 'done' | 'error';

export function UpdateBanner() {
  const [phase, setPhase] = useState<Phase>('hidden');
  /** 版本信息来自主进程（electron-updater 能自己下载安装）还是发布清单 */
  const [viaBridge, setViaBridge] = useState(false);
  const [release, setRelease] = useState<ReleaseInfo | null>(null);
  const [message, setMessage] = useState('');
  const [percent, setPercent] = useState<number | null>(null);

  const native = isNativeApp();
  const desktop = isDesktopApp();

  // 桌面端下载进度由主进程推
  useEffect(() => {
    if (!desktop) return;
    desktopBridge()?.onUpdateEvent?.((payload) => {
      if (payload.type === 'progress') setPercent(Math.round(payload.percent ?? 0));
      if (payload.type === 'downloaded') {
        setPercent(100);
        setMessage('下载完成，点「重启并安装」即可');
      }
      if (payload.type === 'error') {
        setPhase('error');
        setMessage(payload.message ?? '更新失败');
      }
    });
  }, [desktop]);

  // 启动后延后一点再查，别和首屏抢网络
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          setPhase('loading');
          const found = await resolveRelease();
          if (cancelled) return;
          if (!found) {
            setPhase('hidden');
            return;
          }
          if (isUpdateDismissed(found.release.version)) {
            setPhase('hidden');
            return;
          }
          setViaBridge(found.viaBridge);
          setRelease(found.release);
          setPhase('shown');
        } catch {
          if (!cancelled) setPhase('hidden');
        }
      })();
    }, 1500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  async function handleUpdate() {
    if (!release) return;
    setMessage('');
    try {
      if (desktop && viaBridge) {
        const bridge = desktopBridge();
        if (!bridge) throw new Error('桌面端接口不可用');
        if (percent !== null && percent >= 100) {
          await bridge.installUpdate();
          return;
        }
        setPhase('working');
        const result = await bridge.downloadUpdate();
        if (!result.ok) throw new Error(result.message ?? '下载失败');
        setPhase('shown');
        return;
      }

      // 桌面端没接上 electron-updater（未配置发布源）时，退化成下载安装包
      if (desktop) {
        const target = release.installerUrl ?? release.pageUrl;
        if (target) window.open(target, '_blank', 'noopener');
        else setMessage('请到发布页下载安装包完成升级');
        return;
      }

      if (native) {
        setPhase('working');
        await installAndroidUpdate(release);
        setPhase('shown');
        setMessage('已开始下载安装包，请在系统弹窗里点「更新」');
        return;
      }

      if (release.pageUrl) window.open(release.pageUrl, '_blank', 'noopener');
      else setMessage('请到发布页下载安装包完成升级');
    } catch (error) {
      setPhase('error');
      setMessage(error instanceof Error ? error.message : '更新失败');
    }
  }

  if (phase === 'hidden' || phase === 'loading' || !release) return null;

  const busy = phase === 'working';

  return (
    <div className="pointer-events-none fixed inset-x-3 bottom-24 z-50 flex justify-end sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-[380px]">
      <div className="pointer-events-auto w-full overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-[0_18px_48px_-16px_rgba(15,23,42,0.45)]">
        {/* 顶部：版本号 + 关闭 */}
        <div className="flex items-start gap-2 border-b border-neutral-100 bg-neutral-50/80 px-3.5 py-2.5">
          <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-lg bg-neutral-900 text-white">
            <Sparkles className="size-3.5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium text-neutral-900">
              发现新版本 v{release.version}
            </p>
            <p className="mt-0.5 text-[11px] text-neutral-400">
              当前 v{CURRENT_VERSION}
              {release.publishedAt ? ` · ${formatDate(release.publishedAt)} 发布` : ''}
            </p>
          </div>
          <button
            type="button"
            aria-label="关闭"
            onClick={() => {
              dismissUpdate(release.version, 3);
              setPhase('hidden');
            }}
            className="grid size-6 shrink-0 place-items-center rounded-md text-neutral-400 hover:bg-neutral-200/60 hover:text-neutral-700"
          >
            <X className="size-3.5" />
          </button>
        </div>

        {/* 这一版改了什么 */}
        <div className="px-3.5 py-2.5">
          {release.highlights.length > 0 ? (
            <ul className="space-y-1">
              {release.highlights.map((line) => (
                <li key={line} className="flex items-start gap-1.5 text-[12px] leading-relaxed text-neutral-600">
                  <span className="mt-[6px] size-1 shrink-0 rounded-full bg-neutral-300" />
                  <span className="min-w-0 flex-1">{line}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12px] leading-relaxed text-neutral-500">
              这一版有一些改进和修复，建议更新到最新版本。
            </p>
          )}

          {message && (
            <p
              className={`mt-2 text-[11.5px] leading-relaxed ${
                phase === 'error' ? 'text-red-600' : 'text-neutral-500'
              }`}
            >
              {message}
            </p>
          )}
        </div>

        {/* 操作 */}
        <div className="flex items-center gap-1.5 border-t border-neutral-100 px-3.5 py-2.5">
          <button
            type="button"
            onClick={() => void handleUpdate()}
            disabled={busy}
            className="flex h-8 flex-1 items-center justify-center gap-1 rounded-lg bg-neutral-900 px-3 text-[12.5px] font-medium text-white disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : percent !== null && percent < 100 ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Download className="size-3.5" />
            )}
            {percent !== null && percent < 100
              ? `下载中 ${percent}%`
              : percent === 100 && desktop && viaBridge
                ? '重启并安装'
                : native
                  ? '下载并安装'
                  : desktop
                    ? '下载安装包'
                    : '打开发布页'}
          </button>
          <button
            type="button"
            onClick={() => {
              dismissUpdate(release.version, 3);
              setPhase('hidden');
            }}
            className="h-8 shrink-0 rounded-lg border border-neutral-200 px-2.5 text-[12.5px] text-neutral-500 hover:bg-neutral-50"
          >
            稍后
          </button>
          <button
            type="button"
            onClick={() => {
              dismissUpdate(release.version, 0);
              setPhase('hidden');
            }}
            className="h-8 shrink-0 rounded-lg px-2 text-[11.5px] text-neutral-400 hover:text-neutral-600"
          >
            不再提示
          </button>
        </div>

        <a
          href={release.pageUrl || releasePageUrl(release.version)}
          target="_blank"
          rel="noreferrer"
          className="flex items-center justify-center gap-0.5 border-t border-neutral-100 py-1.5 text-[11px] text-neutral-400 hover:text-neutral-600"
        >
          查看完整更新记录
          <ArrowUpRight className="size-3" />
        </a>
      </div>
    </div>
  );
}

/** 桌面端优先问主进程（electron-updater 更清楚自己能不能装），其他环境读发布清单 */
async function resolveRelease(): Promise<{ release: ReleaseInfo; viaBridge: boolean } | null> {
  // 桌面端先问主进程：electron-updater 自己能下载安装，体验最好
  const bridge = desktopBridge();
  if (bridge) {
    try {
      const result = await bridge.checkForUpdate();
      if (result.status === 'available' && result.version) {
        const notes = result.notes ?? '';
        return {
          viaBridge: true,
          release: {
            version: result.version,
            notes,
            highlights: notes
              .split(/\r?\n/)
              .map((line) => line.replace(/^[-*·\s]+/, '').trim())
              .filter(Boolean)
              .slice(0, 6),
            publishedAt: '',
            pageUrl: releasePageUrl(result.version),
            apkUrl: null,
            installerUrl: null,
          },
        };
      }
      // unsupported / error / none 都不算定论：没配发布源的桌面端还得靠清单
    } catch {
      // 落到下面的清单检查
    }
  }

  try {
    // APK / 安装包装在 GitHub Release 资产里，目录清单里的版本号才是准的
    const result = await checkForUpdate();
    return result.status === 'available' ? { release: result.latest, viaBridge: false } : null;
  } catch {
    return null;
  }
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}
