import type { CreateListInput, ListGroup, TaskList, UpdateListInput } from '@ddl/shared';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { listGroups, lists, tasks, type ListGroupRow, type ListRow } from '../../db/schema';

export function toListDto(row: ListRow): TaskList {
  const columns = Array.isArray(row.kanbanColumns)
    ? (row.kanbanColumns as { id: string; name: string }[])
    : [
        { id: 'todo', name: '待办' },
        { id: 'doing', name: '进行中' },
        { id: 'done', name: '已完成' },
      ];
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    icon: row.icon,
    isInbox: row.isInbox,
    sortOrder: row.sortOrder,
    groupId: row.groupId ?? null,
    kind: row.kind === 'note' ? 'note' : 'task',
    archived: row.archived,
    viewMode: row.viewMode === 'kanban' ? 'kanban' : 'list',
    kanbanColumns: columns,
    permission: row.permission,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toGroupDto(row: ListGroupRow): ListGroup {
  return {
    id: row.id,
    name: row.name,
    collapsed: row.collapsed,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function createListsRepo(db: Db) {
  return {
    async findAll(includeArchived = false): Promise<ListRow[]> {
      const conditions = [isNull(lists.deletedAt)];
      if (!includeArchived) conditions.push(eq(lists.archived, false));
      return db
        .select()
        .from(lists)
        .where(and(...conditions))
        .orderBy(asc(lists.isInbox), asc(lists.sortOrder), asc(lists.createdAt));
    },

    async findArchived(): Promise<ListRow[]> {
      return db
        .select()
        .from(lists)
        .where(and(isNull(lists.deletedAt), eq(lists.archived, true)))
        .orderBy(asc(lists.sortOrder));
    },

    async findTrashed(): Promise<ListRow[]> {
      return db.select().from(lists).orderBy(asc(lists.sortOrder)).then((rows) => rows);
    },

    async findById(id: string): Promise<ListRow | null> {
      const rows = await db.select().from(lists).where(eq(lists.id, id)).limit(1);
      return rows[0] ?? null;
    },

    async findInbox(): Promise<ListRow | null> {
      const rows = await db.select().from(lists).where(eq(lists.isInbox, true)).limit(1);
      return rows[0] ?? null;
    },

    async insert(input: CreateListInput): Promise<ListRow> {
      const rows = await db
        .insert(lists)
        .values({
          name: input.name,
          color: input.color,
          icon: input.icon,
          sortOrder: input.sortOrder,
          groupId: input.groupId ?? null,
          kind: input.kind ?? 'task',
          viewMode: input.viewMode ?? 'list',
          kanbanColumns: input.kanbanColumns ?? null,
        })
        .returning();
      const row = rows[0];
      if (!row) throw new Error('创建清单失败：数据库未返回记录');
      return row;
    },

    async update(id: string, patch: UpdateListInput): Promise<ListRow | null> {
      const values: Partial<typeof lists.$inferInsert> = { updatedAt: new Date() };
      if (patch.name !== undefined) values.name = patch.name;
      if (patch.color !== undefined) values.color = patch.color;
      if (patch.icon !== undefined) values.icon = patch.icon;
      if (patch.sortOrder !== undefined) values.sortOrder = patch.sortOrder;
      if (patch.groupId !== undefined) values.groupId = patch.groupId;
      if (patch.kind !== undefined) values.kind = patch.kind;
      if (patch.viewMode !== undefined) values.viewMode = patch.viewMode;
      if (patch.kanbanColumns !== undefined) values.kanbanColumns = patch.kanbanColumns;
      if (patch.archived !== undefined) values.archived = patch.archived;

      const rows = await db.update(lists).set(values).where(eq(lists.id, id)).returning();
      return rows[0] ?? null;
    },

    async remove(id: string): Promise<boolean> {
      const rows = await db.delete(lists).where(eq(lists.id, id)).returning({ id: lists.id });
      return rows.length > 0;
    },

    /** 复制清单：连同任务一起复制（可选只复制未完成） */
    async duplicate(source: ListRow, onlyPending: boolean): Promise<ListRow> {
      const created = await db
        .insert(lists)
        .values({
          name: `${source.name} 副本`,
          color: source.color,
          icon: source.icon,
          sortOrder: Date.now(),
          groupId: source.groupId,
          kind: source.kind,
          viewMode: source.viewMode,
          kanbanColumns: source.kanbanColumns,
        })
        .returning();
      const target = created[0];
      if (!target) throw new Error('复制清单失败');

      const sourceTasks = await db
        .select()
        .from(tasks)
        .where(and(eq(tasks.listId, source.id), isNull(tasks.deletedAt)))
        .orderBy(asc(tasks.sortOrder));

      const filtered = onlyPending ? sourceTasks.filter((item) => item.status !== 'completed') : sourceTasks;
      const idMap = new Map<string, string>();

      // 先插顶层，再插子任务，保证父引用有效
      const tops = filtered.filter((item) => !item.parentId);
      const children = filtered.filter((item) => item.parentId);

      for (const item of tops) {
        const rows = await db
          .insert(tasks)
          .values({
            listId: target.id,
            title: item.title,
            notes: item.notes,
            status: item.status,
            kind: item.kind,
            columnId: item.columnId,
            priority: item.priority,
            isImportant: item.isImportant,
            isUrgent: item.isUrgent,
            dueAt: item.dueAt,
            allDay: item.allDay,
            remindAt: item.remindAt,
            rrule: item.rrule,
            repeatFrom: item.repeatFrom,
            tags: item.tags,
            estimatePomodoros: item.estimatePomodoros,
            sortOrder: item.sortOrder,
            completedAt: item.completedAt,
          })
          .returning({ id: tasks.id });
        const newId = rows[0]?.id;
        if (newId) idMap.set(item.id, newId);
      }

      for (const item of children) {
        const parentId = item.parentId ? idMap.get(item.parentId) : null;
        if (!parentId) continue;
        await db.insert(tasks).values({
          listId: target.id,
          parentId,
          title: item.title,
          status: item.status,
          kind: item.kind,
          priority: item.priority,
          dueAt: item.dueAt,
          allDay: item.allDay,
          tags: item.tags,
          sortOrder: item.sortOrder,
          completedAt: item.completedAt,
        });
      }

      return target;
    },

    /* ---------------- 分组 ---------------- */

    async findGroups(): Promise<ListGroupRow[]> {
      return db.select().from(listGroups).orderBy(asc(listGroups.sortOrder), asc(listGroups.createdAt));
    },

    async insertGroup(name: string, sortOrder: number): Promise<ListGroupRow> {
      const rows = await db.insert(listGroups).values({ name, sortOrder }).returning();
      const row = rows[0];
      if (!row) throw new Error('创建分组失败');
      return row;
    },

    async updateGroup(id: string, patch: { name?: string; collapsed?: boolean; sortOrder?: number }): Promise<ListGroupRow | null> {
      const values: Partial<typeof listGroups.$inferInsert> = { updatedAt: new Date() };
      if (patch.name !== undefined) values.name = patch.name;
      if (patch.collapsed !== undefined) values.collapsed = patch.collapsed;
      if (patch.sortOrder !== undefined) values.sortOrder = patch.sortOrder;
      const rows = await db.update(listGroups).set(values).where(eq(listGroups.id, id)).returning();
      return rows[0] ?? null;
    },

    async removeGroup(id: string): Promise<boolean> {
      const rows = await db.delete(listGroups).where(eq(listGroups.id, id)).returning({ id: listGroups.id });
      return rows.length > 0;
    },
  };
}

export type ListsRepo = ReturnType<typeof createListsRepo>;
