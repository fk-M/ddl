import { CreateAnniversaryInputSchema, UpdateAnniversaryInputSchema } from '@ddl/shared';
import type { Anniversary } from '@ddl/shared';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../../db/client';
import { anniversaries, type AnniversaryRow } from '../../db/schema';
import { NotFoundError } from '../../lib/errors';
import { lunarToSolar, solarToLunar } from '../../lib/lunar';

const IdParamSchema = z.object({ id: z.string().uuid() });
const DAY = 86_400_000;

function startOfDay(date = new Date()): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** 计算「还有 N 天」以及「第几年」 */
function decorate(row: AnniversaryRow): Anniversary {
  const today = startOfDay();
  const raw = new Date(`${row.eventDate}T00:00:00`);

  let nextDate = raw;
  let years = 0;

  if (row.repeatYearly) {
    const lunarInfo = row.lunar ? solarToLunar(raw) : null;

    for (let offset = 0; offset <= 3; offset += 1) {
      let candidate: Date | null;
      if (lunarInfo) {
        candidate = lunarToSolar(today.getFullYear() + offset, lunarInfo.month, lunarInfo.day, lunarInfo.isLeap);
      } else {
        candidate = new Date(today.getFullYear() + offset, raw.getMonth(), raw.getDate());
      }
      if (!candidate) continue;
      if (candidate.getTime() >= today.getTime()) {
        nextDate = candidate;
        break;
      }
    }

    // 第几年：按公历年差算（农历生日同样按年差近似）
    years = Math.max(0, nextDate.getFullYear() - raw.getFullYear());
  }

  const daysUntil = Math.round((startOfDay(nextDate).getTime() - today.getTime()) / DAY);

  return {
    id: row.id,
    title: row.title,
    eventDate: row.eventDate,
    type: row.type as Anniversary['type'],
    repeatYearly: row.repeatYearly,
    lunar: row.lunar,
    color: row.color,
    icon: row.icon,
    notes: row.notes ?? null,
    archived: row.archived,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    daysUntil,
    years: row.type === 'birthday' || row.type === 'anniversary' ? years : 0,
  };
}

export function registerAnniversaryRoutes(app: FastifyInstance, db: Db): void {
  app.get('/api/anniversaries', async (request) => {
    const query = z.object({ includeArchived: z.coerce.boolean().optional() }).parse(request.query);
    const conditions = [isNull(anniversaries.deletedAt)];
    if (!query.includeArchived) conditions.push(eq(anniversaries.archived, false));

    const rows = await db
      .select()
      .from(anniversaries)
      .where(and(...conditions))
      .orderBy(asc(anniversaries.sortOrder), asc(anniversaries.eventDate));

    return { data: rows.map(decorate).sort((a, b) => a.daysUntil - b.daysUntil) };
  });

  app.post('/api/anniversaries', async (request, reply) => {
    const input = CreateAnniversaryInputSchema.parse(request.body);
    const rows = await db
      .insert(anniversaries)
      .values({
        title: input.title,
        eventDate: input.eventDate,
        type: input.type,
        repeatYearly: input.repeatYearly,
        lunar: input.lunar,
        color: input.color,
        icon: input.icon,
        notes: input.notes ?? null,
        sortOrder: input.sortOrder,
      })
      .returning();
    return reply.status(201).send({ data: decorate(rows[0]!) });
  });

  app.patch('/api/anniversaries/:id', async (request) => {
    const { id } = IdParamSchema.parse(request.params);
    const patch = UpdateAnniversaryInputSchema.parse(request.body);

    const values: Partial<typeof anniversaries.$inferInsert> = { updatedAt: new Date() };
    if (patch.title !== undefined) values.title = patch.title;
    if (patch.eventDate !== undefined) values.eventDate = patch.eventDate;
    if (patch.type !== undefined) values.type = patch.type;
    if (patch.repeatYearly !== undefined) values.repeatYearly = patch.repeatYearly;
    if (patch.lunar !== undefined) values.lunar = patch.lunar;
    if (patch.color !== undefined) values.color = patch.color;
    if (patch.icon !== undefined) values.icon = patch.icon;
    if (patch.notes !== undefined) values.notes = patch.notes;
    if (patch.sortOrder !== undefined) values.sortOrder = patch.sortOrder;
    if (patch.archived !== undefined) values.archived = patch.archived;

    const rows = await db.update(anniversaries).set(values).where(eq(anniversaries.id, id)).returning();
    if (!rows[0]) throw new NotFoundError('纪念日不存在');
    return { data: decorate(rows[0]) };
  });

  app.delete('/api/anniversaries/:id', async (request, reply) => {
    const { id } = IdParamSchema.parse(request.params);
    const rows = await db
      .update(anniversaries)
      .set({ deletedAt: new Date() })
      .where(eq(anniversaries.id, id))
      .returning({ id: anniversaries.id });
    if (rows.length === 0) throw new NotFoundError('纪念日不存在');
    return reply.status(204).send();
  });
}
