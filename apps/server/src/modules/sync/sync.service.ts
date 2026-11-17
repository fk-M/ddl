import type { SyncPushInput, SyncPushResult, SyncSnapshot, SyncRow } from '@ddl/shared';
import { and, eq, ne } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { anniversaries, habitLogs, habits, listGroups, lists, tags, tasks } from '../../db/schema';

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

function toHabitRow(raw: Record<string, unknown>) {
  return {
    id: text(raw.id, ''),
    name: text(raw.name, '未命名习惯'),
    icon: text(raw.icon, '✅'),
    color: text(raw.color, '#22c55e'),
    freqType: text(raw.freqType, 'daily'),
    freqConfig: (raw.freqConfig ?? {}) as Record<string, unknown>,
    goalPerPeriod: number(raw.goalPerPeriod, 1),
    unit: text(raw.unit, '次'),
    remindAt: nullableText(raw.remindAt),
    archived: boolean(raw.archived),
    deletedAt: iso(raw.deletedAt),
    sortOrder: number(raw.sortOrder),
    createdAt: iso(raw.createdAt) ?? new Date(),
    updatedAt: iso(raw.updatedAt) ?? new Date(),
  };
}

function toHabitLogRow(raw: Record<string, unknown>) {
  const rawDate = typeof raw.logDate === 'string' ? raw.logDate : '';
  return {
    id: text(raw.id, ''),
    habitId: text(raw.habitId, ''),
    logDate: rawDate.slice(0, 10),
    status: raw.status === 'skip' ? 'skip' : 'done',
    value: number(raw.value, 1),
    note: nullableText(raw.note),
    createdAt: iso(raw.createdAt) ?? iso(raw.updatedAt) ?? new Date(),
  };
}

function toAnniversaryRow(raw: Record<string, unknown>) {
  const rawDate = typeof raw.eventDate === 'string' ? raw.eventDate : '';
  return {
    id: text(raw.id, ''),
    title: text(raw.title, '未命名纪念日'),
    eventDate: rawDate.slice(0, 10) || new Date().toISOString().slice(0, 10),
    type: text(raw.type, 'countdown'),
    repeatYearly: boolean(raw.repeatYearly),
    lunar: boolean(raw.lunar),
    color: text(raw.color, '#f97316'),
    icon: text(raw.icon, '🎂'),
    notes: nullableText(raw.notes),
    archived: boolean(raw.archived),
    deletedAt: iso(raw.deletedAt),
    sortOrder: number(raw.sortOrder),
    createdAt: iso(raw.createdAt) ?? new Date(),
    updatedAt: iso(raw.updatedAt) ?? new Date(),
  };
}

export function createSyncService(db: Db) {
  async function pull(): Promise<SyncSnapshot> {
    const [groupRows, listRows, tagRows, taskRows, habitRows, logRows, anniversaryRows] =
      await Promise.all([
        db.select().from(listGroups),
        db.select().from(lists),
        db.select().from(tags),
        db.select().from(tasks),
        db.select().from(habits),
        db.select().from(habitLogs),
        db.select().from(anniversaries),
      ]);
    return {
      serverTime: new Date().toISOString(),
      listGroups: groupRows.map(serialize),
      lists: listRows.map(serialize),
      tags: tagRows.map(serialize),
      tasks: taskRows.map(serialize),
      habits: habitRows.map(serialize),
      // 打卡记录没有 updatedAt 列（只增不改），用 createdAt 当 LWW 时钟
      habitLogs: logRows.map((row) => ({ ...serialize(row), updatedAt: row.createdAt.toISOString() })),
      anniversaries: anniversaryRows.map(serialize),
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

  async function applyHabits(rows: Record<string, unknown>[]): Promise<number> {
    const existing = await db.select({ id: habits.id, updatedAt: habits.updatedAt }).from(habits);
    const clock = new Map(existing.map((row) => [row.id, row.updatedAt]));
    let applied = 0;
    for (const raw of rows) {
      if (!validRow(raw)) continue;
      const row = toHabitRow(raw);
      const prev = clock.get(row.id);
      if (prev && prev.getTime() >= row.updatedAt.getTime()) continue;
      const { id, ...rest } = row;
      try {
        await db.insert(habits).values(row).onConflictDoUpdate({ target: habits.id, set: rest });
        clock.set(id, row.updatedAt);
        applied += 1;
      } catch {
        // 单条失败不影响整批
      }
    }
    return applied;
  }

  /**
   * 打卡记录：id 由「习惯 + 日期」确定性生成，两端离线打卡会算出同一个 id，
   * 所以直接按 id upsert 即可去重；同一习惯同一天若残留了别的 id（历史数据），
   * 顺手清掉，避免统计重复计数。
   */
  async function applyHabitLogs(rows: Record<string, unknown>[]): Promise<number> {
    const knownHabits = new Set((await db.select({ id: habits.id }).from(habits)).map((row) => row.id));
    let applied = 0;
    for (const raw of rows) {
      // habit_logs 表没有 updated_at，不能用通用 validRow（它要求 raw.updatedAt）。
      // 客户端会用 createdAt 兼作 LWW 时钟，这里只要求有 id + 任一可用时间。
      const hasClock = iso(raw.createdAt) !== null || iso(raw.updatedAt) !== null;
      if (typeof raw.id !== 'string' || !raw.id || !hasClock) continue;
      const row = toHabitLogRow(raw);
      if (!row.habitId || !row.logDate || !knownHabits.has(row.habitId)) continue;
      try {
        await db.insert(habitLogs).values(row).onConflictDoUpdate({ target: habitLogs.id, set: row });
        await db
          .delete(habitLogs)
          .where(
            and(
              eq(habitLogs.habitId, row.habitId),
              eq(habitLogs.logDate, row.logDate),
              ne(habitLogs.id, row.id),
            ),
          );
        applied += 1;
      } catch (error) {
        // 习惯尚未同步过来时会命中外键，跳过等下一轮；其它错误也要留痕，
        // 静默吞掉会让「手机上打了卡、电脑上看不到」变成无从排查的幽灵 bug。
        console.warn('[sync] habit log 写入失败，已跳过：', (error as Error)?.message, row.id);
      }
    }
    return applied;
  }

  async function applyAnniversaries(rows: Record<string, unknown>[]): Promise<number> {
    const existing = await db
      .select({ id: anniversaries.id, updatedAt: anniversaries.updatedAt })
      .from(anniversaries);
    const clock = new Map(existing.map((row) => [row.id, row.updatedAt]));
    let applied = 0;
    for (const raw of rows) {
      if (!validRow(raw)) continue;
      const row = toAnniversaryRow(raw);
      const prev = clock.get(row.id);
      if (prev && prev.getTime() >= row.updatedAt.getTime()) continue;
      const { id, ...rest } = row;
      try {
        await db
          .insert(anniversaries)
          .values(row)
          .onConflictDoUpdate({ target: anniversaries.id, set: rest });
        clock.set(id, row.updatedAt);
        applied += 1;
      } catch {
        // 单条失败不影响整批
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
      // 打卡记录先于习惯删除，避免外键残留
      await db.delete(habitLogs).where(eq(habitLogs.id, id));
      await db.delete(habits).where(eq(habits.id, id));
      await db.delete(anniversaries).where(eq(anniversaries.id, id));
    }
  }

  async function push(input: SyncPushInput): Promise<SyncPushResult> {
    await applyPurges(input.purgedIds);
    const applied = {
      listGroups: await applyListGroups(input.listGroups),
      lists: await applyLists(input.lists),
      tags: await applyTags(input.tags),
      tasks: await applyTasks(input.tasks),
      // 习惯必须在打卡记录之前落地（外键依赖）
      habits: await applyHabits(input.habits),
      habitLogs: await applyHabitLogs(input.habitLogs),
      anniversaries: await applyAnniversaries(input.anniversaries),
    };
    return { serverTime: new Date().toISOString(), applied };
  }

  return { pull, push };
}

export type SyncService = ReturnType<typeof createSyncService>;
