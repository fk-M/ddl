import { CreateTagInputSchema, UpdateTagInputSchema } from '@ddl/shared';
import type { Tag } from '@ddl/shared';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../../db/client';
import { tags, tasks, type TagRow } from '../../db/schema';
import { NotFoundError } from '../../lib/errors';

const IdParamSchema = z.object({ id: z.string().uuid() });

function toDto(row: TagRow): Tag {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    parentId: row.parentId ?? null,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function registerTagRoutes(app: FastifyInstance, db: Db): void {
  app.get('/api/tags', async () => {
    const rows = await db
      .select()
      .from(tags)
      .where(isNull(tags.deletedAt))
      .orderBy(asc(tags.sortOrder), asc(tags.name));

    // 统计每个标签的未完成任务数
    const counts = await db
      .select({ tag: sql<string>`unnest(${tasks.tags})`, total: sql<number>`count(*)::int` })
      .from(tasks)
      .where(and(eq(tasks.status, 'pending'), isNull(tasks.deletedAt)))
      .groupBy(sql`unnest(${tasks.tags})`);

    const countMap = new Map<string, number>();
    for (const row of counts) countMap.set(row.tag, Number(row.total) || 0);

    return {
      data: rows.map((row) => ({ ...toDto(row), taskCount: countMap.get(row.name) ?? 0 })),
    };
  });

  app.post('/api/tags', async (request, reply) => {
    const input = CreateTagInputSchema.parse(request.body);
    const exists = await db
      .select({ id: tags.id })
      .from(tags)
      .where(and(eq(tags.name, input.name), isNull(tags.deletedAt)))
      .limit(1);
    if (exists.length > 0) {
      return reply.status(409).send({ error: { code: 'CONFLICT', message: '标签名称已存在' } });
    }
    const rows = await db
      .insert(tags)
      .values({
        name: input.name,
        color: input.color,
        parentId: input.parentId ?? null,
        sortOrder: input.sortOrder,
      })
      .returning();
    return reply.status(201).send({ data: toDto(rows[0]!) });
  });

  app.patch('/api/tags/:id', async (request) => {
    const { id } = IdParamSchema.parse(request.params);
    const patch = UpdateTagInputSchema.parse(request.body);

    const existingRows = await db.select().from(tags).where(eq(tags.id, id)).limit(1);
    const existing = existingRows[0];
    if (!existing) throw new NotFoundError('标签不存在');

    const values: Partial<typeof tags.$inferInsert> = { updatedAt: new Date() };
    if (patch.name !== undefined) values.name = patch.name;
    if (patch.color !== undefined) values.color = patch.color;
    if (patch.parentId !== undefined) values.parentId = patch.parentId;
    if (patch.sortOrder !== undefined) values.sortOrder = patch.sortOrder;

    const rows = await db.update(tags).set(values).where(eq(tags.id, id)).returning();

    // 改名时同步任务上的标签字符串
    if (patch.name && patch.name !== existing.name) {
      await db.execute(sql`
        update ${tasks}
        set tags = array_replace(tags, ${existing.name}, ${patch.name})
        where ${existing.name} = any(tags)
      `);
    }

    return { data: toDto(rows[0]!) };
  });

  app.delete('/api/tags/:id', async (request, reply) => {
    const { id } = IdParamSchema.parse(request.params);
    const rows = await db
      .update(tags)
      .set({ deletedAt: new Date() })
      .where(eq(tags.id, id))
      .returning({ name: tags.name });
    const removed = rows[0];
    if (!removed) throw new NotFoundError('标签不存在');

    // 从任务上摘除该标签
    await db.execute(sql`
      update ${tasks}
      set tags = array_remove(tags, ${removed.name})
      where ${removed.name} = any(tags)
    `);

    return reply.status(204).send();
  });
}
