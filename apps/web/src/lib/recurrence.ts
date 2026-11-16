export type RepeatPreset = { key: string; label: string; rrule: string | null; group: string };

/** 与滴答清单对齐的重复预设：标准 RRULE + 农历 / 工作日 / 遗忘曲线 / 自定义间隔 */
export const REPEAT_PRESETS: RepeatPreset[] = [
  { key: 'none', label: '不重复', rrule: null, group: '常用' },
  { key: 'daily', label: '每天', rrule: 'FREQ=DAILY', group: '常用' },
  { key: 'weekdays', label: '每个工作日', rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', group: '常用' },
  { key: 'weekly', label: '每周', rrule: 'FREQ=WEEKLY', group: '常用' },
  { key: 'biweekly', label: '每两周', rrule: 'FREQ=WEEKLY;INTERVAL=2', group: '常用' },
  { key: 'monthly', label: '每月', rrule: 'FREQ=MONTHLY', group: '常用' },
  { key: 'yearly', label: '每年', rrule: 'FREQ=YEARLY', group: '常用' },
  { key: 'workday-first', label: '每月第一个工作日', rrule: 'WORKDAY:FIRST', group: '工作日' },
  { key: 'workday-last', label: '每月最后一个工作日', rrule: 'WORKDAY:LAST', group: '工作日' },
  { key: 'workday-2', label: '每月第 2 个工作日', rrule: 'WORKDAY:NTH;N=2', group: '工作日' },
  { key: 'lunar-monthly', label: '农历每月初一', rrule: 'LUNAR:MONTHLY;DAY=1', group: '农历' },
  { key: 'lunar-yearly', label: '农历每年（按当前日期）', rrule: 'LUNAR:YEARLY', group: '农历' },
  { key: 'forget', label: '遗忘曲线复习', rrule: 'FORGET:1,2,4,7,15,30', group: '学习' },
  { key: 'interval-3', label: '每 3 天', rrule: 'INTERVAL:DAYS=3', group: '自定义' },
  { key: 'interval-10', label: '每 10 天', rrule: 'INTERVAL:DAYS=10', group: '自定义' },
];

const WEEKDAY_CN: Record<string, string> = {
  MO: '周一',
  TU: '周二',
  WE: '周三',
  TH: '周四',
  FR: '周五',
  SA: '周六',
  SU: '周日',
};

function parseParams(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const chunk of body.split(';')) {
    const [key, value] = chunk.split('=');
    if (key && value !== undefined) out[key.trim().toUpperCase()] = value.trim();
  }
  return out;
}

/** 规则的中文描述，与服务端 describeRule 保持一致 */
export function describeRrule(rrule: string | null): string | null {
  if (!rrule) return null;
  const preset = REPEAT_PRESETS.find((item) => item.rrule === rrule);
  if (preset) return preset.label;

  const text = rrule.replace(/^RRULE:/i, '').trim();

  if (/^LUNAR:YEARLY/i.test(text)) {
    const params = parseParams(text.slice('LUNAR:YEARLY'.length).replace(/^;/, ''));
    return `农历每年 ${params.MONTH ?? '?'} 月 ${params.DAY ?? '?'} 日`;
  }
  if (/^LUNAR:MONTHLY/i.test(text)) {
    const params = parseParams(text.slice('LUNAR:MONTHLY'.length).replace(/^;/, ''));
    return `农历每月 ${params.DAY ?? '?'} 日`;
  }
  if (/^WORKDAY:/i.test(text)) {
    if (/^WORKDAY:LAST/i.test(text)) return '每月最后一个工作日';
    const params = parseParams(text.slice('WORKDAY:'.length).replace(/^;/, ''));
    const n = params.N ?? '1';
    return n === '1' ? '每月第一个工作日' : `每月第 ${n} 个工作日`;
  }
  if (/^FORGET:/i.test(text)) return `遗忘曲线 ${text.slice('FORGET:'.length)}`;
  if (/^INTERVAL:/i.test(text)) {
    const params = parseParams(text.slice('INTERVAL:'.length).replace(/^;/, ''));
    return `每 ${params.DAYS ?? 1} 天`;
  }

  const params = parseParams(text);
  const interval = Number(params.INTERVAL ?? 1);
  const freq = (params.FREQ ?? '').toUpperCase();

  if (freq === 'DAILY') return interval === 1 ? '每天' : `每 ${interval} 天`;
  if (freq === 'WEEKLY') {
    const byDay = params.BYDAY;
    if (byDay) {
      const names = byDay.split(',').map((code) => WEEKDAY_CN[code.trim().toUpperCase()] ?? code);
      return `${interval === 1 ? '每周' : `每 ${interval} 周`} ${names.join('、')}`;
    }
    return interval === 1 ? '每周' : `每 ${interval} 周`;
  }
  if (freq === 'MONTHLY') {
    const byMonthDay = params.BYMONTHDAY;
    return byMonthDay
      ? `${interval === 1 ? '每月' : `每 ${interval} 月`} ${byMonthDay} 日`
      : interval === 1
        ? '每月'
        : `每 ${interval} 月`;
  }
  if (freq === 'YEARLY') return interval === 1 ? '每年' : `每 ${interval} 年`;

  return '自定义重复';
}

/** 根据 rrule 反查预设 key，用于详情面板回显 */
export function presetKeyOf(rrule: string | null): string {
  if (!rrule) return 'none';
  const preset = REPEAT_PRESETS.find((item) => item.rrule === rrule);
  if (preset) return preset.key;
  if (/^LUNAR:YEARLY/i.test(rrule)) return 'lunar-yearly';
  if (/^LUNAR:MONTHLY/i.test(rrule)) return 'lunar-monthly';
  if (/^FORGET:/i.test(rrule)) return 'forget';
  if (/^INTERVAL:/i.test(rrule)) return 'interval-3';
  if (/^WORKDAY:/i.test(rrule)) return 'workday-first';
  return 'custom';
}

export const REPEAT_GROUPS = ['常用', '工作日', '农历', '学习', '自定义'] as const;
