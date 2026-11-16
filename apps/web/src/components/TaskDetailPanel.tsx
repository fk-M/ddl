import type { Attachment, Priority, Task, TaskList, UpdateTaskPayload } from '@ddl/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Bell, Check, Paperclip, Repeat, Star, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  useCreateTask,
  useDeleteTask,
  useSubtasks,
  useTemplateMutations,
  useToggleTask,
} from '../hooks/useDdl';
import { notificationPermission, requestNotificationPermission } from '../hooks/useReminders';
import { isNativeNotify, requestNotifyPermission } from '../lib/notify';
import { api } from '../lib/api';
import { fromLocalInputValue, toLocalInputValue } from '../lib/datetime';
import {
  MAX_ATTACHMENT_BYTES,
  localAddAttachment,
  localDeleteAttachment,
  localListAttachments,
  localOpenAttachment,
} from '../lib/local-data';
import { REPEAT_GROUPS, REPEAT_PRESETS, describeRrule, presetKeyOf } from '../lib/recurrence';
import { isLocalFirst } from '../lib/server-url';
import { REMIND_SOUNDS } from '../lib/sound';

const PRIORITIES: Array<{ value: Priority; label: string }> = [
  { value: 0, label: '无' },
  { value: 1, label: '低' },
  { value: 2, label: '中' },
  { value: 3, label: '高' },
];

type ReminderDraft = { key: string; value: string; channel: 'inapp' | 'system'; sound: string };

type Props = {
  task: Task;
  lists: TaskList[];
  saving: boolean;
  onClose: () => void;
  onSave: (patch: UpdateTaskPayload) => void;
  onDelete: () => void;
};

function FieldLabel({ children }: { children: string }) {
  return <p className="mb-1.5 text-[11px] font-medium tracking-wide text-neutral-400">{children}</p>;
}

export function TaskDetailPanel({ task, lists, saving, onClose, onSave, onDelete }: Props) {
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes ?? '');
  const [listId, setListId] = useState(task.listId);
  const [dueValue, setDueValue] = useState(toLocalInputValue(task.dueAt));
  const [reminders, setReminders] = useState<ReminderDraft[]>([]);
  const [permission, setPermission] = useState(notificationPermission());
  const [allDay, setAllDay] = useState(task.allDay);
  const [priority, setPriority] = useState<Priority>(task.priority);
  const [isImportant, setIsImportant] = useState(task.isImportant);
  const [isUrgent, setIsUrgent] = useState(task.isUrgent);
  const [rrule, setRrule] = useState<string | null>(task.rrule);
  const [scope, setScope] = useState<'this' | 'future' | 'all'>('all');
  const [tags, setTags] = useState<string[]>(task.tags);
  const [tagInput, setTagInput] = useState('');
  const [subInput, setSubInput] = useState('');
  const [estimate, setEstimate] = useState(task.estimatePomodoros);
  const [attachBusy, setAttachBusy] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const subtasksQuery = useSubtasks(task.parentId ? null : task.id);
  const createTask = useCreateTask();
  const toggleTask = useToggleTask();
  const deleteTask = useDeleteTask();
  const templates = useTemplateMutations();
  const subtasks = subtasksQuery.data ?? [];

  const queryClient = useQueryClient();
  const localFirst = isLocalFirst();
  // 手机端附件存在本地 IndexedDB；桌面端跟随服务端返回的 task.attachments
  const attachmentsQuery = useQuery<Attachment[], Error>({
    queryKey: ['attachments', task.id],
    queryFn: () => localListAttachments(task.id),
    enabled: localFirst,
  });
  const attachments = localFirst ? (attachmentsQuery.data ?? []) : task.attachments;

  // 切换到另一个任务时重置草稿，避免把上一条的编辑带过去
  useEffect(() => {
    setTitle(task.title);
    setNotes(task.notes ?? '');
    setListId(task.listId);
    setDueValue(toLocalInputValue(task.dueAt));
    setAllDay(task.allDay);
    setPriority(task.priority);
    setIsImportant(task.isImportant);
    setIsUrgent(task.isUrgent);
    setRrule(task.rrule);
    setTags(task.tags);
    setTagInput('');
    setEstimate(task.estimatePomodoros);
    setScope('all');
    setReminders(
      (task.reminders.length > 0
        ? task.reminders
        : task.remindAt
          ? [{ id: 'legacy', remindAt: task.remindAt, channel: 'inapp' as const, sound: null }]
          : []
      ).map((item) => ({
        key: item.id,
        value: toLocalInputValue(item.remindAt),
        channel: item.channel,
        sound: item.sound ?? '',
      })),
    );
  }, [task.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  function addTag() {
    const value = tagInput.trim().replace(/^#/, '');
    if (!value) return;
    setTagInput('');
    if (tags.includes(value) || tags.length >= 30) return;
    setTags([...tags, value]);
  }

  function handleAddSubtask(event: FormEvent) {
    event.preventDefault();
    const value = subInput.trim();
    if (!value || createTask.isPending) return;
    createTask.mutate(
      { title: value, listId: task.listId, parentId: task.id },
      { onSuccess: () => setSubInput('') },
    );
  }

  function addReminder() {
    const base = dueValue ? new Date(dueValue) : new Date();
    base.setMinutes(base.getMinutes() - 30);
    setReminders([
      ...reminders,
      { key: `new-${Date.now()}`, value: toLocalInputValue(base.toISOString()), channel: 'inapp', sound: '' },
    ]);
  }

  function handleSave() {
    const trimmedTitle = title.trim();
    if (!trimmedTitle || saving) return;

    const validReminders = reminders
      .map((item) => ({ ...item, iso: fromLocalInputValue(item.value) }))
      .filter((item): item is ReminderDraft & { iso: string } => Boolean(item.iso))
      .map((item) => ({
        remindAt: item.iso,
        channel: item.channel,
        sound: item.sound || null,
        snoozeMinutes: 5,
        persistent: false,
      }));

    onSave({
      title: trimmedTitle,
      notes: notes.trim().length > 0 ? notes : null,
      listId,
      dueAt: fromLocalInputValue(dueValue),
      // 没有截止时间的重复规则无法派生下一次，直接清掉
      rrule: dueValue ? rrule : null,
      allDay,
      priority,
      isImportant,
      isUrgent,
      tags,
      estimatePomodoros: estimate,
      reminders: validReminders,
      scope,
    });
  }

  async function upload(file: File) {
    setAttachBusy(true);
    setAttachError(null);
    try {
      if (localFirst) {
        await localAddAttachment(task.id, file);
        await queryClient.invalidateQueries({ queryKey: ['attachments', task.id] });
        return;
      }
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      const chunk = 0x8000;
      for (let index = 0; index < bytes.length; index += chunk) {
        binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
      }
      await api.uploadAttachment(task.id, file.name, file.type || 'application/octet-stream', btoa(binary));
      // 不再整页 reload：附件挂在 task 上，失效任务查询即可重新拉取
      await queryClient.invalidateQueries({ queryKey: ['tasks'] });
    } catch (error) {
      setAttachError(error instanceof Error ? error.message : '上传失败');
    } finally {
      setAttachBusy(false);
    }
  }

  async function openAttachment(item: Attachment) {
    try {
      if (localFirst) await localOpenAttachment(item.id);
      else window.open(item.url, '_blank', 'noopener');
    } catch (error) {
      setAttachError(error instanceof Error ? error.message : '打开附件失败');
    }
  }

  async function removeAttachment(item: Attachment) {
    if (!window.confirm(`删除附件「${item.name}」？`)) return;
    setAttachError(null);
    try {
      if (localFirst) {
        await localDeleteAttachment(item.id);
        await queryClient.invalidateQueries({ queryKey: ['attachments', task.id] });
        return;
      }
      await api.deleteAttachment(item.id);
      await queryClient.invalidateQueries({ queryKey: ['tasks'] });
    } catch (error) {
      setAttachError(error instanceof Error ? error.message : '删除附件失败');
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button
        type="button"
        aria-label="关闭详情"
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-neutral-900/20"
      />

      <aside
        className="ddl-slide-in relative flex h-full w-full max-w-[460px] flex-col bg-white shadow-2xl md:max-w-[540px] xl:max-w-[460px]"
        style={{
          paddingTop: 'env(safe-area-inset-top)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        <header className="flex items-center justify-between border-b border-neutral-100 px-5 py-3">
          <span className="text-[12px] text-neutral-400">任务详情</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                const name = window.prompt('模板名称', title.slice(0, 20));
                if (!name?.trim()) return;
                templates.create.mutate({
                  name: name.trim(),
                  kind: task.kind,
                  payload: {
                    title,
                    notes,
                    priority,
                    tags,
                    estimatePomodoros: estimate,
                    isImportant,
                    isUrgent,
                    rrule,
                  },
                });
              }}
              className="rounded px-1.5 py-1 text-[11.5px] text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
              title="保存为模板"
            >
              存为模板
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭"
              className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
            >
              <X className="size-4" />
            </button>
          </div>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className="w-full border-none bg-transparent text-[16px] font-medium text-neutral-900 outline-none placeholder:text-neutral-300"
            placeholder="任务标题"
          />

          <div>
            <FieldLabel>截止时间</FieldLabel>
            <div className="flex items-center gap-2">
              <input
                type="datetime-local"
                value={dueValue}
                onChange={(event) => setDueValue(event.target.value)}
                className="h-9 min-w-0 flex-1 rounded-lg border border-neutral-200 px-2.5 text-[13px] text-neutral-700 outline-none focus:border-neutral-400"
              />
              {dueValue && (
                <button
                  type="button"
                  onClick={() => {
                    setDueValue('');
                    setRrule(null);
                  }}
                  className="shrink-0 rounded-lg px-2 py-1.5 text-[12px] text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
                >
                  清除
                </button>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <label className="flex items-center gap-1.5 text-[12.5px] text-neutral-600">
                <input
                  type="checkbox"
                  checked={allDay}
                  onChange={(event) => setAllDay(event.target.checked)}
                  className="size-3.5 accent-neutral-900"
                />
                全天
              </label>
              {[
                { label: '今天', hours: 0 },
                { label: '明天', hours: 24 },
                { label: '+1 周', hours: 24 * 7 },
              ].map((item) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => {
                    const base = new Date();
                    base.setDate(base.getDate() + item.hours / 24);
                    base.setHours(item.hours === 0 ? 18 : 9, 0, 0, 0);
                    setDueValue(toLocalInputValue(base.toISOString()));
                  }}
                  className="rounded-md border border-neutral-200 px-1.5 py-0.5 text-[11.5px] text-neutral-500 hover:border-neutral-400"
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {/* 多提醒 */}
          <div>
            <FieldLabel>{`提醒${reminders.length > 0 ? ` · ${reminders.length}` : ''}`}</FieldLabel>
            <div className="space-y-1.5">
              {reminders.map((item) => (
                <div key={item.key} className="flex items-center gap-1.5">
                  <Bell className="size-3 shrink-0 text-neutral-400" />
                  <input
                    type="datetime-local"
                    value={item.value}
                    onChange={(event) =>
                      setReminders(
                        reminders.map((entry) =>
                          entry.key === item.key ? { ...entry, value: event.target.value } : entry,
                        ),
                      )
                    }
                    className="h-8 min-w-0 flex-1 rounded-lg border border-neutral-200 px-2 text-[12px] text-neutral-700 outline-none focus:border-neutral-400"
                  />
                  <select
                    value={item.sound}
                    onChange={(event) =>
                      setReminders(
                        reminders.map((entry) =>
                          entry.key === item.key ? { ...entry, sound: event.target.value } : entry,
                        ),
                      )
                    }
                    className="h-8 w-[74px] shrink-0 rounded-lg border border-neutral-200 bg-white px-1 text-[11.5px] outline-none"
                    title="提醒铃声"
                  >
                    <option value="">默认铃声</option>
                    {REMIND_SOUNDS.map((sound) => (
                      <option key={sound.id} value={sound.id}>
                        {sound.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setReminders(reminders.filter((entry) => entry.key !== item.key))}
                    className="shrink-0 rounded p-1 text-neutral-300 hover:text-red-600"
                    aria-label="移除提醒"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ))}
            </div>

            <div className="mt-1.5 flex items-center gap-2">
              <button
                type="button"
                onClick={addReminder}
                className="rounded-md border border-dashed border-neutral-200 px-2 py-1 text-[11.5px] text-neutral-500 hover:border-neutral-400"
              >
                + 添加提醒
              </button>
              {dueValue && (
                <button
                  type="button"
                  onClick={() => {
                    const base = new Date(dueValue);
                    base.setMinutes(base.getMinutes() - 30);
                    setReminders([
                      ...reminders,
                      {
                        key: `new-${Date.now()}`,
                        value: toLocalInputValue(base.toISOString()),
                        channel: 'inapp',
                        sound: '',
                      },
                    ]);
                  }}
                  className="rounded-md border border-neutral-200 px-2 py-1 text-[11.5px] text-neutral-500 hover:border-neutral-400"
                >
                  提前 30 分钟
                </button>
              )}
            </div>

            {(permission === 'default' || (permission === 'unsupported' && isNativeNotify())) && (
              <button
                type="button"
                onClick={async () => {
                  if (isNativeNotify()) {
                    const result = await requestNotifyPermission();
                    setPermission(result.granted ? 'granted' : 'denied');
                    return;
                  }
                  const result = await requestNotificationPermission();
                  setPermission(result);
                }}
                className="mt-1.5 text-[11.5px] text-blue-600 hover:underline"
              >
                开启系统通知，到点弹提醒
              </button>
            )}
            {permission === 'denied' && (
              <p className="mt-1.5 text-[11.5px] text-neutral-400">
                通知已被浏览器拦截，只在应用内提示
              </p>
            )}
          </div>

          {/* 重复 */}
          <div>
            <FieldLabel>重复</FieldLabel>
            <select
              value={presetKeyOf(rrule)}
              disabled={!dueValue}
              onChange={(event) => {
                const preset = REPEAT_PRESETS.find((item) => item.key === event.target.value);
                setRrule(preset?.rrule ?? null);
              }}
              className="h-9 w-full rounded-lg border border-neutral-200 bg-white px-2.5 text-[13px] text-neutral-700 outline-none focus:border-neutral-400 disabled:bg-neutral-50 disabled:text-neutral-400"
            >
              {presetKeyOf(rrule) === 'custom' && <option value="custom">自定义规则</option>}
              {REPEAT_GROUPS.map((group) => (
                <optgroup key={group} label={group}>
                  {REPEAT_PRESETS.filter((preset) => preset.group === group).map((preset) => (
                    <option key={preset.key} value={preset.key}>
                      {preset.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            {!dueValue && (
              <p className="mt-1.5 text-[11.5px] text-neutral-400">先设置截止时间，才能设定重复</p>
            )}
            {dueValue && rrule && (
              <div className="mt-2 rounded-lg border border-neutral-200/80 bg-neutral-50 px-2.5 py-2">
                <p className="flex items-center gap-1 text-[11.5px] text-neutral-600">
                  <Repeat className="size-3" />
                  {describeRrule(rrule)}
                </p>
                <p className="mt-1 text-[11px] text-neutral-400">修改这条重复任务时，作用于：</p>
                <div className="mt-1 flex gap-1.5">
                  {(
                    [
                      { key: 'this', label: '仅本次' },
                      { key: 'future', label: '本次及以后' },
                      { key: 'all', label: '全部' },
                    ] as const
                  ).map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => setScope(option.key)}
                      className={clsx(
                        'rounded-md border px-2 py-1 text-[11.5px]',
                        scope === option.key
                          ? 'border-neutral-800 bg-neutral-900 text-white'
                          : 'border-neutral-200 text-neutral-600 hover:border-neutral-400',
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <FieldLabel>清单</FieldLabel>
              <select
                value={listId}
                onChange={(event) => setListId(event.target.value)}
                className="h-9 w-full rounded-lg border border-neutral-200 bg-white px-2.5 text-[13px] text-neutral-700 outline-none focus:border-neutral-400"
              >
                {lists.map((list) => (
                  <option key={list.id} value={list.id}>
                    {list.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <FieldLabel>预计番茄</FieldLabel>
              <input
                type="number"
                min={0}
                max={99}
                value={estimate}
                onChange={(event) => setEstimate(Number(event.target.value) || 0)}
                className="h-9 w-full rounded-lg border border-neutral-200 px-2.5 text-[13px] text-neutral-700 outline-none focus:border-neutral-400"
              />
            </div>
          </div>

          <div>
            <FieldLabel>优先级</FieldLabel>
            <div className="flex gap-1.5">
              {PRIORITIES.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setPriority(item.value)}
                  className={clsx(
                    'h-8 flex-1 rounded-lg border text-[12.5px] transition-colors',
                    priority === item.value
                      ? 'border-neutral-900 bg-neutral-900 text-white'
                      : 'border-neutral-200 text-neutral-600 hover:border-neutral-400',
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <FieldLabel>四象限</FieldLabel>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => setIsImportant((value) => !value)}
                className={clsx(
                  'inline-flex h-8 items-center gap-1 rounded-lg px-3 text-[12.5px] transition-colors',
                  isImportant
                    ? 'bg-neutral-800 text-white'
                    : 'border border-neutral-200 text-neutral-500 hover:border-neutral-400',
                )}
              >
                <Star className="size-3" />
                重要
              </button>
              <button
                type="button"
                onClick={() => setIsUrgent((value) => !value)}
                className={clsx(
                  'h-8 rounded-lg px-3 text-[12.5px] transition-colors',
                  isUrgent
                    ? 'bg-red-500 text-white'
                    : 'border border-neutral-200 text-neutral-500 hover:border-neutral-400',
                )}
              >
                紧急
              </button>
              {task.actualPomodoros > 0 && (
                <span className="ml-auto self-center text-[11.5px] text-neutral-400">
                  已专注 {task.actualPomodoros} 个番茄
                </span>
              )}
            </div>
          </div>

          <div>
            <FieldLabel>标签</FieldLabel>
            <div className="flex flex-wrap items-center gap-1.5">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 rounded bg-neutral-100 py-1 pr-1 pl-2 text-[12px] text-neutral-600"
                >
                  {`#${tag}`}
                  <button
                    type="button"
                    onClick={() => setTags(tags.filter((item) => item !== tag))}
                    className="rounded p-0.5 text-neutral-400 hover:bg-neutral-200 hover:text-neutral-700"
                    aria-label={`移除标签 ${tag}`}
                  >
                    <X className="size-2.5" />
                  </button>
                </span>
              ))}
              <input
                value={tagInput}
                onChange={(event) => setTagInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    addTag();
                  }
                }}
                onBlur={addTag}
                placeholder="输入后回车"
                className="h-7 min-w-[110px] flex-1 rounded border border-dashed border-neutral-200 px-2 text-[12px] outline-none focus:border-neutral-400"
              />
            </div>
          </div>

          <div>
            <FieldLabel>备注</FieldLabel>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              rows={5}
              placeholder="补充说明、链接、验收标准…（支持 Markdown 语法）"
              className="w-full resize-none rounded-lg border border-neutral-200 px-3 py-2 text-[13px] leading-relaxed text-neutral-700 outline-none focus:border-neutral-400"
            />
          </div>

          {/* 附件 */}
          <div>
            <FieldLabel>{`附件${attachments.length > 0 ? ` · ${attachments.length}` : ''}`}</FieldLabel>
            <div className="space-y-1">
              {attachments.map((item) => (
                <div key={item.id} className="flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-neutral-50">
                  <Paperclip className="size-3 shrink-0 text-neutral-400" />
                  <button
                    type="button"
                    onClick={() => void openAttachment(item)}
                    className="min-w-0 flex-1 truncate text-left text-[12.5px] text-neutral-700 hover:underline"
                  >
                    {item.name}
                  </button>
                  <span className="shrink-0 text-[10.5px] text-neutral-400">
                    {Math.max(1, Math.round(item.size / 1024))} KB
                  </span>
                  <button
                    type="button"
                    onClick={() => void removeAttachment(item)}
                    className="shrink-0 rounded p-0.5 text-neutral-300 hover:text-red-600"
                    aria-label="删除附件"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                disabled={attachBusy}
                onClick={() => fileRef.current?.click()}
                className="rounded-md border border-dashed border-neutral-200 px-2 py-1 text-[11.5px] text-neutral-500 hover:border-neutral-400 disabled:opacity-50"
              >
                {attachBusy ? '上传中…' : '+ 上传附件（≤20MB）'}
              </button>
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void upload(file);
                  event.target.value = '';
                }}
              />
              {localFirst && attachments.length === 0 && (
                <p className="text-[11px] text-neutral-400">
                  手机端附件保存在本机，离线也能查看，单个不超过 {Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024)}MB。
                </p>
              )}
              {attachError && <p className="text-[11.5px] text-red-600">{attachError}</p>}
            </div>
          </div>

          {!task.parentId && (
            <div>
              <FieldLabel>
                {`子任务${subtasks.length > 0 ? ` · ${subtasks.filter((item) => item.status === 'completed').length}/${subtasks.length}` : ''}`}
              </FieldLabel>
              <div className="space-y-0.5">
                {subtasks.map((subtask) => (
                  <div
                    key={subtask.id}
                    className="group flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-neutral-50"
                  >
                    <button
                      type="button"
                      onClick={() => toggleTask.mutate(subtask.id)}
                      className={clsx(
                        'flex size-3.5 shrink-0 items-center justify-center rounded-full border-2',
                        subtask.status === 'completed'
                          ? 'border-neutral-900 bg-neutral-900 text-white'
                          : 'border-neutral-300 hover:border-neutral-500',
                      )}
                      aria-label="切换子任务状态"
                    >
                      {subtask.status === 'completed' && <Check className="size-2" strokeWidth={3} />}
                    </button>
                    <span
                      className={clsx(
                        'min-w-0 flex-1 truncate text-[12.5px]',
                        subtask.status === 'completed' ? 'text-neutral-400 line-through' : 'text-neutral-700',
                      )}
                    >
                      {subtask.title}
                    </span>
                    <button
                      type="button"
                      onClick={() => deleteTask.mutate({ id: subtask.id })}
                      className="rounded p-0.5 text-neutral-300 opacity-0 group-hover:opacity-100 hover:text-red-600"
                      aria-label="删除子任务"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                ))}

                <form onSubmit={handleAddSubtask}>
                  <input
                    value={subInput}
                    onChange={(event) => setSubInput(event.target.value)}
                    placeholder="+ 添加子任务，回车确认"
                    className="h-8 w-full rounded border border-dashed border-neutral-200 px-2 text-[12.5px] outline-none focus:border-neutral-400"
                  />
                </form>
              </div>
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between border-t border-neutral-100 px-5 py-3">
          <button
            type="button"
            onClick={onDelete}
            className="text-[12.5px] text-neutral-400 transition-colors hover:text-red-600"
          >
            删除任务
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-8 rounded-lg px-3 text-[12.5px] text-neutral-500 hover:bg-neutral-100"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || title.trim().length === 0}
              className="h-8 rounded-lg bg-neutral-900 px-4 text-[12.5px] text-white transition-opacity disabled:opacity-40"
            >
              {saving ? '保存中…' : '保存'}
            </button>
          </div>
        </footer>
      </aside>
    </div>
  );
}
