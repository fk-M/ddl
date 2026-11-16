import type { AppSettings, Task } from '@ddl/shared';
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { playRemindSound } from '../lib/sound';

export type ReminderNotice = { key: string; title: string; dueAt: string | null; sound?: string | null };

const STORAGE_PREFIX = 'ddl:reminded:';
const CHECK_INTERVAL = 15_000;
/** 只补发最近 10 分钟内的提醒，避免长时间没开应用后一次性弹一堆 */
const GRACE_MS = 10 * 60_000;

type Pending = { key: string; task: Task; remindAt: string; sound: string | null };

/** 展开任务上的所有提醒时间（兼容旧的单字段 remindAt） */
function reminderTimesOf(task: Task): { remindAt: string; sound: string | null }[] {
  if (task.reminders.length > 0) {
    return task.reminders.map((item) => ({ remindAt: item.remindAt, sound: item.sound }));
  }
  if (task.remindAt) return [{ remindAt: task.remindAt, sound: null }];
  return [];
}

/**
 * 到点提醒：每 15 秒比对一次待办任务的提醒时间。
 * 优先走浏览器通知（打包成桌面端后可替换为系统通知），不可用时退化为应用内提示条，并播放提示音。
 */
export function useReminders(settings?: AppSettings) {
  const [notices, setNotices] = useState<ReminderNotice[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const timerRef = useRef<number | null>(null);

  // 独立拉一次待办，避免依赖当前视图的过滤条件
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const data = await api.tasks({ status: 'pending', limit: 300 });
        if (!cancelled) setTasks(data.filter((task) => task.remindAt || task.reminders.length > 0));
      } catch {
        // 提醒是增强能力，拉取失败静默忽略
      }
    }

    void load();
    const id = window.setInterval(load, 3 * 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    function check() {
      const now = Date.now();
      const due: Pending[] = [];

      for (const task of tasks) {
        if (task.status !== 'pending') continue;
        for (const item of reminderTimesOf(task)) {
          const at = new Date(item.remindAt).getTime();
          if (Number.isNaN(at)) continue;
          if (at > now) continue;
          if (now - at > GRACE_MS) continue;
          const key = `${task.id}:${item.remindAt}`;
          if (localStorage.getItem(`${STORAGE_PREFIX}${key}`) !== null) continue;
          localStorage.setItem(`${STORAGE_PREFIX}${key}`, String(now));
          due.push({ key, task, remindAt: item.remindAt, sound: item.sound });
        }
      }

      if (due.length === 0) return;

      setNotices((current) => [
        ...current,
        ...due.map((item) => ({
          key: item.key,
          title: item.task.title,
          dueAt: item.task.dueAt,
          sound: item.sound,
        })),
      ]);

      if (!settings || settings.remindVolume > 0) {
        const sound = due[0]?.sound || settings?.remindSound || 'chimes';
        playRemindSound(sound, settings?.remindVolume ?? 70);
      }

      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        for (const item of due) {
          new Notification('该做这件事了', { body: item.task.title, tag: item.key });
        }
      }
    }

    check();
    timerRef.current = window.setInterval(check, CHECK_INTERVAL);
    return () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
    };
  }, [tasks, settings]);

  function dismiss(key: string) {
    setNotices((current) => current.filter((notice) => notice.key !== key));
  }

  return { notices, dismiss };
}

export function notificationPermission(): NotificationPermission | 'unsupported' {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}

export async function requestNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.requestPermission();
}
