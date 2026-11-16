import { CreateTaskTemplateInputSchema, UpdateTaskTemplateInputSchema } from '@ddl/shared';
import type { TaskTemplate } from '@ddl/shared';
import { asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../../db/client';
import { taskTemplates, type TaskTemplateRow } from '../../db/schema';
import { NotFoundError } from '../../lib/errors';

const IdParamSchema = z.object({ id: z.string().uuid() });

function toDto(row: TaskTemplateRow): TaskTemplate {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind === 'note' ? 'note' : 'task',
    payload: (row.payload ?? {}) as Record<string, unknown>,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function registerTemplateRoutes(app: FastifyInstance, db: Db): void {
  app.get('/api/templates', async () => {
    const rows = await db
      .select()
      .from(taskTemplates)
      .orderBy(asc(taskTemplates.sortOrder), asc(taskTemplates.createdAt));
    return { data: rows.map(toDto) };
  });

  app.post('/api/templates', async (request, reply) => {
    const input = CreateTaskTemplateInputSchema.parse(request.body);
    const rows = await db
      .insert(taskTemplates)
      .values({
        name: input.name,
        kind: input.kind,
        payload: input.payload,
        sortOrder: input.sortOrder,
      })
      .returning();
    return reply.status(201).send({ data: toDto(rows[0]!) });
  });

  app.patch('/api/templates/:id', async (request) => {
    const { id } = IdParamSchema.parse(request.params);
    const patch = UpdateTaskTemplateInputSchema.parse(request.body);
    const values: Partial<typeof taskTemplates.$inferInsert> = { updatedAt: new Date() };
    if (patch.name !== undefined) values.name = patch.name;
    if (patch.kind !== undefined) values.kind = patch.kind;
    if (patch.payload !== undefined) values.payload = patch.payload;
    if (patch.sortOrder !== undefined) values.sortOrder = patch.sortOrder;

    const rows = await db.update(taskTemplates).set(values).where(eq(taskTemplates.id, id)).returning();
    if (!rows[0]) throw new NotFoundError('模板不存在');
    return { data: toDto(rows[0]) };
  });

  app.delete('/api/templates/:id', async (request, reply) => {
    const { id } = IdParamSchema.parse(request.params);
    const rows = await db.delete(taskTemplates).where(eq(taskTemplates.id, id)).returning({ id: taskTemplates.id });
    if (rows.length === 0) throw new NotFoundError('模板不存在');
    return reply.status(204).send();
  });
}
