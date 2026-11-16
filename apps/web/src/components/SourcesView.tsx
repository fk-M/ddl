import clsx from 'clsx';
import { Check, Link2, Loader2, Plus, RefreshCw, Scissors, Trophy, Trash2 } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import {
  useCandidateActions,
  useCandidates,
  useClipExtract,
  useCreateSource,
  useCreateTask,
  useDeleteSource,
  useFetchSource,
  usePresets,
  useSources,
  useSubscribePreset,
} from '../hooks/useDdl';
import { visibleError } from '../lib/api';
import { formatDue } from '../lib/datetime';

function relativeTime(iso: string | null): string {
  if (!iso) return '从未抓取';
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return '刚刚抓取';
  if (minutes < 60) return `${minutes} 分钟前抓取`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前抓取`;
  return `${Math.floor(hours / 24)} 天前抓取`;
}

/** ISO 时间 → datetime-local 输入框所需的本地字符串（无时区） */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* ============================== 剪藏卡片 ============================== */

function ClipCard() {
  const clipExtract = useClipExtract();
  const createTask = useCreateTask();

  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [dueLocal, setDueLocal] = useState('');
  const [created, setCreated] = useState(false);

  const result = clipExtract.data;

  // 识别完成：用结果回填标题与截止时间，供用户确认/微调
  useEffect(() => {
    if (result) {
      setTitle(result.title);
      setDueLocal(result.dueAt ? toLocalInput(result.dueAt) : '');
      setCreated(false);
    }
  }, [result]);

  function handleReset() {
    setText('');
    setTitle('');
    setDueLocal('');
    setCreated(false);
    clipExtract.reset();
  }

  function handleCreate() {
    if (!title.trim() || createTask.isPending) return;
    createTask.mutate(
      {
        title: title.trim().slice(0, 500),
        notes: text.trim() ? text.trim().slice(0, 50_000) : null,
        kind: 'task',
        dueAt: dueLocal ? new Date(dueLocal).toISOString() : null,
        priority: 0,
        isImportant: false,
        isUrgent: false,
        tags: [],
        rrule: null,
        repeatFrom: 'due',
        estimatePomodoros: 0,
        pinned: false,
      },
      {
        onSuccess: () => {
          setCreated(true);
          setText('');
          setTitle('');
          setDueLocal('');
          clipExtract.reset();
        },
      },
    );
  }

  return (
    <section>
      <h2 className="mb-2 text-[13px] font-medium text-neutral-800">剪藏 · 微信 / 雨课堂 / 班级群消息</h2>
      <div className="rounded-xl border border-neutral-200 bg-white p-3">
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="把微信 / 雨课堂 / 班级群里看到的截止通知文字，或文章链接，粘贴到这里。例如：「12月1日 24:00 高数作业提交截止」或一条公众号文章链接。"
          rows={3}
          className="w-full resize-y rounded-lg border border-neutral-200 px-2.5 py-2 text-[13px] outline-none focus:border-neutral-400"
        />
        <div className="mt-2 flex items-center justify-between">
          <p className="text-[11.5px] text-neutral-400">
            自动识别截止时间，确认后再生成任务，不会自动污染清单。
          </p>
          <button
            type="button"
            onClick={() => clipExtract.mutate(text)}
            disabled={clipExtract.isPending || !text.trim()}
            className="flex h-9 shrink-0 items-center gap-1 rounded-lg bg-neutral-900 px-3 text-[12.5px] text-white disabled:opacity-40"
          >
            {clipExtract.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Scissors className="size-3.5" />}
            识别
          </button>
        </div>

        {visibleError(clipExtract.error) && (
          <p className="mt-2 text-[12px] text-red-600">{visibleError(clipExtract.error)?.message}</p>
        )}

        {result && (
          <div className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
            <div className="flex items-center gap-2 text-[11.5px] text-neutral-500">
              <span
                className={clsx(
                  'rounded px-1.5 py-0.5',
                  result.confidence >= 0.7
                    ? 'bg-emerald-50 text-emerald-700'
                    : result.confidence >= 0.4
                      ? 'bg-neutral-100 text-neutral-500'
                      : 'bg-neutral-100 text-neutral-400',
                )}
              >
                置信度 {Math.round(result.confidence * 100)}%
              </span>
              <span className="rounded bg-neutral-100 px-1.5 py-0.5">{result.method === 'llm' ? 'AI 识别' : '规则识别'}</span>
              {result.fetched && <span className="rounded bg-neutral-100 px-1.5 py-0.5">已抓取链接</span>}
            </div>

            <label className="mt-2 block text-[11.5px] text-neutral-500">标题</label>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="mt-1 h-9 w-full rounded-lg border border-neutral-200 px-2.5 text-[13px] outline-none focus:border-neutral-400"
            />

            <label className="mt-2 block text-[11.5px] text-neutral-500">截止时间（可手动调整）</label>
            <input
              type="datetime-local"
              value={dueLocal}
              onChange={(event) => setDueLocal(event.target.value)}
              className="mt-1 h-9 w-full rounded-lg border border-neutral-200 px-2.5 text-[13px] outline-none focus:border-neutral-400"
            />

            {result.matchedText && (
              <p className="mt-2 text-[11.5px] text-neutral-400">
                命中原文：<span className="text-neutral-600">{result.matchedText}</span>
              </p>
            )}

            <div className="mt-3 flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleCreate}
                disabled={createTask.isPending || !title.trim()}
                className="flex h-9 items-center gap-1 rounded-lg bg-neutral-900 px-3 text-[12.5px] text-white disabled:opacity-40"
              >
                {createTask.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                建 DDL
              </button>
              <button
                type="button"
                onClick={handleReset}
                className="h-9 rounded-lg border border-neutral-200 px-3 text-[12.5px] text-neutral-500 hover:bg-neutral-100"
              >
                重填
              </button>
              {created && (
                <span className="flex items-center gap-1 text-[12px] text-emerald-600">
                  <Check className="size-3.5" /> 已建任务
                </span>
              )}
            </div>
            {visibleError(createTask.error) && (
              <p className="mt-2 text-[12px] text-red-600">{visibleError(createTask.error)?.message}</p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

/* ============================== 竞赛频道 ============================== */

function CompetitionSection() {
  const presetsQuery = usePresets();
  const subscribe = useSubscribePreset();
  const presets = presetsQuery.data ?? [];

  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-[13px] font-medium text-neutral-800">竞赛频道</h2>
        <Trophy className="size-3.5 text-amber-500" />
      </div>
      <p className="mb-2 text-[11.5px] text-neutral-400">
        一键订阅下列竞赛信息源，赛事报名 / 截止通知会自动进入「待确认」，确认后生成 DDL。
      </p>

      <div className="space-y-1.5">
        {presets.length === 0 && !presetsQuery.isLoading && (
          <p className="rounded-xl border border-dashed border-neutral-200 px-4 py-6 text-center text-[12.5px] text-neutral-400">
            暂时没有可订阅的竞赛频道（需要联网加载）。
          </p>
        )}

        {presets.map((preset) => (
          <div
            key={preset.key}
            className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white px-3 py-2.5"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-neutral-800">{preset.name}</p>
              <p className="mt-0.5 line-clamp-2 text-[11.5px] text-neutral-400">{preset.description}</p>
            </div>
            <button
              type="button"
              onClick={() => subscribe.mutate(preset.key)}
              disabled={preset.subscribed || (subscribe.isPending && subscribe.variables === preset.key)}
              className={clsx(
                'flex h-9 shrink-0 items-center gap-1 rounded-lg px-3 text-[12.5px]',
                preset.subscribed
                  ? 'border border-neutral-200 text-neutral-400'
                  : 'bg-neutral-900 text-white disabled:opacity-40',
              )}
            >
              {preset.subscribed ? (
                <>
                  <Check className="size-3.5" /> 已订阅
                </>
              ) : subscribe.isPending && subscribe.variables === preset.key ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                '订阅'
              )}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

/* ============================== 信息源（原有） ============================== */

export function SourcesView() {
  const sourcesQuery = useSources();
  const candidatesQuery = useCandidates('pending');
  const createSource = useCreateSource();
  const deleteSource = useDeleteSource();
  const fetchSource = useFetchSource();
  const { accept, dismiss, dismissAll } = useCandidateActions();

  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [lastResult, setLastResult] = useState<string | null>(null);

  const sources = sourcesQuery.data ?? [];
  const candidates = candidatesQuery.data ?? [];

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || !url.trim() || createSource.isPending) return;
    createSource.mutate(
      { name: name.trim(), url: url.trim() },
      {
        onSuccess: () => {
          setName('');
          setUrl('');
        },
      },
    );
  }

  return (
    <div className="space-y-6">
      <ClipCard />
      <CompetitionSection />

      <section>
        <form
          onSubmit={handleSubmit}
          className="rounded-xl border border-neutral-200 bg-white p-3"
        >
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="信息源名称，如「公司公告」"
              className="h-9 min-w-0 flex-1 rounded-lg border border-neutral-200 px-2.5 text-[13px] outline-none focus:border-neutral-400"
            />
            <input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="RSS 地址 https://example.com/feed.xml"
              className="h-9 min-w-0 flex-[1.6] rounded-lg border border-neutral-200 px-2.5 text-[13px] outline-none focus:border-neutral-400"
            />
            <button
              type="submit"
              disabled={createSource.isPending || !name.trim() || !url.trim()}
              className="flex h-9 shrink-0 items-center justify-center gap-1 rounded-lg bg-neutral-900 px-3 text-[12.5px] text-white disabled:opacity-40"
            >
              <Plus className="size-3.5" />
              添加
            </button>
          </div>
          <p className="mt-2 text-[11.5px] text-neutral-400">
            目前支持 RSS / Atom。添加后会按间隔自动抓取，采集到的内容先进「待确认」，不会直接变成任务。
          </p>
          {visibleError(createSource.error) && (
            <p className="mt-2 text-[12px] text-red-600">{visibleError(createSource.error)?.message}</p>
          )}
        </form>

        <div className="mt-3 space-y-1.5">
          {sources.length === 0 && !sourcesQuery.isLoading && (
            <p className="rounded-xl border border-dashed border-neutral-200 px-4 py-8 text-center text-[12.5px] text-neutral-400">
              还没有信息源。加一个 RSS 地址，比如某个招聘站或公告页的订阅源。
            </p>
          )}

          {sources.map((source) => (
            <div
              key={source.id}
              className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white px-3 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-neutral-800">{source.name}</p>
                <p className="mt-0.5 flex items-center gap-2 text-[11.5px] text-neutral-400">
                  <span className="truncate">{source.url}</span>
                  <span>·</span>
                  <span className="shrink-0">{relativeTime(source.lastFetchedAt)}</span>
                </p>
                {source.lastError && (
                  <p className="mt-0.5 truncate text-[11.5px] text-red-600">抓取失败：{source.lastError}</p>
                )}
              </div>

              <button
                type="button"
                onClick={() =>
                  fetchSource.mutate(source.id, {
                    onSuccess: (result) =>
                      setLastResult(
                        `「${source.name}」抓取完成：新增 ${result.added} 条，过滤 ${result.filtered} 条（未识别到截止时间），跳过 ${result.skipped} 条（已存在）`,
                      ),
                    onError: (error) => setLastResult(`抓取失败：${error.message}`),
                  })
                }
                disabled={fetchSource.isPending && fetchSource.variables === source.id}
                className="flex shrink-0 items-center gap-1 rounded-lg border border-neutral-200 px-2 py-1 text-[11.5px] text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
              >
                {fetchSource.isPending && fetchSource.variables === source.id ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <RefreshCw className="size-3" />
                )}
                抓取
              </button>

              <button
                type="button"
                onClick={() => deleteSource.mutate(source.id)}
                className="shrink-0 rounded p-1 text-neutral-300 hover:bg-neutral-100 hover:text-red-600"
                aria-label="删除信息源"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>

        {lastResult && <p className="mt-2 text-[12px] text-neutral-500">{lastResult}</p>}
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-[13px] font-medium text-neutral-800">
            待确认 · {candidates.length}
          </h2>
          <div className="flex items-center gap-2">
            <p className="hidden text-[11.5px] text-neutral-400 sm:block">确认后才会生成任务</p>
            {candidates.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(`忽略全部 ${candidates.length} 条待确认候选？`)) dismissAll.mutate();
                }}
                disabled={dismissAll.isPending}
                className="flex shrink-0 items-center gap-1 rounded-lg border border-neutral-200 px-2.5 py-1 text-[11.5px] text-neutral-500 hover:bg-neutral-50 hover:text-red-600 disabled:opacity-50"
              >
                {dismissAll.isPending ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
                全部忽略
              </button>
            )}
          </div>
        </div>

        {candidates.length === 0 && (
          <p className="rounded-xl border border-dashed border-neutral-200 px-4 py-8 text-center text-[12.5px] text-neutral-400">
            暂无候选。点上面的「抓取」拉一次试试。
          </p>
        )}

        <div className="space-y-1.5">
          {candidates.map((candidate) => (
            <div
              key={candidate.id}
              className="rounded-xl border border-neutral-200 bg-white px-3 py-2.5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] leading-5 text-neutral-800">{candidate.title}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[11.5px] text-neutral-400">
                    {candidate.sourceName && <span>{candidate.sourceName}</span>}
                    {candidate.dueAt && (
                      <span
                        className={clsx(
                          'rounded px-1.5 py-0.5',
                          new Date(candidate.dueAt).getTime() < Date.now()
                            ? 'bg-neutral-100 text-neutral-400'
                            : 'bg-amber-50 text-amber-700',
                        )}
                      >
                        识别时间：{formatDue(candidate.dueAt)}
                      </span>
                    )}
                    <span
                      className={clsx(
                        'rounded px-1.5 py-0.5',
                        candidate.confidence >= 0.7
                          ? 'bg-emerald-50 text-emerald-700'
                          : candidate.confidence >= 0.4
                            ? 'bg-neutral-100 text-neutral-500'
                            : 'bg-neutral-100 text-neutral-400',
                      )}
                    >
                      置信度 {Math.round(candidate.confidence * 100)}%
                    </span>
                    {candidate.url && (
                      <a
                        href={candidate.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-0.5 text-blue-600 hover:underline"
                      >
                        <Link2 className="size-3" />
                        原文
                      </a>
                    )}
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => accept.mutate(candidate.id)}
                    disabled={accept.isPending && accept.variables === candidate.id}
                    className="rounded-lg bg-neutral-900 px-2.5 py-1 text-[11.5px] text-white disabled:opacity-50"
                  >
                    建任务
                  </button>
                  <button
                    type="button"
                    onClick={() => dismiss.mutate(candidate.id)}
                    className="rounded-lg border border-neutral-200 px-2.5 py-1 text-[11.5px] text-neutral-500 hover:bg-neutral-50"
                  >
                    忽略
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
