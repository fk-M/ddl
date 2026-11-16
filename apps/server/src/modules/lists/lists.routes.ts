import { CreateListInputSchema, UpdateListInputSchema } from '@ddl/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ListsService } from './lists.service';

const IdParamSchema = z.object({ id: z.string().uuid('清单 id 必须是合法 UUID') });

export function registerListRoutes(app: FastifyInstance, service: ListsService): void {
  app.get('/api/lists', async (request) => {
    const query = z.object({ includeArchived: z.coerce.boolean().optional() }).parse(request.query);
    return { data: await service.list(query.includeArchived ?? false) };
  });

  app.get('/api/lists/archived', async () => {
    return { data: await service.archived() };
  });

  app.get('/api/lists/:id', async (request) => {
    const { id } = IdParamSchema.parse(request.params);
    return { data: await service.get(id) };
  });

  app.post('/api/lists', async (request, reply) => {
    const input = CreateListInputSchema.parse(request.body);
    const list = await service.create(input);
    return reply.status(201).send({ data: list });
  });

  app.patch('/api/lists/:id', async (request) => {
    const { id } = IdParamSchema.parse(request.params);
    const patch = UpdateListInputSchema.parse(request.body);
    return { data: await service.update(id, patch) };
  });

  app.post('/api/lists/:id/duplicate', async (request) => {
    const { id } = IdParamSchema.parse(request.params);
    const body = z.object({ onlyPending: z.boolean().default(false) }).parse(request.body ?? {});
    return { data: await service.duplicate(id, body.onlyPending) };
  });

  app.post('/api/lists/:id/archive', async (request) => {
    const { id } = IdParamSchema.parse(request.params);
    const body = z.object({ archived: z.boolean().default(true) }).parse(request.body ?? {});
    return { data: await service.archive(id, body.archived) };
  });

  app.delete('/api/lists/:id', async (request, reply) => {
    const { id } = IdParamSchema.parse(request.params);
    await service.remove(id);
    return reply.status(204).send();
  });

  /* ---------------- 分组 ---------------- */

  app.get('/api/list-groups', async () => {
    return { data: await service.groups() };
  });

  app.post('/api/list-groups', async (request, reply) => {
    const body = z.object({ name: z.string().trim().min(1, '分组名称不能为空').max(80) }).parse(request.body);
    return reply.status(201).send({ data: await service.createGroup(body.name) });
  });

  app.patch('/api/list-groups/:id', async (request) => {
    const { id } = IdParamSchema.parse(request.params);
    const patch = z
      .object({
        name: z.string().trim().min(1).max(80).optional(),
        collapsed: z.boolean().optional(),
        sortOrder: z.number().int().optional(),
      })
      .parse(request.body);
    return { data: await service.updateGroup(id, patch) };
  });

  app.delete('/api/list-groups/:id', async (request, reply) => {
    const { id } = IdParamSchema.parse(request.params);
    await service.removeGroup(id);
    return reply.status(204).send();
  });
}
