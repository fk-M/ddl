import type { Candidate, CandidateStatus } from '@ddl/shared';
import { desc, eq, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { candidates, sources, type CandidateRow } from '../../db/schema';

export function toCandidateDto(row: CandidateRow, sourceName: string | null): Candidate {
  return {
    id: row.id,
    sourceId: row.sourceId ?? null,
    sourceName,
    title: row.title,
    url: row.url ?? null,
    excerpt: row.excerpt ?? null,
    dueAt: row.dueAt ? row.dueAt.toISOString() : null,
    confidence: row.confidence,
    status: (row.status === 'accepted' || row.status === 'dismissed' ? row.status : 'pending') as CandidateStatus,
    taskId: row.taskId ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export type NewCandidate = {
  sourceId: string | null;
  title: string;
  url: string | null;
  excerpt: string | null;
  dueAt: Date | null;
  confidence: number;
  fingerprint: string;
};

export function createCandidatesRepo(db: Db) {
  return {
    async findMany(status: CandidateStatus, limit: number): Promise<Array<{ row: CandidateRow; sourceName: string | null }>> {
      const rows = await db
        .select({ row: candidates, sourceName: sources.name })
        .from(candidates)
        .leftJoin(sources, eq(candidates.sourceId, sources.id))
        .where(eq(candidates.status, status))
        .orderBy(desc(candidates.createdAt))
        .limit(limit);
      return rows.map((item) => ({ row: item.row, sourceName: item.sourceName ?? null }));
    },

    async findById(id: string): Promise<CandidateRow | null> {
      const rows = await db.select().from(candidates).where(eq(candidates.id, id)).limit(1);
      return rows[0] ?? null;
    },

    async existsByFingerprint(fingerprint: string): Promise<boolean> {
      const rows = await db
        .select({ id: candidates.id })
        .from(candidates)
        .where(eq(candidates.fingerprint, fingerprint))
        .limit(1);
      return rows.length > 0;
    },

    /** 指纹重复时返回 null（同一篇文章只入池一次） */
    async insert(input: NewCandidate): Promise<CandidateRow | null> {
      const rows = await db
        .insert(candidates)
        .values({
          sourceId: input.sourceId,
          title: input.title,
          url: input.url,
          excerpt: input.excerpt,
          dueAt: input.dueAt,
          confidence: input.confidence,
          fingerprint: input.fingerprint,
        })
        .onConflictDoNothing()
        .returning();
      return rows[0] ?? null;
    },

    async markStatus(id: string, status: CandidateStatus, taskId?: string | null): Promise<void> {
      await db
        .update(candidates)
        .set({ status, taskId: taskId ?? null })
        .where(eq(candidates.id, id));
    },

    /** 一键忽略：把所有 pending 候选置为 dismissed，返回影响条数 */
    async dismissAllPending(): Promise<number> {
      const rows = await db
        .update(candidates)
        .set({ status: 'dismissed' })
        .where(eq(candidates.status, 'pending'))
        .returning({ id: candidates.id });
      return rows.length;
    },

    async countPending(): Promise<number> {
      const rows = await db
        .select({ value: sql<number>`count(*)::int` })
        .from(candidates)
        .where(eq(candidates.status, 'pending'));
      return rows[0]?.value ?? 0;
    },
  };
}

export type CandidatesRepo = ReturnType<typeof createCandidatesRepo>;
