import { CheckInInputSchema, CreateHabitInputSchema, UpdateHabitInputSchema } from '@ddl/shared';
import type { Habit, HabitFreqConfig, HabitLog, HabitStats } from '@ddl/shared';
import { and, asc, eq, gte, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../../db/client';
import { habitLogs, habits, type HabitLogRow, type HabitRow } from '../../db/schema';
import { NotFoundError } from '../../lib/errors';
import { toDateKey } from '../../lib/lunar';

const IdParamSchema = z.object({ id: z.string().uuid() });

const DAY = 86_400_000;

function isoWeekday(date: Date): number {
  const day = date.getDay();
  return day === 0 ? 7 : day;
}

/** 该日期是否属于习惯的计划日 */
export function isScheduled(habit: HabitRow, date: Date): boolean {
  const config = (habit.freqConfig ?? {}) as HabitFreqConfig;
  switch (habit.freqType) {
    case 'weekly':
      return (config.weekDays ?? [1, 2, 3, 4, 5, 6, 7]).includes(isoWeekday(date));
    case 'monthly':
      return (config.monthDays ?? [1]).includes(date.getDate());
    case 'custom': {
      const gap = Math.max(1, config.everyNDays ?? 1);
      const start = new Date(habit.createdAt);
      const diffDays = Math.floor(
        (new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() -
          new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime()) /
          DAY,
      );
      return diffDays >= 0 && diffDays % gap === 0;
    }
    case 'daily':
    default:
      return true;
  }
}

function toLogDto(row: HabitLogRow): HabitLog {
  return {
    id: row.id,
    habitId: row.habitId,
    logDate: row.logDate,
    status: row.status === 'skip' ? 'skip' : 'done',
    value: row.value,
    note: row.note ?? null,
  };
}

/** 计算连续天数、最长连续、完成率 */
function computeStats(habit: HabitRow, logs: HabitLogRow[]): HabitStats {
  const doneSet = new Set(logs.filter((log) => log.status === 'done').map((log) => log.logDate));
  const skipSet = new Set(logs.filter((log) => log.status === 'skip').map((log) => log.logDate));

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // 当前连续（跳过算「不中断但也不计数」）
  let currentStreak = 0;
  for (let offset = 0; offset < 730; offset += 1) {
    const cursor = new Date(today.getTime() - offset * DAY);
    if (!isScheduled(habit, cursor)) continue;
    const key = toDateKey(cursor);
    if (doneSet.has(key)) {
      currentStreak += 1;
      continue;
    }
    if (skipSet.has(key)) continue;
    // 今天还没打卡不算断
    if (offset === 0) continue;
    break;
  }

  // 最长连续
  const sortedDone = [...doneSet].sort();
  let bestStreak = 0;
  let run = 0;
  let previous: Date | null = null;
  for (const key of sortedDone) {
    const date = new Date(`${key}T00:00:00`);
    if (previous) {
      // 检查两个打卡日之间是否所有计划日都打了卡
      let continuous = true;
      const cursor = new Date(previous.getTime() + DAY);
      while (cursor.getTime() < date.getTime()) {
        if (isScheduled(habit, cursor) && !doneSet.has(toDateKey(cursor))) {
          continuous = false;
          break;
        }
        cursor.setTime(cursor.getTime() + DAY);
      }
      run = continuous ? run + 1 : 1;
    } else {
      run = 1;
    }
    previous = date;
    bestStreak = Math.max(bestStreak, run);
  }

  // 近 30 天完成率
  let scheduled = 0;
  let done = 0;
  for (let offset = 0; offset < 30; offset += 1) {
    const cursor = new Date(today.getTime() - offset * DAY);
    if (!isScheduled(habit, cursor)) continue;
    scheduled += 1;
    if (doneSet.has(toDateKey(cursor))) done += 1;
  }

  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthCheckIns = logs.filter(
    (log) => log.status === 'done' && new Date(`${log.logDate}T00:00:00`) >= monthStart,
  ).length;

  return {
    totalCheckIns: doneSet.size,
    currentStreak,
    bestStreak: Math.max(bestStreak, currentStreak),
    monthCheckIns,
    completionRate: scheduled > 0 ? done / scheduled : 0,
    calendar: logs.map((log) => ({
      date: log.logDate,
      status: log.status === 'skip' ? 'skip' : 'done',
      value: log.value,
    })),
  };
}

async function loadLogs(db: Db, habitId: string): Promise<HabitLogRow[]> {
  return db
    .select()
    .from(habitLogs)
    .where(eq(habitLogs.habitId, habitId))
    .orderBy(asc(habitLogs.logDate));
}

function decorate(row: HabitRow, logs: HabitLogRow[]): Habit {
  const stats = computeStats(row, logs);
  const todayKey = toDateKey(new Date());
  return {
    id: row.id,
    name: row.name,
    icon: row.icon,
    color: row.color,
    freqType: row.freqType as Habit['freqType'],
    freqConfig: (row.freqConfig ?? {}) as HabitFreqConfig,
    goalPerPeriod: row.goalPerPeriod,
    unit: row.unit,
    remindAt: row.remindAt ?? null,
    archived: row.archived,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    doneToday: logs.some((log) => log.logDate === todayKey && log.status === 'done'),
    streak: stats.currentStreak,
    bestStreak: stats.bestStreak,
    totalCheckIns: stats.totalCheckIns,
    completionRate: stats.completionRate,
    recentDates: logs
      .filter((log) => log.status === 'done' && log.logDate >= toDateKey(new Date(Date.now() - 90 * DAY)))
      .map((log) => log.logDate),
  };
}

export function registerHabitRoutes(app: FastifyInstance, db: Db): void {
  async function requireHabit(id: string): Promise<HabitRow> {
    const rows = await db.select().from(habits).where(eq(habits.id, id)).limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundError('习惯不存在');
    return row;
  }

  app.get('/api/habits', async (request) => {
    const query = z.object({ includeArchived: z.coerce.boolean().optional() }).parse(request.query);
    const conditions = [isNull(habits.deletedAt)];
    if (!query.includeArchived) conditions.push(eq(habits.archived, false));

    const rows = await db
      .select()
      .from(habits)
      .where(and(...conditions))
      .orderBy(asc(habits.sortOrder), asc(habits.createdAt));

    const allLogs = await db.select().from(habitLogs);
    const byHabit = new Map<string, HabitLogRow[]>();
    for (const log of allLogs) {
      const list = byHabit.get(log.habitId) ?? [];
      list.push(log);
      byHabit.set(log.habitId, list);
    }

    return { data: rows.map((row) => decorate(row, byHabit.get(row.id) ?? [])) };
  });

  app.get('/api/habits/:id/stats', async (request) => {
    const { id } = IdParamSchema.parse(request.params);
    const habit = await requireHabit(id);
    const logs = await loadLogs(db, id);
    return { data: computeStats(habit, logs) };
  });

  app.get('/api/habits/:id/logs', async (request) => {
    const { id } = IdParamSchema.parse(request.params);
    await requireHabit(id);
    const query = z.object({ from: z.string().optional() }).parse(request.query);
    const conditions = [eq(habitLogs.habitId, id)];
    if (query.from) conditions.push(gte(habitLogs.logDate, query.from));
    const rows = await db
      .select()
      .from(habitLogs)
      .where(and(...conditions))
      .orderBy(asc(habitLogs.logDate));
    return { data: rows.map(toLogDto) };
  });

  app.post('/api/habits', async (request, reply) => {
    const input = CreateHabitInputSchema.parse(request.body);
    const rows = await db
      .insert(habits)
      .values({
        name: input.name,
        icon: input.icon,
        color: input.color,
        freqType: input.freqType,
        freqConfig: input.freqConfig,
        goalPerPeriod: input.goalPerPeriod,
        unit: input.unit,
        remindAt: input.remindAt ?? null,
        sortOrder: input.sortOrder,
      })
      .returning();
    return reply.status(201).send({ data: decorate(rows[0]!, []) });
  });

  app.patch('/api/habits/:id', async (request) => {
    const { id } = IdParamSchema.parse(request.params);
    await requireHabit(id);
    const patch = UpdateHabitInputSchema.parse(request.body);

    const values: Partial<typeof habits.$inferInsert> = { updatedAt: new Date() };
    if (patch.name !== undefined) values.name = patch.name;
    if (patch.icon !== undefined) values.icon = patch.icon;
    if (patch.color !== undefined) values.color = patch.color;
    if (patch.freqType !== undefined) values.freqType = patch.freqType;
    if (patch.freqConfig !== undefined) values.freqConfig = patch.freqConfig;
    if (patch.goalPerPeriod !== undefined) values.goalPerPeriod = patch.goalPerPeriod;
    if (patch.unit !== undefined) values.unit = patch.unit;
    if (patch.remindAt !== undefined) values.remindAt = patch.remindAt;
    if (patch.sortOrder !== undefined) values.sortOrder = patch.sortOrder;
    if (patch.archived !== undefined) values.archived = patch.archived;

    const rows = await db.update(habits).set(values).where(eq(habits.id, id)).returning();
    const row = rows[0]!;
    return { data: decorate(row, await loadLogs(db, id)) };
  });

  app.delete('/api/habits/:id', async (request, reply) => {
    const { id } = IdParamSchema.parse(request.params);
    await requireHabit(id);
    await db.update(habits).set({ deletedAt: new Date() }).where(eq(habits.id, id));
    return reply.status(204).send();
  });

  /** 打卡 / 取消打卡 / 跳过 */
  app.post('/api/habits/:id/check', async (request) => {
    const { id } = IdParamSchema.parse(request.params);
    const habit = await requireHabit(id);
    const input = CheckInInputSchema.parse(request.body ?? {});

    const existing = await db
      .select()
      .from(habitLogs)
      .where(and(eq(habitLogs.habitId, id), eq(habitLogs.logDate, input.date)))
      .limit(1);

    if (existing[0]) {
      // 再次点击同一天 = 取消打卡
      if (existing[0].status === input.status) {
        await db.delete(habitLogs).where(eq(habitLogs.id, existing[0].id));
      } else {
        await db
          .update(habitLogs)
          .set({ status: input.status, value: input.value, note: input.note ?? null })
          .where(eq(habitLogs.id, existing[0].id));
      }
    } else {
      await db.insert(habitLogs).values({
        habitId: id,
        logDate: input.date,
        status: input.status,
        value: input.value,
        note: input.note ?? null,
      });
    }

    return { data: decorate(habit, await loadLogs(db, id)) };
  });

  app.post('/api/habits/:id/reset', async (request, reply) => {
    const { id } = IdParamSchema.parse(request.params);
    await requireHabit(id);
    await db.delete(habitLogs).where(eq(habitLogs.habitId, id));
    return reply.status(204).send();
  });

  /** 今日习惯概览（首页/小部件用） */
  app.get('/api/habits/summary/today', async () => {
    const rows = await db
      .select()
      .from(habits)
      .where(and(isNull(habits.deletedAt), eq(habits.archived, false)))
      .orderBy(asc(habits.sortOrder));

    const today = new Date();
    const todayKey = toDateKey(today);
    const doneRows = await db
      .select({ habitId: habitLogs.habitId })
      .from(habitLogs)
      .where(and(eq(habitLogs.logDate, todayKey), eq(habitLogs.status, 'done')));
    const doneSet = new Set(doneRows.map((row) => row.habitId));

    const scheduled = rows.filter((row) => isScheduled(row, today));
    return {
      data: {
        total: scheduled.length,
        done: scheduled.filter((row) => doneSet.has(row.id)).length,
        items: scheduled.map((row) => ({
          id: row.id,
          name: row.name,
          icon: row.icon,
          color: row.color,
          done: doneSet.has(row.id),
        })),
      },
    };
  });

  app.get('/api/habits/count/all', async () => {
    const rows = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(habits)
      .where(and(isNull(habits.deletedAt), eq(habits.archived, false)));
    return { data: { total: Number(rows[0]?.total ?? 0) } };
  });
}
