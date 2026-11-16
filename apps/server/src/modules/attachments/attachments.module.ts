import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Attachment } from '@ddl/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../../config';
import type { Db } from '../../db/client';
import { attachments, tasks, type AttachmentRow } from '../../db/schema';
import { BadRequestError, NotFoundError } from '../../lib/errors';

const IdParamSchema = z.object({ id: z.string().uuid() });
const MAX_BYTES = 20 * 1024 * 1024;

function storageDir(): string {
  const dir = path.join(config.dataDir, 'attachments');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function toDto(row: AttachmentRow): Attachment {
  return {
    id: row.id,
    taskId: row.taskId,
    name: row.name,
    mime: row.mime,
    size: row.size,
    url: `/api/attachments/${row.id}/raw`,
    createdAt: row.createdAt.toISOString(),
  };
}

export function registerAttachmentRoutes(app: FastifyInstance, db: Db): void {
  /** 以 base64 上传，避免引入 multipart 依赖，够自用场景 */
  app.post(
    '/api/tasks/:id/attachments',
    { bodyLimit: 32 * 1024 * 1024 },
    async (request, reply) => {
      const { id } = IdParamSchema.parse(request.params);
      const body = z
        .object({
          name: z.string().trim().min(1).max(255),
          mime: z.string().max(120).default('application/octet-stream'),
          data: z.string().min(1),
        })
        .parse(request.body);

      const taskRows = await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.id, id)).limit(1);
      if (!taskRows[0]) throw new NotFoundError('任务不存在');

      const base64 = body.data.includes(',') ? body.data.slice(body.data.indexOf(',') + 1) : body.data;
      const buffer = Buffer.from(base64, 'base64');
      if (buffer.byteLength > MAX_BYTES) throw new BadRequestError('单个附件不能超过 20MB');

      const digest = createHash('sha256').update(buffer).digest('hex').slice(0, 12);
      const fileName = `${randomUUID()}-${digest}`;
      const fullPath = path.join(storageDir(), fileName);
      writeFileSync(fullPath, buffer);

      const rows = await db
        .insert(attachments)
        .values({
          taskId: id,
          name: body.name,
          mime: body.mime,
          size: buffer.byteLength,
          storagePath: fullPath,
        })
        .returning();

      return reply.status(201).send({ data: toDto(rows[0]!) });
    },
  );

  app.get('/api/attachments/:id/raw', async (request, reply) => {
    const { id } = IdParamSchema.parse(request.params);
    const rows = await db.select().from(attachments).where(eq(attachments.id, id)).limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundError('附件不存在');

    try {
      const buffer = readFileSync(row.storagePath);
      // 非图片/文本一律按下载处理，避免浏览器内联执行
      const inline = /^image\/|^text\/plain|^application\/pdf/.test(row.mime);
      reply.header('Content-Type', row.mime);
      reply.header(
        'Content-Disposition',
        `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(row.name)}`,
      );
      return reply.send(buffer);
    } catch {
      throw new NotFoundError('附件文件已丢失');
    }
  });

  app.delete('/api/attachments/:id', async (request, reply) => {
    const { id } = IdParamSchema.parse(request.params);
    const rows = await db.delete(attachments).where(eq(attachments.id, id)).returning();
    const row = rows[0];
    if (!row) throw new NotFoundError('附件不存在');
    try {
      unlinkSync(row.storagePath);
    } catch {
      // 文件已不存在时忽略
    }
    return reply.status(204).send();
  });
}
