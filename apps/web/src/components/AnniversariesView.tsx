import type { Anniversary } from '@ddl/shared';
import clsx from 'clsx';
import { Cake, CalendarHeart, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useAnniversaryMutations, useAnniversaries } from '../hooks/useDdl';
import { visibleError } from '../lib/api';
import { Button, Card, EmptyState, ErrorBar, Field, Modal, Stat, Toggle, inputClass, selectClass } from './ui';

const TYPE_LABEL: Record<Anniversary['type'], string> = {
  countdown: '倒数日',
  anniversary: '纪念日',
  birthday: '生日',
};

const ICON_CHOICES = ['🎂', '💍', '❤️', '🎓', '💼', '🏠', '✈️', '🎉', '🌱', '⏳'];

type Draft = {
  title: string;
  eventDate: string;
  type: Anniversary['type'];
  repeatYearly: boolean;
  lunar: boolean;
  color: string;
  icon: string;
};

const todayStr = () => {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

const EMPTY: Draft = {
  title: '',
  eventDate: todayStr(),
  type: 'countdown',
  repeatYearly: false,
  lunar: false,
  color: '#f97316',
  icon: '⏳',
};

export function AnniversariesView() {
  const query = useAnniversaries();
  const { create, update, remove } = useAnniversaryMutations();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Anniversary | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);

  const items = query.data ?? [];
  const error = visibleError(query.error, create.error, update.error, remove.error);

  function openCreate() {
    setEditing(null);
    setDraft({ ...EMPTY, icon: '⏳' });
    setOpen(true);
  }

  function openEdit(item: Anniversary) {
    setEditing(item);
    setDraft({
      title: item.title,
      eventDate: item.eventDate,
      type: item.type,
      repeatYearly: item.repeatYearly,
      lunar: item.lunar,
      color: item.color,
      icon: item.icon,
    });
    setOpen(true);
  }

  function submit() {
    const title = draft.title.trim();
    if (!title) return;
    if (editing) {
      update.mutate({ id: editing.id, patch: draft }, { onSuccess: () => setOpen(false) });
    } else {
      create.mutate(draft, { onSuccess: () => setOpen(false) });
    }
  }

  const nearest = items.find((item) => item.daysUntil >= 0);

  return (
    <div className="mx-auto w-full max-w-3xl md:max-w-4xl xl:max-w-3xl">
      {error && (
        <div className="mb-3">
          <ErrorBar message={error.message} />
        </div>
      )}

      <div className="mb-4 grid grid-cols-3 gap-2.5">
        <Stat label="全部" value={items.length} unit="个" />
        <Stat label="最近一个" value={nearest ? `${nearest.daysUntil}` : '—'} unit="天" />
        <Stat label="今年已过" value={items.filter((item) => item.daysUntil < 0).length} unit="个" />
      </div>

      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[12px] font-semibold tracking-wide text-neutral-400 uppercase">倒数纪念日</h2>
        <Button variant="primary" size="sm" onClick={openCreate}>
          <Plus className="size-3.5" />
          添加
        </Button>
      </div>

      {query.isLoading && <p className="text-[12px] text-neutral-400">加载中…</p>}

      {!query.isLoading && items.length === 0 && (
        <EmptyState
          title="还没有倒数日"
          hint="生日、纪念日、考试倒计时，都可以放这里"
          action={
            <Button variant="primary" size="sm" onClick={openCreate}>
              添加第一个
            </Button>
          }
        />
      )}

      <div className="grid gap-2.5 sm:grid-cols-2">
        {items.map((item) => {
          const isPast = item.daysUntil < 0;
          return (
            <Card key={item.id} className="group relative p-3.5">
              <div className="flex items-start gap-3">
                <div
                  className="flex size-10 shrink-0 items-center justify-center rounded-xl text-[18px]"
                  style={{ backgroundColor: `${item.color}1f` }}
                >
                  {item.icon}
                </div>
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => openEdit(item)}
                    className="block max-w-full truncate text-left text-[13.5px] font-medium text-neutral-800 hover:underline"
                  >
                    {item.title}
                  </button>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-neutral-400">
                    <span className="rounded bg-neutral-100 px-1.5 py-0.5">{TYPE_LABEL[item.type]}</span>
                    {item.repeatYearly && <span className="rounded bg-neutral-100 px-1.5 py-0.5">每年</span>}
                    {item.lunar && <span className="rounded bg-neutral-100 px-1.5 py-0.5">农历</span>}
                    <span>{item.eventDate}</span>
                  </div>
                </div>
              </div>

              <div className="mt-3 flex items-end justify-between">
                <div>
                  <p
                    className={clsx('text-[22px] leading-none font-semibold tabular-nums')}
                    style={{ color: isPast ? '#9ca3af' : item.color }}
                  >
                    {isPast ? `已过 ${Math.abs(item.daysUntil)}` : item.daysUntil === 0 ? '就是今天' : item.daysUntil}
                    {!isPast && item.daysUntil !== 0 && <span className="ml-1 text-[11px] font-normal">天</span>}
                  </p>
                  {item.years > 0 && (
                    <p className="mt-1 text-[11px] text-neutral-400">
                      第 {item.years} {item.type === 'birthday' ? '岁' : '年'}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => remove.mutate(item.id)}
                  className="rounded p-1 text-neutral-300 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-red-50 hover:text-red-600"
                  aria-label="删除"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </Card>
          );
        })}
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? '编辑倒数纪念日' : '添加倒数纪念日'}>
        <div className="space-y-3">
          <Field label="名称">
            <input
              autoFocus
              value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              placeholder="比如：结婚纪念日"
              className={inputClass}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="日期">
              <input
                type="date"
                value={draft.eventDate}
                onChange={(event) => setDraft({ ...draft, eventDate: event.target.value })}
                className={inputClass}
              />
            </Field>
            <Field label="类型">
              <select
                value={draft.type}
                onChange={(event) => setDraft({ ...draft, type: event.target.value as Anniversary['type'] })}
                className={selectClass}
              >
                <option value="countdown">倒数日</option>
                <option value="anniversary">纪念日</option>
                <option value="birthday">生日</option>
              </select>
            </Field>
          </div>

          <Field label="图标">
            <div className="flex flex-wrap gap-1.5">
              {ICON_CHOICES.map((icon) => (
                <button
                  key={icon}
                  type="button"
                  onClick={() => setDraft({ ...draft, icon })}
                  className={clsx(
                    'flex size-8 items-center justify-center rounded-lg border text-[15px]',
                    draft.icon === icon ? 'border-neutral-800 bg-neutral-100' : 'border-neutral-200',
                  )}
                >
                  {icon}
                </button>
              ))}
            </div>
          </Field>

          <div className="rounded-lg border border-neutral-200/80 px-3 py-1">
            <Toggle
              label="每年重复"
              hint="生日与纪念日建议开启；倒数日一般只算一次"
              checked={draft.repeatYearly}
              onChange={(next) => setDraft({ ...draft, repeatYearly: next })}
            />
            <Toggle
              label="按农历计算"
              hint="农历生日会在每年对应的农历日期提醒"
              checked={draft.lunar}
              onChange={(next) => setDraft({ ...draft, lunar: next })}
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button variant="primary" onClick={submit} disabled={!draft.title.trim()}>
              {editing ? '保存' : '添加'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
