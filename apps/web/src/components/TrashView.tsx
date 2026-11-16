import { RotateCcw, Trash2 } from 'lucide-react';
import { useDeleteTask, useEmptyTrash, useRestoreTask, useTasks } from '../hooks/useDdl';
import { visibleError } from '../lib/api';
import { formatDue } from '../lib/datetime';
import { Button, EmptyState, ErrorBar } from './ui';

export function TrashView() {
  const tasksQuery = useTasks({ trashed: true, limit: 200 });
  const restore = useRestoreTask();
  const remove = useDeleteTask();
  const emptyTrash = useEmptyTrash();

  const tasks = tasksQuery.data ?? [];
  const error = visibleError(tasksQuery.error, restore.error, remove.error, emptyTrash.error);

  return (
    <div className="mx-auto w-full max-w-3xl md:max-w-4xl xl:max-w-3xl">
      {error && <ErrorBar message={error.message} />}

      <div className="mb-3 flex items-center justify-between">
        <p className="text-[12px] text-neutral-400">删除的任务先进这里，可以恢复或彻底删除</p>
        {tasks.length > 0 && (
          <Button
            variant="danger"
            size="sm"
            onClick={() => {
              if (window.confirm('清空垃圾桶后不可恢复，确定继续？')) emptyTrash.mutate();
            }}
          >
            <Trash2 className="size-3.5" />
            清空垃圾桶
          </Button>
        )}
      </div>

      {tasksQuery.isLoading && <p className="text-[12px] text-neutral-400">加载中…</p>}

      {!tasksQuery.isLoading && tasks.length === 0 && (
        <EmptyState title="垃圾桶很整洁" hint="删除的任务会在这里保留，随时可以恢复" />
      )}

      <ul className="flex flex-col gap-1">
        {tasks.map((task) => (
          <li
            key={task.id}
            className="group flex items-center gap-2 rounded-xl px-3 py-2.5 hover:bg-neutral-100/70"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13.5px] text-neutral-700">{task.title}</p>
              {task.dueAt && (
                <p className="mt-0.5 text-[11.5px] text-neutral-400">{formatDue(task.dueAt, task.allDay)}</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => restore.mutate(task.id)}
              className="rounded p-1.5 text-neutral-400 hover:bg-neutral-200/70 hover:text-neutral-800"
              title="恢复"
            >
              <RotateCcw className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => remove.mutate({ id: task.id, purge: true })}
              className="rounded p-1.5 text-neutral-300 hover:bg-red-50 hover:text-red-600"
              title="彻底删除"
            >
              <Trash2 className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
