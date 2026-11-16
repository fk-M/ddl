import { CreateCalendarInputSchema, UpdateCalendarInputSchema } from '@ddl/shared';
import type { Calendar, CalendarEvent } from '@ddl/shared';
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../../db/client';
import { calendarEvents, calendars, type CalendarRow } from '../../db/schema';
import { BadRequestError, NotFoundError } from '../../lib/errors';
import { parseIcs } from '../../lib/ics';

const IdParamSchema = z.object({ id: z.string().uuid() });

function toDto(row: CalendarRow): Calendar {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    color: row.color,
    enabled: row.enabled,
    lastSyncedAt: row.lastSyncedAt ? row.lastSyncedAt.toISOString() : null,
    lastError: row.lastError ?? null,
    eventCount: row.eventCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** 拉取并解析远程 .ics，写入 calendar_events */
async function syncCalendar(db: Db, row: CalendarRow): Promise<{ imported: number; error: string | null }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    const response = await fetch(row.url, {
      signal: controller.signal,
      headers: { 'user-agent': 'DDL-Calendar/0.1', accept: 'text/calendar,*/*' },
    });
    clearTimeout(timer);

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    const events = parseIcs(text);

    await db.delete(calendarEvents).where(eq(calendarEvents.calendarId, row.id));

    let imported = 0;
    for (const event of events.slice(0, 5000)) {
      await db
        .insert(calendarEvents)
        .values({
          calendarId: row.id,
          uid: event.uid,
          title: event.title,
          description: event.description,
          location: event.location,
          startsAt: event.startsAt,
          endsAt: event.endsAt,
          allDay: event.allDay,
        })
        .onConflictDoNothing();
      imported += 1;
    }

    await db
      .update(calendars)
      .set({
        lastSyncedAt: new Date(),
        lastError: null,
        eventCount: imported,
        updatedAt: new Date(),
      })
      .where(eq(calendars.id, row.id));

    return { imported, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : '未知错误';
    await db
      .update(calendars)
      .set({ lastError: message, lastSyncedAt: new Date(), updatedAt: new Date() })
      .where(eq(calendars.id, row.id));
    return { imported: 0, error: message };
  }
}

export function registerCalendarRoutes(app: FastifyInstance, db: Db): void {
  app.get('/api/calendars', async () => {
    const rows = await db.select().from(calendars).orderBy(asc(calendars.createdAt));
    return { data: rows.map(toDto) };
  });

  app.post('/api/calendars', async (request, reply) => {
    const input = CreateCalendarInputSchema.parse(request.body);
    if (!/^https?:\/\//i.test(input.url)) throw new BadRequestError('订阅地址必须是 http(s) 链接');

    const rows = await db
      .insert(calendars)
      .values({ name: input.name, url: input.url, color: input.color, enabled: input.enabled })
      .returning();

    const created = rows[0]!;
    const result = await syncCalendar(db, created);
    const fresh = await db.select().from(calendars).where(eq(calendars.id, created.id)).limit(1);
    return reply.status(201).send({ data: { ...toDto(fresh[0] ?? created), sync: result } });
  });

  app.patch('/api/calendars/:id', async (request) => {
    const { id } = IdParamSchema.parse(request.params);
    const patch = UpdateCalendarInputSchema.parse(request.body);
    const values: Partial<typeof calendars.$inferInsert> = { updatedAt: new Date() };
    if (patch.name !== undefined) values.name = patch.name;
    if (patch.url !== undefined) values.url = patch.url;
    if (patch.color !== undefined) values.color = patch.color;
    if (patch.enabled !== undefined) values.enabled = patch.enabled;

    const rows = await db.update(calendars).set(values).where(eq(calendars.id, id)).returning();
    if (!rows[0]) throw new NotFoundError('日历不存在');
    return { data: toDto(rows[0]) };
  });

  app.post('/api/calendars/:id/sync', async (request) => {
    const { id } = IdParamSchema.parse(request.params);
    const rows = await db.select().from(calendars).where(eq(calendars.id, id)).limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundError('日历不存在');
    const result = await syncCalendar(db, row);
    const fresh = await db.select().from(calendars).where(eq(calendars.id, id)).limit(1);
    return { data: { calendar: toDto(fresh[0] ?? row), sync: result } };
  });

  app.delete('/api/calendars/:id', async (request, reply) => {
    const { id } = IdParamSchema.parse(request.params);
    const rows = await db.delete(calendars).where(eq(calendars.id, id)).returning({ id: calendars.id });
    if (rows.length === 0) throw new NotFoundError('日历不存在');
    return reply.status(204).send();
  });

  /** 时间段内的事件（含日历名与颜色） */
  app.get('/api/calendars/events', async (request) => {
    const query = z
      .object({
        from: z.string(),
        to: z.string(),
      })
      .parse(request.query);

    const rows = await db
      .select({
        id: calendarEvents.id,
        calendarId: calendarEvents.calendarId,
        calendarName: calendars.name,
        calendarColor: calendars.color,
        uid: calendarEvents.uid,
        title: calendarEvents.title,
        description: calendarEvents.description,
        location: calendarEvents.location,
        startsAt: calendarEvents.startsAt,
        endsAt: calendarEvents.endsAt,
        allDay: calendarEvents.allDay,
      })
      .from(calendarEvents)
      .innerJoin(calendars, eq(calendarEvents.calendarId, calendars.id))
      .where(
        and(
          eq(calendars.enabled, true),
          gte(calendarEvents.startsAt, new Date(query.from)),
          lte(calendarEvents.startsAt, new Date(query.to)),
        ),
      )
      .orderBy(asc(calendarEvents.startsAt));

    const data: CalendarEvent[] = rows.map((row) => ({
      id: row.id,
      calendarId: row.calendarId,
      calendarName: row.calendarName,
      calendarColor: row.calendarColor,
      uid: row.uid,
      title: row.title,
      description: row.description ?? null,
      location: row.location ?? null,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt ? row.endsAt.toISOString() : null,
      allDay: row.allDay,
    }));

    return { data };
  });
}
