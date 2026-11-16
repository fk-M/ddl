import { BellRing, X } from 'lucide-react';
import type { ReminderNotice } from '../hooks/useReminders';

type ReminderToastsProps = {
  notices: ReminderNotice[];
  onDismiss: (key: string) => void;
};

export function ReminderToasts({ notices, onDismiss }: ReminderToastsProps) {
  if (notices.length === 0) return null;

  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-[320px] flex-col gap-2">
      {notices.slice(-3).map((notice) => (
        <div
          key={notice.key}
          className="ddl-slide-in pointer-events-auto flex items-start gap-2.5 rounded-xl border border-neutral-200 bg-white px-3.5 py-3 shadow-lg"
        >
          <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-amber-50">
            <BellRing className="size-3.5 text-amber-600" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[12px] text-neutral-400">提醒</p>
            <p className="mt-0.5 text-[13px] leading-5 text-neutral-800">{notice.title}</p>
          </div>
          <button
            type="button"
            onClick={() => onDismiss(notice.key)}
            className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
            aria-label="关闭提醒"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
