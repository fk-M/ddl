import { config } from './config';
import { buildApp } from './app';
import { closeDb, getDb, getClient } from './db/client';
import { runMigrations } from './db/migrate';

async function main(): Promise<void> {
  // 先建库、再补表：桌面端首次启动时数据目录为空，必须自动补齐 schema
  await getDb();
  if (config.autoMigrate) {
    try {
      await runMigrations(getClient(), { silent: true });
    } catch (error) {
      console.error('[db] 自动迁移失败：', error instanceof Error ? error.message : error);
      process.exit(1);
    }
  }

  const app = await buildApp();

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, '收到退出信号，开始优雅停机');
    try {
      await app.close();
      await closeDb();
      app.log.info('已关闭 HTTP 服务与数据库连接');
      process.exit(0);
    } catch (error) {
      app.log.error({ err: error }, '停机过程中出错');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    app.log.error({ err: reason }, '未处理的 Promise 拒绝');
  });

  try {
    await app.listen({ host: config.host, port: config.port });
    app.log.info(`API 已启动：http://${config.host}:${config.port}（env=${config.nodeEnv}）`);
  } catch (error) {
    app.log.error({ err: error }, '启动失败');
    process.exit(1);
  }
}

void main();
