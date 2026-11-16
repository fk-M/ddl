import type { Task, TaskList } from '@ddl/shared';
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import clsx from 'clsx';
import { Check, Clock, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { formatDue, isOverdue } from '../lib/datetime';

type QuadrantKey = 'q1' | 'q2' | 'q3' | 'q4';

type QuadrantDef = {
  key: QuadrantKey;
  title: string;
  hint: string;
  important: boolean;
  urgent: boolean;
  dot: string;
};

const QUADRANTS: QuadrantDef[] = [
  { key: 'q1', title: '重要且紧急', hint: '立刻做', important: true, urgent: true, dot: 'bg-red-500' },
  { key: 'q2', title: '重要不紧急', hint: '安排时间做', important: true, urgent: false, dot: 'bg-blue-500' },
  { key: 'q3', title: '紧急不重要', hint: '尽快处理或委托', important: false, urgent: true, dot: 'bg-amber-500' },
  { key: 'q4', title: '不重要不紧急', hint: '有空再看', important: false, urgent: false, dot: 'bg-neutral-400' },
];

export type QuadrantPatch = { isImportant?: boolean; isUrgent?: boolean };

type MatrixViewProps = {
  tasks: Task[];
  lists: TaskList[];
  loading: boolean;
  error: string | null;
  togglingId: string | null;
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
  onUpdate: (id: string, patch: QuadrantPatch) => void;
  onDelete: (id: string) => void;
};

function FlagChip({
  active,
  tone,
  children,
  onClick,
}: {
  active: boolean;
  tone: 'neutral' | 'red';
  children: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      // 卡片整体可拖动，按钮要拦住起手事件，否则长按会误触发拖拽
      // （触屏只认 touchstart，光拦 pointerdown 在手机上没用）
      onPointerDown={(event) => event.stopPropagation()}
      onTouchStart={(event) => event.stopPropagation()}
      onClick={onClick}
      className={clsx(
        'rounded px-1 py-[1px] text-[9.5px] transition-colors md:px-1.5 md:text-[10.5px]',
        active
          ? tone === 'red'
            ? 'bg-red-500 text-white'
            : 'bg-neutral-800 text-white'
          : 'border border-neutral-200 text-neutral-400 hover:border-neutral-400 hover:text-neutral-600',
      )}
    >
      {children}
    </button>
  );
}

function MatrixCard({
  task,
  listName,
  busy,
  onToggle,
  onOpen,
  onUpdate,
  onDelete,
}: {
  task: Task;
  listName?: string;
  busy: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onUpdate: (patch: QuadrantPatch) => void;
  onDelete: () => void;
}) {
  const overdue = task.dueAt ? isOverdue(task.dueAt, task.allDay) : false;

  return (
    <div className="group flex items-start gap-1.5 rounded-lg px-1.5 py-1.5 transition-colors hover:bg-neutral-50 md:gap-2 md:px-2 md:py-2">
      <button
        type="button"
        onPointerDown={(event) => event.stopPropagation()}
        onTouchStart={(event) => event.stopPropagation()}
        onClick={onToggle}
        disabled={busy}
        aria-label="标记为已完成"
        className={clsx(
          'mt-[2px] flex size-3.5 shrink-0 items-center justify-center rounded-full border-2 transition-colors md:mt-[3px] md:size-4',
          'border-neutral-300 hover:border-neutral-500',
          busy && 'opacity-50',
        )}
      >
        <Check className="size-2 text-transparent md:size-2.5" strokeWidth={3} />
      </button>

      <div className="min-w-0 flex-1">
        <button type="button" onClick={onOpen} className="block w-full text-left">
          <p className="line-clamp-2 text-[12px] leading-4 break-words text-neutral-800 md:line-clamp-none md:text-[13px] md:leading-5">
            {task.title}
          </p>
        </button>
        <div className="mt-0.5 flex flex-wrap items-center gap-1 md:mt-1 md:gap-1.5">
          {task.dueAt && (
            <span
              className={clsx(
                'inline-flex items-center gap-0.5 text-[10px] md:text-[11px]',
                overdue ? 'text-red-600' : 'text-neutral-500',
              )}
            >
              <Clock className="size-2.5" />
              {formatDue(task.dueAt, task.allDay)}
            </span>
          )}
          {listName && (
            <span className="hidden text-[11px] text-neutral-400 md:inline">{listName}</span>
          )}
          <FlagChip
            active={task.isImportant}
            tone="neutral"
            onClick={() => onUpdate({ isImportant: !task.isImportant })}
          >
            重要
          </FlagChip>
          <FlagChip
            active={task.isUrgent}
            tone="red"
            onClick={() => onUpdate({ isUrgent: !task.isUrgent })}
          >
            紧急
          </FlagChip>
        </div>
      </div>

      <button
        type="button"
        onPointerDown={(event) => event.stopPropagation()}
        onTouchStart={(event) => event.stopPropagation()}
        onClick={onDelete}
        aria-label="删除任务"
        // 手机上没有 hover，删除按钮必须常显，否则四象限里删不掉任务
        className="mt-0.5 shrink-0 rounded p-1 text-neutral-300 transition-opacity hover:bg-neutral-200/70 hover:text-red-600 md:opacity-0 md:group-hover:opacity-100"
      >
        <Trash2 className="size-3" />
      </button>
    </div>
  );
}

/** 可拖动卡片：整卡拖动，长按 160ms 才激活，避免和格内滚动抢手势 */
function DraggableCard({
  task,
  listName,
  busy,
  onToggle,
  onOpen,
  onUpdate,
  onDelete,
}: {
  task: Task;
  listName?: string;
  busy: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onUpdate: (patch: QuadrantPatch) => void;
  onDelete: () => void;
}) {
  const { setNodeRef, listeners, isDragging } = useDraggable({ id: task.id, data: { task } });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      className={clsx('cursor-grab active:cursor-grabbing', isDragging && 'opacity-30')}
    >
      <MatrixCard
        task={task}
        listName={listName}
        busy={busy}
        onToggle={onToggle}
        onOpen={onOpen}
        onUpdate={onUpdate}
        onDelete={onDelete}
      />
    </div>
  );
}

function QuadrantSection({
  quadrant,
  count,
  children,
}: {
  quadrant: QuadrantDef;
  count: number;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: quadrant.key,
    data: { quadrant },
  });

  return (
    <section
      ref={setNodeRef}
      className={clsx(
        'flex min-h-0 flex-col overflow-hidden rounded-xl border bg-white transition-colors md:rounded-2xl',
        isOver
          ? 'border-neutral-400 bg-neutral-50/80 ring-2 ring-neutral-900/5'
          : 'border-neutral-200',
      )}
    >
      <header className="flex shrink-0 items-center gap-1.5 border-b border-neutral-100 px-2 py-1.5 md:gap-2 md:px-3.5 md:py-2.5">
        <span className={clsx('size-1.5 shrink-0 rounded-full', quadrant.dot)} />
        <h2 className="truncate text-[12px] font-medium text-neutral-800 md:text-[13px]">
          {quadrant.title}
        </h2>
        <span className="hidden truncate text-[11px] text-neutral-400 md:inline">
          {quadrant.hint}
        </span>
        <span className="ml-auto shrink-0 text-[10.5px] tabular-nums text-neutral-400 md:text-[11px]">
          {count}
        </span>
      </header>

      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto overscroll-contain p-1 md:p-1.5">
        {children}
      </div>
    </section>
  );
}

export function MatrixView({
  tasks,
  lists,
  loading,
  error,
  togglingId,
  onToggle,
  onOpen,
  onUpdate,
  onDelete,
}: MatrixViewProps) {
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const listNameMap = new Map(lists.map((list) => [list.id, list.name]));
  const pending = tasks.filter((task) => task.status === 'pending');

  // 手机必须走 TouchSensor：PointerSensor 在触摸下会被浏览器的滚动判定打断（pointercancel），
  // 表现就是「长按半天拖不动」。桌面用 MouseSensor，按下即拖不需要等待。
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
  );

  // 手指落点优先：落在哪个象限就归哪个；落在间隙时再退回矩形相交
  const collisionDetection: CollisionDetection = (args) => {
    const hits = pointerWithin(args);
    return hits.length > 0 ? hits : rectIntersection(args);
  };

  function handleDragStart(event: DragStartEvent) {
    // 通知侧边栏手势让位：真机长按拖拽时手指常有横向位移，
    // 不通知就会一边拖卡片一边把抽屉推出来
    window.dispatchEvent(new CustomEvent('ddl:dragstart'));
    const task = pending.find((item) => item.id === event.active.id);
    setActiveTask(task ?? null);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveTask(null);
    const overId = event.over?.id;
    if (typeof overId !== 'string') return;
    const target = QUADRANTS.find((quadrant) => quadrant.key === overId);
    if (!target) return;
    const task = pending.find((item) => item.id === event.active.id);
    if (!task) return;
    // 已经在该象限内，无需改动
    if (task.isImportant === target.important && task.isUrgent === target.urgent) return;
    onUpdate(task.id, { isImportant: target.important, isUrgent: target.urgent });
  }

  if (error) {
    return (
      <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-[13px] text-red-700">
        加载失败：{error}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="grid h-full grid-cols-2 grid-rows-2 gap-2 md:gap-3">
        {QUADRANTS.map((quadrant) => (
          <div
            key={quadrant.key}
            className="animate-pulse rounded-xl border border-neutral-200 bg-neutral-50 md:rounded-2xl"
          />
        ))}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <p className="mb-2 shrink-0 text-[11.5px] text-neutral-400 md:mb-3 md:text-[12px]">
        长按任务拖到别的象限即可调整（手机按住约 0.2 秒）；也可以直接点任务上的「重要 / 紧急」标签。
      </p>

      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setActiveTask(null)}
      >
        <div className="grid min-h-0 flex-1 grid-cols-2 grid-rows-2 gap-2 md:gap-3">
          {QUADRANTS.map((quadrant) => {
            const items = pending.filter(
              (task) => task.isImportant === quadrant.important && task.isUrgent === quadrant.urgent,
            );

            return (
              <QuadrantSection key={quadrant.key} quadrant={quadrant} count={items.length}>
                {items.map((task) => (
                  <DraggableCard
                    key={task.id}
                    task={task}
                    listName={listNameMap.get(task.listId)}
                    busy={togglingId === task.id}
                    onToggle={() => onToggle(task.id)}
                    onOpen={() => onOpen(task.id)}
                    onUpdate={(patch) => onUpdate(task.id, patch)}
                    onDelete={() => onDelete(task.id)}
                  />
                ))}

                {items.length === 0 && (
                  <p className="flex h-full min-h-[60px] items-center justify-center px-1 text-center text-[11px] text-neutral-300 md:min-h-[120px] md:text-[12px]">
                    暂无任务
                  </p>
                )}
              </QuadrantSection>
            );
          })}
        </div>

        <DragOverlay dropAnimation={null}>
          {activeTask ? (
            // 手机上单个象限只有半屏宽，浮层必须跟着视口收缩，否则会横着溢出
            <div className="w-[min(220px,68vw)] rotate-1 rounded-lg border border-neutral-200 bg-white shadow-xl md:w-[300px] md:rotate-0">
              <MatrixCard
                task={activeTask}
                listName={listNameMap.get(activeTask.listId)}
                busy={false}
                onToggle={() => {}}
                onOpen={() => {}}
                onUpdate={() => {}}
                onDelete={() => {}}
              />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
