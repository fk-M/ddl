import type { Task, TaskList } from '@ddl/shared';
import clsx from 'clsx';
import { Check, GripVertical, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useUpdateList } from '../hooks/useDdl';
import { formatDue, isOverdue } from '../lib/datetime';
import { Button, inputClass } from './ui';

type Props = {
  list: TaskList;
  tasks: Task[];
  onOpen: (id: string) => void;
  onToggle: (id: string) => void;
  onMove: (id: string, columnId: string) => void;
  onCreate: (title: string, columnId: string) => void;
};

export function KanbanView({ list, tasks, onOpen, onToggle, onMove, onCreate }: Props) {
  const updateList = useUpdateList();
  const columns = list.kanbanColumns.length > 0 ? list.kanbanColumns : [{ id: 'todo', name: '待办' }];

  const [dragId, setDragId] = useState<string | null>(null);
  const [overColumn, setOverColumn] = useState<string | null>(null);
  const [addingIn, setAddingIn] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');

  const firstColumnId = columns[0]?.id ?? 'todo';

  const grouped = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const column of columns) map.set(column.id, []);
    for (const task of tasks) {
      if (task.parentId) continue;
      const key = task.columnId && map.has(task.columnId) ? task.columnId : firstColumnId;
      map.get(key)?.push(task);
    }
    return map;
  }, [columns, tasks, firstColumnId]);

  function saveColumns(next: { id: string; name: string }[]) {
    updateList.mutate({ id: list.id, patch: { kanbanColumns: next } });
  }

  function addColumn() {
    const id = `col-${Date.now().toString(36)}`;
    saveColumns([...columns, { id, name: `新分组 ${columns.length + 1}` }]);
  }

  function renameColumn(id: string) {
    const current = columns.find((item) => item.id === id);
    if (!current) return;
    const name = window.prompt('列名称', current.name);
    if (!name) return;
    saveColumns(columns.map((item) => (item.id === id ? { ...item, name } : item)));
  }

  function removeColumn(id: string) {
    if (columns.length <= 1) return;
    if (!window.confirm('删除这一列后，列内任务会回到第一列。继续？')) return;
    const fallback = columns.find((item) => item.id !== id)?.id;
    for (const task of grouped.get(id) ?? []) {
      if (fallback) onMove(task.id, fallback);
    }
    saveColumns(columns.filter((item) => item.id !== id));
  }

  function submitNew(columnId: string) {
    const value = newTitle.trim();
    if (!value) {
      setAddingIn(null);
      return;
    }
    onCreate(value, columnId);
    setNewTitle('');
    setAddingIn(null);
  }

  return (
    <div className="flex h-full gap-3 overflow-x-auto pb-2">
      {columns.map((column) => {
        const items = grouped.get(column.id) ?? [];
        const isOver = overColumn === column.id;
        return (
          <div
            key={column.id}
            onDragOver={(event) => {
              event.preventDefault();
              setOverColumn(column.id);
            }}
            onDragLeave={() => setOverColumn((prev) => (prev === column.id ? null : prev))}
            onDrop={(event) => {
              event.preventDefault();
              setOverColumn(null);
              if (dragId) onMove(dragId, column.id);
              setDragId(null);
            }}
            className={clsx(
              'flex w-[260px] shrink-0 flex-col rounded-xl border bg-neutral-50/70 transition-colors',
              isOver ? 'border-neutral-400 bg-neutral-100' : 'border-neutral-200/80',
            )}
          >
            <div className="flex items-center gap-1.5 px-3 py-2.5">
              <button
                type="button"
                onClick={() => renameColumn(column.id)}
                className="truncate text-[12.5px] font-semibold text-neutral-700 hover:underline"
              >
                {column.name}
              </button>
              <span className="text-[11px] tabular-nums text-neutral-400">{items.length}</span>
              <div className="ml-auto flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => {
                    setAddingIn(column.id);
                    setNewTitle('');
                  }}
                  className="rounded p-1 text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700"
                  aria-label="添加任务"
                >
                  <Plus className="size-3.5" />
                </button>
                {columns.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeColumn(column.id)}
                    className="rounded p-1 text-neutral-300 hover:bg-red-50 hover:text-red-600"
                    aria-label="删除列"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </div>
            </div>

            <div className="min-h-[60px] flex-1 space-y-1.5 overflow-y-auto px-2 pb-2">
              {items.map((task) => {
                const done = task.status === 'completed';
                const overdue = task.dueAt ? isOverdue(task.dueAt, task.allDay) && !done : false;
                return (
                  <div
                    key={task.id}
                    draggable
                    onDragStart={() => setDragId(task.id)}
                    onDragEnd={() => setDragId(null)}
                    className={clsx(
                      'group cursor-grab rounded-lg border border-neutral-200/80 bg-white p-2.5 shadow-sm active:cursor-grabbing',
                      dragId === task.id && 'opacity-50',
                    )}
                  >
                    <div className="flex items-start gap-1.5">
                      <button
                        type="button"
                        onClick={() => onToggle(task.id)}
                        className={clsx(
                          'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border',
                          done ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-300',
                        )}
                        aria-label={done ? '取消完成' : '完成'}
                      >
                        {done && <Check className="size-2.5" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => onOpen(task.id)}
                        className={clsx(
                          'min-w-0 flex-1 text-left text-[12.5px] leading-snug',
                          done ? 'text-neutral-400 line-through' : 'text-neutral-800',
                        )}
                      >
                        {task.title}
                      </button>
                      <GripVertical className="mt-0.5 size-3 shrink-0 text-neutral-300 opacity-0 group-hover:opacity-100" />
                    </div>
                    {(task.dueAt || task.tags.length > 0 || task.estimatePomodoros > 0) && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1">
                        {task.dueAt && (
                          <span
                            className={clsx(
                              'rounded px-1.5 py-0.5 text-[10.5px]',
                              overdue ? 'bg-red-50 text-red-600' : 'bg-neutral-100 text-neutral-500',
                            )}
                          >
                            {formatDue(task.dueAt, task.allDay)}
                          </span>
                        )}
                        {task.estimatePomodoros > 0 && (
                          <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10.5px] text-neutral-500">
                            🍅 {task.actualPomodoros}/{task.estimatePomodoros}
                          </span>
                        )}
                        {task.tags.map((tag) => (
                          <span key={tag} className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10.5px] text-neutral-500">
                            #{tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}

              {addingIn === column.id && (
                <div className="ddl-fade-in">
                  <input
                    autoFocus
                    value={newTitle}
                    onChange={(event) => setNewTitle(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') submitNew(column.id);
                      if (event.key === 'Escape') setAddingIn(null);
                    }}
                    onBlur={() => submitNew(column.id)}
                    placeholder="任务标题，回车创建"
                    className={inputClass}
                  />
                </div>
              )}

              {items.length === 0 && addingIn !== column.id && (
                <p className="px-1 py-3 text-center text-[11.5px] text-neutral-400">拖动任务到这里</p>
              )}
            </div>
          </div>
        );
      })}

      <div className="shrink-0">
        <Button variant="ghost" size="sm" onClick={addColumn} className="mt-1">
          <Plus className="size-3.5" />
          添加列
        </Button>
      </div>
    </div>
  );
}
