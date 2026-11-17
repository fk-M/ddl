import { Capacitor, CapacitorHttp } from '@capacitor/core';
import {
  discoverFeedLink,
  isWechatSearchUrl,
  looksLikeSpa,
  parseHtmlListPage,
  parseJsonItemList,
  parseWechatSearchPage,
  stripHtml,
  WechatBlockedError,
} from '@ddl/shared';

/**
 * 手机端自己抓信息源。
 *
 * 为什么能在手机上做：WebView 里 fetch 会被 CORS 拦死，但 Capacitor 自带的
 * CapacitorHttp 走的是系统原生 HTTP（OkHttp / URLSession），不受 CORS 约束，
 * 也能顺便绕开「非浏览器 UA」的拦截。
 *
 * 和电脑端的差别：
 * - RSS 用 DOMParser 解析，不用 rss-parser（那是 Node 的包）；
 * - 截止时间只做规则抽取，没有 LLM（手机上不配 API Key）；
 * - 不做后台轮询，点了才抓（省电、也避免被目标站点限流）。
 */

export type FeedItem = {
  title?: string;
  link?: string;
  content?: string;
  contentSnippet?: string;
  summary?: string;
  /** 公众号检索结果带发布时间，用来丢弃明显过期（截止日早已过去）的老文章 */
  isoDate?: string;
};

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/** 依 Content-Type 或 <meta charset> 推断编码；很多高校/竞赛站是 GBK/GB2312 */
function detectCharset(contentType: string, head: string): string {
  const fromHeader = /charset\s*=\s*["']?([\w-]+)/i.exec(contentType)?.[1]?.toLowerCase();
  const fromMeta = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head)?.[1]?.toLowerCase();
  const cs = fromHeader ?? fromMeta;
  if (!cs) return 'utf-8';
  if (cs === 'gb2312' || cs === 'gbk' || cs === 'gb18030') return 'gb18030';
  return cs;
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function headerValue(headers: Record<string, string> | undefined, name: string): string {
  if (!headers) return '';
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  return key ? String(headers[key]) : '';
}

/**
 * 拉原始正文并按站点编码解码。
 * 原生端用 arraybuffer + 自己解码：OkHttp 只看 Content-Type 的 charset，
 * 而国内站点大量只在 <meta charset> 里声明 GBK，交给原生解码会变乱码。
 */
async function httpText(
  url: string,
): Promise<{ body: string; contentType: string; finalUrl: string }> {
  if (Capacitor.isNativePlatform()) {
    const response = await CapacitorHttp.request({
      url,
      method: 'GET',
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      responseType: 'arraybuffer',
      connectTimeout: 15_000,
      readTimeout: 20_000,
    });

    if (response.status >= 400 && response.status !== 0) {
      throw new Error(`HTTP ${response.status}（页面打不开，请确认地址能在浏览器里访问）`);
    }

    const contentType = headerValue(response.headers, 'content-type');
    // 原生端把 arraybuffer 转成 base64 字符串返回；Web 回落时是 ArrayBuffer
    let bytes: Uint8Array;
    if (typeof response.data === 'string') {
      bytes = base64ToBytes(response.data);
    } else if (response.data instanceof ArrayBuffer) {
      bytes = new Uint8Array(response.data);
    } else {
      throw new Error('返回内容无法识别');
    }

    const headAscii = new TextDecoder('latin1').decode(bytes.subarray(0, 2048));
    const charset = detectCharset(contentType, headAscii);
    let body: string;
    try {
      body = new TextDecoder(charset, { fatal: false }).decode(bytes);
    } catch {
      body = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    }
    return { body, contentType, finalUrl: response.url || url };
  }

  // 浏览器里没有原生 HTTP，跨域站点大概率被拦；这是 dev/网页版的固有限制，给出可读提示
  let response: Response;
  try {
    response = await fetch(url);
  } catch {
    throw new Error(
      '浏览器里无法直接抓取外部站点（跨域限制）。手机 App 与电脑端不受影响，这条只是网页预览的限制。',
    );
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}（页面打不开，请确认地址能在浏览器里访问）`);
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const contentType = response.headers.get('content-type') ?? '';
  const charset = detectCharset(contentType, new TextDecoder('latin1').decode(bytes.subarray(0, 2048)));
  let body: string;
  try {
    body = new TextDecoder(charset, { fatal: false }).decode(bytes);
  } catch {
    body = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }
  return { body, contentType, finalUrl: response.url || url };
}

/* ============================== RSS / Atom 解析 ============================== */

function childText(parent: Element, names: string[]): string {
  for (const node of Array.from(parent.children)) {
    const local = (node.localName ?? node.nodeName).toLowerCase();
    if (names.includes(local)) {
      const text = node.textContent?.trim();
      if (text) return text;
    }
  }
  return '';
}

function atomLink(parent: Element): string {
  for (const node of Array.from(parent.children)) {
    const local = (node.localName ?? node.nodeName).toLowerCase();
    if (local !== 'link') continue;
    const rel = node.getAttribute('rel');
    if (rel && rel !== 'alternate') continue;
    const href = node.getAttribute('href');
    if (href) return href.trim();
  }
  // RSS 的 <link> 是纯文本节点而非 href 属性
  const plain = childText(parent, ['link']);
  return plain;
}

/** 用 DOMParser 解析 RSS 2.0 / Atom / RDF；解析失败返回空数组交给兜底链路 */
export function parseFeedXml(xml: string, baseUrl: string): FeedItem[] {
  if (!/^\s*<\?xml|^\s*<rss|^\s*<feed|^\s*<rdf/i.test(xml)) return [];

  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xml, 'text/xml');
  } catch {
    return [];
  }
  if (doc.querySelector('parsererror')) return [];

  const nodes = Array.from(doc.querySelectorAll('item, entry'));
  const items: FeedItem[] = [];
  for (const node of nodes) {
    const title = childText(node, ['title']);
    if (!title) continue;

    let link = atomLink(node);
    if (link) {
      try {
        link = new URL(link, baseUrl).href;
      } catch {
        /* 保留原值 */
      }
    }

    const content =
      childText(node, ['encoded', 'content', 'description', 'summary']) ||
      childText(node, ['description']);
    const published =
      childText(node, ['isoDate', 'pubdate', 'published', 'updated', 'date']) || undefined;

    items.push({
      title,
      link: link || undefined,
      content,
      isoDate: published && !Number.isNaN(new Date(published).getTime())
        ? new Date(published).toISOString()
        : undefined,
    });
  }
  return items;
}

/* ============================== 抓取编排 ============================== */

type FetchedDoc = { body: string; contentType: string; finalUrl: string };

/** 传入 prefetched 可复用已拉到的正文，避免同一个地址抓两遍 */
async function fetchFallback(url: string, prefetched?: FetchedDoc): Promise<FeedItem[]> {
  const { body, contentType, finalUrl } = prefetched ?? (await httpText(url));

  // 1) JSON API 源
  if (/json/i.test(contentType) || /^\s*[{[]/.test(body)) {
    try {
      const items = parseJsonItemList(JSON.parse(body), finalUrl);
      if (items.length > 0) return items;
    } catch {
      // 不是合法 JSON，继续按 HTML 处理
    }
  }

  // 2) HTML：先看 <link rel="alternate"> 里有没有藏订阅地址
  const feedUrl = discoverFeedLink(body, finalUrl);
  if (feedUrl && feedUrl !== url) {
    try {
      const feedXml = await httpText(feedUrl);
      const items = parseFeedXml(feedXml.body, feedXml.finalUrl);
      if (items.length > 0) return items;
    } catch {
      // 订阅地址也失败，继续按列表页解析
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

/** 抓一个信息源，返回原始条目；失败时抛可读错误 */
export async function fetchSourceItems(url: string): Promise<FeedItem[]> {
  if (isWechatSearchUrl(url)) {
    const { body } = await httpText(url);
    const items = parseWechatSearchPage(body);
    return items.map((item) => ({
      title: item.title,
      link: item.link,
      // 把公众号名拼进正文，「XX大学 教务处」这类线索能提高规则抽取的置信度
      content: [item.summary, item.account].filter(Boolean).join(' · '),
      isoDate: item.publishedAt ? item.publishedAt.toISOString() : undefined,
    }));
  }

  const doc = await httpText(url);

  // 直接就是 feed 的情况
  if (
    /xml|rss|atom/i.test(doc.contentType) ||
    /^\s*<\?xml|^\s*<rss|^\s*<feed|^\s*<rdf/i.test(doc.body)
  ) {
    const items = parseFeedXml(doc.body, doc.finalUrl);
    if (items.length > 0) return items;
  }

  return fetchFallback(url, doc);
}

/** 抓一个文章页，返回页面标题与去标签正文（剪藏识别 DDL 用） */
export async function fetchPageContent(url: string): Promise<{ title: string; content: string }> {
  const { body } = await httpText(url);
  const title = stripHtml(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(body)?.[1] ?? '').trim();
  return { title, content: stripHtml(body).slice(0, 3000) };
}

export { isWechatSearchUrl, WechatBlockedError };
