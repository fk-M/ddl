import { AppSettingsSchema } from '@ddl/shared';
import type { AppSettings } from '@ddl/shared';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../../db/client';
import { settings } from '../../db/schema';

export function registerSettingsRoutes(app: FastifyInstance, db: Db): void {
  async function load(): Promise<AppSettings> {
    const rows = await db.select().from(settings);
    const stored: Record<string, unknown> = {};
    for (const row of rows) stored[row.key] = row.value;
    // 默认值由 schema 提供，存储值覆盖默认值
    return AppSettingsSchema.parse({ ...AppSettingsSchema.parse({}), ...stored });
  }

  app.get('/api/settings', async (): Promise<{ data: AppSettings }> => {
    return { data: await load() };
  });

  app.patch('/api/settings', async (request) => {
    const patch = z.record(z.string(), z.unknown()).parse(request.body);
    const parsed = AppSettingsSchema.partial().parse(patch);

    for (const [key, value] of Object.entries(parsed)) {
      if (value === undefined) continue;
      await db
        .insert(settings)
        .values({ key, value: value as never })
        .onConflictDoUpdate({
          target: settings.key,
          set: { value: value as never, updatedAt: new Date() },
        });
    }

    return { data: await load() };
  });

  app.post('/api/settings/reset', async () => {
    await db.execute(sql`delete from ${settings}`);
    return { data: await load() };
  });
}
