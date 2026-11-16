import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../../db/client';
import {
  anniversaries,
  focusSessions,
  habitLogs,
  habits,
  listGroups,
  lists,
  settings,
  smartLists,
  sources,
  tags,
  taskTemplates,
  tasks,
} from '../../db/schema';
import { csvToObjects, toCsv } from '../../lib/csv';
import { BadRequestError } from '../../lib/errors';
import { buildIcs, parseIcs } from '../../lib/ics';

export function registerBackupRoutes(app: FastifyInstance, db: Db): void {
  app.get('/api/backup/export', async (request, reply) => {
    const query = z.object({ format: z.enum(['json', 'csv', 'ics']).default('json') }).parse(request.query);

    const [
      groupRows,
      listRows,
      tagRows,
      taskRows,
      templateRows,
      habitRows,
      habitLogRows,
      focusRows,
      anniversaryRows,
      smartListRows,
      settingRows,
      sourceRows,
    ] = await Promise.all([
      db.select().from(listGroups),
      db.select().from(lists),
      db.select().from(tags),
      db.select().from(tasks),
      db.select().from(taskTemplates),
      db.select().from(habits),
      db.select().from(habitLogs),
      db.select().from(focusSessions),
      db.select().from(anniversaries),
      db.select().from(smartLists),
      db.select().from(settings),
      db.select().from(sources),
    ]);

    const stamp = new Date().toISOString().slice(0, 10);

    if (query.format === 'csv') {
      const listName = new Map(listRows.map((row) => [row.id, row.name]));
      const csv = toCsv(
        ['title', 'list', 'status', 'priority', 'dueAt', 'allDay', 'tags', 'notes', 'rrule', 'completedAt', 'createdAt'],
        taskRows.map((row) => [
          row.title,
          listName.get(row.listId) ?? '',
          row.status,
          row.priority,
          row.dueAt ? row.dueAt.toISOString() : '',
          row.allDay,
          (row.tags ?? []).join('|'),
          row.notes ?? '',
          row.rrule ?? '',
          row.completedAt ? row.completedAt.toISOString() : '',
          row.createdAt.toISOString(),
        ]),
      );
      reply.header('Content-Type', 'text/csv; charset=utf-8');
      reply.header('Content-Disposition', `attachment; filename="ddl-tasks-${stamp}.csv"`);
      return reply.send(csv);
    }

    if (query.format === 'ics') {
      const ics = buildIcs(
        taskRows
          .filter((row) => row.dueAt)
          .map((row) => ({
            uid: `${row.id}@ddl`,
            title: row.title,
            description: row.notes,
            startsAt: row.dueAt!,
            allDay: row.allDay,
            rrule: row.rrule,
            done: row.status === 'completed',
          })),
        'DDL 任务',
      );
      reply.header('Content-Type', 'text/calendar; charset=utf-8');
      reply.header('Content-Disposition', `attachment; filename="ddl-tasks-${stamp}.ics"`);
      return reply.send(ics);
    }

    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      listGroups: groupRows,
      lists: listRows,
      tags: tagRows,
      tasks: taskRows,
      templates: templateRows,
      habits: habitRows,
      habitLogs: habitLogRows,
      focusSessions: focusRows,
      anniversaries: anniversaryRows,
      smartLists: smartListRows,
      settings: settingRows,
      sources: sourceRows,
    };

    reply.header('Content-Type', 'application/json; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="ddl-backup-${stamp}.json"`);
    return reply.send(JSON.stringify(payload, null, 2));
  });

  app.post('/api/backup/import', { bodyLimit: 32 * 1024 * 1024 }, async (request) => {
    const body = z
      .object({
        format: z.enum(['json', 'csv', 'ics']),
        data: z.string().min(1),
        /** 导入到哪个清单；为空时用收件箱 */
        listId: z.string().uuid().optional(),
        /** 导入后是否默认建为已完成 */
        markCompleted: z.boolean().default(false),
      })
      .parse(request.body);

    const inboxRows = await db.select().from(lists).limit(1);
    const targetListId = body.listId ?? inboxRows[0]?.id;
    if (!targetListId) throw new BadRequestError('没有可导入的清单，请先创建清单');

    let imported = 0;
    let skipped = 0;

    if (body.format === 'json') {
      let parsed: unknown;
      try {
        parsed = JSON.parse(body.data);
      } catch {
        throw new BadRequestError('JSON 解析失败，请检查文件内容');
      }
      const root = parsed as Record<string, unknown>;

      // 清单：按名称复用或新建
      const listIdMap = new Map<string, string>();
      const incomingLists = Array.isArray(root.lists) ? (root.lists as Record<string, unknown>[]) : [];
      const existingLists = await db.select().from(lists);
      const byName = new Map(existingLists.map((row) => [row.name, row.id]));

      for (const item of incomingLists) {
        const name = String(item.name ?? '未命名清单');
        const known = byName.get(name);
        if (known) {
          listIdMap.set(String(item.id), known);
          continue;
        }
        const inserted = await db
          .insert(lists)
          .values({
            name,
            color: String(item.color ?? '#3b82f6'),
            icon: String(item.icon ?? 'list'),
            kind: item.kind === 'note' ? 'note' : 'task',
          })
          .returning({ id: lists.id });
        const newId = inserted[0]!.id;
        byName.set(name, newId);
        listIdMap.set(String(item.id), newId);
      }

      const incomingTasks = Array.isArray(root.tasks) ? (root.tasks as Record<string, unknown>[]) : [];
      const parentMap = new Map<string, string>();

      for (const item of incomingTasks) {
        const mappedList = listIdMap.get(String(item.listId)) ?? targetListId;
        const inserted = await db
          .insert(tasks)
          .values({
            listId: mappedList,
            title: String(item.title ?? '未命名任务'),
            notes: item.notes === null || item.notes === undefined ? null : String(item.notes),
            status: item.status === 'completed' || body.markCompleted ? 'completed' : 'pending',
            kind: item.kind === 'note' ? 'note' : 'task',
            priority: Number(item.priority ?? 0),
            isImportant: Boolean(item.isImportant),
            isUrgent: Boolean(item.isUrgent),
            dueAt: item.dueAt ? new Date(String(item.dueAt)) : null,
            allDay: Boolean(item.allDay),
            rrule: item.rrule ? String(item.rrule) : null,
            repeatFrom: item.repeatFrom === 'completion' ? 'completion' : 'due',
            tags: Array.isArray(item.tags) ? (item.tags as string[]) : [],
            completedAt: item.completedAt ? new Date(String(item.completedAt)) : null,
          })
          .returning({ id: tasks.id });
        parentMap.set(String(item.id), inserted[0]!.id);
        imported += 1;
      }

      // 补子任务的父引用（父子都必须已导入）
      for (const item of incomingTasks) {
        const oldParent = item.parentId ? String(item.parentId) : null;
        if (!oldParent) continue;
        const newId = parentMap.get(String(item.id));
        const newParent = parentMap.get(oldParent);
        if (newId && newParent) {
          await db.update(tasks).set({ parentId: newParent }).where(eq(tasks.id, newId));
        }
      }

      const incomingHabits = Array.isArray(root.habits) ? (root.habits as Record<string, unknown>[]) : [];
      for (const item of incomingHabits) {
        await db.insert(habits).values({
          name: String(item.name ?? '未命名习惯'),
          icon: String(item.icon ?? '✅'),
          color: String(item.color ?? '#22c55e'),
          freqType: String(item.freqType ?? 'daily'),
          freqConfig: (item.freqConfig ?? {}) as never,
          goalPerPeriod: Number(item.goalPerPeriod ?? 1),
          unit: String(item.unit ?? '次'),
        });
        imported += 1;
      }

      const incomingAnniversaries = Array.isArray(root.anniversaries)
        ? (root.anniversaries as Record<string, unknown>[])
        : [];
      for (const item of incomingAnniversaries) {
        await db.insert(anniversaries).values({
          title: String(item.title ?? '未命名'),
          eventDate: String(item.eventDate ?? new Date().toISOString().slice(0, 10)),
          type: String(item.type ?? 'countdown'),
          repeatYearly: Boolean(item.repeatYearly),
          lunar: Boolean(item.lunar),
          color: String(item.color ?? '#f97316'),
          icon: String(item.icon ?? '🎂'),
          notes: item.notes ? String(item.notes) : null,
        });
        imported += 1;
      }

      return { data: { imported, skipped } };
    }

    if (body.format === 'csv') {
      const records = csvToObjects(body.data);
      if (records.length === 0) throw new BadRequestError('CSV 中没有可导入的行');

      const listRows = await db.select().from(lists);
      const byName = new Map(listRows.map((row) => [row.name.toLowerCase(), row.id]));

      for (const record of records) {
        const title = (record.title ?? record.任务 ?? record['Task'] ?? '').trim();
        if (!title) {
          skipped += 1;
          continue;
        }
        const listName = (record.list ?? record.清单 ?? '').trim().toLowerCase();
        let listId = listName ? byName.get(listName) : undefined;
        if (!listId && listName) {
          const inserted = await db.insert(lists).values({ name: record.list ?? record.清单 ?? '导入' }).returning({ id: lists.id });
          listId = inserted[0]!.id;
          byName.set(listName, listId);
        }

        const dueRaw = record.dueAt ?? record.due ?? record['截止时间'] ?? '';
        const dueAt = dueRaw ? new Date(dueRaw) : null;

        await db.insert(tasks).values({
          listId: listId ?? targetListId,
          title,
          notes: record.notes ?? record['备注'] ?? null,
          status:
            (record.status ?? '').toLowerCase() === 'completed' || body.markCompleted ? 'completed' : 'pending',
          priority: Number(record.priority ?? 0) || 0,
          dueAt: dueAt && !Number.isNaN(dueAt.getTime()) ? dueAt : null,
          tags: (record.tags ?? '')
            .split(/[|,;]/)
            .map((item) => item.trim())
            .filter(Boolean),
          completedAt:
            (record.status ?? '').toLowerCase() === 'completed' || body.markCompleted ? new Date() : null,
        });
        imported += 1;
      }

      return { data: { imported, skipped } };
    }

    // ICS 导入：每个 VEVENT 建一个任务
    const events = parseIcs(body.data);
    if (events.length === 0) throw new BadRequestError('没有解析到任何日程');

    for (const event of events) {
      await db.insert(tasks).values({
        listId: targetListId,
        title: event.title.slice(0, 490),
        notes: [event.description, event.location].filter(Boolean).join('\n\n').slice(0, 19_000) || null,
        dueAt: event.startsAt,
        allDay: event.allDay,
        rrule: event.rrule,
        status: body.markCompleted ? 'completed' : 'pending',
        completedAt: body.markCompleted ? new Date() : null,
      });
      imported += 1;
    }

    return { data: { imported, skipped } };
  });
}
