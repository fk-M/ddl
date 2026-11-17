import { LayoutGrid, Loader2, Pin, PinOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  desktopWidget,
  isNativeWidget,
  refreshNativeWidget,
  requestPinWidget,
} from '../lib/widget';
import { Button, Card, SectionTitle } from './ui';

/**
 * 桌面小组件的开关与说明。
 * 两种形态差异很大，文案必须分开写，否则用户会在手机上找「置顶」按钮。
 */
export function WidgetCard() {
  const bridge = desktopWidget();
  const native = isNativeWidget();

  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    if (!bridge) return;
    void bridge.isOpen?.().then((value) => setOpen(Boolean(value)));
    void bridge.getPinned?.().then((value) => setPinned(Boolean(value)));
  }, [bridge]);

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

  if (native) {
    return (
      <Card id="settings-widget">
        <SectionTitle>桌面小组件</SectionTitle>
        <p className="mb-3 text-[12px] leading-relaxed text-neutral-500">
          小组件显示今天的待办和最近的纪念日。数据由 App 运行时推给系统，
          <strong className="font-medium text-neutral-700">App 完全没打开过时不会自己更新</strong>
          ，打开一次就会同步成最新的。
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            className="shrink-0"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              const ok = await requestPinWidget();
              setBusy(false);
              setHint(
                ok
                  ? '已向系统发出添加请求，确认后就会出现在桌面上。'
                  : '当前桌面不支持一键添加，请长按桌面空白处 → 小组件 → 找到「截止日」。',
              );
            }}
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <LayoutGrid className="size-3.5" />}
            添加到桌面
          </Button>
          <Button
            className="shrink-0"
            onClick={async () => {
              setBusy(true);
              const ok = await refreshNativeWidget();
              setBusy(false);
              setHint(ok ? '已刷新桌面上的小组件。' : '刷新失败，请确认小组件已经加到桌面。');
            }}
          >
            立即刷新
          </Button>
        </div>
        {hint && <p className="mt-2 text-[11.5px] leading-relaxed text-neutral-500">{hint}</p>}
      </Card>
    );
  }

  return (
    <Card id="settings-widget">
      <SectionTitle>桌面小组件</SectionTitle>
      <p className="mb-3 text-[12px] leading-relaxed text-neutral-500">
        在你桌面上贴一块悬浮卡片，显示今天的待办（含逾期）和最近一个纪念日倒计时。
        点标题栏可以拖动，点勾直接完成任务，数据与主窗口实时一致。
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          className="shrink-0"
          onClick={async () => {
            const next = await bridge?.open?.();
            setOpen(Boolean(next));
          }}
        >
          <LayoutGrid className="size-3.5" />
          {open ? '重新显示小部件' : '打开小部件'}
        </Button>
        <Button
          className="shrink-0"
          disabled={!open}
          onClick={async () => {
            await bridge?.close?.();
            setOpen(false);
          }}
        >
          关闭小部件
        </Button>
        <Button
          className="shrink-0"
          disabled={!open}
          onClick={async () => {
            const next = await bridge?.setPinned?.(!pinned);
            setPinned(Boolean(next));
          }}
        >
          {pinned ? <Pin className="size-3.5" /> : <PinOff className="size-3.5" />}
          {pinned ? '取消置顶' : '置顶显示'}
        </Button>
      </div>
      <p className="mt-2 text-[11.5px] leading-relaxed text-neutral-400">
        快捷键 <code className="rounded bg-neutral-100 px-1">Ctrl+Shift+D</code> 也能打开；
        小部件不占任务栏，关闭主窗口会一并退出。位置和置顶状态会记住。
      </p>
    </Card>
  );
}
