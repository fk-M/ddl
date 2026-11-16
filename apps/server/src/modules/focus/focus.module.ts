import { CreateFocusSessionInputSchema } from '@ddl/shared';
import type { FocusSession, FocusStats } from '@ddl/shared';
import { and, desc, eq, gte, isNotNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../../db/client';
import { focusSessions, tasks, type FocusSessionRow } from '../../db/schema';
import { NotFoundError } from '../../lib/errors';
import { toDateKey } from '../../lib/lunar';

const IdParamSchema = z.object({ id: z.string().uuid() });
const DAY = 86_400_000;

function toDto(row: FocusSessionRow): FocusSession {
  return {
    id: row.id,
    taskId: row.taskId ?? null,
    taskTitle: row.taskTitle ?? null,
    type: row.type as FocusSession['type'],
    plannedSeconds: row.plannedSeconds,
    actualSeconds: row.actualSeconds,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt ? row.endedAt.toISOString() : null,
    completed: row.completed,
    note: row.note ?? null,
  };
}

function startOfDay(date = new Date()): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function registerFocusRoutes(app: FastifyInstance, db: Db): void {
  app.get('/api/focus/sessions', async (request) => {
    const query = z
      .object({
        from: z.string().optional(),
        to: z.string().optional(),
        type: z.enum(['focus', 'shortBreak', 'longBreak']).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      })
      .parse(request.query);

    const conditions = [];
    if (query.from) conditions.push(gte(focusSessions.startedAt, new Date(query.from)));
    if (query.to) conditions.push(sql`${focusSessions.startedAt} <= ${new Date(query.to)}`);
    if (query.type) conditions.push(eq(focusSessions.type, query.type));

    const rows = await db
      .select()
      .from(focusSessions)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(focusSessions.startedAt))
      .limit(query.limit);

    return { data: rows.map(toDto) };
  });

  app.post('/api/focus/sessions', async (request, reply) => {
    const input = CreateFocusSessionInputSchema.parse(request.body);

    // 关联任务时校验存在性并快照标题，避免任务删除后统计丢名字
    let taskTitle = input.taskTitle ?? null;
    if (input.taskId) {
      const rows = await db
        .select({ title: tasks.title })
        .from(tasks)
        .where(eq(tasks.id, input.taskId))
        .limit(1);
      const found = rows[0];
      if (!found) throw new NotFoundError('关联的任务不存在');
      taskTitle = found.title;
    }

    const rows = await db
      .insert(focusSessions)
      .values({
        taskId: input.taskId ?? null,
        taskTitle,
        type: input.type,
        plannedSeconds: input.plannedSeconds,
        actualSeconds: input.actualSeconds,
        startedAt: input.startedAt ? new Date(input.startedAt) : new Date(),
        endedAt: input.endedAt ? new Date(input.endedAt) : new Date(),
        completed: input.completed,
        note: input.note ?? null,
      })
      .returning();

    // 完成一个番茄后累加任务的番茄计数
    if (input.completed && input.type === 'focus' && input.taskId) {
      await db
        .update(tasks)
        .set({ actualPomodoros: sql`${tasks.actualPomodoros} + 1`, updatedAt: new Date() })
        .where(eq(tasks.id, input.taskId));
    }

    return reply.status(201).send({ data: toDto(rows[0]!) });
  });

  app.delete('/api/focus/sessions/:id', async (request, reply) => {
    const { id } = IdParamSchema.parse(request.params);
    const rows = await db.delete(focusSessions).where(eq(focusSessions.id, id)).returning({ id: focusSessions.id });
    if (rows.length === 0) throw new NotFoundError('专注记录不存在');
    return reply.status(204).send();
  });

  app.get('/api/focus/stats', async (): Promise<{ data: FocusStats }> => {
    const todayStart = startOfDay();
    const weekStart = new Date(todayStart.getTime() - ((todayStart.getDay() + 6) % 7) * DAY);
    const daysAgo14 = new Date(todayStart.getTime() - 13 * DAY);

    const focusOnly = eq(focusSessions.type, 'focus');

    const [todayAgg, weekAgg, totalAgg] = await Promise.all([
      db
        .select({
          seconds: sql<number>`coalesce(sum(${focusSessions.actualSeconds}), 0)::int`,
          count: sql<number>`count(*)::int`,
        })
        .from(focusSessions)
        .where(and(focusOnly, gte(focusSessions.startedAt, todayStart))),
      db
        .select({
          seconds: sql<number>`coalesce(sum(${focusSessions.actualSeconds}), 0)::int`,
          count: sql<number>`count(*)::int`,
        })
        .from(focusSessions)
        .where(and(focusOnly, gte(focusSessions.startedAt, weekStart))),
      db
        .select({
          seconds: sql<number>`coalesce(sum(${focusSessions.actualSeconds}), 0)::int`,
          count: sql<number>`count(*)::int`,
          days: sql<number>`count(distinct date(${focusSessions.startedAt}))::int`,
        })
        .from(focusSessions)
        .where(focusOnly),
    ]);

    const dailyRows = await db
      .select({
        date: sql<string>`date(${focusSessions.startedAt})::text`,
        seconds: sql<number>`coalesce(sum(${focusSessions.actualSeconds}), 0)::int`,
        count: sql<number>`count(*)::int`,
      })
      .from(focusSessions)
      .where(and(focusOnly, gte(focusSessions.startedAt, daysAgo14)))
      .groupBy(sql`date(${focusSessions.startedAt})`);

    const dailyMap = new Map(dailyRows.map((row) => [row.date, row]));
    const daily: FocusStats['daily'] = [];
    for (let offset = 13; offset >= 0; offset -= 1) {
      const cursor = new Date(todayStart.getTime() - offset * DAY);
      const key = toDateKey(cursor);
      const found = dailyMap.get(key);
      daily.push({ date: key, seconds: Number(found?.seconds ?? 0), count: Number(found?.count ?? 0) });
    }

    const topRows = await db
      .select({
        taskId: focusSessions.taskId,
        title: sql<string>`coalesce(${focusSessions.taskTitle}, '未关联任务')`,
        seconds: sql<number>`coalesce(sum(${focusSessions.actualSeconds}), 0)::int`,
      })
      .from(focusSessions)
      .where(and(focusOnly, isNotNull(focusSessions.taskTitle)))
      .groupBy(focusSessions.taskId, focusSessions.taskTitle)
      .orderBy(desc(sql`coalesce(sum(${focusSessions.actualSeconds}), 0)`))
      .limit(8);

    return {
      data: {
        todaySeconds: Number(todayAgg[0]?.seconds ?? 0),
        todayCount: Number(todayAgg[0]?.count ?? 0),
        weekSeconds: Number(weekAgg[0]?.seconds ?? 0),
        weekCount: Number(weekAgg[0]?.count ?? 0),
        totalSeconds: Number(totalAgg[0]?.seconds ?? 0),
        totalCount: Number(totalAgg[0]?.count ?? 0),
        focusDays: Number(totalAgg[0]?.days ?? 0),
        daily,
        topTasks: topRows.map((row) => ({
          taskId: row.taskId ?? null,
          title: row.title,
          seconds: Number(row.seconds ?? 0),
        })),
      },
    };
  });

  /** 常用专注任务：按历史专注次数排序 */
  app.get('/api/focus/frequent-tasks', async () => {
    const rows = await db
      .select({
        taskId: focusSessions.taskId,
        title: sql<string>`coalesce(${focusSessions.taskTitle}, '')`,
        count: sql<number>`count(*)::int`,
      })
      .from(focusSessions)
      .where(and(eq(focusSessions.type, 'focus'), isNotNull(focusSessions.taskId)))
      .groupBy(focusSessions.taskId, focusSessions.taskTitle)
      .orderBy(desc(sql`count(*)`))
      .limit(10);
    return { data: rows };
  });
}
