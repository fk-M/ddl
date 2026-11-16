import type { ListGroup, SmartList, Tag, TaskList } from '@ddl/shared';
import clsx from 'clsx';
import { eachDayOfInterval, endOfWeek, format, isSameMonth, isToday, startOfWeek } from 'date-fns';
import {
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Filter,
  Gift,
  Hash,
  Inbox,
  Layers,
  LayoutGrid,
  Pencil,
  Plus,
  Rss,
  Settings,
  Sun,
  Target,
  Timer,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useCandidates, useHabitsToday, useLunarCells } from '../hooks/useDdl';
import { NAV_ITEMS, TOOL_ITEMS, sortByNavOrder } from '../lib/nav';
import { isLocalFirst } from '../lib/server-url';

// 兼容既有引用（CommandPalette 从这里取），实际定义在 lib/nav.ts
export { NAV_ITEMS, TOOL_ITEMS };

type Props = {
  lists: TaskList[];
  groups: ListGroup[];
  smartLists: SmartList[];
  tags: (Tag & { taskCount: number })[];
  view: string;
  onSelect: (view: string) => void;
  counts: Record<string, number>;
  onCreateList: (name: string, groupId?: string | null) => void;
  onCreateGroup: (name: string) => void;
  onUpdateGroup: (id: string, name: string) => void;
  onDeleteGroup: (id: string) => void;
  onUpdateList: (id: string, name: string) => void;
  onDeleteList: (id: string) => void;
  showMiniCalendar?: boolean;
  /** 用户自定义的导航顺序（设置页拖拽排序后保存） */
  navOrder?: string[];
  /** 移动端抽屉是否展开；桌面端始终常驻，忽略该值 */
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
  onOpenMobile?: () => void;
};

export function MiniCalendar({ onOpenCalendar }: { onOpenCalendar: () => void }) {
  const today = new Date();
  const [cursor, setCursor] = useState({ year: today.getFullYear(), month: today.getMonth() + 1 });
  const cellsQuery = useLunarCells(cursor.year, cursor.month, true);
  const lunarMap = useMemo(() => {
    const map = new Map<string, { lunarLabel: string; term: string }>();
    for (const cell of cellsQuery.data?.cells ?? []) {
      map.set(cell.key, { lunarLabel: cell.lunarLabel, term: cell.term });
    }
    return map;
  }, [cellsQuery.data]);

  // 迷你日历同样不能依赖服务端返回格子：离线时要照样画出完整日期网格，
  // 农历只作为可选 tooltip，接口不可达时降级为空文案即可。
  const cells = useMemo(() => {
    const first = new Date(cursor.year, cursor.month - 1, 1);
    const last = new Date(cursor.year, cursor.month, 0);
    return eachDayOfInterval({
      start: startOfWeek(first, { weekStartsOn: 1 }),
      end: endOfWeek(last, { weekStartsOn: 1 }),
    }).map((day) => {
      const key = format(day, 'yyyy-MM-dd');
      const lunar = lunarMap.get(key);
      return {
        key,
        day: day.getDate(),
        inMonth: isSameMonth(day, first),
        isToday: isToday(day),
        lunarLabel: lunar?.lunarLabel ?? '',
        term: lunar?.term ?? '',
      };
    });
  }, [cursor.year, cursor.month, lunarMap]);
  const todayKey = format(today, 'yyyy-MM-dd');

  function shift(delta: number) {
    const next = new Date(cursor.year, cursor.month - 1 + delta, 1);
    setCursor({ year: next.getFullYear(), month: next.getMonth() + 1 });
  }

  return (
    <div className="px-3 pb-2">
      <div className="mb-1 flex items-center justify-between px-2">
        <button
          type="button"
          onClick={() => shift(-1)}
          className="rounded p-0.5 text-neutral-400 hover:bg-neutral-200/60 hover:text-neutral-700"
          aria-label="上个月"
        >
          <ChevronRight className="size-3 rotate-180" />
        </button>
        <button
          type="button"
          onClick={onOpenCalendar}
          className="text-[11.5px] font-medium text-neutral-600 hover:underline"
        >
          {cursor.year} 年 {cursor.month} 月
        </button>
        <button
          type="button"
          onClick={() => shift(1)}
          className="rounded p-0.5 text-neutral-400 hover:bg-neutral-200/60 hover:text-neutral-700"
          aria-label="下个月"
        >
          <ChevronRight className="size-3" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-px text-center">
        {['一', '二', '三', '四', '五', '六', '日'].map((label) => (
          <span key={label} className="py-0.5 text-[9.5px] text-neutral-400">
            {label}
          </span>
        ))}
        {cells.map((cell) => (
          <button
            key={cell.key}
            type="button"
            onClick={onOpenCalendar}
            className={clsx(
              'flex h-6 flex-col items-center justify-center rounded text-[10px] transition-colors',
              cell.key === todayKey
                ? 'bg-neutral-900 text-white'
                : cell.inMonth
                  ? 'text-neutral-600 hover:bg-neutral-200/60'
                  : 'text-neutral-300',
            )}
            title={`${cell.key} ${cell.lunarLabel}${cell.term ? ` ${cell.term}` : ''}`}
          >
            {cell.day}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Sidebar({
  lists,
  groups,
  smartLists,
  tags,
  view,
  onSelect,
  counts,
  onCreateList,
  onCreateGroup,
  onUpdateGroup,
  onDeleteGroup,
  onUpdateList,
  onDeleteList,
  showMiniCalendar = true,
  navOrder = [],
  mobileOpen = false,
  onCloseMobile,
  onOpenMobile,
}: Props) {
  const [adding, setAdding] = useState<null | { groupId: string | null }>(null);
  const [name, setName] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const candidatesQuery = useCandidates('pending');
  const habitsToday = useHabitsToday();
  const asideRef = useRef<HTMLElement | null>(null);
  /** 手势过程中的实时位移；null 表示没有进行中的手势，交给 CSS 过渡 */
  const [swipeX, setSwipeX] = useState<number | null>(null);
  const openRef = useRef(mobileOpen);
  openRef.current = mobileOpen;
  const openHandler = useRef(onOpenMobile);
  openHandler.current = onOpenMobile;
  const closeHandler = useRef(onCloseMobile);
  closeHandler.current = onCloseMobile;

  const orderedNav = useMemo(() => sortByNavOrder(NAV_ITEMS, navOrder), [navOrder]);
  const orderedTools = useMemo(() => sortByNavOrder(TOOL_ITEMS, navOrder), [navOrder]);

  // 移动端抽屉手势：屏幕任意位置右滑打开、抽屉内左滑关闭。
  // 触摸端必须走 touch 事件：浏览器一旦把滑动判定成页面滚动就会抛 pointercancel，
  // 只监听 pointer 的手势在真机上会被当场掐断（桌面用鼠标测不出来，所以别轻信模拟测试）。
  useEffect(() => {
    const isPhone = () => window.innerWidth < 768;
    const OPEN_THRESHOLD = 56;
    const CLOSE_RATIO = 0.3;
    const SLOP = 8;

    type Track = { startX: number; startY: number; mode: 'open' | 'close'; claimed: boolean };
    let tracking: Track | null = null;

    const widthOf = () => asideRef.current?.offsetWidth ?? 288;

    /** 起点是否落在横向可滚动容器里（看板、设置页签条等）：那里的左右滑归它们自己 */
    function inHorizontalScroller(start: Element): boolean {
      let node: Element | null = start;
      while (node && node !== document.body) {
        const overflowX = getComputedStyle(node).overflowX;
        if (
          (overflowX === 'auto' || overflowX === 'scroll') &&
          node.scrollWidth - node.clientWidth > 8
        ) {
          return true;
        }
        node = node.parentElement;
      }
      return false;
    }

    function begin(x: number, y: number, target: EventTarget | null) {
      tracking = null;
      if (!isPhone()) return;
      if (!openRef.current) {
        if (!(target instanceof Element)) return;
        // 横向容器与日历（左右滑动切月）先让位，剩下的区域一律可以右滑开抽屉
        if (inHorizontalScroller(target) || target.closest('[data-hswipe="calendar"]')) return;
        // 有浮层/详情面板开着时不开抽屉，否则会叠在面板背后
        if (document.querySelector('[data-sheet]')) return;
        tracking = { startX: x, startY: y, mode: 'open', claimed: false };
        return;
      }
      const aside = asideRef.current;
      if (!aside || !(target instanceof Node) || !aside.contains(target)) return;
      tracking = { startX: x, startY: y, mode: 'close', claimed: false };
    }

    /** 返回 true 表示这次移动已被手势接管（调用方据此决定是否阻止滚动） */
    function move(x: number, y: number): boolean {
      if (!tracking) return false;
      const dx = x - tracking.startX;
      const dy = y - tracking.startY;
      if (!tracking.claimed) {
        if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return false;
        const wrongWay = tracking.mode === 'open' ? dx <= 0 : dx >= 0;
        // 纵向为主或方向相反：放手，让列表滚动 / 让别的横向手势处理
        if (Math.abs(dy) >= Math.abs(dx) || wrongWay) {
          tracking = null;
          setSwipeX(null);
          return false;
        }
        tracking.claimed = true;
      }
      const width = widthOf();
      if (tracking.mode === 'open') setSwipeX(-width + Math.min(dx, width));
      else setSwipeX(Math.max(dx, -width));
      return true;
    }

    function finish(x: number) {
      if (!tracking) return;
      const state = tracking;
      tracking = null;
      setSwipeX(null);
      const width = widthOf();
      const dx = x - state.startX;
      if (state.mode === 'open') {
        if (dx >= Math.min(OPEN_THRESHOLD, width * 0.25)) openHandler.current?.();
      } else if (dx <= -Math.min(OPEN_THRESHOLD, width * CLOSE_RATIO)) {
        closeHandler.current?.();
      }
    }

    const reset = () => {
      tracking = null;
      setSwipeX(null);
    };

    // 全屏起手，如果挂非被动 touchmove，每次触摸都要等我们处理完才敢滚动。
    // 打开抽屉本身不需要阻止滚动（右滑方向页面本来也不许横向滚），所以一律用被动监听。
    const onTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (touch) move(touch.clientX, touch.clientY);
    };

    const detachTouch = () => {
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
      document.removeEventListener('touchcancel', detachTouch);
    };

    const onTouchEnd = (event: TouchEvent) => {
      const touch = event.changedTouches[0];
      detachTouch();
      finish(touch ? touch.clientX : 0);
    };

    const onTouchStart = (event: TouchEvent) => {
      detachTouch();
      if (event.touches.length > 1) {
        reset();
        return;
      }
      const touch = event.touches[0];
      if (!touch) return;
      begin(touch.clientX, touch.clientY, event.target);
      if (!tracking) return;
      document.addEventListener('touchmove', onTouchMove, { passive: true });
      document.addEventListener('touchend', onTouchEnd);
      document.addEventListener('touchcancel', detachTouch);
    };

    // 鼠标/触控板路径：便于桌面缩窄窗口时验证，不处理 touch（上面已接管）
    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      begin(event.clientX, event.clientY, event.target);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      move(event.clientX, event.clientY);
    };
    const onPointerUp = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      finish(event.clientX);
    };

    // 必须用捕获阶段：卡片里的按钮会对 pointerdown/touchstart 做 stopPropagation
    // （防止误起拖拽），挂在冒泡阶段就永远收不到起手事件。
    document.addEventListener('touchstart', onTouchStart, { passive: true, capture: true });
    document.addEventListener('pointerdown', onPointerDown, { passive: true, capture: true });
    document.addEventListener('pointermove', onPointerMove, { passive: true });
    document.addEventListener('pointerup', onPointerUp);
    // 注意：不能监听 pointercancel —— 触摸滚动一开始浏览器就会抛它（触摸与 pointer 并行派发），
    // 一 reset 刚建立的触摸手势就废了。鼠标取消极少见，交给下一次 pointerdown 覆盖即可。
    // 四象限/看板开始拖拽时让位，否则横向拖动会同时推开抽屉
    window.addEventListener('ddl:dragstart', reset);
    return () => {
      detachTouch();
      document.removeEventListener('touchstart', onTouchStart, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('ddl:dragstart', reset);
    };
  }, []);

  const pendingCandidates = candidatesQuery.data?.length ?? 0;
  const habitsDone = habitsToday.data ? `${habitsToday.data.done}/${habitsToday.data.total}` : '';

  const customLists = useMemo(() => lists.filter((list) => !list.isInbox), [lists]);
  const ungrouped = customLists.filter((list) => !list.groupId);

  function submitList(event: FormEvent) {
    event.preventDefault();
    const value = name.trim();
    if (!value || !adding) return;
    onCreateList(value, adding.groupId);
    setName('');
    setAdding(null);
  }

  function toggleSection(key: string) {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function renderList(list: TaskList) {
    const key = `list:${list.id}`;
    const active = view === key;
    const count = counts[list.id] ?? 0;
    return (
      <div
        key={list.id}
        className={clsx(
          'group flex h-10 items-center gap-1 rounded-lg px-2 transition-colors md:h-9 xl:h-8',
          active ? 'bg-neutral-200/80 text-neutral-900' : 'text-neutral-600 hover:bg-neutral-200/50',
        )}
      >
        <button
          type="button"
          onClick={() => onSelect(key)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left text-[13.5px] md:text-[13px]"
        >
          <span
            className="flex size-3.5 shrink-0 items-center justify-center rounded-[3px] text-[8px] text-white"
            style={{ backgroundColor: list.color }}
          >
            {list.kind === 'note' ? 'N' : ''}
          </span>
          <span className="truncate">{list.name}</span>
        </button>
        {count > 0 && <span className="text-[10.5px] tabular-nums text-neutral-400">{count}</span>}
        {!list.isInbox && (
          <>
            <button
              type="button"
              onClick={() => {
                const next = window.prompt('重命名清单', list.name);
                if (next && next.trim() && next.trim() !== list.name) onUpdateList(list.id, next.trim());
              }}
              className="rounded p-1 text-neutral-400 transition-colors hover:text-neutral-700"
              aria-label="重命名清单"
            >
              <Pencil className="size-3" />
            </button>
            <button
              type="button"
              onClick={() => {
                if (window.confirm(`删除清单「${list.name}」？\n其中的所有任务也会一并删除，不可恢复。`))
                  onDeleteList(list.id);
              }}
              className="rounded p-1 text-neutral-400 transition-colors hover:text-red-600"
              aria-label="删除清单"
            >
              <Trash2 className="size-3" />
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <>
      {/* 移动端遮罩：点空白处收起抽屉 */}
      <div
        aria-hidden
        onClick={onCloseMobile}
        className={clsx(
          'fixed inset-0 z-30 bg-black/35 transition-opacity duration-200 md:hidden',
          mobileOpen ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      />

      <aside
        ref={asideRef}
        className={clsx(
          'flex w-72 shrink-0 flex-col border-r border-neutral-200/80 bg-[#fbfbfa]',
          // 移动端：抽屉，默认藏到屏幕左侧
          'fixed inset-y-0 left-0 z-40 transition-transform duration-200 ease-out',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
          // 桌面端：回到常规文档流
          // 平板：常驻但比桌面稍窄/更宽随横竖屏变化，桌面回到固定宽度
          'md:static md:z-auto md:w-56 md:translate-x-0 md:transition-none lg:w-64 xl:w-72',
        )}
        style={{
          paddingTop: 'env(safe-area-inset-top)',
          paddingBottom: 'env(safe-area-inset-bottom)',
          // 手势进行中改用实时位移，松手立刻交还 CSS 过渡。
          // 注意：Tailwind v4 的 translate 工具类用的是 CSS `translate` 属性，
          // 若写 inline `transform` 会与它叠加 → 位移翻倍且方向相反（拉到 -554px）。
          ...(swipeX !== null ? { translate: `${swipeX}px`, transition: 'none' } : null),
        }}
      >
        <div className="flex items-center gap-2 px-5 pt-5 pb-3 md:pt-6 md:pb-4">
          <div
            className="flex size-7 items-center justify-center rounded-lg text-[11px] font-semibold text-white"
            style={{ backgroundColor: 'var(--accent)' }}
          >
            DDL
          </div>
          <span className="text-[15px] font-medium tracking-tight text-neutral-800">截止日</span>
          <button
            type="button"
            onClick={onCloseMobile}
            className="ml-auto rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-200/70 hover:text-neutral-700 md:hidden"
            aria-label="收起菜单"
          >
            <X className="size-4" />
          </button>
        </div>

      <div className="flex-1 overflow-y-auto pb-3">
        <nav className="flex flex-col gap-0.5 px-3">
          {orderedNav.map((item) => {
            const active = view === item.key;
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => onSelect(item.key)}
                className={clsx(
                  'flex h-10 items-center gap-2.5 rounded-lg px-2 text-[13.5px] transition-colors md:h-9 xl:h-8 md:text-[13px]',
                  active ? 'bg-neutral-900 text-white' : 'text-neutral-700 hover:bg-neutral-200/60',
                )}
              >
                <Icon className="size-4" strokeWidth={active ? 2 : 1.8} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* 智能清单 */}
        {smartLists.length > 0 && (
          <>
            <div className="mt-4 flex items-center justify-between px-5 pb-1">
              <span className="text-[10.5px] font-medium tracking-wide text-neutral-400 uppercase">
                智能清单
              </span>
            </div>
            <div className="flex flex-col gap-0.5 px-3">
              {smartLists.map((item) => {
                const key = `smart:${item.id}`;
                const active = view === key;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onSelect(key)}
                    className={clsx(
                      'flex h-10 w-full items-center gap-2 rounded-lg px-2 text-[13.5px] transition-colors md:h-9 xl:h-8 md:text-[13px]',
                      active ? 'bg-neutral-200/80 text-neutral-900' : 'text-neutral-600 hover:bg-neutral-200/50',
                    )}
                  >
                    <Filter className="size-3.5 shrink-0" style={{ color: item.color }} />
                    <span className="truncate">{item.name}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {/* 清单分组 */}
        <div className="mt-4 flex items-center justify-between px-5 pb-1">
          <span className="text-[10.5px] font-medium tracking-wide text-neutral-400 uppercase">清单</span>
          <button
            type="button"
            onClick={() => setAdding({ groupId: null })}
            className="rounded p-0.5 text-neutral-400 transition-colors hover:bg-neutral-200/70 hover:text-neutral-700"
            aria-label="新建清单"
          >
            <Plus className="size-3.5" />
          </button>
        </div>

        <div className="px-3">
          {groups.map((group) => {
            const isCollapsed = collapsed[group.id] ?? false;
            const groupLists = customLists.filter((list) => list.groupId === group.id);
            return (
              <div key={group.id} className="mb-1">
                <div className="group flex items-center gap-1 px-1">
                  <button
                    type="button"
                    onClick={() => toggleSection(group.id)}
                    className="rounded p-0.5 text-neutral-400 hover:text-neutral-700"
                    aria-label={isCollapsed ? '展开' : '折叠'}
                  >
                    {isCollapsed ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
                  </button>
                  <span className="truncate text-[11px] font-medium text-neutral-500">{group.name}</span>
                  <button
                    type="button"
                    onClick={() => {
                      const next = window.prompt('重命名分组', group.name);
                      if (next && next.trim() && next.trim() !== group.name) onUpdateGroup(group.id, next.trim());
                    }}
                    className="ml-auto rounded p-0.5 text-neutral-300 transition-opacity hover:text-neutral-700"
                    aria-label="重命名分组"
                  >
                    <Pencil className="size-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(`删除分组「${group.name}」？\n分组下的清单会移到「未分组」，不会丢失。`))
                        onDeleteGroup(group.id);
                    }}
                    className="rounded p-0.5 text-neutral-300 transition-opacity hover:text-red-600"
                    aria-label="删除分组"
                  >
                    <Trash2 className="size-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setAdding({ groupId: group.id })}
                    className="rounded p-0.5 text-neutral-300 hover:text-neutral-700"
                    aria-label="在此分组新建清单"
                  >
                    <Plus className="size-3" />
                  </button>
                </div>
                {!isCollapsed && groupLists.map(renderList)}
              </div>
            );
          })}

          {ungrouped.map(renderList)}

          {adding && (
            <form onSubmit={submitList} className="ddl-fade-in mt-1 flex items-center gap-1 px-1">
              <input
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                onBlur={() => {
                  if (!name.trim()) setAdding(null);
                }}
                placeholder="清单名称"
                className="h-7 min-w-0 flex-1 rounded-md border border-neutral-300 bg-white px-2 text-[12.5px] outline-none focus:border-neutral-500"
              />
              <button
                type="button"
                onClick={() => {
                  setAdding(null);
                  setName('');
                }}
                className="rounded p-1 text-neutral-400 hover:text-neutral-700"
                aria-label="取消"
              >
                <X className="size-3.5" />
              </button>
            </form>
          )}

          {customLists.length === 0 && !adding && (
            <p className="px-2 pt-1 text-[11.5px] leading-relaxed text-neutral-400">
              还没有清单，点右侧 + 新建
            </p>
          )}

          <button
            type="button"
            onClick={() => {
              const label = window.prompt('新分组名称');
              if (label?.trim()) onCreateGroup(label.trim());
            }}
            className="mt-1 flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-[11.5px] text-neutral-400 hover:bg-neutral-200/40 hover:text-neutral-600"
          >
            <Plus className="size-3" />
            新建分组
          </button>
        </div>

        {/* 标签 */}
        {tags.length > 0 && (
          <>
            <div className="mt-4 flex items-center justify-between px-5 pb-1">
              <span className="text-[10.5px] font-medium tracking-wide text-neutral-400 uppercase">标签</span>
            </div>
            <div className="flex flex-col gap-0.5 px-3">
              {tags.slice(0, 8).map((tag) => {
                const key = `tag:${tag.name}`;
                const active = view === key;
                return (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => onSelect(key)}
                    className={clsx(
                      'flex h-9 w-full items-center gap-2 rounded-lg px-2 text-[12.5px] transition-colors md:h-7',
                      active ? 'bg-neutral-200/80 text-neutral-900' : 'text-neutral-600 hover:bg-neutral-200/50',
                    )}
                  >
                    <Hash className="size-3 shrink-0" style={{ color: tag.color }} />
                    <span className="truncate">{tag.name}</span>
                    {tag.taskCount > 0 && (
                      <span className="ml-auto text-[10px] tabular-nums text-neutral-400">{tag.taskCount}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </>
        )}

        {showMiniCalendar && (
          <div className="mt-3 border-t border-neutral-200/70 pt-2">
            <MiniCalendar onOpenCalendar={() => onSelect('calendar')} />
          </div>
        )}
      </div>

      {/* 工具区 */}
      <div className="border-t border-neutral-200/70 px-3 py-2">
        {orderedTools.map((item) => {
          const active = view === item.key;
          const Icon = item.icon;
          const badge =
            item.key === 'sources' && pendingCandidates > 0
              ? String(pendingCandidates)
              : item.key === 'habits' && habitsDone
                ? habitsDone
                : null;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onSelect(item.key)}
              className={clsx(
                'flex h-10 w-full items-center gap-2.5 rounded-lg px-2 text-[13.5px] transition-colors md:h-9 xl:h-8 md:text-[13px]',
                active ? 'bg-neutral-900 text-white' : 'text-neutral-700 hover:bg-neutral-200/60',
              )}
            >
              <Icon className="size-4" strokeWidth={active ? 2 : 1.8} />
              <span>{item.label}</span>
              {badge && (
                <span
                  className={clsx(
                    'ml-auto rounded-full px-1.5 py-0.5 text-[10px] tabular-nums',
                    active ? 'bg-white/20 text-white' : 'bg-neutral-900 text-white',
                  )}
                >
                  {badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div
        className="border-t border-neutral-200/70 px-5 py-2.5"
        style={{ paddingBottom: 'max(0.625rem, env(safe-area-inset-bottom))' }}
      >
        <p className="text-[10.5px] text-neutral-400">
          {isLocalFirst() ? '本地 IndexedDB · 离线可用，同网自动同步' : '本地 PGlite · 数据留在这台机器'}
        </p>
      </div>
      </aside>
    </>
  );
}
