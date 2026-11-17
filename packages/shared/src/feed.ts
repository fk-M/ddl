/**
 * 信息源解析的纯函数集合。
 *
 * 放在 shared 里是因为两端都要用：
 * - 服务端（电脑/桌面内嵌）在 Node 里跑，用 rss-parser 解析 RSS；
 * - 手机端没有服务端，只能自己在 WebView 里抓（CapacitorHttp 绕过 CORS）并用
 *   DOMParser 解析，HTML 列表页 / JSON 列表 / 公众号检索页的解析规则必须与电脑端一致，
 *   否则同一篇文章在两端会被识别成不同的截止时间。
 */

/* ============================== 文本清洗 ============================== */

export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/* ============================== 通用条目类型 ============================== */

export type HtmlFeedItem = {
  title: string;
  link: string;
  contentSnippet?: string;
  /** 列表页上的发布日期（ISO 字符串），仅作参考，不参与截止时间判定 */
  pubDate?: string;
};

/* ============================== HTML 列表页兜底解析 ============================== */

/** 中文标题 8 个字符起步，能滤掉绝大多数导航与分页链接 */
const MIN_TITLE_LENGTH = 8;

const NAV_STOPWORDS = new Set([
  '首页',
  '登录',
  '注册',
  '更多',
  '更多>>',
  '更多+',
  '下一页',
  '上一页',
  '返回',
  '关闭',
  '阅读全文',
  '点击排行',
  '网站地图',
  '联系我们',
]);

const ITEM_LIMIT = 60;

function firstGroup(html: string, pattern: RegExp): string | null {
  const match = html.match(pattern);
  return match?.[1] ?? null;
}

/** 把 2026年11月5日 / 2026-11-05 / 2026/11/05 归一成 Date（按本机时区） */
function parseListDate(text: string): Date | null {
  const match = text.match(/(20\d{2})\s*[年\-/.]\s*(\d{1,2})\s*[月\-/.]\s*(\d{1,2})/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * 大量高校 / 政企站点不提供 RSS，只有渲染好的 HTML 列表页。
 * 这里把页面里「带标题文本的链接」抽成候选条目，策略刻意保守：
 * - 标题优先取 class 含 title 的子元素，其次整段可见文本；
 * - 摘要取 class 含 desc / summary / brief 的子元素；
 * - 日期用正则在链接文本内部找（找不到就留给后续的截止时间抽取）；
 * - 过滤导航类短链接（更多、下一页、登录等）与重复地址。
 */
export function parseHtmlListPage(html: string, baseUrl: string): HtmlFeedItem[] {
  const cleaned = html.replace(/<!--[\s\S]*?-->/g, ' ');
  const results = new Map<string, HtmlFeedItem>();

  const anchorRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchorRe.exec(cleaned)) !== null && results.size < ITEM_LIMIT) {
    const attrs = match[1] ?? '';
    const inner = match[2] ?? '';

    const hrefMatch = attrs.match(/href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const rawHref = (hrefMatch?.[1] ?? hrefMatch?.[2] ?? hrefMatch?.[3] ?? '').trim();
    if (!rawHref || /^(javascript:|mailto:|tel:|#)/i.test(rawHref)) continue;

    let link: URL;
    try {
      link = new URL(rawHref, baseUrl);
    } catch {
      continue;
    }
    if (link.protocol !== 'http:' && link.protocol !== 'https:') continue;

    // 标题：优先 class 含 title 的子元素（内容管理站的通用写法），没有就用整段可见文本
    let title = stripHtml(
      firstGroup(
        inner,
        /class\s*=\s*["'][^"']*title[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|span|p|h[1-6])>/i,
      ) ?? '',
    );
    if (!title) title = stripHtml(inner);
    title = title.replace(/\s+/g, ' ').trim();
    if (title.length < MIN_TITLE_LENGTH) continue;
    if (NAV_STOPWORDS.has(title)) continue;

    const excerpt = stripHtml(
      firstGroup(
        inner,
        /class\s*=\s*["'][^"']*(?:desc|summary|brief)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|span|p)>/i,
      ) ?? '',
    );

    const listDate = parseListDate(stripHtml(inner));

    // 同一地址只保留一条（不同锚点指向同一文章很常见）
    if (!results.has(link.href)) {
      results.set(link.href, {
        title: title.slice(0, 300),
        link: link.href,
        contentSnippet: excerpt ? excerpt.slice(0, 500) : undefined,
        pubDate: listDate ? listDate.toISOString() : undefined,
      });
    }
  }

  return [...results.values()];
}

/**
 * 在 HTML <head> 里找 RSS / Atom 订阅地址（<link rel="alternate" type="application/rss+xml|atom+xml">）。
 * 很多站点首页本身不是 feed，但 <link> 里藏着真正的订阅地址；返回绝对 URL。
 */
export function discoverFeedLink(html: string, baseUrl: string): string | null {
  const linkRe = /<link\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) !== null) {
    const tag = m[0];
    const rel = /\brel\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] ?? '';
    const type = /\btype\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] ?? '';
    if (!/alternate/i.test(rel)) continue;
    if (!/(rss|atom)\+xml/i.test(type) && !/rss|atom/i.test(type)) continue;
    const href = /\bhref\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1]?.trim();
    if (!href) continue;
    try {
      return new URL(href, baseUrl).href;
    } catch {
      /* ignore */
    }
  }
  return null;
}

/** 粗判是否为 JS 动态渲染的 SPA 壳（静态抓取拿不到列表） */
export function looksLikeSpa(html: string): boolean {
  return (
    /<script\b[^>]*\btype\s*=\s*["']module["']/i.test(html) ||
    /<div\b[^>]*\bid\s*=\s*["'](root|app|__next|__nuxt)["']/i.test(html) ||
    /build-mode\s*:/i.test(html) ||
    /vite|webpack|__NEXT_DATA__|window\.__NUXT__/i.test(html)
  );
}

/* ============================== JSON 列表 ============================== */

const TITLE_KEYS = ['title', 'name', 'subject', 'label', 'headline'];
const LINK_KEYS = ['link', 'url', 'htmlUrl', 'permalink', 'href', 'target'];
const DESC_KEYS = ['desc', 'description', 'summary', 'abstract', 'content', 'snippet'];

function pickField(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

/** 从 JSON 里递归找「对象数组」当作条目列表（很多站点的列表来自 JSON API） */
function findItemArray(node: unknown, depth = 0): Record<string, unknown>[] | null {
  if (depth > 4 || node == null) return null;
  if (Array.isArray(node)) {
    const objs = node.filter(
      (x) => x && typeof x === 'object' && !Array.isArray(x),
    ) as Record<string, unknown>[];
    if (objs.length > 0 && objs.some((o) => pickField(o, TITLE_KEYS))) return objs;
    return null;
  }
  if (typeof node === 'object') {
    const rec = node as Record<string, unknown>;
    for (const key of [
      'data',
      'items',
      'list',
      'results',
      'records',
      'contests',
      'rows',
      'content',
      'dataList',
      'result',
    ]) {
      const found = findItemArray(rec[key], depth + 1);
      if (found) return found;
    }
  }
  return null;
}

/** 通用 JSON 列表提取：把 `{title, link, ...}` 形式的对象数组转成条目 */
export function parseJsonItemList(json: unknown, baseUrl: string): HtmlFeedItem[] {
  const arr = findItemArray(json);
  if (!arr) return [];
  const out: HtmlFeedItem[] = [];
  for (const obj of arr) {
    const title = pickField(obj, TITLE_KEYS);
    if (!title || title.length < 2) continue;
    const rawLink = pickField(obj, LINK_KEYS);
    let link = '';
    if (rawLink) {
      try {
        link = new URL(rawLink, baseUrl).href;
      } catch {
        link = rawLink;
      }
    }
    const desc = pickField(obj, DESC_KEYS);
    out.push({
      title: title.slice(0, 300),
      link,
      contentSnippet: desc ? stripHtml(desc).slice(0, 500) : undefined,
    });
  }
  return out;
}

/* ============================== 微信公众号检索 ============================== */

const SOGOU_HOST = 'weixin.sogou.com';

/** 判断一个信息源地址是不是搜狗微信搜索 */
export function isWechatSearchUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (!/sogou\.com$/i.test(url.hostname)) return false;
    return url.hostname.startsWith('weixin.') || url.pathname.startsWith('/weixin');
  } catch {
    return false;
  }
}

/** 搜狗触发了反爬（验证码 / 账号异常），需要给用户可读提示 */
export class WechatBlockedError extends Error {
  constructor() {
    super('搜狗微信搜索临时限制了访问（可能需要验证码），请稍后再试，或降低抓取频率');
    this.name = 'WechatBlockedError';
  }
}

export type WechatSearchItem = {
  title: string;
  link: string;
  summary: string;
  account: string;
  publishedAt: Date | null;
};

function decodeEntities(text: string): string {
  return text
    .replace(/<em[^>]*>/gi, '')
    .replace(/<\/em>/gi, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&hellip;/g, '…')
    .replace(/&mdash;/g, '—')
    .replace(/&amp;/g, '&')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 解析搜狗微信搜索结果页。
 * 结构：ul.news-list > li > .txt-box > h3 > a（标题/跳转链）、p.txt-info（摘要）、
 * .s-p > span.all-time-y2（公众号名）+ span.s2 > script（timeConvert(秒级时间戳)）
 */
export function parseWechatSearchPage(html: string): WechatSearchItem[] {
  if (/antispider|请输入验证码|访问过于频繁|账号异常/.test(html)) {
    throw new WechatBlockedError();
  }

  const start = html.indexOf('class="news-list"');
  if (start < 0) {
    if (/没有找到相关的微信公众号文章|暂无相关/.test(html)) return [];
    throw new Error('搜狗返回的页面结构变了，未能识别文章列表（可能被反爬拦截）');
  }

  const list = html.slice(start);
  const blocks = list.split(/<li\s+id="sogou_vr_/).slice(1);
  const items: WechatSearchItem[] = [];

  for (const block of blocks) {
    const anchor = /<h3[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    if (!anchor) continue;
    const title = decodeEntities(anchor[2] ?? '');
    if (!title) continue;

    const href = (anchor[1] ?? '').replace(/&amp;/g, '&');
    const link = href.startsWith('http')
      ? href
      : `https://${SOGOU_HOST}${href.startsWith('/') ? '' : '/'}${href}`;

    const summary = decodeEntities(
      /<p[^>]*class="txt-info"[^>]*>([\s\S]*?)<\/p>/i.exec(block)?.[1] ?? '',
    );
    const account = decodeEntities(
      /<span[^>]*class="all-time-y2"[^>]*>([\s\S]*?)<\/span>/i.exec(block)?.[1] ?? '',
    );
    const seconds = /timeConvert\('(\d+)'\)/.exec(block)?.[1];

    items.push({
      title,
      link,
      summary,
      account,
      publishedAt: seconds ? new Date(Number(seconds) * 1000) : null,
    });
  }

  return items;
}
