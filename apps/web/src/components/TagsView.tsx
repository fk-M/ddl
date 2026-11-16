import type { SmartFilter } from '@ddl/shared';
import clsx from 'clsx';
import { Filter, Hash, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useSmartListMutations, useSmartLists, useTagMutations, useTags } from '../hooks/useDdl';
import { visibleError } from '../lib/api';
import { Button, Card, ErrorBar, Field, Modal, SectionTitle, inputClass, selectClass } from './ui';

const COLORS = ['#6366f1', '#3b82f6', '#22c55e', '#f97316', '#ef4444', '#14b8a6', '#eab308'];

export function TagsView({ onOpenTag, onOpenSmart }: { onOpenTag: (name: string) => void; onOpenSmart: (id: string) => void }) {
  const tagsQuery = useTags();
  const smartListsQuery = useSmartLists();
  const tagMutations = useTagMutations();
  const smartMutations = useSmartListMutations();

  const [tagName, setTagName] = useState('');
  const [tagColor, setTagColor] = useState(COLORS[0]!);

  const [smartOpen, setSmartOpen] = useState(false);
  const [smartName, setSmartName] = useState('');
  const [smartFilter, setSmartFilter] = useState<SmartFilter>({});

  const tags = tagsQuery.data ?? [];
  const smartLists = smartListsQuery.data ?? [];
  const error = visibleError(
    tagsQuery.error,
    smartListsQuery.error,
    tagMutations.create.error,
    smartMutations.create.error,
  );

  function createTag() {
    const name = tagName.trim();
    if (!name) return;
    tagMutations.create.mutate({ name, color: tagColor }, { onSuccess: () => setTagName('') });
  }

  function createSmart() {
    const name = smartName.trim();
    if (!name) return;
    smartMutations.create.mutate(
      { name, filter: smartFilter },
      {
        onSuccess: () => {
          setSmartOpen(false);
          setSmartName('');
          setSmartFilter({});
        },
      },
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 pb-8 md:max-w-4xl xl:max-w-3xl">
      {error && <ErrorBar message={error.message} />}

      <Card>
        <SectionTitle>标签</SectionTitle>
        <div className="flex gap-2">
          <div className="flex gap-1">
            {COLORS.map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => setTagColor(color)}
                className={clsx(
                  'size-6 rounded-full border-2',
                  tagColor === color ? 'border-neutral-800' : 'border-transparent',
                )}
                style={{ backgroundColor: color }}
                aria-label={color}
              />
            ))}
          </div>
          <input
            value={tagName}
            onChange={(event) => setTagName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') createTag();
            }}
            placeholder="新标签名称"
            className={inputClass}
          />
          <Button variant="primary" onClick={createTag} disabled={!tagName.trim()}>
            <Plus className="size-3.5" />
            添加
          </Button>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {tags.length === 0 && <p className="text-[12px] text-neutral-400">还没有标签，先加一个</p>}
          {tags.map((tag) => (
            <div
              key={tag.id}
              className="group flex items-center gap-1.5 rounded-full border border-neutral-200 px-2.5 py-1 text-[12px]"
            >
              <Hash className="size-3" style={{ color: tag.color }} />
              <button type="button" onClick={() => onOpenTag(tag.name)} className="hover:underline">
                {tag.name}
              </button>
              <span className="text-[10.5px] text-neutral-400">{tag.taskCount}</span>
              <button
                type="button"
                onClick={() => tagMutations.remove.mutate(tag.id)}
                className="ml-0.5 text-neutral-300 opacity-0 transition-opacity group-hover:opacity-100 hover:text-red-600"
                aria-label="删除标签"
              >
                <Trash2 className="size-3" />
              </button>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <SectionTitle
          action={
            <Button size="sm" variant="primary" onClick={() => setSmartOpen(true)}>
              <Plus className="size-3.5" />
              新建智能清单
            </Button>
          }
        >
          智能清单 / 过滤器
        </SectionTitle>

        {smartLists.length === 0 ? (
          <p className="text-[12px] text-neutral-400">
            智能清单把「一堆条件」存成一个入口，比如「高优先级且本周到期」。
          </p>
        ) : (
          <div className="space-y-1.5">
            {smartLists.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-2 rounded-lg border border-neutral-200/80 px-2.5 py-2"
              >
                <Filter className="size-3.5 shrink-0" style={{ color: item.color }} />
                <button
                  type="button"
                  onClick={() => onOpenSmart(item.id)}
                  className="min-w-0 flex-1 truncate text-left text-[12.5px] text-neutral-800 hover:underline"
                >
                  {item.name}
                </button>
                <span className="shrink-0 text-[11px] text-neutral-400">
                  {describeFilter(item.filter)}
                </span>
                <button
                  type="button"
                  onClick={() => smartMutations.remove.mutate(item.id)}
                  className="rounded p-1 text-neutral-300 hover:bg-red-50 hover:text-red-600"
                  aria-label="删除智能清单"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal open={smartOpen} onClose={() => setSmartOpen(false)} title="新建智能清单">
        <div className="space-y-3">
          <Field label="名称">
            <input
              autoFocus
              value={smartName}
              onChange={(event) => setSmartName(event.target.value)}
              placeholder="比如：高优先级待办"
              className={inputClass}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="状态">
              <select
                value={smartFilter.status ?? ''}
                onChange={(event) =>
                  setSmartFilter({
                    ...smartFilter,
                    status: event.target.value ? (event.target.value as 'pending' | 'completed') : undefined,
                  })
                }
                className={selectClass}
              >
                <option value="">不限</option>
                <option value="pending">未完成</option>
                <option value="completed">已完成</option>
              </select>
            </Field>

            <Field label="优先级">
              <select
                value={smartFilter.priorities?.[0] ?? ''}
                onChange={(event) =>
                  setSmartFilter({
                    ...smartFilter,
                    priorities: event.target.value
                      ? [Number(event.target.value) as 0 | 1 | 2 | 3]
                      : undefined,
                  })
                }
                className={selectClass}
              >
                <option value="">不限</option>
                <option value="3">高</option>
                <option value="2">中</option>
                <option value="1">低</option>
                <option value="0">无</option>
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="N 天内到期">
              <input
                type="number"
                min={0}
                max={3650}
                value={smartFilter.dueWithinDays ?? ''}
                onChange={(event) =>
                  setSmartFilter({
                    ...smartFilter,
                    dueWithinDays: event.target.value ? Number(event.target.value) : undefined,
                  })
                }
                placeholder="不限"
                className={inputClass}
              />
            </Field>
            <Field label="关键词">
              <input
                value={smartFilter.keyword ?? ''}
                onChange={(event) =>
                  setSmartFilter({ ...smartFilter, keyword: event.target.value || undefined })
                }
                placeholder="匹配标题或备注"
                className={inputClass}
              />
            </Field>
          </div>

          <div className="flex flex-wrap gap-3 text-[12px] text-neutral-600">
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={smartFilter.important ?? false}
                onChange={(event) =>
                  setSmartFilter({ ...smartFilter, important: event.target.checked || undefined })
                }
              />
              仅重要
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={smartFilter.urgent ?? false}
                onChange={(event) =>
                  setSmartFilter({ ...smartFilter, urgent: event.target.checked || undefined })
                }
              />
              仅紧急
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={smartFilter.overdue ?? false}
                onChange={(event) =>
                  setSmartFilter({ ...smartFilter, overdue: event.target.checked || undefined })
                }
              />
              仅逾期
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={smartFilter.hasDue ?? false}
                onChange={(event) =>
                  setSmartFilter({ ...smartFilter, hasDue: event.target.checked || undefined })
                }
              />
              仅有到期时间
            </label>
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setSmartOpen(false)}>
              取消
            </Button>
            <Button variant="primary" onClick={createSmart} disabled={!smartName.trim()}>
              创建
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function describeFilter(filter: SmartFilter): string {
  const parts: string[] = [];
  if (filter.status) parts.push(filter.status === 'pending' ? '未完成' : '已完成');
  if (filter.priorities?.length) parts.push(`优先级 ${filter.priorities.join('/')}`);
  if (filter.dueWithinDays !== undefined) parts.push(`${filter.dueWithinDays} 天内`);
  if (filter.important) parts.push('重要');
  if (filter.urgent) parts.push('紧急');
  if (filter.overdue) parts.push('逾期');
  if (filter.hasDue) parts.push('有日期');
  if (filter.keyword) parts.push(`“${filter.keyword}”`);
  return parts.length > 0 ? parts.join(' · ') : '无筛选条件';
}
