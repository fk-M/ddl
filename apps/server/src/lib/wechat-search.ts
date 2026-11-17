/**
 * 微信公众号文章检索（通过搜狗微信搜索的公开检索页）。
 *
 * 为什么不直连微信：公众号没有公开的文章列表 API，`mp.weixin.qq.com` 需要登录态与
 * 公众号身份，任何「订阅某个号」的抓取都要走第三方聚合或逆向；搜狗微信搜索是目前
 * 唯一对公网开放的检索入口，返回的是「按关键词命中的文章列表」，含标题、摘要、
 * 公众号名与发布时间——足够我们做截止时间识别，且不需要抓正文（更合规、也更抗反爬）。
 *
 * 代价：只能按关键词发现文章，不能保证覆盖某个号的全部推送；搜狗有频率限制，
 * 高频会弹验证码，因此调用方应当低频（单源单次只取第一页）。
 */

import { wechatSearchUrl } from '@ddl/shared';

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

/** 由关键词拼搜狗微信文章检索地址（type=2 = 文章） */
export function buildWechatSearchUrl(keyword: string): string {
  return wechatSearchUrl(keyword);
}

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

export type WechatSearchItem = {
  title: string;
  link: string;
  summary: string;
  account: string;
  publishedAt: Date | null;
};

/** 搜狗触发了反爬（验证码 / 账号异常），需要给用户可读提示 */
export class WechatBlockedError extends Error {
  constructor() {
    super('搜狗微信搜索临时限制了访问（可能需要验证码），请稍后再试，或降低抓取频率');
    this.name = 'WechatBlockedError';
  }
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
