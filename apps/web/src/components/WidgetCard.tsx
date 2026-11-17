import { Check, LayoutGrid, Loader2, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import {
  WIDGET_KINDS,
  desktopWidget,
  isNativeWidget,
  refreshNativeWidget,
  requestPinWidget,
} from '../lib/widget';
import { Button, Card, SectionTitle } from './ui';

/**
 * 桌面小组件的入口与说明。
 *
 * 关键点：两种形态都支持「同时放多个」——Windows 可以开好几块不同的小部件，
 * Android 每种类型都是独立的 AppWidget，用户可以四象限放一块、今天放一块。
 * 文案要写清楚，否则用户会以为只能开一个。
 */
export function WidgetCard() {
  const bridge = desktopWidget();
  const native = isNativeWidget();

  const [openKinds, setOpenKinds] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  const refreshOpen = useCallback(async () => {
    if (!bridge) return;
    try {
      const rows = await bridge.list();
      const counts: Record<string, number> = {};
      for (const row of rows) counts[row.kind] = (counts[row.kind] ?? 0) + 1;
      setOpenKinds(counts);
    } catch {
      setOpenKinds({});
    }
  }, [bridge]);

  useEffect(() => {
    void refreshOpen();
  }, [refreshOpen]);

  if (!bridge && !native) {
    return (
      <Card id="settings-widget">
        <SectionTitle>桌面小组件</SectionTitle>
        <p className="text-[12px] leading-relaxed text-neutral-500">
          系统级小组件目前在 Windows 桌面端和 Android 客户端里可用。
          浏览器和 iPhone 上可以把页面「添加到主屏幕」，同样一点就开。
        </p>
      </Card>
    );
  }

  /* --------------------------- Android --------------------------- */
  if (native) {
    return (
      <Card id="settings-widget">
        <SectionTitle>桌面小组件</SectionTitle>
        <p className="mb-3 text-[12px] leading-relaxed text-neutral-500">
          四种都可以单独放到桌面上，<strong className="font-medium text-neutral-700">也能同时放好几块</strong>
          （比如左边四象限、右边今天）。在桌面上点一下圆圈就能直接完成任务，不用打开 App；
          数据由 App 运行时推给系统，
          <strong className="font-medium text-neutral-700">App 完全没打开过时不会自己更新</strong>。
        </p>

        <div className="space-y-1.5">
          {WIDGET_KINDS.map((kind) => (
            <div
              key={kind.id}
              className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="text-[12.5px] font-medium text-neutral-800">{kind.name}</p>
                <p className="mt-0.5 text-[11.5px] leading-snug text-neutral-400">{kind.desc}</p>
              </div>
              <Button
                variant="primary"
                className="shrink-0"
                disabled={busy === kind.id}
                onClick={async () => {
                  setBusy(kind.id);
                  const ok = await requestPinWidget(kind.id);
                  setBusy(null);
                  setHint(
                    ok
                      ? `已向系统发出「${kind.name}」的添加请求，确认后就会出现在桌面上。`
                      : `当前桌面不支持一键添加，请长按桌面空白处 → 小组件 → 找到「截止日 · ${kind.name}」。`,
                  );
                }}
              >
                {busy === kind.id ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <LayoutGrid className="size-3.5" />
                )}
                添加到桌面
              </Button>
            </div>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            className="shrink-0"
            onClick={async () => {
              const ok = await refreshNativeWidget();
              setHint(ok ? '已刷新桌面上的全部小组件。' : '刷新失败，请确认小组件已经加到桌面。');
            }}
          >
            <RefreshCw className="size-3.5" />
            立即刷新
          </Button>
        </div>
        {hint && <p className="mt-2 text-[11.5px] leading-relaxed text-neutral-500">{hint}</p>}
      </Card>
    );
  }

  /* --------------------------- Windows --------------------------- */
  const totalOpen = Object.values(openKinds).reduce((sum, count) => sum + count, 0);

  return (
    <Card id="settings-widget">
      <SectionTitle>桌面小组件</SectionTitle>
      <p className="mb-3 text-[12px] leading-relaxed text-neutral-500">
        在你桌面上贴悬浮卡片，可以
        <strong className="font-medium text-neutral-700">同时开好几块</strong>
        （四象限一块、今天一块都行）。点标题栏拖动，点圆圈直接完成任务、
        点时钟推到明天，数据与主窗口实时一致。
      </p>

      <div className="space-y-1.5">
        {WIDGET_KINDS.map((kind) => {
          const count = openKinds[kind.id] ?? 0;
          return (
            <div
              key={kind.id}
              className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-[12.5px] font-medium text-neutral-800">
                  {kind.name}
                  {count > 0 && (
                    <span className="flex items-center gap-0.5 rounded bg-emerald-50 px-1 text-[10.5px] font-normal text-emerald-600">
                      <Check className="size-2.5" />
                      已开 {count} 块
                    </span>
                  )}
                </p>
                <p className="mt-0.5 text-[11.5px] leading-snug text-neutral-400">{kind.desc}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Button
                  variant="primary"
                  onClick={async () => {
                    await bridge?.open(kind.id);
                    await refreshOpen();
                  }}
                >
                  <LayoutGrid className="size-3.5" />
                  打开
                </Button>
                {count > 0 && (
                  <Button
                    onClick={async () => {
                      await bridge?.closeKind(kind.id);
                      await refreshOpen();
                    }}
                  >
                    关闭
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          className="shrink-0"
          disabled={totalOpen === 0}
          onClick={async () => {
            await bridge?.closeAll();
            await refreshOpen();
          }}
        >
          全部关闭
        </Button>
      </div>
      <p className="mt-2 text-[11.5px] leading-relaxed text-neutral-400">
        小部件不占任务栏，关闭主窗口会一并退出；位置、尺寸和置顶状态按每一块单独记住。
        想快速打开某一种，用菜单「文件 → 桌面小部件」。
      </p>
    </Card>
  );
}
