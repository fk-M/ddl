import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { PGlite } from '@electric-sql/pglite';
import { config } from '../config';
import { createClient } from './client';

const MIGRATION_DIR = config.migrationDir;

/**
 * 逐文件、逐事务应用未执行过的 SQL 迁移。
 * 幂等：已记录在 _migrations 的文件直接跳过，可在每次启动时安全调用。
 */
export async function runMigrations(
  pg: PGlite,
  options: { dir?: string; silent?: boolean } = {},
): Promise<{ applied: number; skipped: number }> {
  const dir = options.dir ?? MIGRATION_DIR;
  const log = (message: string) => {
    if (!options.silent) console.log(message);
  };

  await pg.exec(
    `create table if not exists _migrations (
       name text primary key,
       applied_at timestamptz not null default now()
     )`,
  );

  const appliedRows = await pg.query<{ name: string }>('select name from _migrations');
  const applied = new Set(appliedRows.rows.map((row) => row.name));

  const files = readdirSync(dir)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  let appliedCount = 0;
  let skippedCount = 0;

  for (const file of files) {
    if (applied.has(file)) {
      skippedCount += 1;
      continue;
    }
    const sqlText = readFileSync(path.join(dir, file), 'utf8');
    // 每个迁移文件一个事务，失败整体回滚，避免半套 schema
    await pg.transaction(async (tx) => {
      await tx.exec(sqlText);
      await tx.query('insert into _migrations (name) values ($1)', [file]);
    });
    appliedCount += 1;
    log(`\u2713 应用 ${file}`);
  }

  log(
    appliedCount > 0
      ? `迁移完成，共应用 ${appliedCount} 个文件`
      : `数据库已是最新，无需迁移（已应用 ${skippedCount} 个）`,
  );

  return { applied: appliedCount, skipped: skippedCount };
}

/** 以 CLI 方式直接执行时的入口（npm run db:migrate） */
async function main(): Promise<void> {
  const pg = await createClient();
  try {
    await runMigrations(pg);
  } finally {
    await pg.close();
  }
}

// 被打包/被 import 时不自动执行，只有直接运行本文件才跑 CLI
const isDirectRun =
  process.argv[1] !== undefined &&
  /(^|[\\/])migrate\.(ts|js|cjs|mjs)$/.test(process.argv[1]);

if (isDirectRun) {
  main().catch((error) => {
    console.error('迁移失败：', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
