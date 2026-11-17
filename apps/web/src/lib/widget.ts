/**
 * 桌面小组件数据桥。
 *
 * - Windows：小组件是 Electron 的独立无边框窗口，加载 ?widget=<kind>，数据实时取；
 * - Android：AppWidget 的 RemoteViews 由原生渲染，读不到 WebView 的 IndexedDB，
 *   所以要把「每种小组件该显示什么」压成 JSON 交给原生存进 SharedPreferences。
 *
 * 两种形态共用同一份 `WIDGET_KINDS` 与同一个 `buildWidgetPayload()`，
 * 保证桌面上看到的顺序、文案、截止时间与主界面完全一致。
 */
import type { Anniversary, Task, TaskList } from '@ddl/shared';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { formatDue, isOverdue } from './datetime';

type WidgetPlugin = {
  update(options: { payload: string }): Promise<{ ok: boolean }>;
  refresh(): Promise<{ ok: boolean }>;
  requestPin(options: { kind: string }): Promise<{ requested: boolean }>;
  /** 取走「用户在桌面上点掉的任务 id」，取完即清 */
  takeCompleted(): Promise<{ ids: string[] }>;
};

type DesktopWidgetBridge = {
  open: (kind?: WidgetKind) => Promise<{ id: string; kind: WidgetKind } | null>;
  close: (id: string) => Promise<void>;
  closeKind: (kind: WidgetKind) => Promise<void>;
  closeAll: () => Promise<void>;
  list: () => Promise<{ id: string; kind: WidgetKind; pinned: boolean }[]>;
  focusMain: () => Promise<boolean>;
  setPinned: (id: string, pinned: boolean) => Promise<boolean>;
  getPinned: (id: string) => Promise<boolean>;
};

const DdlWidget = registerPlugin<WidgetPlugin>('DdlWidget');

/** 目前只有 Android 实现了系统级小组件（iOS 要走 WidgetKit，另开工程） */
export function isNativeWidget(): boolean {
  return Capacitor.getPlatform() === 'android';
}

export function desktopWidget(): DesktopWidgetBridge | null {
  const bridge = (window as unknown as { widget?: Partial<DesktopWidgetBridge> }).widget;
  return bridge && typeof bridge.open === 'function' ? (bridge as DesktopWidgetBridge) : null;
}

/* ============================== 小组件类型 ============================== */

export type WidgetKind = 'quadrant' | 'today' | 'inbox' | 'next7';

export type WidgetKindMeta = {
  id: WidgetKind;
  /** 设置页与菜单里显示的名字 */
  name: string;
  desc: string;
  /** Windows 悬浮窗默认尺寸 */
  width: number;
  height: number;
  /** Android 的 AppWidgetProvider 类名（用于 requestPin 与刷新） */
  androidProvider: string;
};

/**
 * 允许用户选的小组件。四象限看的是「重要性排序」，今天/收件箱/最近 7 天看的是「时间轴」，
 * 三种都能同时放到桌面上（Android 与 Windows 都支持多实例）。
 */
export const WIDGET_KINDS: WidgetKindMeta[] = [
  {
    id: 'quadrant',
    name: '四象限',
    desc: '重要 × 紧急铺成 2×2，一眼看清先做哪个',
    width: 380,
    height: 460,
    androidProvider: 'DdlWidgetProvider',
  },
  {
    id: 'today',
    name: '今天',
    desc: '今天到期 + 已逾期的任务，最常用的那一屏',
    width: 320,
    height: 430,
    androidProvider: 'DdlWidgetToday',
  },
  {
    id: 'inbox',
    name: '收件箱',
    desc: '还没归类到清单里的任务，随手记的东西都在这',
    width: 320,
    height: 430,
    androidProvider: 'DdlWidgetInbox',
  },
  {
    id: 'next7',
    name: '最近 7 天',
    desc: '未来一周要交的东西，提前有个数',
    width: 320,
    height: 460,
    androidProvider: 'DdlWidgetNext7',
  },
];

export function isWidgetKind(value: unknown): value is WidgetKind {
  return typeof value === 'string' && WIDGET_KINDS.some((item) => item.id === value);
}

export function widgetKindMeta(kind: WidgetKind): WidgetKindMeta {
  return WIDGET_KINDS.find((item) => item.id === kind) ?? WIDGET_KINDS[0]!;
}

/* ============================== 四象限 ============================== */

export type QuadrantKey = 'q1' | 'q2' | 'q3' | 'q4';

export type QuadrantMeta = {
  key: QuadrantKey;
  /** 长名，主界面用 */
  title: string;
  /** 短名，小组件里放得下 */
  short: string;
  important: boolean;
  urgent: boolean;
  dot: string;
};

/**
 * 顺序必须是 重要且紧急 → 重要不紧急 → 紧急不重要 → 不重要不紧急，
 * 2×2 网格按行铺，正好落在左上、右上、左下、右下。
 * 与 MatrixView 的分类口径保持一致：只看 isImportant × isUrgent，与 priority 无关。
 */
export const QUADRANT_META: QuadrantMeta[] = [
  { key: 'q1', title: '重要且紧急', short: '重要紧急', important: true, urgent: true, dot: 'bg-rose-500' },
  { key: 'q2', title: '重要不紧急', short: '重要不急', important: true, urgent: false, dot: 'bg-blue-500' },
  { key: 'q3', title: '紧急不重要', short: '紧急不重', important: false, urgent: true, dot: 'bg-amber-500' },
  { key: 'q4', title: '不重要不紧急', short: '都不占', important: false, urgent: false, dot: 'bg-neutral-400' },
];

export type QuadrantCell = QuadrantMeta & { tasks: Task[] };

/** 逾期的排前面，其次按截止时间；没有截止时间的排最后 */
function sortByDue(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const aDue = a.dueAt ? new Date(a.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
    const bDue = b.dueAt ? new Date(b.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
    return aDue - bDue;
  });
}

/** 把未完成任务按四象限分组，空象限也保留（小组件要保持 2×2 的形状） */
export function buildQuadrants(tasks: Task[]): QuadrantCell[] {
  const pending = tasks.filter((task) => !task.completedAt);
  return QUADRANT_META.map((meta) => ({
    ...meta,
    tasks: sortByDue(
      pending.filter((task) => task.isImportant === meta.important && task.isUrgent === meta.urgent),
    ),
  }));
}

/* ============================== 各类型取数 ============================== */

function startOfDay(base: Date): number {
  const date = new Date(base);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function endOfDay(base: Date): number {
  const date = new Date(base);
  date.setHours(23, 59, 59, 999);
  return date.getTime();
}

/** 今天到期的 + 已经逾期的（逾期的不该被藏起来） */
export function buildTodayTasks(tasks: Task[], now = new Date()): Task[] {
  const dayEnd = endOfDay(now);
  return sortByDue(
    tasks.filter((task) => {
      if (task.completedAt || !task.dueAt) return false;
      return new Date(task.dueAt).getTime() <= dayEnd;
    }),
  );
}

/** 未来 days 天（含今天）内到期的 */
export function buildNextDaysTasks(tasks: Task[], days = 7, now = new Date()): Task[] {
  const from = startOfDay(now);
  const deadline = endOfDay(new Date(from + (days - 1) * 86_400_000));
  return sortByDue(
    tasks.filter((task) => {
      if (task.completedAt || !task.dueAt) return false;
      const due = new Date(task.dueAt).getTime();
      return due <= deadline;
    }),
  );
}

/** 收件箱里的任务：没有截止时间的排前面（它们更需要被「处理」） */
export function buildInboxTasks(tasks: Task[], inboxListId: string | null | undefined): Task[] {
  if (!inboxListId) return [];
  const rows = tasks.filter((task) => !task.completedAt && task.listId === inboxListId);
  return [...rows].sort((a, b) => {
    const aDue = a.dueAt ? new Date(a.dueAt).getTime() : 0;
    const bDue = b.dueAt ? new Date(b.dueAt).getTime() : 0;
    return aDue - bDue;
  });
}

/* ============================== Android 载荷 ============================== */

export type WidgetItem = {
  /** 任务 id：桌面上点一下要靠它回传「完成了哪条」 */
  id: string;
  /** 标题 */
  t: string;
  /** 截止时间文案，空串表示没有 */
  d: string;
  /** 是否已逾期（原生据此标红） */
  o: boolean;
};

export type WidgetQuadrant = {
  /** 短标题，例：重要紧急 */
  t: string;
  /** 该象限未完成数量 */
  n: number;
  /** 露出的条目，最多 PER_QUADRANT 条 */
  i: WidgetItem[];
};

export type WidgetKindData = {
  title: string;
  /** 这一块里的任务数 */
  count: number;
  /** 列表型（今天/收件箱/最近7天）用 */
  items: WidgetItem[];
  empty: string;
  /** 四象限专用 */
  quadrants?: WidgetQuadrant[];
};

export type WidgetPayload = {
  generatedAt: string;
  /** 兼容旧版原生：顶层仍是四象限那套字段 */
  title: string;
  total: number;
  quadrants: WidgetQuadrant[];
  footer: string;
  kinds: Record<WidgetKind, WidgetKindData>;
};

const PER_QUADRANT = 3;

/** 今日标题：`今天 · 11月17日` */
function todayTitle(): string {
  const now = new Date();
  return `今天 · ${now.getMonth() + 1}月${now.getDate()}日`;
}

function toItem(task: Task): WidgetItem {
  return {
    id: task.id,
    t: task.title,
    d: task.dueAt ? formatDue(task.dueAt, task.allDay) : '',
    o: task.dueAt ? isOverdue(task.dueAt, task.allDay) : false,
  };
}

export type WidgetContext = {
  /** 收件箱清单 id；离线新建的收件箱也算 */
  inboxListId?: string | null;
  /** 每种列表最多给原生多少条（原生还会按尺寸再裁） */
  limit?: number;
};

export function buildWidgetPayload(
  tasks: Task[],
  anniversaries: Anniversary[],
  context: WidgetContext = {},
): WidgetPayload {
  const limit = context.limit ?? 20;
  const cells = buildQuadrants(tasks);
  const quadrants: WidgetQuadrant[] = cells.map((cell) => ({
    t: cell.short,
    n: cell.tasks.length,
    i: cell.tasks.slice(0, PER_QUADRANT).map(toItem),
  }));

  const todayTasks = buildTodayTasks(tasks);
  const inboxTasks = buildInboxTasks(tasks, context.inboxListId);
  const nextTasks = buildNextDaysTasks(tasks, 7);

  const next = [...anniversaries].sort((a, b) => a.daysUntil - b.daysUntil)[0];
  const footer = next
    ? `${next.title} · ${next.daysUntil === 0 ? '就是今天' : `还有 ${next.daysUntil} 天`}`
    : '';
  const total = cells.reduce((sum, cell) => sum + cell.tasks.length, 0);
  const title = todayTitle();

  return {
    generatedAt: new Date().toISOString(),
    title,
    total,
    quadrants,
    footer,
    kinds: {
      quadrant: { title, count: total, items: [], empty: '没有待办' },
      today: {
        title: '今天',
        count: todayTasks.length,
        items: todayTasks.slice(0, limit).map(toItem),
        empty: '今天没有要交的',
      },
      inbox: {
        title: '收件箱',
        count: inboxTasks.length,
        items: inboxTasks.slice(0, limit).map(toItem),
        empty: '收件箱是空的',
      },
      next7: {
        title: '最近 7 天',
        count: nextTasks.length,
        items: nextTasks.slice(0, limit).map(toItem),
        empty: '这一周都很空',
      },
    },
  };
}

/** 把当前快照推给原生小组件；非 Android 或没有小组件时静默跳过 */
export async function syncNativeWidget(
  tasks: Task[],
  anniversaries: Anniversary[],
  context: WidgetContext = {},
): Promise<boolean> {
  if (!isNativeWidget()) return false;
  try {
    const payload = JSON.stringify(buildWidgetPayload(tasks, anniversaries, context));
    await DdlWidget.update({ payload });
    return true;
  } catch {
    // 小组件是锦上添花，失败不该影响主流程
    return false;
  }
}

export async function refreshNativeWidget(): Promise<boolean> {
  if (!isNativeWidget()) return false;
  try {
    await DdlWidget.refresh();
    return true;
  } catch {
    return false;
  }
}

/** 请求系统把某种小组件钉到桌面；返回 false 时引导用户长按桌面手动添加 */
export async function requestPinWidget(kind: WidgetKind = 'quadrant'): Promise<boolean> {
  if (!isNativeWidget()) return false;
  try {
    const result = await DdlWidget.requestPin({ kind });
    return Boolean(result.requested);
  } catch {
    return false;
  }
}

/**
 * 取走「在桌面上点掉的任务」。
 *
 * 原生侧不能直接改 IndexedDB，所以点一下只是把 id 记进 SharedPreferences 并立刻把
 * 那一条从小组件上藏起来（视觉上当成就完成了）。App 下次启动/回到前台时由这里取走，
 * 真正写成 completed 再推新快照。
 */
export async function takeWidgetCompleted(): Promise<string[]> {
  if (!isNativeWidget()) return [];
  try {
    const result = await DdlWidget.takeCompleted();
    return Array.isArray(result?.ids) ? result.ids : [];
  } catch {
    return [];
  }
}

/** 一份任务清单里有哪些属于收件箱 */
export function findInboxListId(lists: TaskList[] | undefined): string | null {
  if (!lists) return null;
  return lists.find((list) => list.isInbox)?.id ?? null;
}
