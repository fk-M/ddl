import {
  CalendarDays,
  Gift,
  Hash,
  Inbox,
  Layers,
  LayoutGrid,
  Rss,
  Settings,
  Sun,
  Target,
  Timer,
  Trash2,
} from 'lucide-react';

/** 主导航：日常视图 */
export const NAV_ITEMS = [
  { key: 'inbox', label: '收件箱', icon: Inbox },
  { key: 'today', label: '今天', icon: Sun },
  { key: 'next7', label: '最近 7 天', icon: CalendarDays },
  { key: 'calendar', label: '日历', icon: CalendarDays },
  { key: 'matrix', label: '四象限', icon: LayoutGrid },
  { key: 'all', label: '全部任务', icon: Layers },
] as const;

/** 工具导航：独立功能页 */
export const TOOL_ITEMS = [
  { key: 'focus', label: '番茄专注', icon: Timer },
  { key: 'habits', label: '习惯打卡', icon: Target },
  { key: 'anniversaries', label: '倒数纪念日', icon: Gift },
  { key: 'tags', label: '标签与过滤器', icon: Hash },
  { key: 'trash', label: '垃圾桶', icon: Trash2 },
  { key: 'sources', label: '信息源', icon: Rss },
  { key: 'settings', label: '设置', icon: Settings },
] as const;

export type NavItem = (typeof NAV_ITEMS)[number] | (typeof TOOL_ITEMS)[number];

/** 顺序编辑面板用的完整清单（主导航在前，工具在后） */
export const ALL_NAV_ITEMS: NavItem[] = [...NAV_ITEMS, ...TOOL_ITEMS];

const DEFAULT_ORDER: string[] = ALL_NAV_ITEMS.map((item) => item.key);

/**
 * 按保存好的顺序重排导航项。
 * - 空数组 → 使用内置默认顺序
 * - 未出现在顺序里的项（新增功能）排在末尾，保持原有相对次序
 */
export function sortByNavOrder<T extends { key: string }>(items: readonly T[], order: string[]): T[] {
  if (order.length === 0) return [...items];
  const rank = new Map(order.map((key, index) => [key, index]));
  return [...items].sort((a, b) => {
    const left = rank.get(a.key) ?? Number.MAX_SAFE_INTEGER;
    const right = rank.get(b.key) ?? Number.MAX_SAFE_INTEGER;
    if (left === right) return 0;
    return left - right;
  });
}

/** 把用户拖好的顺序补全成「所有导航项」的完整数组，避免新增项丢失 */
export function normalizeNavOrder(order: string[] = []): string[] {
  const seen = new Set(order.filter((key) => DEFAULT_ORDER.includes(key)));
  const rest = DEFAULT_ORDER.filter((key) => !seen.has(key));
  return [...order.filter((key) => seen.has(key)), ...rest];
}

export function navLabelOf(key: string): string {
  return ALL_NAV_ITEMS.find((item) => item.key === key)?.label ?? key;
}

export function navIconOf(key: string) {
  return ALL_NAV_ITEMS.find((item) => item.key === key)?.icon;
}
