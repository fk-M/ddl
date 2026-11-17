/**
 * HTML 列表页兜底解析 —— 实现已挪到 `@ddl/shared`（packages/shared/src/feed.ts），
 * 因为手机端没有服务端，也要用同一套规则自己解析，两端结果必须一致。
 * 这里保留同名导出，避免改动调用方。
 */
export {
  discoverFeedLink,
  looksLikeSpa,
  parseHtmlListPage,
  parseJsonItemList,
  type HtmlFeedItem,
} from '@ddl/shared';
