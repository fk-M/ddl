import {
  addDays,
  endOfDay,
  format,
  isBefore,
  isToday,
  isTomorrow,
  startOfDay,
  startOfWeek,
} from 'date-fns';
import { zhCN } from 'date-fns/locale';

/**
 * 到期时间展示，按「离今天有多远」分档：
 * - 今天 / 明天
 * - 本周内（周一起算）：周四
 * - 下周：下周四
 * - 再往后：12月3日（跨年补年份）
 * 已过期的日期同样落在对应档位，颜色由 isOverdue 负责。
 */
export function formatDue(iso: string, allDay = false): string {
  const date = new Date(iso);
  const time = allDay ? '' : ` ${format(date, 'HH:mm')}`;
  const now = new Date();

  if (isToday(date)) return `今天${time}`;
  if (isTomorrow(date)) return `明天${time}`;

  const weekStart = startOfWeek(now, { weekStartsOn: 1 });
  const nextWeekStart = addDays(weekStart, 7);
  const weekAfterNextStart = addDays(weekStart, 14);

  if (!isBefore(date, weekStart) && isBefore(date, nextWeekStart)) {
    return `${format(date, 'EEE', { locale: zhCN })}${time}`;
  }
  if (!isBefore(date, nextWeekStart) && isBefore(date, weekAfterNextStart)) {
    return `下${format(date, 'EEE', { locale: zhCN })}${time}`;
  }

  if (date.getFullYear() === now.getFullYear()) return `${format(date, 'M月d日')}${time}`;
  return `${format(date, 'yyyy年M月d日')}${time}`;
}

export function isOverdue(iso: string, allDay = false): boolean {
  const date = new Date(iso);
  if (allDay) return isBefore(date, startOfDay(new Date()));
  return isBefore(date, new Date());
}

export function startOfTodayIso(): string {
  return startOfDay(new Date()).toISOString();
}

export function endOfTodayIso(): string {
  return endOfDay(new Date()).toISOString();
}

export function endOfNextWeekIso(): string {
  return endOfDay(addDays(new Date(), 7)).toISOString();
}

export function formatClock(iso: string): string {
  return format(new Date(iso), 'HH:mm');
}

/** ISO → <input type="datetime-local"> 需要的本地时间字符串 */
export function toLocalInputValue(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return format(date, "yyyy-MM-dd'T'HH:mm");
}

/** <input type="datetime-local"> 的值（本地时区）→ ISO */
export function fromLocalInputValue(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}
