import { Lunar, Solar } from 'lunar-typescript';

export type LunarDate = {
  year: number;
  /** 农历月，负数表示闰月 */
  month: number;
  day: number;
  isLeap: boolean;
  label: string;
};

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 阳历 → 农历 */
export function solarToLunar(date: Date): LunarDate {
  const solar = Solar.fromYmd(date.getFullYear(), date.getMonth() + 1, date.getDate());
  const lunar = solar.getLunar();
  const month = lunar.getMonth(); // 闰月为负数
  return {
    year: lunar.getYear(),
    month: Math.abs(month),
    day: lunar.getDay(),
    isLeap: month < 0,
    label: `${lunar.getMonthInChinese()}月${lunar.getDayInChinese()}`,
  };
}

/** 农历 → 阳历；闰月或该日不存在时返回 null */
export function lunarToSolar(year: number, month: number, day: number, isLeap = false): Date | null {
  try {
    const target = isLeap ? -month : month;
    const lunar = Lunar.fromYmd(year, target, day);
    // fromYmd 会自动纠正非法日期，这里反向校验，避免出现「正月三十」这种不存在的日子
    if (lunar.getMonth() !== target || lunar.getDay() !== day) return null;
    const solar = lunar.getSolar();
    return new Date(solar.getYear(), solar.getMonth() - 1, solar.getDay());
  } catch {
    return null;
  }
}

/** 下一次「农历每年」发生日（严格晚于 after） */
export function nextLunarYearly(after: Date, month: number, day: number, isLeap = false): Date | null {
  const base = solarToLunar(after).year;
  for (let offset = 0; offset <= 3; offset += 1) {
    const candidate = lunarToSolar(base + offset, month, day, isLeap);
    if (!candidate) continue;
    if (candidate.getTime() > after.getTime()) return candidate;
  }
  return null;
}

/** 下一次「农历每月」发生日（严格晚于 after） */
export function nextLunarMonthly(after: Date, day: number): Date | null {
  const cursor = new Date(after.getTime());
  for (let index = 0; index < 40; index += 1) {
    const lunar = solarToLunar(cursor);
    const candidate = lunarToSolar(lunar.year, lunar.month, day, lunar.isLeap);
    if (candidate && candidate.getTime() > after.getTime()) return candidate;
    cursor.setDate(cursor.getDate() + 25);
  }
  return null;
}

/** 节气名（无则为空串） */
export function solarTerm(date: Date): string {
  try {
    const solar = Solar.fromYmd(date.getFullYear(), date.getMonth() + 1, date.getDate());
    return solar.getLunar().getJieQi();
  } catch {
    return '';
  }
}

/** 公历 / 农历节日名 */
export function festivalsOf(date: Date): string[] {
  try {
    const solar = Solar.fromYmd(date.getFullYear(), date.getMonth() + 1, date.getDate());
    const lunar = solar.getLunar();
    return [...new Set([...solar.getFestivals(), ...lunar.getFestivals()])];
  } catch {
    return [];
  }
}

export type DayCell = {
  /** YYYY-MM-DD */
  key: string;
  /** 公历日 */
  day: number;
  /** 农历短标签，如「初七」或节日名 */
  lunarLabel: string;
  /** 是否节气 / 节日 */
  term: string;
  festivals: string[];
  isToday: boolean;
  inMonth: boolean;
};

/** 生成某月的日历单元格（含上下补白），周一为首日 */
export function buildMonthCells(year: number, month: number, weekStartsMonday = true): DayCell[] {
  const first = new Date(year, month - 1, 1);
  const daysInMonth = new Date(year, month, 0).getDate();
  const todayKey = toDateKey(new Date());

  const firstWeekday = first.getDay(); // 0=周日
  const offset = weekStartsMonday ? (firstWeekday + 6) % 7 : firstWeekday;

  const cells: DayCell[] = [];
  const start = new Date(year, month - 1, 1 - offset);

  for (let index = 0; index < 42; index += 1) {
    const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
    const key = toDateKey(cursor);
    const lunar = solarToLunar(cursor);
    const term = solarTerm(cursor);
    const festivals = festivalsOf(cursor);
    cells.push({
      key,
      day: cursor.getDate(),
      lunarLabel: lunar.label,
      term: term || (festivals[0] ?? ''),
      festivals,
      isToday: key === todayKey,
      inMonth: cursor.getMonth() === month - 1,
    });
    if (index >= 34 && cursor.getDate() >= daysInMonth && cursor.getMonth() === month - 1) break;
  }

  return cells;
}
