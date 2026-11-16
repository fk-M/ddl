import {
  BatchTaskInputSchema,
  CreateTaskInputSchema,
  TaskQuerySchema,
  UpdateTaskInputSchema,
} from '@ddl/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { TasksService } from './tasks.service';

const IdParamSchema = z.object({ id: z.string().uuid('任务 id 必须是合法 UUID') });

/** 查询参数里的数组可能是逗号分隔或重复 key，这里统一成数组 */
function normalizeArray(value: unknown): unknown {
  if (typeof value === 'string') return value.split(',').filter(Boolean);
  if (Array.isArray(value)) return value;
  return undefined;
}

export function registerTaskRoutes(app: FastifyInstance, service: TasksService): void {
  app.get('/api/tasks', async (request) => {
    const raw = { ...(request.query as Record<string, unknown>) };
    for (const key of ['listIds', 'priorities', 'tags']) {
      const normalized = normalizeArray(raw[key]);
      if (normalized === undefined) delete raw[key];
      else raw[key] = normalized;
    }
    if (raw.priorities) {
      raw.priorities = (raw.priorities as string[]).map((item) => Number(item));
    }
    const query = TaskQuerySchema.parse(raw);
    return { data: await service.list(query) };
  });

  app.get('/api/tasks/counts', async () => {
    return { data: await service.counts() };
  });

  app.get('/api/tasks/:id', async (request) => {
    const { id } = IdParamSchema.parse(request.params);
    return { data: await service.get(id) };
  });

  app.get('/api/tasks/:id/children', async (request) => {
    const { id } = IdParamSchema.parse(request.params);
    return { data: await service.children(id) };
  });

  app.post('/api/tasks', async (request, reply) => {
    const input = CreateTaskInputSchema.parse(request.body);
    const task = await service.create(input);
    return reply.status(201).send({ data: task });
  });

  app.patch('/api/tasks/:id', async (request) => {
    const { id } = IdParamSchema.parse(request.params);
    const patch = UpdateTaskInputSchema.parse(request.body);
    return { data: await service.update(id, patch) };
  });

  app.post('/api/tasks/:id/toggle', async (request) => {
    const { id } = IdParamSchema.parse(request.params);
    return { data: await service.toggle(id) };
  });

  app.post('/api/tasks/:id/quadrant', async (request) => {
    const { id } = IdParamSchema.parse(request.params);
    const body = z.object({ isImportant: z.boolean(), isUrgent: z.boolean() }).parse(request.body);
    return { data: await service.setQuadrant(id, body.isImportant, body.isUrgent) };
  });

  app.post('/api/tasks/:id/reorder', async (request) => {
    const { id } = IdParamSchema.parse(request.params);
    const body = z.object({ sortOrder: z.number() }).parse(request.body);
    await service.reorder(id, body.sortOrder);
    return { data: { ok: true } };
  });

  app.post('/api/tasks/:id/pomodoro', async (request) => {
    const { id } = IdParamSchema.parse(request.params);
    await service.incrementPomodoro(id);
    return { data: { ok: true } };
  });

  app.post('/api/tasks/batch', async (request) => {
    const input = BatchTaskInputSchema.parse(request.body);
    return { data: await service.batch(input) };
  });

  app.post('/api/tasks/:id/restore', async (request) => {
    const { id } = IdParamSchema.parse(request.params);
    await service.restore(id);
    return { data: { ok: true } };
  });

  app.delete('/api/tasks/trash/empty', async () => {
    return { data: { removed: await service.emptyTrash() } };
  });

  app.delete('/api/tasks/:id', async (request, reply) => {
    const { id } = IdParamSchema.parse(request.params);
    const query = z.object({ purge: z.coerce.boolean().optional() }).parse(request.query);
    if (query.purge) await service.purge(id);
    else await service.remove(id);
    return reply.status(204).send();
  });
}
