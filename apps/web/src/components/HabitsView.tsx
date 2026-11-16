import type { Habit } from '@ddl/shared';
import clsx from 'clsx';
import { Archive, Check, Flame, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useHabitMutations, useHabits } from '../hooks/useDdl';
import { visibleError } from '../lib/api';
import { Button, Card, EmptyState, ErrorBar, Field, Modal, SectionTitle, Stat, inputClass, selectClass } from './ui';

const WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日'];

const ICON_CHOICES = ['✅', '📚', '🏃', '💧', '🧘', '💪', '🎸', '🌙', '🍎', '✍️', '🧹', '💰'];
const COLOR_CHOICES = ['#22c55e', '#3b82f6', '#8b5cf6', '#f97316', '#ef4444', '#14b8a6', '#eab308'];

function dateKey(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 本周（周一为首日）的 7 个日期 */
function currentWeek(): Date[] {
  const today = new Date();
  const weekday = (today.getDay() + 6) % 7;
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - weekday);
  return Array.from({ length: 7 }, (_, index) => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + index));
}

type DraftHabit = {
  name: string;
  icon: string;
  color: string;
  freqType: 'daily' | 'weekly' | 'monthly' | 'custom';
  weekDays: number[];
  everyNDays: number;
  goalPerPeriod: number;
  unit: string;
};

const EMPTY_DRAFT: DraftHabit = {
  name: '',
  icon: '✅',
  color: '#22c55e',
  freqType: 'daily',
  weekDays: [1, 2, 3, 4, 5],
  everyNDays: 2,
  goalPerPeriod: 1,
  unit: '次',
};

export function HabitsView() {
  const habitsQuery = useHabits();
  const { create, update, remove, check, reset } = useHabitMutations();

  const [editing, setEditing] = useState<Habit | null>(null);
  const [draft, setDraft] = useState<DraftHabit>(EMPTY_DRAFT);
  const [modalOpen, setModalOpen] = useState(false);

  const habits = habitsQuery.data ?? [];
  const week = useMemo(currentWeek, []);
  const todayKey = dateKey(new Date());
  const doneToday = habits.filter((habit) => habit.doneToday).length;
  const totalStreak = habits.reduce((sum, habit) => sum + habit.streak, 0);

  function openCreate() {
    setEditing(null);
    setDraft(EMPTY_DRAFT);
    setModalOpen(true);
  }

  function openEdit(habit: Habit) {
    setEditing(habit);
    setDraft({
      name: habit.name,
      icon: habit.icon,
      color: habit.color,
      freqType: habit.freqType,
      weekDays: habit.freqConfig.weekDays ?? [1, 2, 3, 4, 5],
      everyNDays: habit.freqConfig.everyNDays ?? 2,
      goalPerPeriod: habit.goalPerPeriod,
      unit: habit.unit,
    });
    setModalOpen(true);
  }

  function submit() {
    const name = draft.name.trim();
    if (!name) return;

    const freqConfig =
      draft.freqType === 'weekly'
        ? { weekDays: draft.weekDays }
        : draft.freqType === 'custom'
          ? { everyNDays: draft.everyNDays }
          : {};

    const payload = {
      name,
      icon: draft.icon,
      color: draft.color,
      freqType: draft.freqType,
      freqConfig,
      goalPerPeriod: draft.goalPerPeriod,
      unit: draft.unit || '次',
    };

    if (editing) update.mutate({ id: editing.id, patch: payload }, { onSuccess: () => setModalOpen(false) });
    else create.mutate(payload, { onSuccess: () => setModalOpen(false) });
  }

  const error = visibleError(
    habitsQuery.error,
    create.error,
    update.error,
    remove.error,
    check.error,
    reset.error,
  );

  return (
    <div className="mx-auto w-full max-w-3xl md:max-w-4xl xl:max-w-3xl">
      {error && (
        <div className="mb-3">
          <ErrorBar message={error.message} />
        </div>
      )}

      <div className="mb-4 grid grid-cols-3 gap-2.5">
        <Stat label="今日完成" value={`${doneToday}/${habits.length}`} />
        <Stat label="习惯总数" value={habits.length} unit="个" />
        <Stat label="连续天数合计" value={totalStreak} unit="天" />
      </div>

      <div className="mb-3 flex items-center justify-between">
        <SectionTitle>我的习惯</SectionTitle>
        <Button variant="primary" size="sm" onClick={openCreate}>
          <Plus className="size-3.5" />
          新建习惯
        </Button>
      </div>

      {habitsQuery.isLoading && <p className="text-[12px] text-neutral-400">加载中…</p>}

      {!habitsQuery.isLoading && habits.length === 0 && (
        <EmptyState
          title="还没有习惯"
          hint="从每天读书、喝水、运动开始，坚持会变成看得见的连续天数"
          action={
            <Button variant="primary" size="sm" onClick={openCreate}>
              添加第一个习惯
            </Button>
          }
        />
      )}

      <div className="space-y-2.5">
        {habits.map((habit) => (
          <Card key={habit.id} className="p-3.5">
            <div className="flex items-start gap-3">
              <button
                type="button"
                onClick={() => check.mutate({ id: habit.id, date: todayKey })}
                className={clsx(
                  'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full border-2 text-[15px] transition-all',
                  habit.doneToday ? 'text-white' : 'border-neutral-200 bg-white',
                )}
                style={habit.doneToday ? { backgroundColor: habit.color, borderColor: habit.color } : undefined}
                title={habit.doneToday ? '取消今日打卡' : '今日打卡'}
              >
                {habit.doneToday ? <Check className="size-4" /> : habit.icon}
              </button>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => openEdit(habit)}
                    className="truncate text-[13.5px] font-medium text-neutral-800 hover:underline"
                  >
                    {habit.name}
                  </button>
                  {habit.streak > 0 && (
                    <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10.5px] text-amber-700">
                      <Flame className="size-2.5" />
                      {habit.streak}
                    </span>
                  )}
                </div>

                <div className="mt-2 flex items-center gap-1">
                  {week.map((day, index) => {
                    const key = dateKey(day);
                    const isFuture = key > todayKey;
                    const isDone = habit.recentDates.includes(key);
                    return (
                      <button
                        key={key}
                        type="button"
                        disabled={isFuture}
                        onClick={() => check.mutate({ id: habit.id, date: key })}
                        className={clsx(
                          'flex h-9 flex-1 flex-col items-center justify-center rounded-md text-[10.5px] font-medium transition-colors sm:h-7 sm:text-[10px]',
                          isDone ? 'text-white' : 'bg-neutral-100 text-neutral-500',
                          isFuture && 'opacity-40',
                          !isDone && !isFuture && 'hover:bg-neutral-200',
                        )}
                        style={isDone ? { backgroundColor: habit.color } : undefined}
                        title={key}
                      >
                        {WEEK_LABELS[index]}
                      </button>
                    );
                  })}
                </div>

                <div className="mt-2 flex items-center gap-3 text-[11px] text-neutral-400">
                  <span>完成率 {Math.round(habit.completionRate * 100)}%</span>
                  <span>累计 {habit.totalCheckIns} 次</span>
                  <span>最长 {habit.bestStreak} 天</span>
                  <div className="ml-auto flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => update.mutate({ id: habit.id, patch: { archived: true } })}
                      className="rounded p-1 hover:bg-neutral-100 hover:text-neutral-700"
                      title="归档"
                    >
                      <Archive className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => reset.mutate(habit.id)}
                      className="rounded p-1 hover:bg-neutral-100 hover:text-neutral-700"
                      title="清空打卡记录"
                    >
                      <RotateCcw className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => remove.mutate(habit.id)}
                      className="rounded p-1 hover:bg-red-50 hover:text-red-600"
                      title="删除"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? '编辑习惯' : '新建习惯'}>
        <div className="space-y-3">
          <Field label="名称">
            <input
              autoFocus
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              placeholder="比如：每天读书 20 页"
              className={inputClass}
            />
          </Field>

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

          <Field label="颜色">
            <div className="flex gap-1.5">
              {COLOR_CHOICES.map((color) => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setDraft({ ...draft, color })}
                  className={clsx(
                    'size-7 rounded-full border-2',
                    draft.color === color ? 'border-neutral-800' : 'border-transparent',
                  )}
                  style={{ backgroundColor: color }}
                  aria-label={color}
                />
              ))}
            </div>
          </Field>

          <Field label="打卡周期">
            <select
              value={draft.freqType}
              onChange={(event) =>
                setDraft({ ...draft, freqType: event.target.value as DraftHabit['freqType'] })
              }
              className={selectClass}
            >
              <option value="daily">每天</option>
              <option value="weekly">每周指定几天</option>
              <option value="custom">每 N 天</option>
            </select>
          </Field>

          {draft.freqType === 'weekly' && (
            <Field label="选择星期">
              <div className="flex gap-1.5">
                {WEEK_LABELS.map((label, index) => {
                  const day = index + 1;
                  const active = draft.weekDays.includes(day);
                  return (
                    <button
                      key={label}
                      type="button"
                      onClick={() =>
                        setDraft({
                          ...draft,
                          weekDays: active
                            ? draft.weekDays.filter((item) => item !== day)
                            : [...draft.weekDays, day].sort(),
                        })
                      }
                      className={clsx(
                        'h-8 flex-1 rounded-lg border text-[12px]',
                        active ? 'border-neutral-800 bg-neutral-900 text-white' : 'border-neutral-200',
                      )}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </Field>
          )}

          {draft.freqType === 'custom' && (
            <Field label="间隔天数">
              <input
                type="number"
                min={1}
                max={365}
                value={draft.everyNDays}
                onChange={(event) => setDraft({ ...draft, everyNDays: Number(event.target.value) || 1 })}
                className={inputClass}
              />
            </Field>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setModalOpen(false)}>
              取消
            </Button>
            <Button variant="primary" onClick={submit} disabled={!draft.name.trim()}>
              {editing ? '保存' : '创建'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
