import { mkdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { config } from '../config';
import * as schema from './schema';

/**
 * P0 使用 PGlite（WASM 版 Postgres 16）：
 * - 零安装，同一套 PG 方言与 Drizzle schema
 * - 切到真实 Postgres 时，仅需把 drizzle() 的 driver 换成 node-postgres，schema 与 SQL 不动
 */
function buildDb(client: PGlite) {
  return drizzle(client, { schema });
}

export type Db = ReturnType<typeof buildDb>;

let client: PGlite | null = null;
let instance: Db | null = null;

export async function createClient(): Promise<PGlite> {
  // PGlite 不会递归创建目录，必须先确保父目录存在
  mkdirSync(config.pgliteDir, { recursive: true });
  const pg = new PGlite(config.pgliteDir);
  await pg.waitReady;
  return pg;
}

export async function getDb(): Promise<Db> {
  if (!instance) {
    if (config.databaseUrl) {
      // 预留：真实 Postgres 通道尚未接入，避免静默忽略配置
      console.warn('[db] 检测到 DATABASE_URL，但当前版本仍使用 PGlite，配置已忽略');
    }
    client = await createClient();
    instance = buildDb(client);
  }
  return instance;
}

export function getClient(): PGlite {
  if (!client) throw new Error('数据库尚未初始化，请先调用 getDb()');
  return client;
}

export async function closeDb(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    instance = null;
  }
}
