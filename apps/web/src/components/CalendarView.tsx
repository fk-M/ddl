import type { Task, TaskList } from '@ddl/shared';
import clsx from 'clsx';
import {
  addDays,
  addMonths,
  endOfDay,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useCalendarEvents, useLunarCells, useTasks } from '../hooks/useDdl';
import { isOverdue } from '../lib/datetime';


/** 窄屏判断：月视图在手机上要减少每格信息量，否则 7 列根本放不下 */
function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    const handler = (event: MediaQueryListEvent) => setNarrow(event.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return narrow;
}

const WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日'];
const MAX_CHIPS = 3;

type Mode = 'month' | 'week' | 'year' | 'agenda';

const MODE_LABEL: Record<Mode, string> = {
  month: '月',
  week: '周',
  year: '年',
  agenda: '时间轴',
};

type Props = {
  lists: TaskList[];
  onOpen: (id: string) => void;
  showLunar?: boolean;
};

export function CalendarView({ lists, onOpen, showLunar = true }: Props) {
  const [mode, setMode] = useState<Mode>('month');
  // 手机上每格只放 2 条，否则格子放不下会互相挤压
  const narrow = useIsNarrow();
  const maxChips = narrow ? 2 : MAX_CHIPS;
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));

  const range = useMemo(() => {
    if (mode === 'week') {
      return { start: startOfWeek(cursor, { weekStartsOn: 1 }), end: endOfWeek(cursor, { weekStartsOn: 1 }) };
    }
    if (mode === 'year') {
      return { start: startOfMonth(new Date(cursor.getFullYear(), 0, 1)), end: endOfMonth(new Date(cursor.getFullYear(), 11, 1)) };
    }
    if (mode === 'agenda') {
      return { start: startOfDay(new Date()), end: endOfDay(addDays(new Date(), 30)) };
    }
    return {
      start: startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 }),
      end: endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 }),
    };
  }, [mode, cursor]);

  const tasksQuery = useTasks({
    dueFrom: startOfDay(range.start).toISOString(),
    dueTo: endOfDay(range.end).toISOString(),
    limit: 800,
  });

  const eventsQuery = useCalendarEvents(range.start.toISOString(), range.end.toISOString());
  const lunarQuery = useLunarCells(cursor.getFullYear(), cursor.getMonth() + 1, true);
  const lunarMap = useMemo(() => {
    const map = new Map<string, { lunarLabel: string; term: string }>();
    for (const cell of lunarQuery.data?.cells ?? []) {
      map.set(cell.key, { lunarLabel: cell.lunarLabel, term: cell.term });
    }
    return map;
  }, [lunarQuery.data]);

  const listNameMap = useMemo(() => new Map(lists.map((list) => [list.id, list.name])), [lists]);

  const byDay = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const task of tasksQuery.data ?? []) {
      if (!task.dueAt || task.parentId) continue;
      const key = format(new Date(task.dueAt), 'yyyy-MM-dd');
      const bucket = map.get(key) ?? [];
      bucket.push(task);
      map.set(key, bucket);
    }
    return map;
  }, [tasksQuery.data]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, { id: string; title: string; color: string }[]>();
    for (const event of eventsQuery.data ?? []) {
      const key = format(new Date(event.startsAt), 'yyyy-MM-dd');
      const bucket = map.get(key) ?? [];
      bucket.push({ id: event.id, title: event.title, color: event.calendarColor });
      map.set(key, bucket);
    }
    return map;
  }, [eventsQuery.data]);

  function shift(delta: number) {
    if (mode === 'year') setCursor((value) => new Date(value.getFullYear() + delta, value.getMonth(), 1));
    else if (mode === 'week' || mode === 'agenda') setCursor((value) => addDays(value, delta * 7));
    else setCursor((value) => addMonths(value, delta));
  }

  // 手机上左右滑动切换月份（周视图即切周、年视图切年），阈值避免和点击日期冲突
  const swipeRef = useRef<{ x: number; y: number } | null>(null);

  function handlePointerDown(event: ReactPointerEvent) {
    if (event.pointerType === 'mouse') return; // 鼠标拖动容易误触，交给左右箭头
    swipeRef.current = { x: event.clientX, y: event.clientY };
  }

  function handlePointerUp(event: ReactPointerEvent) {
    const start = swipeRef.current;
    swipeRef.current = null;
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    // 横向位移要明显大于纵向，否则用户其实是在上下滚
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    shift(dx < 0 ? 1 : -1);
  }

  const weekDays = useMemo(
    () => eachDayOfInterval({ start: range.start, end: range.end }),
    [range.start, range.end],
  );

  // 月历网格必须由本地日期算出来，农历只是「可选叠加」。
  // 旧实现直接拿 /api/lunar/cells 的 cells 渲染格子：手机离线时该接口失败，
  // 整块日历就只剩星期表头（截图里的空白网格），周/年/时间轴也被连带拖垮。
  const monthCells = useMemo(
    () =>
      weekDays.map((day) => {
        const key = format(day, 'yyyy-MM-dd');
        const lunar = lunarMap.get(key);
        return {
          key,
          day: day.getDate(),
          lunarLabel: lunar?.lunarLabel ?? '',
          term: lunar?.term ?? '',
          festivals: [] as string[],
          isToday: isToday(day),
          inMonth: isSameMonth(day, cursor),
        };
      }),
    [weekDays, lunarMap, cursor],
  );

  return (
    <div
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      // 只接管横向滑动，纵向仍交给页面滚动
      // data-hswipe：告知侧边栏抽屉手势回避这块区域（左右滑动在这里是切月/切周）
      data-hswipe="calendar"
      className="touch-pan-y"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => shift(-1)}
            className="rounded-md p-1.5 text-neutral-500 hover:bg-neutral-100"
            aria-label="上一页"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => shift(1)}
            className="rounded-md p-1.5 text-neutral-500 hover:bg-neutral-100"
            aria-label="下一页"
          >
            <ChevronRight className="size-4" />
          </button>
          <span className="ml-1 text-[14px] font-medium text-neutral-800">
            {mode === 'year'
              ? `${cursor.getFullYear()} 年`
              : mode === 'agenda'
                ? '未来 30 天'
                : `${format(range.start, 'M月d日')} – ${format(range.end, 'M月d日')}`}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <div className="flex rounded-lg border border-neutral-200 p-0.5">
            {(Object.keys(MODE_LABEL) as Mode[]).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setMode(item)}
                className={clsx(
                  'rounded-md px-2 py-1 text-[11.5px] transition-colors',
                  mode === item ? 'bg-neutral-900 text-white' : 'text-neutral-500 hover:bg-neutral-100',
                )}
              >
                {MODE_LABEL[item]}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setCursor(startOfMonth(new Date()))}
            className="rounded-md px-2 py-1 text-[12px] text-neutral-500 hover:bg-neutral-100"
          >
            回到今天
          </button>
        </div>
      </div>

      {/* 月视图 */}
      {mode === 'month' && (
        <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
          <div className="sticky top-0 z-10 grid grid-cols-7 border-b border-neutral-100 bg-neutral-50/90 backdrop-blur-sm">
            {WEEK_LABELS.map((label) => (
              <div key={label} className="py-1 text-center text-[10.5px] text-neutral-400 sm:py-1.5 sm:text-[11px]">
                {label}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7">
            {monthCells.map((cell) => {
              const dayTasks = byDay.get(cell.key) ?? [];
              const dayEvents = eventsByDay.get(cell.key) ?? [];
              return (
                <div
                  key={cell.key}
                  className={clsx(
                    // 平板是触屏且横向有富余：格子更高更好点，桌面回到紧凑高度
                    'min-h-[76px] border-r border-b border-neutral-100 p-0.5 last:border-r-0 sm:min-h-[104px] sm:p-1 md:min-h-[132px] md:p-1.5 xl:min-h-[104px] xl:p-1',
                    cell.inMonth ? 'bg-white' : 'bg-neutral-50/50',
                  )}
                >
                  <div className="mb-0.5 flex items-start justify-between px-0.5">
                    <div className="flex flex-col">
                      <span
                        className={clsx(
                          'inline-flex size-[18px] items-center justify-center rounded-full text-[11px] sm:size-5 sm:text-[11.5px]',
                          cell.isToday
                            ? 'bg-neutral-900 font-medium text-white'
                            : cell.inMonth
                              ? 'text-neutral-600'
                              : 'text-neutral-300',
                        )}
                      >
                        {cell.day}
                      </span>
                      {showLunar &&
                        (cell.term ? (
                          // 节气 / 节日字数短，窄屏也放得下，优先保留
                          <span className="mt-0.5 max-w-[34px] truncate text-[9px] leading-3 text-red-500 sm:max-w-[38px] sm:text-[9.5px]">
                            {cell.term}
                          </span>
                        ) : (
                          // 农历日期在手机宽度下会被截成「九月…」，没有信息量，窄屏隐藏
                          <span className="mt-0.5 hidden max-w-[38px] truncate text-[9.5px] leading-3 text-neutral-400 sm:block">
                            {cell.lunarLabel}
                          </span>
                        ))}
                    </div>
                    {dayTasks.length > 0 && (
                      <span className="text-[10px] text-neutral-300">{dayTasks.length}</span>
                    )}
                  </div>

                  <div className="space-y-0.5">
                    {dayEvents.slice(0, 1).map((event) => (
                      <span
                        key={event.id}
                        className="block truncate rounded px-1 py-0.5 text-[10.5px] leading-4 text-white"
                        style={{ backgroundColor: event.color }}
                        title={event.title}
                      >
                        {event.title}
                      </span>
                    ))}
                    {dayTasks.slice(0, maxChips).map((task) => (
                      <button
                        key={task.id}
                        type="button"
                        onClick={() => onOpen(task.id)}
                        title={task.title}
                        className={clsx(
                          'block w-full truncate rounded px-1 py-0.5 text-left text-[11px] leading-4 transition-colors',
                          task.status === 'completed'
                            ? 'bg-neutral-100 text-neutral-400 line-through'
                            : isOverdue(task.dueAt ?? '', task.allDay)
                              ? 'bg-red-50 text-red-600 hover:bg-red-100'
                              : 'bg-blue-50 text-blue-700 hover:bg-blue-100',
                        )}
                      >
                        {task.title}
                      </button>
                    ))}
                    {dayTasks.length > maxChips && (
                      <p className="truncate px-1 text-[10px] text-neutral-400">
                        +{dayTasks.length - maxChips}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 周视图 */}
      {mode === 'week' && (
        <div className="grid grid-cols-7 gap-1.5">
          {weekDays.map((day) => {
            const key = format(day, 'yyyy-MM-dd');
            const dayTasks = byDay.get(key) ?? [];
            const dayEvents = eventsByDay.get(key) ?? [];
            const lunar = lunarMap.get(key);
            return (
              <div
                key={key}
                className={clsx(
                  'min-h-[240px] rounded-xl border p-1.5',
                  isToday(day) ? 'border-neutral-800 bg-neutral-50' : 'border-neutral-200/80 bg-white',
                )}
              >
                <div className="mb-1.5 text-center">
                  <p className="text-[11px] text-neutral-400">{format(day, 'EEE', { locale: zhCN })}</p>
                  <p className="text-[15px] font-semibold text-neutral-800">{format(day, 'd')}</p>
                  {showLunar && lunar && (
                    <p className="text-[9.5px] text-neutral-400">{lunar.term || lunar.lunarLabel}</p>
                  )}
                </div>
                <div className="space-y-1">
                  {dayEvents.map((event) => (
                    <span
                      key={event.id}
                      className="block truncate rounded px-1 py-0.5 text-[10.5px] text-white"
                      style={{ backgroundColor: event.color }}
                    >
                      {event.title}
                    </span>
                  ))}
                  {dayTasks.map((task) => (
                    <button
                      key={task.id}
                      type="button"
                      onClick={() => onOpen(task.id)}
                      className={clsx(
                        'block w-full truncate rounded px-1 py-0.5 text-left text-[10.5px]',
                        task.status === 'completed'
                          ? 'bg-neutral-100 text-neutral-400 line-through'
                          : 'bg-blue-50 text-blue-700',
                      )}
                    >
                      {task.title}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 年视图 */}
      {mode === 'year' && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 12 }, (_, monthIndex) => {
            const monthStart = new Date(cursor.getFullYear(), monthIndex, 1);
            const daysInMonth = new Date(cursor.getFullYear(), monthIndex + 1, 0).getDate();
            const count = Array.from({ length: daysInMonth }, (_, dayIndex) =>
              format(new Date(cursor.getFullYear(), monthIndex, dayIndex + 1), 'yyyy-MM-dd'),
            ).reduce((sum, key) => sum + (byDay.get(key)?.length ?? 0), 0);

            return (
              <button
                key={monthIndex}
                type="button"
                onClick={() => {
                  setCursor(monthStart);
                  setMode('month');
                }}
                className={clsx(
                  'rounded-xl border p-2.5 text-left transition-colors',
                  isSameMonth(monthStart, new Date()) && cursor.getFullYear() === new Date().getFullYear()
                    ? 'border-neutral-800 bg-neutral-50'
                    : 'border-neutral-200/80 bg-white hover:bg-neutral-50',
                )}
              >
                <p className="text-[12.5px] font-medium text-neutral-800">
                  {format(monthStart, 'M 月', { locale: zhCN })}
                </p>
                <div className="mt-1.5 grid grid-cols-7 gap-px">
                  {Array.from({ length: daysInMonth }, (_, dayIndex) => {
                    const key = format(new Date(cursor.getFullYear(), monthIndex, dayIndex + 1), 'yyyy-MM-dd');
                    const has = (byDay.get(key)?.length ?? 0) > 0;
                    return (
                      <span
                        key={key}
                        className={clsx('aspect-square rounded-[2px]', has ? 'bg-blue-400' : 'bg-neutral-100')}
                      />
                    );
                  })}
                </div>
                <p className="mt-1 text-[10.5px] text-neutral-400">{count} 项</p>
              </button>
            );
          })}
        </div>
      )}

      {/* 时间轴 */}
      {mode === 'agenda' && (
        <div className="space-y-2">
          {weekDays
            .filter((day) => {
              const key = format(day, 'yyyy-MM-dd');
              return (byDay.get(key)?.length ?? 0) > 0 || (eventsByDay.get(key)?.length ?? 0) > 0;
            })
            .map((day) => {
              const key = format(day, 'yyyy-MM-dd');
              const dayTasks = byDay.get(key) ?? [];
              const dayEvents = eventsByDay.get(key) ?? [];
              const lunar = lunarMap.get(key);
              return (
                <div key={key} className="rounded-xl border border-neutral-200/80 bg-white">
                  <div className="flex items-baseline gap-2 border-b border-neutral-100 px-3 py-1.5">
                    <span className="text-[12.5px] font-medium text-neutral-800">
                      {format(day, 'M月d日 EEEE', { locale: zhCN })}
                    </span>
                    {showLunar && lunar && (
                      <span className="text-[11px] text-neutral-400">{lunar.term || lunar.lunarLabel}</span>
                    )}
                    <span className="ml-auto text-[11px] text-neutral-400">
                      {dayTasks.length + dayEvents.length} 项
                    </span>
                  </div>
                  <div className="divide-y divide-neutral-100">
                    {dayEvents.map((event) => (
                      <div key={event.id} className="flex items-center gap-2 px-3 py-2">
                        <span className="size-2 rounded-full" style={{ backgroundColor: event.color }} />
                        <span className="min-w-0 flex-1 truncate text-[12.5px] text-neutral-700">
                          {event.title}
                        </span>
                        <span className="text-[10.5px] text-neutral-400">订阅日程</span>
                      </div>
                    ))}
                    {dayTasks.map((task) => (
                      <button
                        key={task.id}
                        type="button"
                        onClick={() => onOpen(task.id)}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-neutral-50"
                      >
                        <span
                          className={clsx(
                            'size-2 rounded-full',
                            task.status === 'completed'
                              ? 'bg-neutral-300'
                              : isOverdue(task.dueAt ?? '', task.allDay)
                                ? 'bg-red-400'
                                : 'bg-blue-400',
                          )}
                        />
                        <span
                          className={clsx(
                            'min-w-0 flex-1 truncate text-[12.5px]',
                            task.status === 'completed' ? 'text-neutral-400 line-through' : 'text-neutral-700',
                          )}
                        >
                          {task.title}
                        </span>
                        <span className="text-[10.5px] text-neutral-400">
                          {task.dueAt ? format(new Date(task.dueAt), 'HH:mm') : ''}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          <p className="py-4 text-center text-[12px] text-neutral-400">未来 30 天没有排期</p>
        </div>
      )}

      <p className="mt-2 flex flex-wrap gap-3 text-[11px] text-neutral-400">
        <span>共 {tasksQuery.data?.length ?? 0} 项</span>
        {eventsQuery.data && eventsQuery.data.length > 0 && (
          <span>· {eventsQuery.data.length} 个订阅日程</span>
        )}
        <span>· 点击色块可打开任务详情</span>
        {listNameMap.size === 0 && <span>· 先建一个清单再排期更方便</span>}
      </p>
    </div>
  );
}
