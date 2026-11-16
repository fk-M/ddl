import { existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

/** 依次加载 cwd 与仓库根目录的 .env（Node 22 内置，无需 dotenv） */
function loadEnvFiles(): void {
  const candidates = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '..', '..', '.env'),
  ];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    try {
      process.loadEnvFile(file);
    } catch {
      // 解析失败时忽略，交给默认值兜底
    }
  }
}

loadEnvFiles();

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  PGLITE_DIR: z.string().min(1).default('./data/pglite'),
  DATABASE_URL: z.string().url().optional(),
  /** 前端构建产物目录；配置后由本服务直接托管，桌面端与手机端因此同源免 CORS */
  WEB_DIST: z.string().optional(),
  /** SQL 迁移目录；默认取 cwd/drizzle，打包后可指向资源目录 */
  MIGRATION_DIR: z.string().optional(),
  /** 启动时是否自动执行迁移（幂等，桌面端首次安装必需） */
  AUTO_MIGRATE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  // 默认允许浏览器开发源与 Capacitor WebView 源（安卓端 http://localhost）
  CORS_ORIGINS: z
    .string()
    .default(
      'http://localhost:5173,http://127.0.0.1:5173,http://localhost,capacitor://localhost',
    ),
  /** 可选：配置后启用 LLM 抽取，未配置时走规则抽取 */
  LLM_BASE_URL: z.string().url().default('https://api.deepseek.com/v1'),
  LLM_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().default('deepseek-chat'),
  /** 采集轮询间隔（秒），设为 0 关闭后台轮询 */
  COLLECT_TICK_SECONDS: z.coerce.number().int().min(0).max(3600).default(300),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  const detail = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
  // 配置错误必须在启动阶段快速失败
  console.error(`[config] 环境变量校验失败，进程退出：\n${detail}`);
  process.exit(1);
}

const env = parsed.data;

export const config = {
  nodeEnv: env.NODE_ENV,
  isDev: env.NODE_ENV === 'development',
  isProd: env.NODE_ENV === 'production',
  host: env.HOST,
  port: env.PORT,
  logLevel: env.LOG_LEVEL,
  pgliteDir: path.resolve(process.cwd(), env.PGLITE_DIR),
  /** 附件与备份存放目录（与 PGlite 数据目录同级） */
  dataDir: path.resolve(process.cwd(), path.dirname(env.PGLITE_DIR)),
  /** 前端静态目录；null 表示不托管（开发态由 Vite 负责） */
  webDist: env.WEB_DIST ? path.resolve(process.cwd(), env.WEB_DIST) : null,
  migrationDir: env.MIGRATION_DIR
    ? path.resolve(process.cwd(), env.MIGRATION_DIR)
    : path.resolve(process.cwd(), 'drizzle'),
  autoMigrate: env.AUTO_MIGRATE,
  databaseUrl: env.DATABASE_URL ?? null,
  corsOrigins: env.CORS_ORIGINS.split(',')
    .map((item) => item.trim())
    .filter(Boolean),
  llm: {
    baseUrl: env.LLM_BASE_URL.replace(/\/$/, ''),
    apiKey: env.LLM_API_KEY ?? null,
    model: env.LLM_MODEL,
  },
  collectTickSeconds: env.COLLECT_TICK_SECONDS,
} as const;
