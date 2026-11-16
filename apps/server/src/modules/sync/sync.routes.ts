import { SyncPushSchema } from '@ddl/shared';
import type { FastifyInstance } from 'fastify';
import type { SyncService } from './sync.service';

/**
 * 手机端本地优先架构的同步端点：
 * 只有探测到本服务可达时客户端才会调用，桌面端直连 PGlite 无需经过这里。
 */
export function registerSyncRoutes(app: FastifyInstance, service: SyncService): void {
  app.get('/api/sync/pull', async () => ({ data: await service.pull() }));

  app.post('/api/sync/push', async (request) => {
    const input = SyncPushSchema.parse(request.body ?? {});
    return { data: await service.push(input) };
  });
}
