import { CreateSmartListInputSchema, UpdateSmartListInputSchema } from '@ddl/shared';
import type { SmartList } from '@ddl/shared';
import { asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../../db/client';
import { smartLists, type SmartListRow } from '../../db/schema';
import { NotFoundError } from '../../lib/errors';

const IdParamSchema = z.object({ id: z.string().uuid() });

function toDto(row: SmartListRow): SmartList {
  return {
    id: row.id,
    name: row.name,
    icon: row.icon,
    color: row.color,
    filter: (row.filter ?? {}) as SmartList['filter'],
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function registerSmartListRoutes(app: FastifyInstance, db: Db): void {
  app.get('/api/smart-lists', async () => {
    const rows = await db
      .select()
      .from(smartLists)
      .orderBy(asc(smartLists.sortOrder), asc(smartLists.createdAt));
    return { data: rows.map(toDto) };
  });

  app.post('/api/smart-lists', async (request, reply) => {
    const input = CreateSmartListInputSchema.parse(request.body);
    const rows = await db
      .insert(smartLists)
      .values({
        name: input.name,
        icon: input.icon,
        color: input.color,
        filter: input.filter,
        sortOrder: input.sortOrder,
      })
      .returning();
    return reply.status(201).send({ data: toDto(rows[0]!) });
  });

  app.patch('/api/smart-lists/:id', async (request) => {
    const { id } = IdParamSchema.parse(request.params);
    const patch = UpdateSmartListInputSchema.parse(request.body);
    const values: Partial<typeof smartLists.$inferInsert> = { updatedAt: new Date() };
    if (patch.name !== undefined) values.name = patch.name;
    if (patch.icon !== undefined) values.icon = patch.icon;
    if (patch.color !== undefined) values.color = patch.color;
    if (patch.filter !== undefined) values.filter = patch.filter;
    if (patch.sortOrder !== undefined) values.sortOrder = patch.sortOrder;

    const rows = await db.update(smartLists).set(values).where(eq(smartLists.id, id)).returning();
    if (!rows[0]) throw new NotFoundError('智能清单不存在');
    return { data: toDto(rows[0]) };
  });

  app.delete('/api/smart-lists/:id', async (request, reply) => {
    const { id } = IdParamSchema.parse(request.params);
    const rows = await db.delete(smartLists).where(eq(smartLists.id, id)).returning({ id: smartLists.id });
    if (rows.length === 0) throw new NotFoundError('智能清单不存在');
    return reply.status(204).send();
  });
}
