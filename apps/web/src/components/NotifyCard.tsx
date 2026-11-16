import { BellRing, BellOff, Send, Settings2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import clsx from 'clsx';
import {
  isNativeNotify,
  notifyState,
  openNotifySettings,
  requestNotifyPermission,
  showTestNotification,
} from '../lib/notify';
import { Button, Card, SectionTitle } from './ui';

type State = { granted: boolean; exact: boolean; native: boolean };

/** 系统通知开关：手机端走原生通知渠道，桌面/浏览器走 Web Notification */
export function NotifyCard() {
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const refresh = useCallback(async () => {
    setState(await notifyState());
  }, []);

  useEffect(() => {
    void refresh();
    // 用户去系统设置里开完权限回来，需要重新读一次状态
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh]);

  async function handleEnable() {
    setBusy(true);
    setMessage('');
    try {
      const result = await requestNotifyPermission();
      await refresh();
      if (result.granted) {
        setMessage('已开启，现在可以收到到点提醒了');
      } else if (result.needsSettings) {
        await openNotifySettings();
        setMessage('系统里没有授予通知权限，已在设置页打开「通知」开关后再回来');
      } else {
        setMessage('当前环境不支持系统通知，会继续用应用内提示');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '开启失败');
    } finally {
      setBusy(false);
    }
  }

  async function handleTest() {
    setBusy(true);
    setMessage('');
    try {
      await showTestNotification();
      setMessage('已发送，若没看到请检查系统通知权限');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '发送失败');
    } finally {
      setBusy(false);
    }
  }

  const granted = state?.granted ?? false;

  return (
    <Card id="settings-notify">
      <SectionTitle>系统通知</SectionTitle>

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[13px] text-neutral-800">
            <span
              className={clsx(
                'inline-block size-2 rounded-full',
                granted ? 'bg-emerald-500' : 'bg-amber-500',
              )}
            />
            {granted ? '通知已开启' : '通知未开启'}
          </p>
          <p className="mt-1 text-[11.5px] leading-relaxed text-neutral-400">
            {isNativeNotify()
              ? '开启后，到点的任务提醒会交给系统闹钟推送——退出应用、锁屏也能收到。'
              : '开启后，到点提醒会以浏览器通知的形式弹出；需要应用保持在后台。'}
          </p>
          {state?.native && !state.exact && (
            <p className="mt-1 text-[11.5px] leading-relaxed text-amber-600">
              系统未允许「精确闹钟」，提醒可能延迟几分钟。可在系统设置里为「截止日」放开该权限。
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <Button onClick={handleEnable} disabled={busy || granted}>
            {granted ? <BellRing className="size-3.5" /> : <BellOff className="size-3.5" />}
            {granted ? '已开启' : '开启通知'}
          </Button>
          <button
            type="button"
            onClick={handleTest}
            disabled={busy || !granted}
            className="inline-flex items-center gap-1 text-[11.5px] text-blue-600 hover:underline disabled:text-neutral-300 disabled:no-underline"
          >
            <Send className="size-3" />
            发一条测试通知
          </button>
          {state?.native && (
            <button
              type="button"
              onClick={() => void openNotifySettings()}
              className="inline-flex items-center gap-1 text-[11.5px] text-neutral-400 hover:text-neutral-600"
            >
              <Settings2 className="size-3" />
              系统通知设置
            </button>
          )}
        </div>
      </div>

      {message && <p className="mt-2 text-[11.5px] text-neutral-500">{message}</p>}
    </Card>
  );
}
