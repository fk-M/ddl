import type { CreateSourceInput, Source, UpdateSourceInput } from '@ddl/shared';
import { asc, desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { sources, type SourceRow } from '../../db/schema';

export function toSourceDto(row: SourceRow): Source {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    url: row.url,
    enabled: row.enabled,
    fetchIntervalMinutes: row.fetchIntervalMinutes,
    lastFetchedAt: row.lastFetchedAt ? row.lastFetchedAt.toISOString() : null,
    lastError: row.lastError ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function createSourcesRepo(db: Db) {
  return {
    async findAll(): Promise<SourceRow[]> {
      return db.select().from(sources).orderBy(asc(sources.createdAt));
    },

    async findById(id: string): Promise<SourceRow | null> {
      const rows = await db.select().from(sources).where(eq(sources.id, id)).limit(1);
      return rows[0] ?? null;
    },

    async findByUrl(url: string): Promise<SourceRow | null> {
      const rows = await db.select().from(sources).where(eq(sources.url, url)).limit(1);
      return rows[0] ?? null;
    },

    async insert(input: CreateSourceInput): Promise<SourceRow> {
      const rows = await db
        .insert(sources)
        .values({
          name: input.name,
          url: input.url,
          enabled: input.enabled,
          fetchIntervalMinutes: input.fetchIntervalMinutes,
        })
        .returning();
      const row = rows[0];
      if (!row) throw new Error('创建信息源失败：数据库未返回记录');
      return row;
    },

    async update(id: string, patch: UpdateSourceInput): Promise<SourceRow | null> {
      const values: Partial<typeof sources.$inferInsert> = { updatedAt: new Date() };
      if (patch.name !== undefined) values.name = patch.name;
      if (patch.url !== undefined) values.url = patch.url;
      if (patch.enabled !== undefined) values.enabled = patch.enabled;
      if (patch.fetchIntervalMinutes !== undefined) {
        values.fetchIntervalMinutes = patch.fetchIntervalMinutes;
      }
      const rows = await db.update(sources).set(values).where(eq(sources.id, id)).returning();
      return rows[0] ?? null;
    },

    async remove(id: string): Promise<boolean> {
      const rows = await db.delete(sources).where(eq(sources.id, id)).returning({ id: sources.id });
      return rows.length > 0;
    },

    async markFetched(id: string): Promise<void> {
      await db
        .update(sources)
        .set({ lastFetchedAt: new Date(), lastError: null, updatedAt: new Date() })
        .where(eq(sources.id, id));
    },

    async markError(id: string, message: string): Promise<void> {
      await db
        .update(sources)
        .set({ lastError: message.slice(0, 500), lastFetchedAt: new Date(), updatedAt: new Date() })
        .where(eq(sources.id, id));
    },

    /** 到期待抓取的源：启用中，且从未抓取过或已超过抓取间隔 */
    async findDue(): Promise<SourceRow[]> {
      return db
        .select()
        .from(sources)
        .where(
          sql`${sources.enabled} = true and (${sources.lastFetchedAt} is null or ${sources.lastFetchedAt} < now() - (${sources.fetchIntervalMinutes} || ' minutes')::interval)`,
        )
        .orderBy(desc(sources.lastFetchedAt));
    },
  };
}

export type SourcesRepo = ReturnType<typeof createSourcesRepo>;
