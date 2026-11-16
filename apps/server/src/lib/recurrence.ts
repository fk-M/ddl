import { createRequire } from 'node:module';
import { nextLunarMonthly, nextLunarYearly, solarToLunar } from './lunar.js';

// rrule 2.8.1 只有 CJS 入口，Node ESM 无法具名导入，这里显式走 require
const require = createRequire(import.meta.url);
const { RRule } = require('rrule') as typeof import('rrule');

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** 转成 iCalendar 的 UTC 紧凑格式：20261105T070000Z */
function toIcsUtc(date: Date): string {
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

/* ============================================================
 * 规则语法
 * ------------------------------------------------------------
 * 1) 标准 RFC5545 规则体：FREQ=WEEKLY;BYDAY=MO
 * 2) LUNAR:YEARLY;MONTH=8;DAY=15;LEAP=0    农历每年
 * 3) LUNAR:MONTHLY;DAY=1                   农历每月
 * 4) WORKDAY:FIRST / WORKDAY:LAST          每月第一个 / 最后一个工作日
 * 5) WORKDAY:NTH;N=2                       每月第 N 个工作日
 * 6) FORGET:1,2,4,7,15,30                  艾宾浩斯遗忘曲线（相对首次到期日）
 * 7) INTERVAL:DAYS=3                       每 N 天
 * ============================================================ */

export type RuleKind = 'rrule' | 'lunar-yearly' | 'lunar-monthly' | 'workday' | 'forget' | 'interval';

export function ruleKind(rule: string): RuleKind | null {
  const text = rule.trim();
  if (!text) return null;
  if (/^LUNAR:YEARLY/i.test(text)) return 'lunar-yearly';
  if (/^LUNAR:MONTHLY/i.test(text)) return 'lunar-monthly';
  if (/^WORKDAY:/i.test(text)) return 'workday';
  if (/^FORGET:/i.test(text)) return 'forget';
  if (/^INTERVAL:/i.test(text)) return 'interval';
  if (/^(RRULE:)?FREQ=/i.test(text)) return 'rrule';
  return null;
}

function parseParams(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const chunk of body.split(';')) {
    const [key, value] = chunk.split('=');
    if (key && value !== undefined) out[key.trim().toUpperCase()] = value.trim();
  }
  return out;
}

/** 是否工作日（简化：周一至周五） */
export function isWorkday(date: Date): boolean {
  const weekday = date.getDay();
  return weekday !== 0 && weekday !== 6;
}

function nthWorkdayOfMonth(year: number, month1: number, n: number, fromEnd: boolean): Date | null {
  const daysInMonth = new Date(year, month1, 0).getDate();
  const list: Date[] = [];
  for (let day = 1; day <= daysInMonth; day += 1) {
    const cursor = new Date(year, month1 - 1, day);
    if (isWorkday(cursor)) list.push(cursor);
  }
  if (list.length === 0) return null;
  const index = fromEnd ? list.length - n : n - 1;
  return list[index] ?? null;
}

/**
 * 依据规则计算下一次发生的时刻。
 * 约定：标准 RRULE 只存规则体（DTSTART 由 after 提供）。
 */
export function nextOccurrence(rule: string, after: Date): Date | null {
  const text = rule.replace(/^RRULE:/i, '').trim();
  if (!text) return null;

  const kind = ruleKind(rule);
  const target = after instanceof Date ? after : new Date(after);

  try {
    if (kind === 'rrule') {
      const parsed = RRule.fromString(`DTSTART:${toIcsUtc(target)}\nRRULE:${text}`);
      return parsed.after(target, false) ?? null;
    }

    if (kind === 'lunar-yearly') {
      const params = parseParams(text.slice('LUNAR:YEARLY'.length).replace(/^;/, ''));
      const lunar = solarToLunar(target);
      const month = Number(params.MONTH ?? lunar.month);
      const day = Number(params.DAY ?? lunar.day);
      const isLeap = params.LEAP === '1';
      return nextLunarYearly(target, month, day, isLeap);
    }

    if (kind === 'lunar-monthly') {
      const params = parseParams(text.slice('LUNAR:MONTHLY'.length).replace(/^;/, ''));
      const lunar = solarToLunar(target);
      return nextLunarMonthly(target, Number(params.DAY ?? lunar.day));
    }

    if (kind === 'workday') {
      const params = parseParams(text.slice('WORKDAY:'.length).replace(/^;/, ''));
      const head = text.slice('WORKDAY:'.length).split(';')[0] ?? '';
      const mode = head.toUpperCase();
      const n = Number(params.N ?? 1);
      // 从下个月开始找，避免返回早于 after 的日期
      for (let step = 0; step <= 3; step += 1) {
        const cursor = new Date(target.getFullYear(), target.getMonth() + step, 1);
        const found =
          mode === 'LAST'
            ? nthWorkdayOfMonth(cursor.getFullYear(), cursor.getMonth() + 1, 1, true)
            : nthWorkdayOfMonth(cursor.getFullYear(), cursor.getMonth() + 1, n, false);
        if (found && found.getTime() > target.getTime()) return found;
      }
      return null;
    }

    if (kind === 'forget') {
      const days = text
        .slice('FORGET:'.length)
        .split(',')
        .map((item) => Number(item.trim()))
        .filter((item) => Number.isFinite(item) && item > 0);
      for (const gap of days) {
        const candidate = new Date(target.getTime() + gap * 86_400_000);
        if (candidate.getTime() > target.getTime()) return candidate;
      }
      return null;
    }

    if (kind === 'interval') {
      const params = parseParams(text.slice('INTERVAL:'.length).replace(/^;/, ''));
      const days = Number(params.DAYS ?? 1);
      if (!Number.isFinite(days) || days < 1) return null;
      return new Date(target.getTime() + days * 86_400_000);
    }

    return null;
  } catch {
    // 规则非法时返回 null，由调用方决定是否跳过（不应该阻断完成操作）
    return null;
  }
}

/** 规则是否合法，用于创建/更新时的防御性校验 */
export function isValidRrule(rule: string): boolean {
  if (!rule) return false;
  const kind = ruleKind(rule);
  if (!kind) return false;
  if (kind === 'rrule') {
    try {
      RRule.fromString(`DTSTART:20260101T000000Z\nRRULE:${rule.replace(/^RRULE:/i, '').trim()}`);
      return true;
    } catch {
      return false;
    }
  }
  return nextOccurrence(rule, new Date()) !== null;
}

const WEEKDAY_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** 规则的中文描述，用于详情面板与列表角标 */
export function describeRule(rule: string): string {
  if (!rule) return '';
  const text = rule.replace(/^RRULE:/i, '').trim();
  const kind = ruleKind(rule);

  if (kind === 'lunar-yearly') {
    const params = parseParams(text.slice('LUNAR:YEARLY'.length).replace(/^;/, ''));
    return `农历每年 ${params.MONTH ?? '?'} 月 ${params.DAY ?? '?'} 日`;
  }
  if (kind === 'lunar-monthly') {
    const params = parseParams(text.slice('LUNAR:MONTHLY'.length).replace(/^;/, ''));
    return `农历每月 ${params.DAY ?? '?'} 日`;
  }
  if (kind === 'workday') {
    if (/^WORKDAY:LAST/i.test(text)) return '每月最后一个工作日';
    const params = parseParams(text.slice('WORKDAY:'.length).replace(/^;/, ''));
    const n = params.N ?? '1';
    return n === '1' ? '每月第一个工作日' : `每月第 ${n} 个工作日`;
  }
  if (kind === 'forget') return `遗忘曲线 ${text.slice('FORGET:'.length)}`;
  if (kind === 'interval') {
    const params = parseParams(text.slice('INTERVAL:'.length).replace(/^;/, ''));
    return `每 ${params.DAYS ?? 1} 天`;
  }

  if (kind === 'rrule') {
    const params = parseParams(text);
    const interval = Number(params.INTERVAL ?? 1);
    const freq = (params.FREQ ?? '').toUpperCase();
    if (freq === 'DAILY') return interval === 1 ? '每天' : `每 ${interval} 天`;
    if (freq === 'WEEKLY') {
      const byDay = params.BYDAY;
      if (byDay) {
        const names = byDay.split(',').map((code) => {
          const map: Record<string, string> = { MO: '周一', TU: '周二', WE: '周三', TH: '周四', FR: '周五', SA: '周六', SU: '周日' };
          return map[code.trim().toUpperCase()] ?? code;
        });
        return (interval === 1 ? '每周 ' : `每 ${interval} 周 `) + names.join('、');
      }
      return interval === 1 ? '每周' : `每 ${interval} 周`;
    }
    if (freq === 'MONTHLY') {
      const byMonthDay = params.BYMONTHDAY;
      return byMonthDay
        ? (interval === 1 ? '每月 ' : `每 ${interval} 月 `) + `${byMonthDay} 日`
        : interval === 1
          ? '每月'
          : `每 ${interval} 月`;
    }
    if (freq === 'YEARLY') return interval === 1 ? '每年' : `每 ${interval} 年`;
    if (freq === 'HOURLY') return `每 ${interval} 小时`;
  }

  return rule;
}

/** 在 [from, to] 区间内枚举发生时刻，用于日历/看板展示重复任务 */
export function occurrencesBetween(rule: string, anchor: Date, from: Date, to: Date, cap = 200): Date[] {
  const out: Date[] = [];
  let cursor = anchor;
  if (cursor.getTime() < from.getTime()) {
    // 快进到区间起点
    let guard = 0;
    while (cursor.getTime() < from.getTime() && guard < cap * 4) {
      const next = nextOccurrence(rule, cursor);
      if (!next) return out;
      cursor = next;
      guard += 1;
    }
  }
  while (cursor.getTime() <= to.getTime() && out.length < cap) {
    if (cursor.getTime() >= from.getTime()) out.push(cursor);
    const next = nextOccurrence(rule, cursor);
    if (!next) break;
    cursor = next;
  }
  return out;
}

export const weekdayLabel = (date: Date): string => WEEKDAY_CN[date.getDay()] ?? '';
