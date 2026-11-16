import { formatDue } from '../lib/datetime';
import { parseQuickAdd } from '../lib/nl';
import { CornerDownLeft, Plus, Sparkles, X } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';

type QuickAddProps = {
  placeholder?: string;
  pending: boolean;
  onSubmit: (payload: { title: string; dueAt: string | null }) => void;
};

export function QuickAdd({ placeholder = '添加任务…', pending, onSubmit }: QuickAddProps) {
  const [text, setText] = useState('');
  const [ignoreDue, setIgnoreDue] = useState(false);

  const parsed = useMemo(() => parseQuickAdd(text), [text]);
  const dueAt = ignoreDue ? null : parsed.dueAt;
  const canSubmit = parsed.title.trim().length > 0 && !pending;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    onSubmit({ title: parsed.title.trim(), dueAt });
    setText('');
    setIgnoreDue(false);
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2 shadow-xs transition-colors focus-within:border-neutral-400">
        <Plus className="size-4 shrink-0 text-neutral-400" />
        <input
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setIgnoreDue(false);
          }}
          placeholder={placeholder}
          className="h-7 min-w-0 flex-1 bg-transparent text-[14px] text-neutral-800 outline-none placeholder:text-neutral-400"
        />

        {dueAt && (
          <span className="ddl-fade-in inline-flex shrink-0 items-center gap-1 rounded-md bg-neutral-100 py-1 pr-1 pl-2 text-[12px] text-neutral-600">
            {formatDue(dueAt)}
            <button
              type="button"
              onClick={() => setIgnoreDue(true)}
              className="rounded p-0.5 text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700"
              aria-label="不设置时间"
            >
              <X className="size-3" />
            </button>
          </span>
        )}

        <button
          type="submit"
          disabled={!canSubmit}
          className="flex size-6 shrink-0 items-center justify-center rounded-md bg-neutral-900 text-white transition-opacity disabled:opacity-25"
          aria-label="创建任务"
        >
          <CornerDownLeft className="size-3.5" />
        </button>
      </div>

      {text.trim() && parsed.matchedText && (
        <p className="mt-1.5 flex items-center gap-1 pl-1 text-[11.5px] text-neutral-400">
          <Sparkles className="size-3" />
          已识别时间「{parsed.matchedText}」
          {ignoreDue && '，本次不采用'}
        </p>
      )}
    </form>
  );
}
