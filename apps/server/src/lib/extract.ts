import { createRequire } from 'node:module';
import { config } from '../config';

const require = createRequire(import.meta.url);
// chrono-node 为 CJS 包，ESM 下无法具名导入
const chrono = require('chrono-node') as typeof import('chrono-node');

// stripHtml 与手机端共用同一份实现（手机端离线自己抓页面时也要清洗 HTML）
export { stripHtml } from '@ddl/shared';

/** 截止语义关键词：命中则显著提高置信度 */
const DEADLINE_HINTS = [
  '截止',
  '截至',
  '截稿',
  '报名',
  '提交',
  '申请',
  '截止日期',
  '最后期限',
  '前完成',
  'deadline',
  'due',
  'closes on',
];

export type ExtractionResult = {
  dueAt: Date | null;
  confidence: number;
  hint: string | null;
  matchedText: string | null;
  /** 抽取方式，便于排查 */
  method: 'rule' | 'llm' | 'none';
};

const zhCasual =
  (chrono as unknown as { zh?: { casual: typeof chrono.casual } }).zh?.casual ?? chrono.casual;

/** 规则抽取：在标题与正文里找第一个日期，并结合邻近关键词判断是否真的是截止时间 */
export function extractByRule(title: string, content: string, now = new Date()): ExtractionResult {
  const text = `${title}\n${content}`.slice(0, 2000);
  // 口语化「X日24点 / X日24:00」表示当日结束，chrono 无法解析，规整成 23:59 再抽取。
  // 对所有采集链路（信息源、剪藏）通用，语义明确、误伤极低。
  const normalized = text
    .replace(/24[:：]00/g, '23:59')
    .replace(/24\s*点(?!\d)/g, '23点59分')
    .replace(/24\s*时(?!\d)/g, '23时59分');
  const results = zhCasual.parse(normalized, now, { forwardDate: true });
  const hit = results[0];

  if (!hit) {
    return { dueAt: null, confidence: 0.1, hint: null, matchedText: null, method: 'none' };
  }

  const windowText = text.slice(
    Math.max(0, hit.index - 14),
    hit.index + hit.text.length + 14,
  );
  const hint = DEADLINE_HINTS.find((word) => windowText.toLowerCase().includes(word)) ?? null;

  const dueAt = hit.start.date();
  let confidence = hint ? 0.85 : 0.45;
  // 时间早于当前时刻，多半是文章发布日期而非截止时间
  if (dueAt.getTime() < now.getTime()) confidence = Math.min(confidence, 0.2);

  return { dueAt, confidence, hint, matchedText: hit.text, method: 'rule' };
}

type LlmPayload = { is_deadline: boolean; title?: string; due_at?: string | null; confidence?: number };

/** LLM 抽取：仅在配置了 LLM_API_KEY 时启用，失败时静默回退到规则抽取 */
export async function extractByLlm(
  title: string,
  content: string,
  now = new Date(),
): Promise<ExtractionResult | null> {
  if (!config.llm.apiKey) return null;

  const prompt = [
    '你是信息抽取器。判断下面这条资讯是否包含一个明确的「截止时间」（报名截止、提交截止、活动开始等）。',
    '只输出 JSON，不要解释。字段：',
    '{"is_deadline": boolean, "title": "凝练后的事项标题，不超过30字", "due_at": "ISO8601 时间或 null", "confidence": 0~1}',
    `当前时间：${now.toISOString()}`,
    '',
    `标题：${title}`,
    `正文：${content.slice(0, 1500)}`,
  ].join('\n');

  try {
    const response = await fetch(`${config.llm.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.llm.apiKey}`,
      },
      body: JSON.stringify({
        model: config.llm.model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) return null;
    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const raw = body.choices?.[0]?.message?.content;
    if (!raw) return null;

    const parsed = JSON.parse(raw) as LlmPayload;
    if (!parsed.is_deadline || !parsed.due_at) {
      return { dueAt: null, confidence: 0.1, hint: null, matchedText: null, method: 'llm' };
    }

    const dueAt = new Date(parsed.due_at);
    if (Number.isNaN(dueAt.getTime())) return null;

    return {
      dueAt,
      confidence: Math.min(0.99, Math.max(0.3, parsed.confidence ?? 0.8)),
      hint: 'llm',
      matchedText: parsed.title ?? null,
      method: 'llm',
    };
  } catch {
    return null;
  }
}

/** 先试 LLM，失败或未配置则回退规则 */
export async function extractDeadline(
  title: string,
  content: string,
  now = new Date(),
): Promise<ExtractionResult> {
  const llm = await extractByLlm(title, content, now);
  if (llm) return llm;
  return extractByRule(title, content, now);
}
