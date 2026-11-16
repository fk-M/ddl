import { createRequire } from 'node:module';
import { BadRequestError } from '../../lib/errors';
import { extractDeadline, stripHtml } from '../../lib/extract';
import type { ClipExtractResult } from '@ddl/shared';

const require = createRequire(import.meta.url);

/** 部分站点会拦非浏览器 UA，统一用浏览器 UA 抓取链接页面 */
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const MIN_TEXT_LENGTH = 2;

/** 判断输入是否为单个纯链接（不含换行、以 http(s):// 开头） */
function looksLikeSingleUrl(text: string): boolean {
  const trimmed = text.trim();
  return /^(https?:\/\/)[^\s]+$/.test(trimmed);
}

/** 抓取链接页面，返回页面标题与正文摘要（去脚本/样式后截断） */
async function fetchUrlContent(url: string): Promise<{ title: string; content: string }> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': BROWSER_UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(15_000),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const title = stripHtml(body.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? '').trim();
  const content = stripHtml(body).slice(0, 3000);
  return { title, content };
}

export function createClipService() {
  return {
    /**
     * 剪藏抽取：把用户粘贴的文字或链接识别成一条潜在的 DDL。
     * - 纯文字：直接抽截止时间，标题取首行；
     * - 单链接：先抓页面标题+正文再抽，抓不到则回退成纯文本（用链接本身当标题）。
     */
    async extract(input: { text: string }): Promise<ClipExtractResult> {
      const text = (input.text ?? '').trim();
      if (text.length < MIN_TEXT_LENGTH) {
        throw new BadRequestError('请输入要识别的文字或链接');
      }

      // 单一链接：尝试抓取页面正文，用「页面标题 + 正文」抽取
      if (looksLikeSingleUrl(text)) {
        try {
          const { title, content } = await fetchUrlContent(text);
          const extraction = await extractDeadline(title || text, content);
          return {
            title: title || text,
            dueAt: extraction.dueAt ? extraction.dueAt.toISOString() : null,
            confidence: extraction.confidence,
            method: extraction.method,
            matchedText: extraction.matchedText,
            excerpt: content.slice(0, 300) || null,
            fetched: true,
          };
        } catch {
          // 抓取失败（反爬 / 网络 / 超时）：回退成纯文本，用链接本身当标题
          const extraction = await extractDeadline(text, '');
          return {
            title: text,
            dueAt: extraction.dueAt ? extraction.dueAt.toISOString() : null,
            confidence: extraction.confidence,
            method: extraction.method,
            matchedText: extraction.matchedText,
            excerpt: null,
            fetched: false,
          };
        }
      }

      // 纯文字：直接抽取，标题取首行
      const extraction = await extractDeadline(text, '');
      const firstLine = text.split('\n')[0] ?? '';
      const title = firstLine.trim().slice(0, 200) || text.slice(0, 200);
      return {
        title,
        dueAt: extraction.dueAt ? extraction.dueAt.toISOString() : null,
        confidence: extraction.confidence,
        method: extraction.method,
        matchedText: extraction.matchedText,
        excerpt: text.slice(0, 300),
        fetched: false,
      };
    },
  };
}

export type ClipService = ReturnType<typeof createClipService>;
