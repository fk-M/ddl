/**
 * 手机端的截止时间抽取（只有规则，没有 LLM）。
 *
 * 规则与服务端 `apps/server/src/lib/extract.ts` 的 extractByRule 保持一致：
 * chrono 解析第一个日期 + 邻近截止关键词加权 + 过去时间降权。
 * chrono-node 体积不小，改成首次用到时再动态加载，信息源页没打开就不会进包。
 */

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

export type LocalExtraction = {
  dueAt: Date | null;
  confidence: number;
  hint: string | null;
  matchedText: string | null;
};

type ChronoLike = {
  casual: { parse: (text: string, ref?: Date, options?: { forwardDate?: boolean }) => ChronoResult[] };
  zh?: { casual: { parse: (text: string, ref?: Date, options?: { forwardDate?: boolean }) => ChronoResult[] } };
};

type ChronoResult = {
  index: number;
  text: string;
  start: { date: () => Date };
};

let chronoPromise: Promise<ChronoLike | null> | null = null;

function loadChrono(): Promise<ChronoLike | null> {
  if (!chronoPromise) {
    chronoPromise = import('chrono-node')
      .then((mod) => {
        const resolved = ((mod as unknown as { default?: ChronoLike }).default ?? mod) as ChronoLike;
        return resolved?.casual ? resolved : null;
      })
      .catch(() => null);
  }
  return chronoPromise;
}

/** 关键词兜底：chrono 还没加载完时先用正则找一个「X月X日」 */
function fallbackByRegex(text: string, now: Date): LocalExtraction {
  const match = /(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/.exec(text);
  if (!match) {
    return { dueAt: null, confidence: 0.1, hint: null, matchedText: null };
  }
  const month = Number(match[1]);
  const day = Number(match[2]);
  const guess = new Date(now.getFullYear(), month - 1, day, 23, 59);
  if (guess.getTime() < now.getTime()) guess.setFullYear(guess.getFullYear() + 1);
  const windowText = text.slice(Math.max(0, match.index - 14), match.index + match[0].length + 14);
  const hint = DEADLINE_HINTS.find((word) => windowText.toLowerCase().includes(word)) ?? null;
  return {
    dueAt: guess,
    confidence: hint ? 0.8 : 0.4,
    hint,
    matchedText: match[0],
  };
}

/**
 * 与电脑端同口径的规则抽取。
 * 口语化「X日24点 / 24:00」表示当日结束，chrono 解析不了，先规整成 23:59。
 */
export async function extractByRuleLocal(
  title: string,
  content: string,
  now = new Date(),
): Promise<LocalExtraction> {
  const text = `${title}\n${content}`.slice(0, 2000);
  const normalized = text
    .replace(/24[:：]00/g, '23:59')
    .replace(/24\s*点(?!\d)/g, '23点59分')
    .replace(/24\s*时(?!\d)/g, '23时59分');

  const chrono = await loadChrono();
  if (!chrono) return fallbackByRegex(normalized, now);

  const parser = chrono.zh?.casual ?? chrono.casual;
  let results: ChronoResult[] = [];
  try {
    results = parser.parse(normalized, now, { forwardDate: true });
  } catch {
    return fallbackByRegex(normalized, now);
  }

  const hit = results[0];
  if (!hit) {
    return { dueAt: null, confidence: 0.1, hint: null, matchedText: null };
  }

  const windowText = text.slice(
    Math.max(0, hit.index - 14),
    hit.index + hit.text.length + 14,
  );
  const hint = DEADLINE_HINTS.find((word) => windowText.toLowerCase().includes(word)) ?? null;

  const dueAt = hit.start.date();
  let confidence = hint ? 0.85 : 0.45;
  if (dueAt.getTime() < now.getTime()) confidence = Math.min(confidence, 0.2);

  return { dueAt, confidence, hint, matchedText: hit.text };
}
