import type { Task } from '@ddl/shared';
import clsx from 'clsx';
import { Check, Clock, Flag, Repeat, Trash2 } from 'lucide-react';
import { formatDue, isOverdue } from '../lib/datetime';
import { describeRrule } from '../lib/recurrence';

const PRIORITY_COLOR: Record<number, string> = {
  3: 'text-red-500',
  2: 'text-amber-500',
  1: 'text-sky-500',
};

type TaskItemProps = {
  task: Task;
  listName?: string;
  busy?: boolean;
  compact?: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onDelete: () => void;
};

export function TaskItem({ task, listName, busy, compact, onToggle, onOpen, onDelete }: TaskItemProps) {
  const completed = task.status === 'completed';
  const overdue = task.dueAt ? isOverdue(task.dueAt, task.allDay) : false;

  return (
    <div
      className={clsx(
        'group flex items-start gap-2.5 rounded-xl transition-colors hover:bg-neutral-100/70',
        compact ? 'px-2 py-1.5' : 'px-3 py-2.5',
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        disabled={busy}
        aria-label={completed ? '标记为未完成' : '标记为已完成'}
        className={clsx(
          'mt-[3px] flex size-[18px] shrink-0 items-center justify-center rounded-full border-2 transition-all',
          completed
            ? 'border-neutral-900 bg-neutral-900 text-white'
            : 'border-neutral-300 hover:border-neutral-500',
          busy && 'opacity-50',
        )}
      >
        {completed && <Check className="size-3" strokeWidth={3} />}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-1.5">
          {task.priority > 0 && (
            <Flag
              className={clsx('mt-[3px] size-3.5 shrink-0', PRIORITY_COLOR[task.priority])}
              fill="currentColor"
              strokeWidth={1}
            />
          )}
          <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
            <p
              className={clsx(
                'break-words',
                compact ? 'text-[13px] leading-5' : 'text-[14px] leading-6',
                completed ? 'text-neutral-400 line-through' : 'text-neutral-800',
              )}
            >
              {task.title}
            </p>
          </button>
        </div>

        {(task.dueAt || listName || task.tags.length > 0 || task.rrule) && (
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]">
            {task.dueAt && (
              <span
                className={clsx(
                  'inline-flex items-center gap-1',
                  overdue && !completed ? 'text-red-600' : 'text-neutral-500',
                )}
              >
                <Clock className="size-3" />
                {formatDue(task.dueAt, task.allDay)}
              </span>
            )}
            {task.rrule && (
              <span className="inline-flex items-center gap-1 text-neutral-500">
                <Repeat className="size-3" />
                {describeRrule(task.rrule)}
              </span>
            )}
            {listName && <span className="text-neutral-400">{listName}</span>}
            {task.tags.map((tag) => (
              <span key={tag} className="rounded bg-neutral-100 px-1.5 py-0.5 text-neutral-500">
                {`#${tag}`}
              </span>
            ))}
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onDelete}
        aria-label="删除任务"
        className="mt-0.5 rounded p-1 text-neutral-300 transition-colors hover:bg-neutral-200/70 hover:text-red-600 focus-visible:opacity-100"
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
  );
}
