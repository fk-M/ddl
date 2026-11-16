import type {
  AppSettings,
  Attachment,
  BatchTaskInput,
  CreateListGroupPayload,
  CreateListPayload,
  CreateTagPayload,
  CreateTaskPayload,
  ListGroup,
  Tag,
  Task,
  TaskList,
  TaskQuery,
  UpdateListPayload,
  UpdateTagPayload,
  UpdateTaskPayload,
} from '@ddl/shared';
import {
  deleteAttachmentRow,
  deleteAttachmentsByTask,
  deleteRows,
  getAttachmentRow,
  getAll,
  getMeta,
  getRow,
  listAttachmentsByTask,
  putAttachmentRow,
  putRows,
  setMeta,
  type LocalRow,
  type SyncStore,
} from './local-db';
import { AppSettingsSchema } from '@ddl/shared';
import { scheduleSync } from './sync-engine';

/** 手机端「本地优先」数据源：所有核心读写落在 IndexedDB，离线完整可用 */
function now(): string {
  return new Date().toISOString();
}

function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const rand = (Math.random() * 16) | 0;
    return (char === 'x' ? rand : (rand & 0x3) | 0x8).toString(16);
  });
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}
function nullableStr(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}
function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
function bool(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}
function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}
function priority(value: unknown): 0 | 1 | 2 | 3 {
  const parsed = num(value);
  return parsed >= 1 && parsed <= 3 ? (Math.floor(parsed) as 1 | 2 | 3) : 0;
}

async function insert(store: SyncStore, row: LocalRow): Promise<LocalRow> {
  await putRows(store, [row]);
  scheduleSync();
  return row;
}

async function patch(
  store: SyncStore,
  id: string,
  changes: Record<string, unknown>,
): Promise<LocalRow | null> {
  const row = await getRow<LocalRow>(store, id);
  if (!row) return null;
  const next: LocalRow = { ...row, ...changes, updatedAt: now(), _dirty: true };
  await putRows(store, [next]);
  scheduleSync();
  return next;
}

/** 物理删除必须记入待推送墓碑，否则下一轮 pull 会把记录带回来 */
async function purgeIds(store: SyncStore, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await deleteRows(store, ids);
  const pending = (await getMeta<string[]>('purgedIds')) ?? [];
  await setMeta('purgedIds', [...new Set([...pending, ...ids])]);
  scheduleSync();
}

/* ------------------------------ 行 → DTO ------------------------------ */

function rowToTask(row: LocalRow, stats?: { total: number; done: number }): Task {
  return {
    id: row.id,
    listId: str(row.listId),
    title: str(row.title, '未命名任务'),
    notes: nullableStr(row.notes),
    status: row.status === 'completed' ? 'completed' : 'pending',
    kind: row.kind === 'note' ? 'note' : 'task',
    columnId: nullableStr(row.columnId),
    priority: priority(row.priority),
    isImportant: bool(row.isImportant),
    isUrgent: bool(row.isUrgent),
    parentId: nullableStr(row.parentId),
    dueAt: nullableStr(row.dueAt),
    allDay: bool(row.allDay),
    remindAt: nullableStr(row.remindAt),
    rrule: nullableStr(row.rrule),
    repeatFrom: row.repeatFrom === 'completion' ? 'completion' : 'due',
    tags: strings(row.tags),
    estimatePomodoros: num(row.estimatePomodoros),
    actualPomodoros: num(row.actualPomodoros),
    pinned: bool(row.pinned),
    sortOrder: num(row.sortOrder),
    completedAt: nullableStr(row.completedAt),
    createdAt: str(row.createdAt, row.updatedAt),
    updatedAt: str(row.updatedAt),
    reminders: [],
    attachments: [],
    childCount: stats?.total ?? 0,
    childDoneCount: stats?.done ?? 0,
  };
}

function rowToList(row: LocalRow): TaskList {
  return {
    id: row.id,
    name: str(row.name, '未命名清单'),
    color: str(row.color, '#3b82f6'),
    icon: str(row.icon, 'list'),
    isInbox: bool(row.isInbox),
    sortOrder: num(row.sortOrder),
    groupId: nullableStr(row.groupId),
    kind: row.kind === 'note' ? 'note' : 'task',
    archived: bool(row.archived),
    viewMode: row.viewMode === 'kanban' ? 'kanban' : 'list',
    kanbanColumns: Array.isArray(row.kanbanColumns)
      ? (row.kanbanColumns as { id: string; name: string }[])
      : [],
    permission: str(row.permission, 'private'),
    createdAt: str(row.createdAt, row.updatedAt),
    updatedAt: str(row.updatedAt),
  };
}

function rowToTag(row: LocalRow): Tag {
  return {
    id: row.id,
    name: str(row.name, '未命名标签'),
    color: str(row.color, '#6366f1'),
    parentId: nullableStr(row.parentId),
    sortOrder: num(row.sortOrder),
    createdAt: str(row.createdAt, row.updatedAt),
    updatedAt: str(row.updatedAt),
  };
}

function rowToGroup(row: LocalRow): ListGroup {
  return {
    id: row.id,
    name: str(row.name, '未命名分组'),
    collapsed: bool(row.collapsed),
    sortOrder: num(row.sortOrder),
    createdAt: str(row.createdAt, row.updatedAt),
    updatedAt: str(row.updatedAt),
  };
}

/* ------------------------------ 清单 ------------------------------ */

function makeListRow(payload: Partial<CreateListPayload> & { isInbox?: boolean }): LocalRow {
  const stamp = now();
  return {
    id: uuid(),
    name: payload.name ?? '未命名清单',
    color: payload.color ?? '#3b82f6',
    icon: payload.icon ?? 'list',
    isInbox: payload.isInbox ?? false,
    sortOrder: payload.sortOrder ?? 0,
    groupId: payload.groupId ?? null,
    kind: payload.kind ?? 'task',
    archived: false,
    deletedAt: null,
    viewMode: payload.viewMode ?? 'list',
    kanbanColumns: payload.kanbanColumns ?? null,
    permission: 'private',
    createdAt: stamp,
    updatedAt: stamp,
    _dirty: true,
  };
}

async function resolveListId(listId?: string | null): Promise<string> {
  if (listId) {
    const existing = await getRow<LocalRow>('lists', listId);
    if (existing) return listId;
  }
  const all = await getAll<LocalRow>('lists');
  const inbox = all.find((row) => bool(row.isInbox) && !row.deletedAt);
  if (inbox) return inbox.id;
  // 完全离线首次启动：本地库是空的，先造一个收件箱，保证立刻能记任务
  const created = await insert('lists', makeListRow({ name: '收件箱', isInbox: true }));
  return created.id;
}

export async function localLists(includeArchived = false): Promise<TaskList[]> {
  const rows = await getAll<LocalRow>('lists');
  return rows
    .filter((row) => !row.deletedAt && (includeArchived || !bool(row.archived)))
    .map(rowToList)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt));
}

export async function localArchivedLists(): Promise<TaskList[]> {
  const rows = await getAll<LocalRow>('lists');
  return rows.filter((row) => !row.deletedAt && bool(row.archived)).map(rowToList);
}

export async function localCreateList(payload: CreateListPayload): Promise<TaskList> {
  return rowToList(await insert('lists', makeListRow(payload)));
}

export async function localUpdateList(id: string, payload: UpdateListPayload): Promise<TaskList> {
  const changes: Record<string, unknown> = {};
  const source = payload as Record<string, unknown>;
  for (const key of [
    'name', 'color', 'icon', 'sortOrder', 'groupId', 'kind', 'archived', 'viewMode', 'kanbanColumns',
  ]) {
    if (source[key] !== undefined) changes[key] = source[key];
  }
  const row = await patch('lists', id, changes);
  if (!row) throw new Error('清单不存在');
  return rowToList(row);
}

export async function localDeleteList(id: string): Promise<void> {
  await patch('lists', id, { deletedAt: now() });
}

export async function localArchiveList(id: string, archived: boolean): Promise<TaskList> {
  const row = await patch('lists', id, { archived });
  if (!row) throw new Error('清单不存在');
  return rowToList(row);
}

export async function localDuplicateList(id: string, onlyPending = false): Promise<TaskList> {
  const source = await getRow<LocalRow>('lists', id);
  if (!source) throw new Error('清单不存在');
  const copy = await insert('lists', {
    ...source,
    id: uuid(),
    name: `${str(source.name, '清单')} 副本`,
    isInbox: false,
    createdAt: now(),
    updatedAt: now(),
    _dirty: true,
  });
  const tasks = await getAll<LocalRow>('tasks');
  const clones = tasks
    .filter((row) => row.listId === id && !row.deletedAt && (!onlyPending || row.status !== 'completed'))
    .map((row) => ({
      ...row,
      id: uuid(),
      listId: copy.id,
      parentId: null,
      createdAt: now(),
      updatedAt: now(),
      _dirty: true,
    }));
  if (clones.length > 0) {
    await putRows('tasks', clones);
    scheduleSync();
  }
  return rowToList(copy);
}

export async function localListGroups(): Promise<ListGroup[]> {
  return (await getAll<LocalRow>('listGroups')).map(rowToGroup);
}

export async function localCreateListGroup(payload: CreateListGroupPayload): Promise<ListGroup> {
  const stamp = now();
  return rowToGroup(
    await insert('listGroups', {
      id: uuid(),
      name: payload.name ?? '未命名分组',
      collapsed: payload.collapsed ?? false,
      sortOrder: payload.sortOrder ?? 0,
      createdAt: stamp,
      updatedAt: stamp,
      _dirty: true,
    }),
  );
}

export async function localUpdateListGroup(
  id: string,
  payload: Partial<CreateListGroupPayload>,
): Promise<ListGroup> {
  const row = await patch('listGroups', id, payload as Record<string, unknown>);
  if (!row) throw new Error('分组不存在');
  return rowToGroup(row);
}

export async function localDeleteListGroup(id: string): Promise<void> {
  // 组内清单先移到「未分组」，否则离线时这些清单会变成孤儿、从侧栏消失
  const rows = await getAll<LocalRow>('lists');
  for (const row of rows) {
    if (row.groupId === id && !row.deletedAt) {
      await patch('lists', row.id, { groupId: null, _dirty: true });
    }
  }
  await purgeIds('listGroups', [id]);
}

/* ------------------------------ 任务 ------------------------------ */

function childStats(rows: LocalRow[]): Map<string, { total: number; done: number }> {
  const map = new Map<string, { total: number; done: number }>();
  for (const row of rows) {
    if (!row.parentId || row.deletedAt) continue;
    const key = str(row.parentId);
    const stat = map.get(key) ?? { total: 0, done: 0 };
    stat.total += 1;
    if (row.status === 'completed') stat.done += 1;
    map.set(key, stat);
  }
  return map;
}

export async function localTasks(query: Partial<TaskQuery>): Promise<Task[]> {
  const rows = await getAll<LocalRow>('tasks');
  const trashed = Boolean(query.trashed);
  const stamp = now();
  let items = rows.filter((row) => (trashed ? Boolean(row.deletedAt) : !row.deletedAt));

  if (query.listId) items = items.filter((row) => row.listId === query.listId);
  if (query.listIds?.length) items = items.filter((row) => query.listIds!.includes(str(row.listId)));
  if (query.parentId) items = items.filter((row) => row.parentId === query.parentId);
  if (query.topLevelOnly) items = items.filter((row) => !row.parentId);
  if (query.status) items = items.filter((row) => row.status === query.status);
  if (query.kind) items = items.filter((row) => row.kind === query.kind);
  if (query.dueFrom) items = items.filter((row) => str(row.dueAt) >= query.dueFrom!);
  if (query.dueTo) items = items.filter((row) => Boolean(row.dueAt) && str(row.dueAt) <= query.dueTo!);
  if (query.hasDue === true) items = items.filter((row) => Boolean(row.dueAt));
  if (query.hasDue === false) items = items.filter((row) => !row.deletedAt && !row.dueAt);
  if (query.overdue) {
    items = items.filter(
      (row) => Boolean(row.dueAt) && str(row.dueAt) < stamp && row.status !== 'completed',
    );
  }
  if (query.priorities?.length) {
    items = items.filter((row) => query.priorities!.includes(priority(row.priority)));
  }
  if (query.tags?.length) {
    items = items.filter((row) => strings(row.tags).some((tag) => query.tags!.includes(tag)));
  }
  if (query.important !== undefined) items = items.filter((row) => bool(row.isImportant) === query.important);
  if (query.urgent !== undefined) items = items.filter((row) => bool(row.isUrgent) === query.urgent);
  if (query.completedFrom) items = items.filter((row) => str(row.completedAt) >= query.completedFrom!);
  if (query.completedTo) {
    items = items.filter((row) => Boolean(row.completedAt) && str(row.completedAt) <= query.completedTo!);
  }
  if (query.since) items = items.filter((row) => str(row.updatedAt) >= query.since!);
  if (query.q) {
    const needle = query.q.toLowerCase();
    items = items.filter(
      (row) =>
        str(row.title).toLowerCase().includes(needle) || str(row.notes).toLowerCase().includes(needle),
    );
  }

  const sort = query.sort ?? 'manual';
  const direction = query.order === 'asc' ? 1 : -1;
  const sortKey = (row: LocalRow): string | number => {
    switch (sort) {
      case 'dueAt':
        return str(row.dueAt) || '9999';
      case 'priority':
        return -priority(row.priority);
      case 'createdAt':
        return str(row.createdAt, row.updatedAt);
      case 'completedAt':
        return str(row.completedAt);
      case 'title':
        return str(row.title).toLowerCase();
      case 'list':
        return str(row.listId);
      case 'tag':
        return strings(row.tags)[0] ?? '';
      default:
        return num(row.sortOrder);
    }
  };
  items.sort((a, b) => {
    if (bool(a.pinned) !== bool(b.pinned)) return bool(a.pinned) ? -1 : 1;
    const doneA = a.status === 'completed' ? 1 : 0;
    const doneB = b.status === 'completed' ? 1 : 0;
    if (doneA !== doneB) return doneA - doneB;
    const ka = sortKey(a);
    const kb = sortKey(b);
    const cmp = typeof ka === 'number' && typeof kb === 'number'
      ? ka - kb
      : String(ka).localeCompare(String(kb));
    return direction * cmp;
  });

  const stats = childStats(rows);
  return items.slice(0, query.limit ?? 500).map((row) => rowToTask(row, stats.get(row.id)));
}

export async function localTask(id: string): Promise<Task> {
  const row = await getRow<LocalRow>('tasks', id);
  if (!row) throw new Error('任务不存在');
  return rowToTask(row, childStats(await getAll<LocalRow>('tasks')).get(id));
}

export async function localTaskCounts(): Promise<Record<string, number>> {
  const rows = await getAll<LocalRow>('tasks');
  const result: Record<string, number> = {};
  for (const row of rows) {
    if (row.deletedAt || row.status === 'completed' || row.parentId) continue;
    const key = str(row.listId);
    result[key] = (result[key] ?? 0) + 1;
  }
  return result;
}

const TASK_CREATE_FIELDS = [
  'title', 'notes', 'kind', 'columnId', 'priority', 'isImportant', 'isUrgent', 'parentId',
  'dueAt', 'allDay', 'remindAt', 'rrule', 'repeatFrom', 'tags', 'estimatePomodoros',
  'pinned', 'sortOrder',
] as const;

export async function localCreateTask(payload: CreateTaskPayload): Promise<Task> {
  const stamp = now();
  const source = payload as Record<string, unknown>;
  const row: LocalRow = {
    id: uuid(),
    listId: await resolveListId(payload.listId),
    status: 'pending',
    kind: 'task',
    columnId: null,
    priority: 0,
    isImportant: false,
    isUrgent: false,
    parentId: null,
    dueAt: null,
    allDay: false,
    remindAt: null,
    rrule: null,
    repeatFrom: 'due',
    tags: [],
    estimatePomodoros: 0,
    actualPomodoros: 0,
    pinned: false,
    sortOrder: Date.now(),
    deletedAt: null,
    completedAt: null,
    createdAt: stamp,
    updatedAt: stamp,
    _dirty: true,
  };
  for (const key of TASK_CREATE_FIELDS) {
    if (source[key] !== undefined) row[key] = source[key];
  }
  return rowToTask(await insert('tasks', row));
}

const TASK_PATCH_FIELDS = [
  ...TASK_CREATE_FIELDS, 'status', 'listId', 'actualPomodoros',
] as const;

export async function localUpdateTask(id: string, payload: UpdateTaskPayload): Promise<Task> {
  const source = payload as Record<string, unknown>;
  const changes: Record<string, unknown> = {};
  for (const key of TASK_PATCH_FIELDS) {
    if (source[key] !== undefined) changes[key] = source[key];
  }
  if (source.status !== undefined) {
    changes.completedAt = source.status === 'completed' ? now() : null;
  }
  const row = await patch('tasks', id, changes);
  if (!row) throw new Error('任务不存在');
  return rowToTask(row);
}

export async function localToggleTask(
  id: string,
): Promise<{ task: Task; spawned: Task | null; undo: string }> {
  const existing = await getRow<LocalRow>('tasks', id);
  if (!existing) throw new Error('任务不存在');
  const nextStatus = existing.status === 'completed' ? 'pending' : 'completed';
  const row = await patch('tasks', id, {
    status: nextStatus,
    completedAt: nextStatus === 'completed' ? now() : null,
  });
  return {
    task: rowToTask(row!),
    // 离线模式下不派生重复实例；联网同步后由服务端规则处理后续实例
    spawned: null,
    undo: nextStatus === 'completed' ? 'completed' : 'uncompleted',
  };
}

export async function localDeleteTask(id: string, purge = false): Promise<void> {
  if (purge) {
    await purgeIds('tasks', [id]);
    // 永久删除才清理附件；软删除要能随任务一起恢复
    await deleteAttachmentsByTask(id);
    return;
  }
  await patch('tasks', id, { deletedAt: now() });
}

export async function localRestoreTask(id: string): Promise<{ ok: boolean }> {
  await patch('tasks', id, { deletedAt: null });
  return { ok: true };
}

export async function localEmptyTrash(): Promise<{ removed: number }> {
  const rows = await getAll<LocalRow>('tasks');
  const ids = rows.filter((row) => Boolean(row.deletedAt) && !row.parentId).map((row) => row.id);
  await purgeIds('tasks', ids);
  // 清空回收站是永久删除，附件一并清理，避免 Blob 长期占用存储
  for (const id of ids) await deleteAttachmentsByTask(id);
  return { removed: ids.length };
}

export async function localSetQuadrant(id: string, isImportant: boolean, isUrgent: boolean): Promise<Task> {
  const row = await patch('tasks', id, { isImportant, isUrgent });
  if (!row) throw new Error('任务不存在');
  return rowToTask(row);
}

export async function localReorderTask(id: string, sortOrder: number): Promise<{ ok: boolean }> {
  await patch('tasks', id, { sortOrder });
  return { ok: true };
}

export async function localBatchTasks(input: BatchTaskInput): Promise<{ affected: number }> {
  const { ids, action, payload } = input;
  let affected = 0;
  for (const id of ids) {
    const row = await getRow<LocalRow>('tasks', id);
    if (!row) continue;
    switch (action) {
      case 'complete':
      case 'uncomplete': {
        const done = action === 'complete';
        await patch('tasks', id, { status: done ? 'completed' : 'pending', completedAt: done ? now() : null });
        break;
      }
      case 'delete':
        await patch('tasks', id, { deletedAt: now() });
        break;
      case 'restore':
        await patch('tasks', id, { deletedAt: null });
        break;
      case 'purge':
        await purgeIds('tasks', [id]);
        break;
      case 'move':
        if (payload?.listId) await patch('tasks', id, { listId: payload.listId });
        break;
      case 'setDue':
        await patch('tasks', id, { dueAt: payload?.dueAt ?? null });
        break;
      case 'setPriority':
        if (payload?.priority !== undefined) await patch('tasks', id, { priority: payload.priority });
        break;
      case 'setImportant':
        if (payload?.isImportant !== undefined) await patch('tasks', id, { isImportant: payload.isImportant });
        break;
      case 'setUrgent':
        if (payload?.isUrgent !== undefined) await patch('tasks', id, { isUrgent: payload.isUrgent });
        break;
      case 'setQuadrant':
        await patch('tasks', id, {
          isImportant: payload?.isImportant ?? false,
          isUrgent: payload?.isUrgent ?? false,
        });
        break;
      case 'pin':
      case 'unpin':
        await patch('tasks', id, { pinned: action === 'pin' });
        break;
      case 'addTags':
      case 'removeTags': {
        const current = new Set(strings(row.tags));
        for (const tag of payload?.tags ?? []) {
          if (action === 'addTags') current.add(tag);
          else current.delete(tag);
        }
        await patch('tasks', id, { tags: [...current] });
        break;
      }
    }
    affected += 1;
  }
  return { affected };
}

/* ------------------------------ 标签 ------------------------------ */

export async function localTags(): Promise<(Tag & { taskCount: number })[]> {
  const [rows, tasks] = await Promise.all([
    getAll<LocalRow>('tags'),
    getAll<LocalRow>('tasks'),
  ]);
  const counts = new Map<string, number>();
  for (const task of tasks) {
    if (task.deletedAt) continue;
    for (const tag of strings(task.tags)) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return rows
    .filter((row) => !row.deletedAt)
    .map((row) => ({ ...rowToTag(row), taskCount: counts.get(str(row.name)) ?? 0 }));
}

export async function localCreateTag(payload: CreateTagPayload): Promise<Tag> {
  const stamp = now();
  return rowToTag(
    await insert('tags', {
      id: uuid(),
      name: payload.name ?? '未命名标签',
      color: payload.color ?? '#6366f1',
      parentId: payload.parentId ?? null,
      sortOrder: payload.sortOrder ?? 0,
      deletedAt: null,
      createdAt: stamp,
      updatedAt: stamp,
      _dirty: true,
    }),
  );
}

export async function localUpdateTag(id: string, payload: UpdateTagPayload): Promise<Tag> {
  const row = await patch('tags', id, payload as Record<string, unknown>);
  if (!row) throw new Error('标签不存在');
  return rowToTag(row);
}

export async function localDeleteTag(id: string): Promise<void> {
  await patch('tags', id, { deletedAt: now() });
}

/* ------------------------------ 附件（本地优先） ------------------------------ */

/**
 * 本地附件的虚拟 URL 前缀。详情面板据此判断该走本地 Blob，
 * 而不是当成服务端的 http 下载地址。
 */
export const LOCAL_ATTACHMENT_PREFIX = 'local-attachment://';

/** 与服务端 MAX_BYTES 保持一致，避免两端规则不一致导致行为分裂 */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

function attachmentToDto(row: {
  id: string;
  taskId: string;
  name: string;
  mime: string;
  size: number;
  createdAt: string;
}): Attachment {
  return {
    id: row.id,
    taskId: row.taskId,
    name: row.name,
    mime: row.mime,
    size: row.size,
    url: `${LOCAL_ATTACHMENT_PREFIX}${row.id}`,
    createdAt: row.createdAt,
  };
}

export async function localListAttachments(taskId: string): Promise<Attachment[]> {
  const rows = await listAttachmentsByTask(taskId);
  return rows
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((row) => attachmentToDto(row));
}

export async function localAddAttachment(taskId: string, file: File): Promise<Attachment> {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error('单个附件不能超过 20MB');
  }
  const row = {
    id: uuid(),
    taskId,
    name: file.name || '未命名文件',
    mime: file.type || 'application/octet-stream',
    size: file.size,
    blob: file,
    createdAt: now(),
  };
  await putAttachmentRow(row);
  return attachmentToDto(row);
}

export async function localDeleteAttachment(id: string): Promise<void> {
  await deleteAttachmentRow(id);
}

/** 删除任务时顺带清理它的附件，避免 Blob 变成无人引用的垃圾 */
export async function localPurgeTaskAttachments(taskId: string): Promise<void> {
  await deleteAttachmentsByTask(taskId);
}

function base64OfBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('读取附件失败'));
    reader.readAsDataURL(blob);
  });
}

/** 用 id + 原扩展名落盘，避开中文/空格等文件名在部分设备上的兼容问题 */
function safeAttachmentName(id: string, name: string): string {
  const ext = /\.([A-Za-z0-9]{1,8})$/.exec(name)?.[1];
  return ext ? `${id}.${ext.toLowerCase()}` : id;
}

/**
 * 打开本地附件：先写到缓存目录，再交给系统分享面板让用户选择用什么 App 打开。
 * Android WebView 不支持直接打开 blob: URL，必须落成真实文件。
 */
export async function localOpenAttachment(id: string): Promise<void> {
  const row = await getAttachmentRow(id);
  if (!row) throw new Error('附件不存在或已被删除');

  const { Capacitor } = await import('@capacitor/core');
  if (!Capacitor.isNativePlatform()) {
    // 浏览器/桌面端预览：blob URL 足够
    const url = URL.createObjectURL(row.blob);
    window.open(url, '_blank');
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return;
  }

  const [{ Filesystem, Directory }, { Share }] = await Promise.all([
    import('@capacitor/filesystem'),
    import('@capacitor/share'),
  ]);
  const data = await base64OfBlob(row.blob);
  const written = await Filesystem.writeFile({
    path: `ddl-attachments/${safeAttachmentName(row.id, row.name)}`,
    data,
    directory: Directory.Cache,
    recursive: true,
  });

  const canShare = await Share.canShare();
  if (!canShare.value) throw new Error('当前设备没有可用于打开该附件的应用');
  await Share.share({ title: row.name, text: row.name, url: written.uri, dialogTitle: '打开附件' });
}

/* ============================== 设置（本地优先） ============================== */

const SETTINGS_META_KEY = 'app-settings';

/**
 * 手机端设置存在 IndexedDB 的 meta store 里。
 * 之前设置只走服务端接口，手机离线时所有开关都是「点了没反应」——
 * 主题、提醒、导航顺序这些本来就跟设备相关，落本地更合理。
 * 设置不参与同步协议，各设备各自保留。
 */
export async function localGetSettings(): Promise<AppSettings> {
  const stored = await getMeta<Partial<AppSettings>>(SETTINGS_META_KEY);
  const merged = { ...AppSettingsSchema.parse({}) } as Record<string, unknown>;
  for (const [key, value] of Object.entries(stored ?? {})) {
    if (value !== undefined) merged[key] = value;
  }
  return merged as AppSettings;
}

export async function localPatchSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const current = await localGetSettings();
  const next = AppSettingsSchema.parse({ ...current, ...patch });
  await setMeta(SETTINGS_META_KEY, next);
  return next;
}

export async function localResetSettings(): Promise<AppSettings> {
  const defaults = AppSettingsSchema.parse({});
  await setMeta(SETTINGS_META_KEY, defaults);
  return defaults;
}

/* ============================== 本地导出 ============================== */

/** 手机端导出 JSON 备份：结构与服务端 /api/backup/export 对齐，可直接在桌面端导入 */
export async function localExportJson(): Promise<string> {
  const [listGroups, lists, tags, tasks, settings] = await Promise.all([
    getAll('listGroups'),
    getAll('lists'),
    getAll('tags'),
    getAll('tasks'),
    localGetSettings(),
  ]);
  const payload = {
    app: 'ddl',
    exportedAt: new Date().toISOString(),
    source: 'android-local-first',
    listGroups,
    lists,
    tags,
    tasks: tasks.filter((task) => !(task as { deletedAt?: string | null }).deletedAt),
    templates: [],
    habits: [],
    habitLogs: [],
    focusSessions: [],
    anniversaries: [],
    smartLists: [],
    sources: [],
    settings: Object.entries(settings).map(([key, value]) => ({ key, value })),
  };
  return JSON.stringify(payload, null, 2);
}
