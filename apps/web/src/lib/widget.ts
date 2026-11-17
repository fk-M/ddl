/**
 * 桌面小组件数据桥。
 *
 * - Windows：小组件是 Electron 的独立窗口，直接加载 ?widget=1，数据实时取，这里只负责开关；
 * - Android：AppWidget 的 RemoteViews 由原生渲染，读不到 WebView 的 IndexedDB，
 *   所以要把「今天要显示的几条」压成 JSON 交给原生存进 SharedPreferences。
 */
import type { Anniversary, Task } from '@ddl/shared';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { formatDue, isOverdue } from './datetime';

type WidgetPlugin = {
  update(options: { payload: string }): Promise<{ ok: boolean }>;
  refresh(): Promise<{ ok: boolean }>;
  requestPin(): Promise<{ requested: boolean }>;
};

type DesktopWidgetBridge = {
  open?: () => Promise<boolean>;
  close?: () => Promise<void>;
  isOpen?: () => Promise<boolean>;
  focusMain?: () => Promise<boolean>;
  setPinned?: (pinned: boolean) => Promise<boolean>;
  getPinned?: () => Promise<boolean>;
};

const DdlWidget = registerPlugin<WidgetPlugin>('DdlWidget');

/** 目前只有 Android 实现了系统级小组件（iOS 要走 WidgetKit，另开工程） */
export function isNativeWidget(): boolean {
  return Capacitor.getPlatform() === 'android';
}

export function desktopWidget(): DesktopWidgetBridge | null {
  const bridge = (window as unknown as { widget?: DesktopWidgetBridge }).widget;
  return bridge ?? null;
}

export type WidgetPayload = {
  title: string;
  count: number;
  items: { t: string; d: string; o: boolean }[];
  footer: string;
  emptyText: string;
};

/** 今日标题：`今天 · 11月17日` */
function todayTitle(): string {
  const now = new Date();
  return `今天 · ${now.getMonth() + 1}月${now.getDate()}日`;
}

/**
 * 组装小组件展示内容。逻辑与 Windows 小部件保持一致：
 * 逾期的排前面，其次按截止时间近的优先；只显示未完成的任务。
 */
export function buildWidgetPayload(tasks: Task[], anniversaries: Anniversary[], limit = 4): WidgetPayload {
  const pending = tasks
    .filter((task) => !task.completedAt)
    .sort((a, b) => {
      const aDue = a.dueAt ? new Date(a.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
      const bDue = b.dueAt ? new Date(b.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
      return aDue - bDue;
    });

  const items = pending.slice(0, limit).map((task) => ({
    t: task.title,
    d: task.dueAt ? formatDue(task.dueAt, task.allDay) : '无截止',
    o: task.dueAt ? isOverdue(task.dueAt, task.allDay) : false,
  }));

  const next = [...anniversaries].sort((a, b) => a.daysUntil - b.daysUntil)[0];
  const footer = next
    ? `${next.title} · ${next.daysUntil === 0 ? '就是今天' : `还有 ${next.daysUntil} 天`}`
    : '';

  return {
    title: todayTitle(),
    count: pending.length,
    items,
    footer,
    emptyText: '今天清空了',
  };
}

/** 把当前快照推给原生小组件；非原生平台或没有小组件时静默跳过 */
export async function syncNativeWidget(tasks: Task[], anniversaries: Anniversary[]): Promise<boolean> {
  if (!isNativeWidget()) return false;
  try {
    const payload = JSON.stringify(buildWidgetPayload(tasks, anniversaries));
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

/** 请求系统把小组件钉到桌面；返回 false 时引导用户长按桌面手动添加 */
export async function requestPinWidget(): Promise<boolean> {
  if (!isNativeWidget()) return false;
  try {
    const result = await DdlWidget.requestPin();
    return Boolean(result.requested);
  } catch {
    return false;
  }
}
