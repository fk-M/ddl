import * as chrono from 'chrono-node';

type ZhCasual = { parse: typeof chrono.casual.parse };

// chrono-node 的中文解析器在 namespaces 上导出，做一次兜底避免版本差异
const zhCasual: ZhCasual =
  (chrono as unknown as { zh?: { casual: ZhCasual } }).zh?.casual ?? chrono.casual;

export type ParsedQuickAdd = {
  title: string;
  dueAt: string | null;
  matchedText: string | null;
};

/**
 * 从「明天下午3点交周报」这类输入里拆出标题与截止时间。
 * 时间表达式会从标题中剥离；若剥离后为空，则保留原文本以保证任务可创建。
 */
export function parseQuickAdd(input: string, now: Date = new Date()): ParsedQuickAdd {
  const text = input.trim();
  if (!text) return { title: '', dueAt: null, matchedText: null };

  const results = zhCasual.parse(text, now, { forwardDate: true });
  const hit = results.at(-1);
  if (!hit) return { title: text, dueAt: null, matchedText: null };

  const stripped = (text.slice(0, hit.index) + text.slice(hit.index + hit.text.length))
    .replace(/^[\s,，、:：]+/, '')
    .replace(/[\s,，、:：]+$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return {
    title: stripped.length > 0 ? stripped : text,
    dueAt: hit.start.date().toISOString(),
    matchedText: hit.text,
  };
}
