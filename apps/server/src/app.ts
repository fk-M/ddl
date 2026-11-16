import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ErrorCode } from '@ddl/shared';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { sql } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { config } from './config';
import { getDb } from './db/client';
import { AppError, toErrorBody } from './lib/errors';
import { registerAnniversaryRoutes } from './modules/anniversaries/anniversaries.module';
import { registerAttachmentRoutes } from './modules/attachments/attachments.module';
import { registerBackupRoutes } from './modules/backup/backup.module';
import { registerCalendarRoutes } from './modules/calendars/calendars.module';
import { registerFocusRoutes } from './modules/focus/focus.module';
import { registerHabitRoutes } from './modules/habits/habits.module';
import { createListsRepo } from './modules/lists/lists.repo';
import { registerListRoutes } from './modules/lists/lists.routes';
import { createListsService } from './modules/lists/lists.service';
import { registerLunarRoutes } from './modules/lunar/lunar.module';
import { registerSettingsRoutes } from './modules/settings/settings.module';
import { registerSmartListRoutes } from './modules/smart-lists/smart-lists.module';
import { createTasksRepo } from './modules/tasks/tasks.repo';
import { registerTaskRoutes } from './modules/tasks/tasks.routes';
import { createTasksService } from './modules/tasks/tasks.service';
import { registerTagRoutes } from './modules/tags/tags.module';
import { registerTemplateRoutes } from './modules/templates/templates.module';
import { createCandidatesRepo } from './modules/sources/candidates.repo';
import { createCollectService } from './modules/sources/collect.service';
import { createSourcesRepo } from './modules/sources/sources.repo';
import { registerSourceRoutes } from './modules/sources/sources.routes';
import { createClipService } from './modules/sources/clip.service';
import { createSourcesService } from './modules/sources/sources.service';
import { registerSyncRoutes } from './modules/sync/sync.routes';
import { createSyncService } from './modules/sync/sync.service';

export async function buildApp(): Promise<FastifyInstance> {
  const db = await getDb();

  const app = Fastify({
    logger: config.isDev
      ? {
          level: config.logLevel,
          transport: {
            target: 'pino-pretty',
            options: { translateTime: 'SYS:HH:mm:ss', ignore: 'pid,hostname' },
          },
        }
      : { level: config.logLevel },
    genReqId: () => randomUUID(),
    bodyLimit: 1024 * 1024,
    trustProxy: false,
  });

  // 兼容「声明了 Content-Type: application/json 但没有请求体」的请求。
  // 旧版前端对所有请求（含 DELETE / toggle / restore）无条件加了 JSON 头，Fastify 默认
  // 解析器会抛 FST_ERR_CTP_EMPTY_JSON_BODY，导致删除任务失败；空 body 一律视为 {}，
  // 后续该报错的场景交给 Zod 给出明确的「请求参数校验失败」。
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
    const text = typeof body === 'string' ? body.trim() : '';
    if (!text) return done(null, {});
    try {
      done(null, JSON.parse(text));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      done(Object.assign(new Error(`JSON 解析失败：${message}`), { statusCode: 400 }), undefined);
    }
  });

  // 显式来源白名单；局域网模式（serve:lan）会注入 '*' 以兼容各版本 WebView 的 Origin 变体
  // 桌面内嵌服务仍是严格白名单；无 Origin（原生客户端 / curl）一律放行
  await app.register(cors, {
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (config.corsOrigins.includes('*') || config.corsOrigins.includes(origin)) {
        return callback(null, true);
      }
      app.log.warn({ origin }, 'CORS 来源被拒绝');
      return callback(null, false);
    },
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  // 打包运行：由本服务直接托管前端产物，页面与接口同源，省掉 CORS 与额外静态服务器
  const serveWeb =
    config.webDist !== null && existsSync(path.join(config.webDist, 'index.html'));
  if (serveWeb && config.webDist) {
    await app.register(fastifyStatic, {
      root: config.webDist,
      prefix: '/',
      // 必须开 wildcard：关闭后文件清单会在启动时被快照，
      // 重新构建产生的新 hash 文件名将匹配不到，落到 SPA 兜底返回 text/html
      wildcard: true,
      index: ['index.html'],
      // 自己接管缓存头：带 hash 的资源长缓存，index.html 必须每次回源
      // 注意 v10 的 setHeaders 第一个参数是 Fastify reply，不是原生 ServerResponse
      cacheControl: false,
      setHeaders: (reply, filePath) => {
        // 所有 HTML 页面（index.html、diagnostics.html 等）都必须每次回源，
        // 否则改了检测页手机端还拿到旧版本；只有带 hash 的静态资源才长缓存。
        const isHtml = filePath.toLowerCase().endsWith('.html');
        reply.header(
          'Cache-Control',
          isHtml ? 'no-cache, must-revalidate' : 'public, max-age=604800, immutable',
        );
      },
    });
  }

  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    // 同源 iframe 要放行：可视化检测页用隐藏 iframe 真实加载各视图做完整性检查，
    // 也允许未来的分栏预览；DENY 会让 contentDocument 变成 null。外部站点仍被拦截。
    reply.header('X-Frame-Options', 'SAMEORIGIN');
    reply.header('Referrer-Policy', 'no-referrer');
    return payload;
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: {
          code: ErrorCode.VALIDATION_ERROR,
          message: '请求参数校验失败',
          requestId: request.id,
          details: error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        },
      });
    }

    if (error instanceof AppError) {
      return reply.status(error.statusCode).send(toErrorBody(error, request.id));
    }

    // Fastify 自带错误（空 JSON body、请求体过大、媒体类型不支持等）都带 statusCode，
    // 属于客户端问题。按原状态码返回，别统一伪装成 500「服务器内部错误」误导排查。
    const statusCode = (error as { statusCode?: unknown }).statusCode;
    if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
      return reply.status(statusCode).send({
        error: {
          code: statusCode === 404 ? ErrorCode.NOT_FOUND : ErrorCode.BAD_REQUEST,
          message: error instanceof Error ? error.message : '请求不合法',
          requestId: request.id,
        },
      });
    }

    // 未预期错误：记录完整堆栈，但只向客户端返回规范化信息
    request.log.error({ err: error }, '未处理的服务端错误');
    return reply.status(500).send({
      error: {
        code: ErrorCode.INTERNAL_ERROR,
        message: '服务器内部错误',
        requestId: request.id,
      },
    });
  });

  app.setNotFoundHandler((request, reply) => {
    // 前端是单页应用：非 /api 的 GET 请求一律回落到 index.html，交给前端路由
    if (serveWeb && request.method === 'GET' && !request.url.startsWith('/api')) {
      return reply.type('text/html; charset=utf-8').sendFile('index.html');
    }
    reply.status(404).send({
      error: {
        code: ErrorCode.NOT_FOUND,
        message: `接口不存在：${request.method} ${request.url}`,
        requestId: request.id,
      },
    });
  });

  app.get('/health', async () => ({ status: 'ok', uptime: process.uptime() }));

  app.get('/ready', async (_request, reply) => {
    try {
      await db.execute(sql`select 1`);
      return { status: 'ready' };
    } catch (error) {
      app.log.error({ err: error }, '就绪检查失败');
      return reply.status(503).send({ status: 'unavailable' });
    }
  });

  const listsRepo = createListsRepo(db);
  const tasksRepo = createTasksRepo(db);
  const tasksService = createTasksService(tasksRepo, listsRepo);

  const sourcesRepo = createSourcesRepo(db);
  const candidatesRepo = createCandidatesRepo(db);
  const collectService = createCollectService(sourcesRepo, candidatesRepo);
  const sourcesService = createSourcesService(sourcesRepo, candidatesRepo, tasksService, collectService);
  const clipService = createClipService();

  registerListRoutes(app, createListsService(listsRepo));
  registerTaskRoutes(app, tasksService);
  registerSourceRoutes(app, sourcesService, clipService);

  // 新增能力：标签 / 模板 / 智能清单 / 习惯 / 专注 / 纪念日 / 日历订阅 / 设置 / 附件 / 备份 / 农历
  registerTagRoutes(app, db);
  registerTemplateRoutes(app, db);
  registerSmartListRoutes(app, db);
  registerHabitRoutes(app, db);
  registerFocusRoutes(app, db);
  registerAnniversaryRoutes(app, db);
  registerCalendarRoutes(app, db);
  registerSettingsRoutes(app, db);
  registerAttachmentRoutes(app, db);
  registerBackupRoutes(app, db);
  registerLunarRoutes(app);

  // 手机端离线本地库 ↔ 本机 PGlite 的双向同步枢纽
  registerSyncRoutes(app, createSyncService(db));

  // 后台采集轮询：按各源自带的抓取间隔判断是否到期，单源失败不影响其他源
  if (config.collectTickSeconds > 0) {
    const timer = setInterval(() => {
      void collectService
        .refreshDue()
        .then((result) => {
          if (result.sources > 0) app.log.info(result, '采集轮询完成');
        })
        .catch((error: unknown) => app.log.error({ err: error }, '采集轮询失败'));
    }, config.collectTickSeconds * 1000);
    timer.unref();
    app.addHook('onClose', async () => clearInterval(timer));
  }

  return app;
}
