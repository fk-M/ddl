import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { BadRequestError, NotFoundError } from '../../lib/errors';
import { extractDeadline, stripHtml } from '../../lib/extract';
import { discoverFeedLink, looksLikeSpa, parseHtmlListPage, parseJsonItemList } from '../../lib/html-feed';
import {
  isWechatSearchUrl,
  parseWechatSearchPage,
  WechatBlockedError,
} from '../../lib/wechat-search';
import type { CandidatesRepo } from '../sources/candidates.repo';
import type { SourcesRepo } from '../sources/sources.repo';

const require = createRequire(import.meta.url);
const Parser = require('rss-parser') as new (options?: Record<string, unknown>) => {
  parseURL(url: string): Promise<Feed>;
};

type FeedItem = {
  title?: string;
  link?: string;
  content?: string;
  contentSnippet?: string;
  summary?: string;
  /** 公众号检索结果带发布时间，用来丢弃明显过期（截止日早已过去）的老文章 */
  isoDate?: string;
};
type Feed = { title?: string; items?: FeedItem[] };

export type FetchResult = { added: number; total: number; skipped: number; filtered: number };

/** 低于该置信度且没有识别到截止时间的内容不进候选池，避免把 DDL 工具做成阅读器 */
const MIN_CONFIDENCE = 0.3;

/** 部分站点会拦非浏览器 UA，兜底抓取与 RSS 抓取统一用浏览器 UA */
const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/** 依 Content-Type 或 <meta charset> 推断编码；很多高校/竞赛站是 GBK/GB2312 */
function detectCharset(contentType: string, buffer: Uint8Array): string {
  const fromHeader = /charset\s*=\s*["']?([\w-]+)/i.exec(contentType)?.[1];
  let cs = fromHeader?.toLowerCase();
  if (!cs) {
    const head = new TextDecoder('latin1').decode(buffer.subarray(0, 2048));
    cs = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head)?.[1]?.toLowerCase();
  }
  if (!cs) return 'utf-8';
  if (cs === 'gb2312' || cs === 'gbk' || cs === 'gb18030') return 'gb18030';
  return cs;
}

/** 兜底抓取：拉原始正文（HTML / JSON，自动按站点编码解码），交给后续按类型解析 */
async function fetchBody(
  url: string,
): Promise<{ body: string; contentType: string; finalUrl: string }> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': BROWSER_UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(15_000),
  });
  const buffer = new Uint8Array(await response.arrayBuffer());
  if (!response.ok) throw new Error(`HTTP ${response.status}（页面打不开，请确认地址能在浏览器里访问）`);
  const contentType = response.headers.get('content-type') ?? '';
  const charset = detectCharset(contentType, buffer);
  let body: string;
  try {
    body = new TextDecoder(charset, { fatal: false }).decode(buffer);
  } catch {
    body = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
  }
  return { body, contentType, finalUrl: response.url || url };
}

export function createCollectService(sourcesRepo: SourcesRepo, candidatesRepo: CandidatesRepo) {
  const parser = new Parser({
    timeout: 15_000,
    headers: { 'User-Agent': BROWSER_UA },
  });

  /** 兜底抓取：JSON 源 → RSS/Atom 自动发现 → HTML 列表页；都不行则给出可操作错误 */
  async function fetchFallback(source: { url: string; name: string }): Promise<FeedItem[]> {
    const { body, contentType, finalUrl } = await fetchBody(source.url);

    // 1) JSON API 源
    if (/json/i.test(contentType) || /^\s*[{[]/.test(body)) {
      try {
        const json: unknown = JSON.parse(body);
        const items = parseJsonItemList(json, finalUrl);
        if (items.length > 0) return items;
      } catch {
        // 不是合法 JSON，继续按 HTML 处理
      }
    }

    // 2) HTML：先找 <link rel="alternate"> 里藏的 RSS/Atom 订阅地址
    const feedUrl = discoverFeedLink(body, finalUrl);
    if (feedUrl && feedUrl !== source.url) {
      try {
        const feed = await parser.parseURL(feedUrl);
        if ((feed.items?.length ?? 0) > 0) return feed.items ?? [];
      } catch {
        // 订阅地址也失败，继续按 HTML 列表页解析
      }
    }

    // 3) HTML 列表页
    const items = parseHtmlListPage(body, finalUrl);
    if (items.length > 0) return items;

    // 4) 都不行：区分 SPA 与普通页面，给出可操作提示
    if (looksLikeSpa(body)) {
      throw new Error(
        '该页面是 JavaScript 动态渲染的应用（SPA），静态抓取拿不到列表内容；请改用 RSS / Atom 订阅地址，或服务端渲染的文章列表页',
      );
    }
    throw new Error('页面里没有可识别的文章链接（需要是文章列表页，而不是详情页或首页）');
  }

  /** 公众号关键词源：走搜狗微信搜索，只解析列表元信息，不抓正文 */
  async function fetchWechatSearch(source: { url: string; name: string }): Promise<FeedItem[]> {
    const { body } = await fetchBody(source.url);
    let items;
    try {
      items = parseWechatSearchPage(body);
    } catch (error) {
      if (error instanceof WechatBlockedError) throw new BadRequestError(error.message);
      throw error;
    }
    return items.map((item) => ({
      title: item.title,
      link: item.link,
      // 把公众号名拼进正文，规则抽取时「XX大学 教务处」这类线索能提高置信度
      content: [item.summary, item.account].filter(Boolean).join(' · '),
      isoDate: item.publishedAt ? item.publishedAt.toISOString() : undefined,
    }));
  }

  async function fetchSource(sourceId: string): Promise<FetchResult> {
    const source = await sourcesRepo.findById(sourceId);
    if (!source) throw new NotFoundError('信息源不存在');

    const wechat = isWechatSearchUrl(source.url);
    let feed: Feed;
    if (wechat) {
      try {
        feed = { title: source.name, items: await fetchWechatSearch(source) };
      } catch (error) {
        const message = error instanceof Error ? error.message : '未知错误';
        await sourcesRepo.markError(sourceId, message);
        throw new BadRequestError(`拉取失败：${message}`);
      }
    } else {
      try {
        feed = await parser.parseURL(source.url);
      } catch (rssError) {
        // 先别急着报错：地址很可能是 JSON 源 / 无 RSS 的 HTML 列表页，尝试兜底解析
        const rssMessage = rssError instanceof Error ? rssError.message : '未知错误';
        try {
          feed = { title: source.name, items: await fetchFallback(source) };
        } catch (htmlError) {
          const htmlMessage = htmlError instanceof Error ? htmlError.message : '未知错误';
          const message =
            `RSS 解析失败：${rssMessage}；兜底解析也失败：${htmlMessage}。` +
            '本应用支持 RSS / Atom 订阅地址、JSON 列表源，或能直接打开的文章列表页';
          await sourcesRepo.markError(sourceId, message);
          throw new BadRequestError(`拉取失败：${message}`);
        }
      }

      // RSS 通道正常返回但一条都没有：有的站点对非浏览器 UA 返回空内容或错误页，再试一次兜底
      if ((feed.items?.length ?? 0) === 0) {
        try {
          feed = { title: source.name, items: await fetchFallback(source) };
        } catch {
          // 保留 RSS 的空结果
        }
      }
    }

    const items = (feed.items ?? []).slice(0, 30);
    const now = new Date();
    let added = 0;
    let skipped = 0;
    let filtered = 0;

    for (const item of items) {
      const title = (item.title ?? '').trim();
      if (!title) {
        skipped += 1;
        continue;
      }

      // 关键词检索会翻出几年前的老文章：原文里的「7月13日截止」如今按「下一次发生」
      // 会被算成明年，属于假截止。文章本身超过 8 个月就直接丢掉。
      if (wechat && item.isoDate) {
        const age = now.getTime() - new Date(item.isoDate).getTime();
        if (Number.isFinite(age) && age > 240 * 86_400_000) {
          filtered += 1;
          continue;
        }
      }

      // 搜狗跳转链里带一次性 token，每次抓取都不同，用它做指纹会导致同一篇文章反复入库，
      // 所以公众号源按标题去重
      const fingerprint = createHash('sha256')
        .update(`${source.id}:${wechat ? `wx:${title}` : (item.link ?? title)}`)
        .digest('hex');

      if (await candidatesRepo.existsByFingerprint(fingerprint)) {
        skipped += 1;
        continue;
      }

      const content = stripHtml(item.content ?? item.contentSnippet ?? item.summary ?? '');
      const extraction = await extractDeadline(title, content, now);

      // 没有时间点、置信度又低的，直接丢弃
      if (!extraction.dueAt && extraction.confidence < MIN_CONFIDENCE) {
        filtered += 1;
        continue;
      }

      const inserted = await candidatesRepo.insert({
        sourceId: source.id,
        title: title.slice(0, 300),
        url: item.link ?? null,
        excerpt: content.slice(0, 300) || null,
        dueAt: extraction.dueAt,
        confidence: extraction.confidence,
        fingerprint,
      });

      if (inserted) added += 1;
      else skipped += 1;
    }

    await sourcesRepo.markFetched(sourceId);
    return { added, total: items.length, skipped, filtered };
  }

  /** 后台轮询：抓取所有到期未抓的源，单个失败不影响其他源 */
  async function refreshDue(): Promise<{ sources: number; added: number }> {
    const due = await sourcesRepo.findDue();
    let added = 0;
    for (const source of due) {
      try {
        const result = await fetchSource(source.id);
        added += result.added;
      } catch {
        // markError 已在 fetchSource 内记录，这里继续下一个源
      }
    }
    return { sources: due.length, added };
  }

  return { fetchSource, refreshDue };
}

export type CollectService = ReturnType<typeof createCollectService>;
