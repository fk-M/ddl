import type { SyncPushInput, SyncPushResult, SyncSnapshot, SyncRow } from '@ddl/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { listGroups, lists, tags, tasks } from '../../db/schema';

/**
 * 双端同步：电脑上的 PGlite 作为同步枢纽。
 * - pull 返回核心实体的全量快照（含 deletedAt 墓碑），不做增量水位，
 *   避免两端时钟偏差导致漏同步；待办数据量小，全量最可靠。
 * - push 逐条按 updatedAt 做 LWW 判定，只有客户端版本更新才写库。
 * 写入顺序必须保持 listGroups → lists → tags → tasks，以满足外键依赖。
 */

function serialize(row: unknown): SyncRow {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
    out[key] = value instanceof Date ? value.toISOString() : value;
  }
  return out as SyncRow;
}

function iso(value: unknown): Date | null {
  if (typeof value !== 'string' || !value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function nullableText(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function number(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function boolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function validRow(raw: Record<string, unknown>): boolean {
  return typeof raw.id === 'string' && raw.id.length > 0 && iso(raw.updatedAt) !== null;
}

function toListGroupRow(raw: Record<string, unknown>) {
  return {
    id: text(raw.id, ''),
    name: text(raw.name, '未命名分组'),
    collapsed: boolean(raw.collapsed),
    sortOrder: number(raw.sortOrder),
    createdAt: iso(raw.createdAt) ?? new Date(),
    updatedAt: iso(raw.updatedAt) ?? new Date(),
  };
}

function toListRow(raw: Record<string, unknown>) {
  return {
    id: text(raw.id, ''),
    name: text(raw.name, '未命名清单'),
    color: text(raw.color, '#3b82f6'),
    icon: text(raw.icon, 'list'),
    isInbox: boolean(raw.isInbox),
    sortOrder: number(raw.sortOrder),
    groupId: nullableText(raw.groupId),
    kind: text(raw.kind, 'task'),
    archived: boolean(raw.archived),
    deletedAt: iso(raw.deletedAt),
    viewMode: text(raw.viewMode, 'list'),
    kanbanColumns: raw.kanbanColumns ?? null,
    permission: text(raw.permission, 'private'),
    createdAt: iso(raw.createdAt) ?? new Date(),
    updatedAt: iso(raw.updatedAt) ?? new Date(),
  };
}

function toTagRow(raw: Record<string, unknown>) {
  return {
    id: text(raw.id, ''),
    name: text(raw.name, '未命名标签'),
    color: text(raw.color, '#6366f1'),
    parentId: nullableText(raw.parentId),
    sortOrder: number(raw.sortOrder),
    deletedAt: iso(raw.deletedAt),
    createdAt: iso(raw.createdAt) ?? new Date(),
    updatedAt: iso(raw.updatedAt) ?? new Date(),
  };
}

function toTaskRow(raw: Record<string, unknown>) {
  return {
    id: text(raw.id, ''),
    listId: text(raw.listId, ''),
    parentId: nullableText(raw.parentId),
    title: text(raw.title, '未命名任务'),
    notes: nullableText(raw.notes),
    status: raw.status === 'completed' ? 'completed' : 'pending',
    kind: raw.kind === 'note' ? 'note' : 'task',
    columnId: nullableText(raw.columnId),
    priority: number(raw.priority),
    isImportant: boolean(raw.isImportant),
    isUrgent: boolean(raw.isUrgent),
    dueAt: iso(raw.dueAt),
    allDay: boolean(raw.allDay),
    remindAt: iso(raw.remindAt),
    rrule: nullableText(raw.rrule),
    repeatFrom: raw.repeatFrom === 'completion' ? 'completion' : 'due',
    tags: Array.isArray(raw.tags)
      ? raw.tags.filter((item): item is string => typeof item === 'string')
      : [],
    estimatePomodoros: number(raw.estimatePomodoros),
    actualPomodoros: number(raw.actualPomodoros),
    pinned: boolean(raw.pinned),
    sortOrder: number(raw.sortOrder),
    deletedAt: iso(raw.deletedAt),
    completedAt: iso(raw.completedAt),
    createdAt: iso(raw.createdAt) ?? new Date(),
    updatedAt: iso(raw.updatedAt) ?? new Date(),
  };
}

export function createSyncService(db: Db) {
  async function pull(): Promise<SyncSnapshot> {
    const [groupRows, listRows, tagRows, taskRows] = await Promise.all([
      db.select().from(listGroups),
      db.select().from(lists),
      db.select().from(tags),
      db.select().from(tasks),
    ]);
    return {
      serverTime: new Date().toISOString(),
      listGroups: groupRows.map(serialize),
      lists: listRows.map(serialize),
      tags: tagRows.map(serialize),
      tasks: taskRows.map(serialize),
    };
  }

  async function applyListGroups(rows: Record<string, unknown>[]): Promise<number> {
    const existing = await db
      .select({ id: listGroups.id, updatedAt: listGroups.updatedAt })
      .from(listGroups);
    const clock = new Map(existing.map((row) => [row.id, row.updatedAt]));
    let applied = 0;
    for (const raw of rows) {
      if (!validRow(raw)) continue;
      const row = toListGroupRow(raw);
      const prev = clock.get(row.id);
      if (prev && prev.getTime() >= row.updatedAt.getTime()) continue;
      const { id, ...rest } = row;
      await db.insert(listGroups).values(row).onConflictDoUpdate({ target: listGroups.id, set: rest });
      clock.set(id, row.updatedAt);
      applied += 1;
    }
    return applied;
  }

  async function applyLists(rows: Record<string, unknown>[]): Promise<number> {
    const existing = await db.select({ id: lists.id, updatedAt: lists.updatedAt }).from(lists);
    const clock = new Map(existing.map((row) => [row.id, row.updatedAt]));
    // 收件箱全局唯一：客户端离线自建的草稿收件箱不能插进来，否则整批 push 会 500。
    // 正常情况下同步引擎已先对齐 id，这里是兜底。
    const serverInbox = await db
      .select({ id: lists.id })
      .from(lists)
      .where(eq(lists.isInbox, true))
      .limit(1);
    const inboxId = serverInbox[0]?.id;
    let applied = 0;
    for (const raw of rows) {
      if (!validRow(raw)) continue;
      const row = toListRow(raw);
      if (row.isInbox && inboxId && inboxId !== row.id) continue;
      const prev = clock.get(row.id);
      if (prev && prev.getTime() >= row.updatedAt.getTime()) continue;
      const { id, ...rest } = row;
      try {
        await db.insert(lists).values(row).onConflictDoUpdate({ target: lists.id, set: rest });
        clock.set(id, row.updatedAt);
        applied += 1;
      } catch {
        // 单条约束冲突不影响整批，下一轮同步会重试
      }
    }
    return applied;
  }

  async function applyTags(rows: Record<string, unknown>[]): Promise<number> {
    const existing = await db.select({ id: tags.id, updatedAt: tags.updatedAt }).from(tags);
    const clock = new Map(existing.map((row) => [row.id, row.updatedAt]));
    let applied = 0;
    for (const raw of rows) {
      if (!validRow(raw)) continue;
      const row = toTagRow(raw);
      const prev = clock.get(row.id);
      if (prev && prev.getTime() >= row.updatedAt.getTime()) continue;
      const { id, ...rest } = row;
      await db.insert(tags).values(row).onConflictDoUpdate({ target: tags.id, set: rest });
      clock.set(id, row.updatedAt);
      applied += 1;
    }
    return applied;
  }

  async function applyTasks(rows: Record<string, unknown>[]): Promise<number> {
    const existing = await db.select({ id: tasks.id, updatedAt: tasks.updatedAt }).from(tasks);
    const clock = new Map(existing.map((row) => [row.id, row.updatedAt]));
    const knownLists = new Set((await db.select({ id: lists.id }).from(lists)).map((row) => row.id));
    let applied = 0;
    for (const raw of rows) {
      if (!validRow(raw)) continue;
      const row = toTaskRow(raw);
      // 离线新建的任务若引用了一个服务端还不存在的清单，先跳过而不是让整批同步失败；
      // 对应清单会在下一次同步先落地，之后这条任务自然能写入。
      if (!row.listId || !knownLists.has(row.listId)) continue;
      const prev = clock.get(row.id);
      if (prev && prev.getTime() >= row.updatedAt.getTime()) continue;
      const { id, ...rest } = row;
      try {
        await db.insert(tasks).values(row).onConflictDoUpdate({ target: tasks.id, set: rest });
        clock.set(id, row.updatedAt);
        applied += 1;
      } catch {
        // 单条失败（例如父任务尚未同步）不影响整批，下轮同步会重试
      }
    }
    return applied;
  }

  /** 物理删除必须先于 upsert，否则同一批里被删除的清单可能把新任务级联掉 */
  async function applyPurges(ids: string[]): Promise<void> {
    for (const id of ids) {
      await db.delete(tasks).where(eq(tasks.id, id));
      await db.delete(tags).where(eq(tags.id, id));
      await db.delete(lists).where(eq(lists.id, id));
      await db.delete(listGroups).where(eq(listGroups.id, id));
    }
  }

  async function push(input: SyncPushInput): Promise<SyncPushResult> {
    await applyPurges(input.purgedIds);
    const applied = {
      listGroups: await applyListGroups(input.listGroups),
      lists: await applyLists(input.lists),
      tags: await applyTags(input.tags),
      tasks: await applyTasks(input.tasks),
    };
    return { serverTime: new Date().toISOString(), applied };
  }

  return { pull, push };
}

export type SyncService = ReturnType<typeof createSyncService>;
