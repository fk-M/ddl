import { CheckCircle2, Hourglass, Loader2, Maximize2, Pin, PinOff, RefreshCw, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useAnniversaries, useTasks, useToggleTask } from '../hooks/useDdl';
import { endOfTodayIso, formatDue, isOverdue } from '../lib/datetime';
import type { Task } from '@ddl/shared';

/**
 * Windows 悬浮小部件（Electron 独立无边框窗口，?widget=1 加载的就是这一屏）。
 *
 * 只读为主：列出今天（含逾期）最靠前的几条 + 最近一个纪念日倒计时，
 * 点勾可以完成，点「展开」回到主窗口。数据仍走同一个内嵌服务，不需要额外同步。
 */

type DesktopBridge = {
  widget?: {
    close: () => Promise<void>;
    focusMain: () => Promise<void>;
    setPinned: (pinned: boolean) => Promise<boolean>;
    getPinned: () => Promise<boolean>;
  };
};

function bridge(): DesktopBridge['widget'] | undefined {
  return (window as unknown as DesktopBridge).widget;
}

/** 今日待办排序：逾期的靠前，其次按截止时间 */
function todayTasks(tasks: Task[]): Task[] {
  return [...tasks]
    .filter((task) => !task.completedAt)
    .sort((a, b) => {
      const aDue = a.dueAt ? new Date(a.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
      const bDue = b.dueAt ? new Date(b.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
      return aDue - bDue;
    });
}

export function WidgetApp() {
  const todayFilter = useMemo(() => ({ dueTo: endOfTodayIso(), limit: 100 }), []);
  const tasksQuery = useTasks(todayFilter);
  const anniversariesQuery = useAnniversaries();
  const toggle = useToggleTask();

  const [pinned, setPinned] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  // 主进程持有真实的置顶状态（重启窗口后要一致），进来先对齐一次
  useEffect(() => {
    void bridge()
      ?.getPinned()
      .then((value) => setPinned(Boolean(value)));
  }, []);

  // 小部件长期挂着不点，靠定时刷新保证「今天」的边界和新增任务能跟上
  const refetchTasks = tasksQuery.refetch;
  const refetchAnniversaries = anniversariesQuery.refetch;
  useEffect(() => {
    const timer = setInterval(() => {
      void refetchTasks();
      void refetchAnniversaries();
    }, 60_000);
    return () => clearInterval(timer);
  }, [refetchTasks, refetchAnniversaries]);

  const tasks = tasksQuery.data ?? [];
  const pending = todayTasks(tasks).slice(0, 6);
  const all = todayTasks(tasks);

  const nextAnniversary = useMemo(() => {
    const rows = anniversariesQuery.data ?? [];
    return [...rows].sort((a, b) => a.daysUntil - b.daysUntil)[0] ?? null;
  }, [anniversariesQuery.data]);

  async function handleToggle(task: Task) {
    setBusy(task.id);
    try {
      await toggle.mutateAsync(task.id);
    } finally {
      setBusy(null);
    }
  }

  async function handlePin() {
    const next = await bridge()?.setPinned(!pinned);
    setPinned(Boolean(next));
  }

  return (
    <div className="flex h-screen w-screen p-1.5">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-neutral-200/80 bg-white/95 text-neutral-900 shadow-[0_16px_40px_-12px_rgba(15,23,42,0.35)] backdrop-blur">
        {/* 顶部：可拖动区 + 窗口按钮 */}
        <header
          className="flex shrink-0 items-center gap-2 border-b border-neutral-100 px-3 py-2"
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] font-medium text-neutral-800">{todayLabel()}</p>
            <p className="mt-0.5 text-[11px] text-neutral-400">
              {all.length > 0 ? `${all.length} 项待办` : '没有待办，享受一下'}
            </p>
          </div>
        <div className="flex shrink-0 items-center gap-0.5" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <button
            type="button"
            title={pinned ? '取消置顶' : '置顶显示'}
            onClick={() => void handlePin()}
            className="grid size-6 place-items-center rounded-md text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
          >
            {pinned ? <Pin size={12} /> : <PinOff size={12} />}
          </button>
          <button
            type="button"
            title="打开主界面"
            onClick={() => void bridge()?.focusMain()}
            className="grid size-6 place-items-center rounded-md text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
          >
            <Maximize2 size={12} />
          </button>
          <button
            type="button"
            title="收起（点托盘图标可再打开）"
            onClick={() => void bridge()?.close()}
            className="grid size-6 place-items-center rounded-md text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
          >
            <X size={12} />
          </button>
        </div>
      </header>

      {/* 待办列表 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1.5">
        {tasksQuery.isLoading && (
          <div className="flex h-full items-center justify-center gap-2 text-[12px] text-neutral-400">
            <Loader2 className="size-3.5 animate-spin" />
            加载中…
          </div>
        )}

        {!tasksQuery.isLoading && pending.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
            <CheckCircle2 className="size-6 text-emerald-500" />
            <p className="text-[12px] text-neutral-500">今天清空了</p>
          </div>
        )}

        <ul className="space-y-0.5">
          {pending.map((task) => {
            const overdue = task.dueAt ? isOverdue(task.dueAt, task.allDay) : false;
            return (
              <li key={task.id} className="group flex items-start gap-2 rounded-lg px-1.5 py-1.5 hover:bg-neutral-50">
                <button
                  type="button"
                  title="完成"
                  onClick={() => void handleToggle(task)}
                  className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border border-neutral-300 text-transparent hover:border-emerald-500 hover:text-emerald-500"
                >
                  {busy === task.id ? (
                    <Loader2 className="size-3 animate-spin text-neutral-400" />
                  ) : (
                    <CheckCircle2 className="size-3" />
                  )}
                </button>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-[12.5px] leading-snug text-neutral-800">{task.title}</p>
                  <p className={`mt-0.5 text-[10.5px] ${overdue ? 'text-rose-500' : 'text-neutral-400'}`}>
                    {task.dueAt ? formatDue(task.dueAt, task.allDay) : '无截止时间'}
                    {task.priority === 3 && <span className="ml-1 text-rose-500">高</span>}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {/* 底部：最近纪念日 + 刷新 */}
      <footer className="flex shrink-0 items-center gap-2 border-t border-neutral-100 px-3 py-2">
        {nextAnniversary ? (
          <p className="flex min-w-0 flex-1 items-center gap-1 text-[11px] text-neutral-500">
            <Hourglass size={11} className="shrink-0 text-amber-500" />
            <span className="truncate">{nextAnniversary.title}</span>
            <span className="shrink-0 font-medium text-amber-600">
              {nextAnniversary.daysUntil === 0 ? '就是今天' : `还有 ${nextAnniversary.daysUntil} 天`}
            </span>
          </p>
        ) : (
          <p className="min-w-0 flex-1 text-[11px] text-neutral-400">还没设置纪念日</p>
        )}
        <button
          type="button"
          title="刷新"
          onClick={() => {
            void tasksQuery.refetch();
            void anniversariesQuery.refetch();
          }}
          className="grid size-6 shrink-0 place-items-center rounded-md text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
        >
          <RefreshCw size={11} className={tasksQuery.isFetching ? 'animate-spin' : undefined} />
        </button>
      </footer>
      </div>
    </div>
  );
}

/** 顶部标题：`今天 · 11月17日 周二` */
function todayLabel(): string {
  const now = new Date();
  const weekday = now.toLocaleDateString('zh-CN', { weekday: 'short' });
  return `今天 · ${now.getMonth() + 1}月${now.getDate()}日 ${weekday}`;
}
