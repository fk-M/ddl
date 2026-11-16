import { CandidateStatusSchema, CreateSourceInputSchema, UpdateSourceInputSchema } from '@ddl/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ClipService } from './clip.service';
import type { SourcesService } from './sources.service';

const IdParamSchema = z.object({ id: z.string().uuid('id 必须是合法 UUID') });

const CandidateQuerySchema = z.object({
  status: CandidateStatusSchema.default('pending'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const ClipExtractInputSchema = z.object({ text: z.string().min(1).max(20_000) });

const SubscribePresetInputSchema = z.object({ key: z.string().trim().min(1, '预设 key 不能为空') });

export function registerSourceRoutes(
  app: FastifyInstance,
  service: SourcesService,
  clipService: ClipService,
): void {
  app.get('/api/sources', async () => {
    return { data: await service.list() };
  });

  app.post('/api/sources', async (request, reply) => {
    const input = CreateSourceInputSchema.parse(request.body);
    const source = await service.create(input);
    return reply.status(201).send({ data: source });
  });

  app.patch('/api/sources/:id', async (request) => {
    const { id } = IdParamSchema.parse(request.params);
    const patch = UpdateSourceInputSchema.parse(request.body);
    return { data: await service.update(id, patch) };
  });

  app.delete('/api/sources/:id', async (request, reply) => {
    const { id } = IdParamSchema.parse(request.params);
    await service.remove(id);
    return reply.status(204).send();
  });

  app.post('/api/sources/:id/fetch', async (request) => {
    const { id } = IdParamSchema.parse(request.params);
    return { data: await service.fetchNow(id) };
  });

  /** 剪藏抽取：粘贴文字或链接，识别截止时间，返回建议标题与置信度（不直接建任务） */
  app.post('/api/clip/extract', async (request) => {
    const { text } = ClipExtractInputSchema.parse(request.body);
    return { data: await clipService.extract({ text }) };
  });

  app.get('/api/candidates', async (request) => {
    const query = CandidateQuerySchema.parse(request.query);
    return { data: await service.listCandidates(query.status, query.limit) };
  });

  app.post('/api/candidates/:id/accept', async (request) => {
    const { id } = IdParamSchema.parse(request.params);
    return { data: await service.acceptCandidate(id) };
  });

  app.post('/api/candidates/:id/dismiss', async (request, reply) => {
    const { id } = IdParamSchema.parse(request.params);
    await service.dismissCandidate(id);
    return reply.status(204).send();
  });

  /** 一键忽略全部待确认候选 */
  app.post('/api/candidates/dismiss-all', async () => {
    return { data: { dismissed: await service.dismissAllCandidates() } };
  });

  /** 内置竞赛预设源列表（标注是否已订阅） */
  app.get('/api/sources/presets', async () => {
    return { data: await service.listPresets() };
  });

  /** 一键订阅某个竞赛预设源 */
  app.post('/api/sources/presets/subscribe', async (request) => {
    const { key } = SubscribePresetInputSchema.parse(request.body);
    return { data: await service.subscribePreset(key) };
  });
}
