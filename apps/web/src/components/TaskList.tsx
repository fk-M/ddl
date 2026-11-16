import type { AppSettings, Task, TaskList } from '@ddl/shared';
import { AlertCircle, Archive, ChevronDown, ChevronRight, Inbox, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { TaskItem } from './TaskItem';

type TaskListViewProps = {
  tasks: Task[];
  lists: TaskList[];
  loading: boolean;
  error: string | null;
  emptyTitle: string;
  emptyHint: string;
  togglingId: string | null;
  /** 已完成区的默认展开策略，来自 settings.completedDisplay */
  completedDisplay?: AppSettings['completedDisplay'];
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onDeleteMany?: (ids: string[]) => void;
};

function SkeletonRow() {
  return (
    <div className="flex animate-pulse items-center gap-3 px-3 py-3">
      <div className="size-[18px] rounded-full bg-neutral-200" />
      <div className="h-3.5 flex-1 rounded bg-neutral-200" />
    </div>
  );
}

export function TaskListView({
  tasks,
  lists,
  loading,
  error,
  emptyTitle,
  emptyHint,
  togglingId,
  completedDisplay = 'collapsed',
  onToggle,
  onOpen,
  onDelete,
  onDeleteMany,
}: TaskListViewProps) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  /** 手动展开/收起覆盖设置里的默认策略；切视图或改设置后被 syncOpen 重置 */
  const [completedOverride, setCompletedOverride] = useState<boolean | null>(null);

  const listNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const list of lists) map.set(list.id, list.name);
    return map;
  }, [lists]);

  const childrenMap = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const task of tasks) {
      if (!task.parentId) continue;
      const bucket = map.get(task.parentId) ?? [];
      bucket.push(task);
      map.set(task.parentId, bucket);
    }
    return map;
  }, [tasks]);

  // 顶层任务才进主列表，子任务挂在父任务下面
  const topLevel = tasks.filter((task) => !task.parentId);
  const pending = topLevel.filter((task) => task.status === 'pending');
  const completed = topLevel.filter((task) => task.status === 'completed');

  const completedOpen = completedOverride ?? completedDisplay === 'expanded';

  function toggleExpanded(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearCompleted() {
    if (!onDeleteMany || completed.length === 0) return;
    if (!window.confirm(`把 ${completed.length} 条已完成任务移到垃圾桶？之后仍可从垃圾桶恢复。`)) return;
    setCompletedOverride(null);
    onDeleteMany(completed.map((task) => task.id));
  }

  function renderRow(task: Task) {
    const children = childrenMap.get(task.id) ?? [];
    const open = expanded.has(task.id);

    return (
      <li key={task.id}>
        <TaskItem
          task={task}
          listName={listNameMap.get(task.listId)}
          busy={togglingId === task.id}
          onToggle={() => onToggle(task.id)}
          onOpen={() => onOpen(task.id)}
          onDelete={() => onDelete(task.id)}
        />

        {children.length > 0 && (
          <>
            <button
              type="button"
              onClick={() => toggleExpanded(task.id)}
              className="mb-1 ml-9 flex items-center gap-1 rounded px-1.5 py-0.5 text-[11.5px] text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
            >
              {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
              {children.filter((child) => child.status === 'pending').length} / {children.length} 个子任务
            </button>

            {open && (
              <ul className="mb-1 ml-6 border-l border-neutral-100 pl-1">
                {children.map((child) => (
                  <li key={child.id}>
                    <TaskItem
                      task={child}
                      compact
                      busy={togglingId === child.id}
                      onToggle={() => onToggle(child.id)}
                      onOpen={() => onOpen(child.id)}
                      onDelete={() => onDelete(child.id)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </li>
    );
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-0.5 pt-1">
        <SkeletonRow />
        <SkeletonRow />
        <SkeletonRow />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mt-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-[13px] text-red-700">
        <AlertCircle className="mt-0.5 size-4 shrink-0" />
        <div>
          <p className="font-medium">加载失败</p>
          <p className="mt-0.5 text-red-600/90">{error}</p>
        </div>
      </div>
    );
  }

  if (topLevel.length === 0) {
    return (
      <div className="mt-16 flex flex-col items-center text-center">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-neutral-100">
          <Inbox className="size-5 text-neutral-400" strokeWidth={1.6} />
        </div>
        <p className="mt-3 text-[14px] font-medium text-neutral-700">{emptyTitle}</p>
        <p className="mt-1 max-w-[280px] text-[12.5px] leading-relaxed text-neutral-400">{emptyHint}</p>
      </div>
    );
  }

  return (
    <div className="pt-1">
      <ul className="flex flex-col">{pending.map(renderRow)}</ul>

      {completed.length > 0 && completedDisplay !== 'hidden' && (
        <div className="mt-5">
          <div className="mb-1 flex items-center gap-1 pr-2">
            <button
              type="button"
              onClick={() => setCompletedOverride(!completedOpen)}
              aria-expanded={completedOpen}
              className="flex items-center gap-1 rounded px-3 py-1 text-[11px] font-medium tracking-wide text-neutral-400 uppercase hover:bg-neutral-100 hover:text-neutral-600"
            >
              {completedOpen ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
              已完成 · {completed.length}
            </button>

            <div className="ml-auto flex items-center gap-1">
              <button
                type="button"
                onClick={() => setCompletedOverride(!completedOpen)}
                className="flex items-center gap-1 rounded px-1.5 py-1 text-[11.5px] text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
                title={completedOpen ? '暂时收起已完成' : '展开已完成'}
              >
                <Archive className="size-3" />
                {completedOpen ? '收起' : '展开'}
              </button>
              {onDeleteMany && (
                <button
                  type="button"
                  onClick={clearCompleted}
                  className="flex items-center gap-1 rounded px-1.5 py-1 text-[11.5px] text-neutral-400 hover:bg-red-50 hover:text-red-600"
                  title="把已完成任务移到垃圾桶"
                >
                  <Trash2 className="size-3" />
                  清空
                </button>
              )}
            </div>
          </div>

          {completedOpen && <ul className="flex flex-col">{completed.map(renderRow)}</ul>}
        </div>
      )}
    </div>
  );
}
