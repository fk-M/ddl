/**
 * 系统通知通道。
 *
 * WebView 里没有 `Notification` API，所以手机端只能走原生插件（DdlNotifyPlugin）：
 * - 立刻弹一条：notify
 * - 把未来的提醒交给 AlarmManager：schedule（App 退到后台/被关掉也能准时提醒）
 * 浏览器与桌面端仍然用 Web Notification（桌面端后续可换系统托盘通知）。
 */
import type { Task } from '@ddl/shared';
import { Capacitor, registerPlugin } from '@capacitor/core';

export type ScheduleItem = { id: number; title: string; body: string; at: number };

type NotifyPlugin = {
  checkPermission(): Promise<{ granted: boolean; exact: boolean }>;
  requestPermission(): Promise<{ granted: boolean }>;
  openSettings(): Promise<void>;
  notify(options: { id?: number; title: string; body?: string; silent?: boolean }): Promise<void>;
  schedule(options: { items: ScheduleItem[] }): Promise<{ scheduled: number; exact: boolean }>;
  cancelAll(): Promise<void>;
};

const DdlNotify = registerPlugin<NotifyPlugin>('DdlNotify');

/** 排期窗口与上限：Android 单个应用最多 500 个闹钟，留足余量 */
const SCHEDULE_WINDOW_MS = 14 * 24 * 60 * 60_000;
const SCHEDULE_LIMIT = 64;

export function isNativeNotify(): boolean {
  return Capacitor.isNativePlatform();
}

/** 简单的字符串散列，保证同一条提醒每次算出的通知 id 一致（重复触发只会覆盖，不会堆叠） */
function hashId(input: string): number {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) | 0;
  }
  return (Math.abs(hash) % 1_000_000) + 1;
}

export async function notifyState(): Promise<{ granted: boolean; exact: boolean; native: boolean }> {
  if (!isNativeNotify()) {
    const supported = typeof Notification !== 'undefined';
    return {
      granted: supported && Notification.permission === 'granted',
      exact: true,
      native: false,
    };
  }
  try {
    const result = await DdlNotify.checkPermission();
    return { granted: result.granted, exact: result.exact, native: true };
  } catch {
    return { granted: false, exact: false, native: true };
  }
}

export async function requestNotifyPermission(): Promise<{ granted: boolean; needsSettings: boolean }> {
  if (!isNativeNotify()) {
    if (typeof Notification === 'undefined') return { granted: false, needsSettings: false };
    const permission = await Notification.requestPermission();
    return { granted: permission === 'granted', needsSettings: permission === 'denied' };
  }
  const result = await DdlNotify.requestPermission();
  return { granted: result.granted, needsSettings: !result.granted };
}

export function openNotifySettings(): Promise<void> {
  if (!isNativeNotify()) return Promise.resolve();
  return DdlNotify.openSettings();
}

export async function postNotification(title: string, body: string, silent = false): Promise<void> {
  if (isNativeNotify()) {
    try {
      await DdlNotify.notify({ id: hashId(`${title}:${body}`), title, body, silent });
    } catch {
      // 通知失败不影响主流程
    }
    return;
  }
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    new Notification(title, { body, silent });
  }
}

export async function showTestNotification(): Promise<void> {
  await postNotification('截止日 · 通知已就绪', '这是一条测试通知，能看到说明权限和渠道都正常。');
}

/** 展开任务上的提醒时间（兼容旧的单字段 remindAt） */
function reminderTimesOf(task: Task): string[] {
  if (task.reminders.length > 0) return task.reminders.map((item) => item.remindAt);
  if (task.remindAt) return [task.remindAt];
  return [];
}

/**
 * 把「未来 14 天内的提醒」整体重排给系统闹钟。
 * 每次任务列表变化后调用即可，插件内部会先取消旧的再排新的。
 */
export async function syncReminderAlarms(tasks: Task[]): Promise<{ scheduled: number } | null> {
  if (!isNativeNotify()) return null;

  const now = Date.now();
  const limit = now + SCHEDULE_WINDOW_MS;
  const items: ScheduleItem[] = [];

  for (const task of tasks) {
    if (task.status !== 'pending') continue;
    for (const remindAt of reminderTimesOf(task)) {
      const at = new Date(remindAt).getTime();
      if (Number.isNaN(at) || at <= now || at > limit) continue;
      items.push({
        id: hashId(`${task.id}:${remindAt}`),
        title: '该做这件事了',
        body: task.title,
        at,
      });
      if (items.length >= SCHEDULE_LIMIT) break;
    }
    if (items.length >= SCHEDULE_LIMIT) break;
  }

  items.sort((left, right) => left.at - right.at);

  try {
    const result = await DdlNotify.schedule({ items });
    return { scheduled: result.scheduled };
  } catch {
    return null;
  }
}

export async function cancelReminderAlarms(): Promise<void> {
  if (!isNativeNotify()) return;
  try {
    await DdlNotify.cancelAll();
  } catch {
    // 忽略
  }
}
