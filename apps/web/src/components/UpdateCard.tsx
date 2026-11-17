import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Download, Loader2, RefreshCw } from 'lucide-react';
import {
  CURRENT_VERSION,
  GITHUB_REPO,
  checkForUpdate,
  installAndroidUpdate,
  isDesktopApp,
  isNativeApp,
  releasePageUrl,
  toHighlights,
  type ReleaseInfo,
} from '../lib/update';
import { Button, Card, SectionTitle } from './ui';

type Phase = 'idle' | 'checking' | 'up-to-date' | 'available' | 'installing' | 'error' | 'unsupported';

type DesktopBridge = {
  checkForUpdate: () => Promise<{
    status: 'unsupported' | 'none' | 'available' | 'error';
    version?: string;
    notes?: string;
    message?: string;
  }>;
  downloadUpdate: () => Promise<{ ok: boolean; message?: string }>;
  installUpdate: () => Promise<{ ok: boolean }>;
  onUpdateEvent?: (handler: (payload: { type: string; percent?: number; message?: string }) => void) => void;
};

function desktopBridge(): DesktopBridge | undefined {
  return (window as { ddlDesktop?: DesktopBridge }).ddlDesktop;
}

export function UpdateCard() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState<string>('');
  const [release, setRelease] = useState<ReleaseInfo | null>(null);
  const [percent, setPercent] = useState<number | null>(null);

  const native = isNativeApp();
  const desktop = isDesktopApp();

  // 桌面端下载进度由主进程推送
  useEffect(() => {
    const bridge = desktopBridge();
    bridge?.onUpdateEvent?.((payload) => {
      if (payload.type === 'progress') {
        setPercent(Math.round(payload.percent ?? 0));
      } else if (payload.type === 'downloaded') {
        setPercent(100);
        setMessage('下载完成，点击「重启并安装」完成更新');
        setPhase('available');
      } else if (payload.type === 'error') {
        setPhase('error');
        setMessage(payload.message ?? '更新失败');
      }
    });
  }, []);

  const handleCheck = useCallback(async () => {
    setPhase('checking');
    setMessage('');
    setPercent(null);
    try {
      if (desktop) {
        const bridge = desktopBridge();
        if (!bridge) throw new Error('桌面端接口不可用');
        const result = await bridge.checkForUpdate();
        if (result.status === 'unsupported') {
          setPhase('unsupported');
          setMessage(result.message ?? '当前为开发模式，不检查更新');
          return;
        }
        if (result.status === 'none') {
          setPhase('up-to-date');
          return;
        }
        if (result.status === 'error') {
          setPhase('error');
          setMessage(result.message ?? '检查更新失败');
          return;
        }
        setRelease({
          version: result.version ?? '',
          notes: result.notes ?? '',
          highlights: toHighlights(result.notes),
          publishedAt: '',
          pageUrl: '',
          apkUrl: null,
          installerUrl: null,
        });
        setPhase('available');
        return;
      }

      const result = await checkForUpdate();
      if (result.status === 'unsupported') {
        setPhase('unsupported');
        setMessage(result.reason);
        return;
      }
      if (result.status === 'up-to-date') {
        setPhase('up-to-date');
        return;
      }
      setRelease(result.latest);
      setPhase('available');
    } catch (error) {
      setPhase('error');
      setMessage(error instanceof Error ? error.message : '检查更新失败');
    }
  }, [desktop]);

  const handleInstall = useCallback(async () => {
    setMessage('');
    try {
      if (desktop) {
        const bridge = desktopBridge();
        if (!bridge) throw new Error('桌面端接口不可用');
        // 已下载完就直接装，否则先下载
        if (percent !== null && percent >= 100) {
          await bridge.installUpdate();
          return;
        }
        setPhase('installing');
        const result = await bridge.downloadUpdate();
        if (!result.ok) throw new Error(result.message ?? '下载失败');
        return;
      }

      if (native && release) {
        setPhase('installing');
        await installAndroidUpdate(release);
        setMessage('已开始下载安装包，请在弹出的系统界面点「更新」');
        setPhase('available');
        return;
      }

      // 浏览器：只能跳到发布页手动下载
      if (release?.pageUrl) window.open(release.pageUrl, '_blank', 'noopener');
      else setMessage('请在电脑上下载安装包完成升级');
    } catch (error) {
      setPhase('error');
      setMessage(error instanceof Error ? error.message : '更新失败');
    }
  }, [desktop, native, percent, release]);

  const busy = phase === 'checking' || phase === 'installing';

  return (
    <Card>
      <SectionTitle>版本与更新</SectionTitle>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[13px] text-neutral-700">当前版本</p>
          <p className="mt-0.5 text-[11.5px] text-neutral-400">
            v{CURRENT_VERSION}
            {GITHUB_REPO ? ` · 更新源 ${GITHUB_REPO}` : ' · 未配置更新源'}
          </p>
        </div>
        <Button onClick={handleCheck} disabled={busy}>
          {phase === 'checking' ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5" />
          )}
          {phase === 'checking' ? '检查中…' : '检查更新'}
        </Button>
      </div>

      {phase === 'up-to-date' && (
        <p className="mt-3 flex items-center gap-1.5 text-[12.5px] text-emerald-700">
          <CheckCircle2 className="size-3.5" />
          已经是最新版本
        </p>
      )}

      {phase === 'unsupported' && (
        <p className="mt-3 flex items-start gap-1.5 text-[12.5px] text-neutral-500">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
          {message || '当前环境不支持自动更新'}
        </p>
      )}

      {phase === 'error' && (
        <div className="mt-3 flex items-start gap-1.5 text-[12.5px] text-red-600">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
          <div>
            <p>{message || '更新失败'}</p>
            {GITHUB_REPO && (
              <a
                href={releasePageUrl()}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-block text-[12px] text-blue-600 hover:underline"
              >
                直接打开发布页手动下载 ↗
              </a>
            )}
          </div>
        </div>
      )}

      {phase === 'available' && release && (
        <div className="mt-3 rounded-lg border border-neutral-200/80 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[13px] font-medium text-neutral-800">
              发现新版本 v{release.version}
            </p>
            <Button size="sm" onClick={handleInstall} disabled={busy}>
              <Download className="size-3.5" />
              {percent !== null && percent < 100
                ? `下载中 ${percent}%`
                : percent === 100 && desktop
                  ? '重启并安装'
                  : native
                    ? '下载并安装'
                    : '打开发布页'}
            </Button>
          </div>
          {release.highlights.length > 0 ? (
            <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">
              {release.highlights.map((line) => (
                <li key={line} className="flex items-start gap-1.5 text-[12px] leading-relaxed text-neutral-500">
                  <span className="mt-[6px] size-1 shrink-0 rounded-full bg-neutral-300" />
                  <span className="min-w-0 flex-1">{line}</span>
                </li>
              ))}
            </ul>
          ) : (
            release.notes && (
              <p className="mt-2 max-h-32 overflow-y-auto text-[12px] leading-relaxed whitespace-pre-wrap text-neutral-500">
                {release.notes}
              </p>
            )
          )}
          <p className="mt-2 text-[11.5px] text-neutral-400">
            {native
              ? '更新会覆盖安装，本机任务与附件都会保留。首次使用需允许「安装未知应用」。'
              : desktop
                ? '下载完成后点「重启并安装」，应用会自动重启到新版本。'
                : '在浏览器里无法自动安装，请到发布页手动下载。'}
          </p>
          {message && <p className="mt-1.5 text-[11.5px] text-neutral-500">{message}</p>}
        </div>
      )}
    </Card>
  );
}
