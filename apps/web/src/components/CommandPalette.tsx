import type { SmartList, TaskList } from '@ddl/shared';
import clsx from 'clsx';
import { ArrowRight, Plus, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { NAV_ITEMS, TOOL_ITEMS } from './Sidebar';

type Props = {
  open: boolean;
  onClose: () => void;
  lists: TaskList[];
  smartLists: SmartList[];
  onNavigate: (view: string) => void;
  onCreate: (title: string) => void;
  onSearch: (keyword: string) => void;
};

type Command = { key: string; label: string; hint?: string; run: () => void };

export function CommandPalette({ open, onClose, lists, smartLists, onNavigate, onCreate, onSearch }: Props) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      window.setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  const commands = useMemo<Command[]>(() => {
    const base: Command[] = [
      ...NAV_ITEMS.map((item) => ({
        key: `nav-${item.key}`,
        label: item.label,
        hint: '视图',
        run: () => onNavigate(item.key),
      })),
      ...TOOL_ITEMS.map((item) => ({
        key: `tool-${item.key}`,
        label: item.label,
        hint: '工具',
        run: () => onNavigate(item.key),
      })),
      ...lists
        .filter((list) => !list.isInbox)
        .map((list) => ({
          key: `list-${list.id}`,
          label: list.name,
          hint: '清单',
          run: () => onNavigate(`list:${list.id}`),
        })),
      ...smartLists.map((item) => ({
        key: `smart-${item.id}`,
        label: item.name,
        hint: '智能清单',
        run: () => onNavigate(`smart:${item.id}`),
      })),
    ];
    return base;
  }, [lists, smartLists, onNavigate]);

  const text = query.trim();
  const filtered = text
    ? commands.filter((command) => command.label.toLowerCase().includes(text.toLowerCase()))
    : commands;

  const canCreate = text.length > 0;

  function runCommand() {
    const command = filtered[active];
    if (command) {
      command.run();
      onClose();
      return;
    }
    if (canCreate) {
      onCreate(text);
      onClose();
    }
  }

  if (!open) return null;

  const total = filtered.length + (canCreate ? 1 : 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/25 px-4 pt-24"
      data-sheet="1"
      onClick={onClose}
    >
      <div
        className="ddl-pop w-full max-w-lg overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-neutral-100 px-3.5 py-2.5">
          <Search className="size-4 shrink-0 text-neutral-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') onClose();
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActive((prev) => Math.min(prev + 1, Math.max(0, total - 1)));
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActive((prev) => Math.max(0, prev - 1));
              }
              if (event.key === 'Enter') {
                event.preventDefault();
                runCommand();
              }
            }}
            placeholder="跳转视图、搜索任务，或输入标题新建任务"
            className="h-7 flex-1 border-none bg-transparent text-[13.5px] outline-none placeholder:text-neutral-400"
          />
        </div>

        <div className="max-h-[46vh] overflow-y-auto py-1.5">
          {canCreate && (
            <button
              type="button"
              onClick={() => {
                onCreate(text);
                onClose();
              }}
              onMouseEnter={() => setActive(filtered.length)}
              className={clsx(
                'flex w-full items-center gap-2 px-3.5 py-2 text-left text-[13px]',
                active === filtered.length ? 'bg-neutral-100' : 'hover:bg-neutral-50',
              )}
            >
              <Plus className="size-3.5 shrink-0 text-neutral-400" />
              <span className="min-w-0 flex-1 truncate text-neutral-800">新建任务「{text}」</span>
            </button>
          )}

          {filtered.map((command, index) => (
            <button
              key={command.key}
              type="button"
              onClick={() => {
                command.run();
                onClose();
              }}
              onMouseEnter={() => setActive(index)}
              className={clsx(
                'flex w-full items-center gap-2 px-3.5 py-2 text-left text-[13px]',
                active === index ? 'bg-neutral-100' : 'hover:bg-neutral-50',
              )}
            >
              <span className="min-w-0 flex-1 truncate text-neutral-800">{command.label}</span>
              {command.hint && <span className="shrink-0 text-[11px] text-neutral-400">{command.hint}</span>}
            </button>
          ))}

          {filtered.length === 0 && !canCreate && (
            <p className="px-3.5 py-6 text-center text-[12.5px] text-neutral-400">没有匹配项</p>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-neutral-100 px-3.5 py-2 text-[11px] text-neutral-400">
          <span>↑↓ 选择 · Enter 执行 · Esc 关闭</span>
          {text && (
            <button type="button" onClick={() => onSearch(text)} className="flex items-center gap-1 hover:text-neutral-700">
              搜索任务
              <ArrowRight className="size-3" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
