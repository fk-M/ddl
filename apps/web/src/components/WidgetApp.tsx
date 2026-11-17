import clsx from 'clsx';
import {
  CheckCircle2,
  Clock3,
  Hourglass,
  Loader2,
  Maximize2,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useAnniversaries, useCreateTask, useLists, useTasks, useToggleTask, useUpdateTask } from '../hooks/useDdl';
import { formatDue, isOverdue } from '../lib/datetime';
import {
  buildInboxTasks,
  buildNextDaysTasks,
  buildQuadrants,
  buildTodayTasks,
  findInboxListId,
  isWidgetKind,
  widgetKindMeta,
  type WidgetKind,
} from '../lib/widget';
import type { Task } from '@ddl/shared';

/**
 * Windows 悬浮小部件（Electron 独立无边框窗口）。
 *
 * `?widget=<kind>` 决定显示哪一块：quadrant / today / inbox / next7。
 * `?wid=<id>` 是这一扇窗口的实例 id —— 同一个类型可以同时开好几块，
 * 关闭/置顶都要按实例走，否则会误关别的窗口。
 *
 * 所有类型都能在卡片里直接操作：点圆圈完成、点时钟推到明天，
 * 不用点开主界面。
 */

type DesktopBridge = {
  widget?: {
    close: (id: string) => Promise<void>;
    focusMain: () => Promise<boolean>;
    setPinned: (id: string, pinned: boolean) => Promise<boolean>;
    getPinned: (id: string) => Promise<boolean>;
  };
};

function bridge(): DesktopBridge['widget'] | undefined {
  const value = (window as unknown as DesktopBridge).widget;
  return value && typeof value.getPinned === 'function' ? value : undefined;
}

/** 每个象限最多露出几条，再多就靠「+N」提示去主界面看 */
const PER_QUADRANT = 3;

function readParams(): { kind: WidgetKind; wid: string } {
  let kind: WidgetKind = 'quadrant';
  let wid = '';
  try {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('widget');
    if (isWidgetKind(raw)) kind = raw;
    wid = params.get('wid') ?? '';
  } catch {
    // 取不到就按默认四象限
  }
  return { kind, wid };
}

export function WidgetApp() {
  const { kind, wid } = useMemo(readParams, []);
  const meta = widgetKindMeta(kind);

  const tasksQuery = useTasks(
    useMemo(() => ({ status: 'pending' as const, kind: 'task' as const, limit: 300 }), []),
  );
  const listsQuery = useLists();
  const anniversariesQuery = useAnniversaries();
  const toggle = useToggleTask();
  const updateTask = useUpdateTask();
  const createTask = useCreateTask();

  const [pinned, setPinned] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');

  // 主进程持有真实的置顶状态（重启窗口后要一致），进来先对齐一次
  useEffect(() => {
    if (!wid) return;
    void bridge()
      ?.getPinned(wid)
      .then((value) => setPinned(Boolean(value)));
  }, [wid]);

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

  const tasks = useMemo(() => tasksQuery.data ?? [], [tasksQuery.data]);
  const inboxListId = useMemo(() => findInboxListId(listsQuery.data), [listsQuery.data]);

  const quadrants = useMemo(() => buildQuadrants(tasks), [tasks]);
  const listTasks = useMemo(() => {
    if (kind === 'today') return buildTodayTasks(tasks);
    if (kind === 'inbox') return buildInboxTasks(tasks, inboxListId);
    if (kind === 'next7') return buildNextDaysTasks(tasks, 7);
    return [];
  }, [kind, tasks, inboxListId]);

  const pendingTotal = tasks.filter((task) => !task.completedAt).length;
  const headline = kind === 'quadrant' ? pendingTotal : listTasks.length;

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

  /** 推到明天同一时刻（没有时间的按明晚 23:59），比「删掉重录」省事 */
  async function handleSnooze(task: Task) {
    setBusy(task.id);
    try {
      const base = task.dueAt ? new Date(task.dueAt) : new Date();
      base.setDate(base.getDate() + 1);
      if (!task.dueAt) base.setHours(23, 59, 0, 0);
      await updateTask.mutateAsync({ id: task.id, patch: { dueAt: base.toISOString() } });
    } finally {
      setBusy(null);
    }
  }

  async function handleAdd() {
    const title = draft.trim();
    if (!title) {
      setAdding(false);
      return;
    }
    setBusy('__new__');
    try {
      await createTask.mutateAsync({
        title,
        listId: kind === 'inbox' ? (inboxListId ?? undefined) : undefined,
      });
      setDraft('');
      setAdding(false);
    } finally {
      setBusy(null);
    }
  }

  async function handlePin() {
    if (!wid) return;
    const next = await bridge()?.setPinned(wid, !pinned);
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
            <p className="truncate text-[12px] font-medium text-neutral-800">{meta.name}</p>
            <p className="mt-0.5 truncate text-[11px] text-neutral-400">
              {headline > 0 ? `${headline} 项 · ${todayLabel()}` : `空着 · ${todayLabel()}`}
            </p>
          </div>
          <div
            className="flex shrink-0 items-center gap-0.5"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            <button
              type="button"
              title="新建任务"
              onClick={() => setAdding((value) => !value)}
              className="grid size-6 place-items-center rounded-md text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
            >
              <Plus size={12} />
            </button>
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
              title="关闭这块小部件"
              onClick={() => void bridge()?.close(wid)}
              className="grid size-6 place-items-center rounded-md text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
            >
              <X size={12} />
            </button>
          </div>
        </header>

        {/* 随手加一条，省得为了记一句话去开主界面 */}
        {adding && (
          <div className="flex shrink-0 items-center gap-1.5 border-b border-neutral-100 px-2 py-1.5">
            <input
              autoFocus
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void handleAdd();
                if (event.key === 'Escape') {
                  setDraft('');
                  setAdding(false);
                }
              }}
              placeholder={kind === 'inbox' ? '记到收件箱…' : '记一条…'}
              className="h-6 min-w-0 flex-1 rounded border border-neutral-200 px-1.5 text-[11px] outline-none focus:border-neutral-400"
            />
            <button
              type="button"
              onClick={() => void handleAdd()}
              disabled={busy === '__new__'}
              className="h-6 shrink-0 rounded bg-neutral-900 px-2 text-[11px] text-white disabled:opacity-40"
            >
              {busy === '__new__' ? <Loader2 className="size-3 animate-spin" /> : '添加'}
            </button>
          </div>
        )}

        {tasksQuery.isLoading ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-[12px] text-neutral-400">
            <Loader2 className="size-3.5 animate-spin" />
            加载中…
          </div>
        ) : kind === 'quadrant' ? (
          /* 2×2 四象限 */
          <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-2 gap-1.5 p-1.5">
            {quadrants.map((cell) => (
              <section
                key={cell.key}
                className="flex min-h-0 flex-col rounded-lg border border-neutral-100 bg-neutral-50/60 px-1.5 py-1"
              >
                <div className="flex shrink-0 items-center gap-1">
                  <span className={clsx('size-1.5 shrink-0 rounded-full', cell.dot)} />
                  <p className="min-w-0 flex-1 truncate text-[10.5px] font-medium text-neutral-600">
                    {cell.title}
                  </p>
                  <span className="shrink-0 text-[10px] tabular-nums text-neutral-400">
                    {cell.tasks.length}
                  </span>
                </div>

                <div className="mt-1 min-h-0 flex-1 overflow-hidden">
                  {cell.tasks.length === 0 ? (
                    <div className="grid h-full place-items-center">
                      <span className="text-[10px] text-neutral-300">空了</span>
                    </div>
                  ) : (
                    <ul className="space-y-0.5">
                      {cell.tasks.slice(0, PER_QUADRANT).map((task) => (
                        <TaskRow
                          key={task.id}
                          task={task}
                          busy={busy === task.id}
                          onToggle={() => void handleToggle(task)}
                        />
                      ))}
                      {cell.tasks.length > PER_QUADRANT && (
                        <li className="text-[9.5px] text-neutral-400">
                          +{cell.tasks.length - PER_QUADRANT} 条
                        </li>
                      )}
                    </ul>
                  )}
                </div>
              </section>
            ))}
          </div>
        ) : (
          /* 列表型：今天 / 收件箱 / 最近 7 天 */
          <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5">
            {listTasks.length === 0 ? (
              <div className="grid h-full place-items-center">
                <span className="text-[10.5px] text-neutral-300">
                  {kind === 'today' ? '今天没有要交的' : kind === 'inbox' ? '收件箱是空的' : '这一周都很空'}
                </span>
              </div>
            ) : (
              <ul className="space-y-0.5">
                {listTasks.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    busy={busy === task.id}
                    onToggle={() => void handleToggle(task)}
                    onSnooze={() => void handleSnooze(task)}
                    showQuadrantDot
                  />
                ))}
              </ul>
            )}
          </div>
        )}

        {/* 底部：最近纪念日 + 刷新 */}
        <footer className="flex shrink-0 items-center gap-2 border-t border-neutral-100 px-3 py-1.5">
          {nextAnniversary ? (
            <p className="flex min-w-0 flex-1 items-center gap-1 text-[10.5px] text-neutral-500">
              <Hourglass size={10} className="shrink-0 text-amber-500" />
              <span className="truncate">{nextAnniversary.title}</span>
              <span className="shrink-0 font-medium text-amber-600">
                {nextAnniversary.daysUntil === 0 ? '就是今天' : `还有 ${nextAnniversary.daysUntil} 天`}
              </span>
            </p>
          ) : (
            <p className="min-w-0 flex-1 text-[10.5px] text-neutral-400">还没设置纪念日</p>
          )}
          <button
            type="button"
            title="刷新"
            onClick={() => {
              void tasksQuery.refetch();
              void anniversariesQuery.refetch();
            }}
            className="grid size-5 shrink-0 place-items-center rounded-md text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
          >
            <RefreshCw size={10} className={tasksQuery.isFetching ? 'animate-spin' : undefined} />
          </button>
        </footer>
      </div>
    </div>
  );
}

/** 一行任务：点圆圈完成；列表型还多一个「推到明天」 */
function TaskRow({
  task,
  busy,
  onToggle,
  onSnooze,
  showQuadrantDot = false,
}: {
  task: Task;
  busy: boolean;
  onToggle: () => void;
  onSnooze?: () => void;
  showQuadrantDot?: boolean;
}) {
  const overdue = task.dueAt ? isOverdue(task.dueAt, task.allDay) : false;
  const dot = task.isImportant
    ? task.isUrgent
      ? 'bg-rose-500'
      : 'bg-blue-500'
    : task.isUrgent
      ? 'bg-amber-500'
      : 'bg-neutral-300';

  return (
    <li className="group flex items-start gap-1 rounded px-0.5 py-0.5 hover:bg-neutral-100/80">
      <button
        type="button"
        title="完成"
        onClick={onToggle}
        className="mt-[1px] grid size-3 shrink-0 place-items-center rounded-full border border-neutral-300 text-transparent hover:border-emerald-500 hover:text-emerald-500"
      >
        {busy ? (
          <Loader2 className="size-2 animate-spin text-neutral-400" />
        ) : (
          <CheckCircle2 className="size-2" />
        )}
      </button>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1 text-[10.5px] leading-snug text-neutral-700">
          {showQuadrantDot && <span className={clsx('size-1 shrink-0 rounded-full', dot)} />}
          <span className="truncate">{task.title}</span>
        </p>
        {task.dueAt && (
          <p
            className={clsx(
              'truncate text-[9.5px] leading-tight',
              overdue ? 'text-rose-500' : 'text-neutral-400',
            )}
          >
            {formatDue(task.dueAt, task.allDay)}
          </p>
        )}
      </div>
      {onSnooze && (
        <button
          type="button"
          title="推到明天"
          onClick={onSnooze}
          className="mt-[1px] hidden size-3.5 shrink-0 place-items-center rounded text-neutral-300 hover:text-neutral-600 group-hover:grid"
        >
          <Clock3 size={9} />
        </button>
      )}
    </li>
  );
}

/** 顶部标题：`11月17日 周二` */
function todayLabel(): string {
  const now = new Date();
  const weekday = now.toLocaleDateString('zh-CN', { weekday: 'short' });
  return `${now.getMonth() + 1}月${now.getDate()}日 ${weekday}`;
}
