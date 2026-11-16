import type {
  Attachment,
  CreateTaskInput,
  Task,
  TaskQuery,
  TaskReminder,
  UpdateTaskInput,
} from '@ddl/shared';
import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { attachments, taskReminders, tasks, type TaskRow } from '../../db/schema';

export function toReminderDto(row: typeof taskReminders.$inferSelect): TaskReminder {
  return {
    id: row.id,
    taskId: row.taskId,
    remindAt: row.remindAt.toISOString(),
    channel: row.channel === 'system' ? 'system' : 'inapp',
    sound: row.sound ?? null,
    snoozeMinutes: row.snoozeMinutes,
    persistent: row.persistent,
  };
}

export function toAttachmentDto(row: typeof attachments.$inferSelect): Attachment {
  return {
    id: row.id,
    taskId: row.taskId,
    name: row.name,
    mime: row.mime,
    size: row.size,
    url: `/api/attachments/${row.id}/raw`,
    createdAt: row.createdAt.toISOString(),
  };
}

export type TaskExtras = {
  reminders: TaskReminder[];
  attachments: Attachment[];
  childCount: number;
  childDoneCount: number;
};

export function toTaskDto(row: TaskRow, extras?: Partial<TaskExtras>): Task {
  return {
    id: row.id,
    listId: row.listId,
    title: row.title,
    notes: row.notes ?? null,
    status: row.status === 'completed' ? 'completed' : 'pending',
    kind: row.kind === 'note' ? 'note' : 'task',
    columnId: row.columnId ?? null,
    priority: (row.priority >= 1 && row.priority <= 3 ? row.priority : 0) as 0 | 1 | 2 | 3,
    isImportant: row.isImportant,
    isUrgent: row.isUrgent,
    parentId: row.parentId ?? null,
    dueAt: row.dueAt ? row.dueAt.toISOString() : null,
    allDay: row.allDay,
    remindAt: row.remindAt ? row.remindAt.toISOString() : null,
    rrule: row.rrule ?? null,
    repeatFrom: row.repeatFrom === 'completion' ? 'completion' : 'due',
    tags: row.tags ?? [],
    estimatePomodoros: row.estimatePomodoros,
    actualPomodoros: row.actualPomodoros,
    pinned: row.pinned,
    sortOrder: row.sortOrder,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    reminders: extras?.reminders ?? [],
    attachments: extras?.attachments ?? [],
    childCount: extras?.childCount ?? 0,
    childDoneCount: extras?.childDoneCount ?? 0,
  };
}

function buildOrder(query: TaskQuery) {
  const direction = query.order === 'asc' ? asc : desc;
  const overdueFirst = sql`case when ${tasks.status} = 'pending' then 0 else 1 end`;

  switch (query.sort) {
    case 'dueAt':
      return [overdueFirst, sql`${tasks.dueAt} asc nulls last`, desc(tasks.priority)];
    case 'priority':
      return [overdueFirst, desc(tasks.priority), sql`${tasks.dueAt} asc nulls last`];
    case 'createdAt':
      return [overdueFirst, direction(tasks.createdAt)];
    case 'completedAt':
      return [sql`${tasks.completedAt} desc nulls last`, overdueFirst];
    case 'title':
      return [overdueFirst, direction(tasks.title)];
    case 'list':
      return [overdueFirst, asc(tasks.listId), sql`${tasks.sortOrder} asc`];
    case 'tag':
      return [overdueFirst, sql`${tasks.tags} asc`, sql`${tasks.dueAt} asc nulls last`];
    case 'manual':
      return [overdueFirst, asc(tasks.sortOrder), asc(tasks.createdAt)];
    default:
      return [
        desc(tasks.pinned),
        overdueFirst,
        sql`${tasks.dueAt} asc nulls last`,
        desc(tasks.priority),
        asc(tasks.sortOrder),
        desc(tasks.createdAt),
      ];
  }
}

export function createTasksRepo(db: Db) {
  return {
    async findMany(query: TaskQuery): Promise<TaskRow[]> {
      const conditions: SQL[] = [];

      if (query.trashed) conditions.push(isNotNull(tasks.deletedAt));
      else conditions.push(isNull(tasks.deletedAt));

      if (query.listId) conditions.push(eq(tasks.listId, query.listId));
      if (query.listIds && query.listIds.length > 0) conditions.push(inArray(tasks.listId, query.listIds));
      if (query.parentId) conditions.push(eq(tasks.parentId, query.parentId));
      if (query.topLevelOnly) conditions.push(isNull(tasks.parentId));
      if (query.status) conditions.push(eq(tasks.status, query.status));
      if (query.kind) conditions.push(eq(tasks.kind, query.kind));
      if (query.dueFrom) conditions.push(gte(tasks.dueAt, new Date(query.dueFrom)));
      if (query.dueTo) conditions.push(lte(tasks.dueAt, new Date(query.dueTo)));
      if (query.hasDue === true) conditions.push(isNotNull(tasks.dueAt));
      if (query.hasDue === false) conditions.push(isNull(tasks.dueAt));
      if (query.overdue) {
        conditions.push(isNotNull(tasks.dueAt));
        conditions.push(sql`${tasks.dueAt} < now()`);
        conditions.push(eq(tasks.status, 'pending'));
      }
      if (query.priorities && query.priorities.length > 0) {
        conditions.push(inArray(tasks.priority, query.priorities));
      }
      if (query.tags && query.tags.length > 0) {
        conditions.push(sql`${tasks.tags} && ${query.tags}::text[]`);
      }
      if (query.important !== undefined) conditions.push(eq(tasks.isImportant, query.important));
      if (query.urgent !== undefined) conditions.push(eq(tasks.isUrgent, query.urgent));
      if (query.completedFrom) conditions.push(gte(tasks.completedAt, new Date(query.completedFrom)));
      if (query.completedTo) conditions.push(lte(tasks.completedAt, new Date(query.completedTo)));
      if (query.since) conditions.push(gte(tasks.updatedAt, new Date(query.since)));

      if (query.q) {
        const keyword = `%${query.q}%`;
        const matched = or(ilike(tasks.title, keyword), ilike(tasks.notes, keyword));
        if (matched) conditions.push(matched);
      }

      return db
        .select()
        .from(tasks)
        .where(and(...conditions))
        .orderBy(...buildOrder(query))
        .limit(query.limit);
    },

    async findById(id: string): Promise<TaskRow | null> {
      const rows = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
      return rows[0] ?? null;
    },

    async findChildren(parentId: string): Promise<TaskRow[]> {
      return db
        .select()
        .from(tasks)
        .where(and(eq(tasks.parentId, parentId), isNull(tasks.deletedAt)))
        .orderBy(asc(tasks.sortOrder), asc(tasks.createdAt));
    },

    /** 批量取子任务统计，避免 N+1 */
    async childStats(ids: string[]): Promise<Map<string, { total: number; done: number }>> {
      const map = new Map<string, { total: number; done: number }>();
      if (ids.length === 0) return map;
      const rows = await db
        .select({
          parentId: tasks.parentId,
          total: sql<number>`count(*)::int`,
          done: sql<number>`sum(case when ${tasks.status} = 'completed' then 1 else 0 end)::int`,
        })
        .from(tasks)
        .where(and(inArray(tasks.parentId, ids), isNull(tasks.deletedAt)))
        .groupBy(tasks.parentId);
      for (const row of rows) {
        if (!row.parentId) continue;
        map.set(row.parentId, { total: Number(row.total) || 0, done: Number(row.done) || 0 });
      }
      return map;
    },

    async remindersFor(taskIds: string[]): Promise<Map<string, TaskReminder[]>> {
      const map = new Map<string, TaskReminder[]>();
      if (taskIds.length === 0) return map;
      const rows = await db
        .select()
        .from(taskReminders)
        .where(inArray(taskReminders.taskId, taskIds))
        .orderBy(asc(taskReminders.remindAt));
      for (const row of rows) {
        const list = map.get(row.taskId) ?? [];
        list.push(toReminderDto(row));
        map.set(row.taskId, list);
      }
      return map;
    },

    async attachmentsFor(taskIds: string[]): Promise<Map<string, Attachment[]>> {
      const map = new Map<string, Attachment[]>();
      if (taskIds.length === 0) return map;
      const rows = await db
        .select()
        .from(attachments)
        .where(inArray(attachments.taskId, taskIds))
        .orderBy(asc(attachments.createdAt));
      for (const row of rows) {
        const list = map.get(row.taskId) ?? [];
        list.push(toAttachmentDto(row));
        map.set(row.taskId, list);
      }
      return map;
    },

    async insert(input: CreateTaskInput, listId: string): Promise<TaskRow> {
      const rows = await db
        .insert(tasks)
        .values({
          listId,
          title: input.title,
          notes: input.notes ?? null,
          kind: input.kind ?? 'task',
          columnId: input.columnId ?? null,
          priority: input.priority,
          isImportant: input.isImportant,
          isUrgent: input.isUrgent,
          parentId: input.parentId ?? null,
          dueAt: input.dueAt ? new Date(input.dueAt) : null,
          allDay: input.allDay,
          remindAt: input.remindAt ? new Date(input.remindAt) : null,
          rrule: input.rrule ?? null,
          repeatFrom: input.repeatFrom ?? 'due',
          tags: input.tags,
          estimatePomodoros: input.estimatePomodoros ?? 0,
          pinned: input.pinned ?? false,
          sortOrder: input.sortOrder ?? Date.now(),
        })
        .returning();
      const row = rows[0];
      if (!row) throw new Error('创建任务失败：数据库未返回记录');
      return row;
    },

    async update(id: string, patch: UpdateTaskInput): Promise<TaskRow | null> {
      const values: Partial<typeof tasks.$inferInsert> = { updatedAt: new Date() };

      if (patch.title !== undefined) values.title = patch.title;
      if (patch.listId !== undefined) values.listId = patch.listId;
      if (patch.notes !== undefined) values.notes = patch.notes;
      if (patch.kind !== undefined) values.kind = patch.kind;
      if (patch.columnId !== undefined) values.columnId = patch.columnId;
      if (patch.priority !== undefined) values.priority = patch.priority;
      if (patch.isImportant !== undefined) values.isImportant = patch.isImportant;
      if (patch.isUrgent !== undefined) values.isUrgent = patch.isUrgent;
      if (patch.parentId !== undefined) values.parentId = patch.parentId;
      if (patch.allDay !== undefined) values.allDay = patch.allDay;
      if (patch.rrule !== undefined) values.rrule = patch.rrule;
      if (patch.repeatFrom !== undefined) values.repeatFrom = patch.repeatFrom;
      if (patch.tags !== undefined) values.tags = patch.tags;
      if (patch.estimatePomodoros !== undefined) values.estimatePomodoros = patch.estimatePomodoros;
      if (patch.pinned !== undefined) values.pinned = patch.pinned;
      if (patch.sortOrder !== undefined) values.sortOrder = patch.sortOrder;
      if ('dueAt' in patch) values.dueAt = patch.dueAt ? new Date(patch.dueAt) : null;
      if ('remindAt' in patch) values.remindAt = patch.remindAt ? new Date(patch.remindAt) : null;

      if (patch.status !== undefined) {
        values.status = patch.status;
        values.completedAt = patch.status === 'completed' ? new Date() : null;
      }

      const rows = await db.update(tasks).set(values).where(eq(tasks.id, id)).returning();
      return rows[0] ?? null;
    },

    /** 软删除（进垃圾桶） */
    async softDelete(id: string): Promise<boolean> {
      const rows = await db
        .update(tasks)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(tasks.id, id))
        .returning({ id: tasks.id });
      return rows.length > 0;
    },

    async restore(id: string): Promise<boolean> {
      const rows = await db
        .update(tasks)
        .set({ deletedAt: null, updatedAt: new Date() })
        .where(eq(tasks.id, id))
        .returning({ id: tasks.id });
      return rows.length > 0;
    },

    /** 硬删除 */
    async purge(id: string): Promise<boolean> {
      const rows = await db.delete(tasks).where(eq(tasks.id, id)).returning({ id: tasks.id });
      return rows.length > 0;
    },

    async emptyTrash(): Promise<number> {
      const rows = await db
        .delete(tasks)
        .where(and(isNotNull(tasks.deletedAt), isNull(tasks.parentId)))
        .returning({ id: tasks.id });
      return rows.length;
    },

    async batchUpdate(ids: string[], values: Partial<typeof tasks.$inferInsert>): Promise<number> {
      if (ids.length === 0) return 0;
      const rows = await db
        .update(tasks)
        .set({ ...values, updatedAt: new Date() })
        .where(inArray(tasks.id, ids))
        .returning({ id: tasks.id });
      return rows.length;
    },

    /** 重复任务完成后派生下一次实例 */
    async spawnNextOccurrence(source: TaskRow, dueAt: Date): Promise<TaskRow> {
      const shift = source.dueAt ? dueAt.getTime() - source.dueAt.getTime() : 0;
      const rows = await db
        .insert(tasks)
        .values({
          listId: source.listId,
          parentId: source.parentId,
          title: source.title,
          notes: source.notes,
          status: 'pending',
          kind: source.kind,
          columnId: source.columnId,
          priority: source.priority,
          isImportant: source.isImportant,
          isUrgent: source.isUrgent,
          dueAt,
          allDay: source.allDay,
          remindAt: source.remindAt ? new Date(source.remindAt.getTime() + shift) : null,
          rrule: source.rrule,
          repeatFrom: source.repeatFrom,
          tags: source.tags,
          estimatePomodoros: source.estimatePomodoros,
          sortOrder: source.sortOrder,
        })
        .returning();
      const row = rows[0];
      if (!row) throw new Error('派生重复任务失败：数据库未返回记录');
      return row;
    },

    /** 统计各清单未完成数量，用于侧边栏角标 */
    async countsByList(): Promise<Map<string, number>> {
      const rows = await db
        .select({ listId: tasks.listId, total: sql<number>`count(*)::int` })
        .from(tasks)
        .where(and(eq(tasks.status, 'pending'), isNull(tasks.deletedAt), isNull(tasks.parentId)))
        .groupBy(tasks.listId);
      const map = new Map<string, number>();
      for (const row of rows) map.set(row.listId, Number(row.total) || 0);
      return map;
    },

    async addReminders(
      taskId: string,
      reminders: { remindAt: string; channel?: string; sound?: string | null; snoozeMinutes?: number; persistent?: boolean }[],
    ): Promise<void> {
      if (reminders.length === 0) return;
      await db.insert(taskReminders).values(
        reminders.map((item) => ({
          taskId,
          remindAt: new Date(item.remindAt),
          channel: item.channel ?? 'inapp',
          sound: item.sound ?? null,
          snoozeMinutes: item.snoozeMinutes ?? 5,
          persistent: item.persistent ?? false,
        })),
      );
    },

    async replaceReminders(
      taskId: string,
      reminders: { remindAt: string; channel?: string; sound?: string | null; snoozeMinutes?: number; persistent?: boolean }[],
    ): Promise<void> {
      await db.delete(taskReminders).where(eq(taskReminders.taskId, taskId));
      await this.addReminders(taskId, reminders);
      // 兼容旧字段：把最早的一条同步到 tasks.remind_at
      const first = [...reminders].sort((a, b) => a.remindAt.localeCompare(b.remindAt))[0];
      await db
        .update(tasks)
        .set({ remindAt: first ? new Date(first.remindAt) : null, updatedAt: new Date() })
        .where(eq(tasks.id, taskId));
    },

    async bumpPomodoro(taskId: string): Promise<void> {
      await db
        .update(tasks)
        .set({ actualPomodoros: sql`${tasks.actualPomodoros} + 1`, updatedAt: new Date() })
        .where(eq(tasks.id, taskId));
    },
  };
}

export type TasksRepo = ReturnType<typeof createTasksRepo>;

export const orderHelpers = { asc };
