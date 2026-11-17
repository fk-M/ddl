import type {
  Anniversary,
  AppSettings,
  Attachment,
  BatchTaskInput,
  Calendar as CalendarSub,
  CalendarEvent,
  Candidate,
  CandidateStatus,
  ClipExtractResult,
  CreateAnniversaryPayload,
  CreateCalendarPayload,
  CreateFocusSessionPayload,
  CreateHabitPayload,
  CreateListGroupPayload,
  CreateListPayload,
  CreateSmartListPayload,
  CreateSourcePayload,
  CreateTagPayload,
  PresetSource,
  CreateTaskPayload,
  CreateTaskTemplatePayload,
  FocusSession,
  FocusStats,
  Habit,
  HabitLog,
  HabitStats,
  ListGroup,
  SmartList,
  Source,
  Tag,
  Task,
  TaskList,
  TaskQuery,
  TaskTemplate,
  UpdateListPayload,
  UpdateSourcePayload,
  UpdateTaskPayload,
} from '@ddl/shared';
import * as local from './local-data';
import { getServerUrl, isLocalCollectDevice, isLocalFirst } from './server-url';

export {
  defaultServerUrl,
  getServerUrl,
  normalizeServerUrl,
  setServerUrl,
} from './server-url';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }

  /** 4xx 属于业务错误，重试没有意义 */
  get retryable(): boolean {
    return this.status === 0 || this.status >= 500;
  }
}

type ErrorEnvelope = { error?: { message?: string; code?: string } };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    // 只有真的带请求体才声明 JSON。GET / DELETE / toggle / restore 等无 body 的请求
    // 若携带 Content-Type: application/json，Fastify 默认解析器会抛
    // FST_ERR_CTP_EMPTY_JSON_BODY(400)，表现为「删不掉任务」。
    const headers = new Headers(init?.headers);
    if (init?.body != null && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    response = await fetch(`${getServerUrl()}${path}`, {
      ...init,
      headers,
    });
  } catch {
    throw new ApiError('无法连接服务，请确认后端已启动', 0, 'NETWORK_ERROR');
  }

  if (response.status === 204) return undefined as T;

  const raw = await response.text();
  let body: unknown = null;
  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch {
      body = null;
    }
  }

  if (!response.ok) {
    const envelope = body as ErrorEnvelope | null;
    throw new ApiError(
      envelope?.error?.message ?? `请求失败（HTTP ${response.status}）`,
      response.status,
      envelope?.error?.code ?? 'UNKNOWN',
    );
  }

  // 手机端 Capacitor WebView 的本地资源服务、或某些代理/网关，会对未知的
  // /api/* 路径直接回落成 index.html（HTTP 200 + HTML）。此时 JSON.parse 失败，
  // body 为 null；旧实现直接 (body as { data: T }).data 会抛
  // "Cannot read properties of null (reading 'data')"，这条 TypeError 既不是
  // ApiError 也不会被离线过滤捕获，于是常驻成红色「服务器内部错误」横幅。
  // 统一转成可识别的 ApiError，让离线状态安静降级。
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApiError(
      `服务返回了非 JSON 内容（HTTP ${response.status}），请检查服务端地址是否正确`,
      0,
      'INVALID_RESPONSE',
    );
  }

  const envelope = body as { data?: T } & ErrorEnvelope;
  if (!('data' in envelope)) {
    // 少数端点直接返回裸对象，没有 { data } 信封，兼容处理而不是崩掉页面
    return envelope as T;
  }
  return envelope.data as T;
}

/**
 * 手机端离线时，非核心模块（设置 / 日历订阅 / 习惯 / 专注 / 信息源…）本来就不联网可用，
 * 这类连接错误属于预期状态，不该把每个页面都铺满红色错误条。
 */
export function isOfflineSilentError(error: unknown): boolean {
  return (
    isLocalFirst() &&
    error instanceof ApiError &&
    (error.status === 0 || error.code === 'INVALID_RESPONSE')
  );
}

/** 页面统一的错误条过滤：离线时把预期内的连接错误收敛成 null，避免整页铺红条 */
export function visibleError(...errors: unknown[]): Error | null {
  for (const error of errors) {
    if (!error) continue;
    if (isOfflineSilentError(error)) continue;
    return error instanceof Error ? error : new Error(String(error));
  }
  return null;
}

function toQuery(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      search.set(key, value.join(','));
      continue;
    }
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

export type LunarCell = {
  key: string;
  day: number;
  lunarLabel: string;
  term: string;
  festivals: string[];
  isToday: boolean;
  inMonth: boolean;
};

export type LunarToday = {
  date: string;
  lunarLabel: string;
  lunarYear: number;
  lunarMonth: number;
  lunarDay: number;
  isLeap: boolean;
  term: string;
  festivals: string[];
};

export const api = {
  /* ------------------------------ 清单 ------------------------------ */
  // 手机端（Capacitor）走本地优先：先写 IndexedDB，探测到电脑服务可达时再双向同步。
  // 桌面端与开发态保持原来的直连方式，功能与数据完全不受影响。
  lists: (includeArchived = false) =>
    isLocalFirst()
      ? local.localLists(includeArchived)
      : request<TaskList[]>(`/api/lists?includeArchived=${includeArchived}`),
  archivedLists: () =>
    isLocalFirst() ? local.localArchivedLists() : request<TaskList[]>('/api/lists/archived'),
  createList: (payload: CreateListPayload) =>
    isLocalFirst()
      ? local.localCreateList(payload)
      : request<TaskList>('/api/lists', { method: 'POST', body: JSON.stringify(payload) }),
  updateList: (id: string, payload: UpdateListPayload) =>
    isLocalFirst()
      ? local.localUpdateList(id, payload)
      : request<TaskList>(`/api/lists/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteList: (id: string) =>
    isLocalFirst()
      ? local.localDeleteList(id)
      : request<void>(`/api/lists/${id}`, { method: 'DELETE' }),
  duplicateList: (id: string, onlyPending = false) =>
    isLocalFirst()
      ? local.localDuplicateList(id, onlyPending)
      : request<TaskList>(`/api/lists/${id}/duplicate`, {
          method: 'POST',
          body: JSON.stringify({ onlyPending }),
        }),
  archiveList: (id: string, archived = true) =>
    isLocalFirst()
      ? local.localArchiveList(id, archived)
      : request<TaskList>(`/api/lists/${id}/archive`, {
          method: 'POST',
          body: JSON.stringify({ archived }),
        }),

  listGroups: () =>
    isLocalFirst() ? local.localListGroups() : request<ListGroup[]>('/api/list-groups'),
  createListGroup: (payload: CreateListGroupPayload) =>
    isLocalFirst()
      ? local.localCreateListGroup(payload)
      : request<ListGroup>('/api/list-groups', { method: 'POST', body: JSON.stringify(payload) }),
  updateListGroup: (id: string, payload: Partial<CreateListGroupPayload>) =>
    isLocalFirst()
      ? local.localUpdateListGroup(id, payload)
      : request<ListGroup>(`/api/list-groups/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteListGroup: (id: string) =>
    isLocalFirst()
      ? local.localDeleteListGroup(id)
      : request<void>(`/api/list-groups/${id}`, { method: 'DELETE' }),

  /* ------------------------------ 任务 ------------------------------ */
  tasks: (query: Partial<TaskQuery>) =>
    isLocalFirst() ? local.localTasks(query) : request<Task[]>(`/api/tasks${toQuery(query)}`),
  task: (id: string) =>
    isLocalFirst() ? local.localTask(id) : request<Task>(`/api/tasks/${id}`),
  taskCounts: () =>
    isLocalFirst() ? local.localTaskCounts() : request<Record<string, number>>('/api/tasks/counts'),
  createTask: (payload: CreateTaskPayload) =>
    isLocalFirst()
      ? local.localCreateTask(payload)
      : request<Task>('/api/tasks', { method: 'POST', body: JSON.stringify(payload) }),
  updateTask: (id: string, payload: UpdateTaskPayload) =>
    isLocalFirst()
      ? local.localUpdateTask(id, payload)
      : request<Task>(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  toggleTask: (id: string) =>
    isLocalFirst()
      ? local.localToggleTask(id)
      : request<{ task: Task; spawned: Task | null; undo: string }>(`/api/tasks/${id}/toggle`, {
          method: 'POST',
        }),
  deleteTask: (id: string, purge = false) =>
    isLocalFirst()
      ? local.localDeleteTask(id, purge)
      : request<void>(`/api/tasks/${id}${purge ? '?purge=true' : ''}`, { method: 'DELETE' }),
  restoreTask: (id: string) =>
    isLocalFirst()
      ? local.localRestoreTask(id)
      : request<{ ok: boolean }>(`/api/tasks/${id}/restore`, { method: 'POST' }),
  emptyTrash: () =>
    isLocalFirst()
      ? local.localEmptyTrash()
      : request<{ removed: number }>('/api/tasks/trash/empty', { method: 'DELETE' }),
  setQuadrant: (id: string, isImportant: boolean, isUrgent: boolean) =>
    isLocalFirst()
      ? local.localSetQuadrant(id, isImportant, isUrgent)
      : request<Task>(`/api/tasks/${id}/quadrant`, {
          method: 'POST',
          body: JSON.stringify({ isImportant, isUrgent }),
        }),
  reorderTask: (id: string, sortOrder: number) =>
    isLocalFirst()
      ? local.localReorderTask(id, sortOrder)
      : request<{ ok: boolean }>(`/api/tasks/${id}/reorder`, {
          method: 'POST',
          body: JSON.stringify({ sortOrder }),
        }),
  batchTasks: (payload: BatchTaskInput) =>
    isLocalFirst()
      ? local.localBatchTasks(payload)
      : request<{ affected: number }>('/api/tasks/batch', {
          method: 'POST',
          body: JSON.stringify(payload),
        }),

  /* ------------------------------ 标签 ------------------------------ */
  tags: () =>
    isLocalFirst()
      ? local.localTags()
      : request<(Tag & { taskCount: number })[]>('/api/tags'),
  createTag: (payload: CreateTagPayload) =>
    isLocalFirst()
      ? local.localCreateTag(payload)
      : request<Tag>('/api/tags', { method: 'POST', body: JSON.stringify(payload) }),
  updateTag: (id: string, payload: Partial<CreateTagPayload>) =>
    isLocalFirst()
      ? local.localUpdateTag(id, payload)
      : request<Tag>(`/api/tags/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteTag: (id: string) =>
    isLocalFirst()
      ? local.localDeleteTag(id)
      : request<void>(`/api/tags/${id}`, { method: 'DELETE' }),

  /* ------------------------------ 模板 ------------------------------ */
  templates: () => request<TaskTemplate[]>('/api/templates'),
  createTemplate: (payload: CreateTaskTemplatePayload) =>
    request<TaskTemplate>('/api/templates', { method: 'POST', body: JSON.stringify(payload) }),
  updateTemplate: (id: string, payload: Partial<CreateTaskTemplatePayload>) =>
    request<TaskTemplate>(`/api/templates/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteTemplate: (id: string) => request<void>(`/api/templates/${id}`, { method: 'DELETE' }),

  /* --------------------------- 智能清单 --------------------------- */
  smartLists: () => request<SmartList[]>('/api/smart-lists'),
  createSmartList: (payload: CreateSmartListPayload) =>
    request<SmartList>('/api/smart-lists', { method: 'POST', body: JSON.stringify(payload) }),
  updateSmartList: (id: string, payload: Partial<CreateSmartListPayload>) =>
    request<SmartList>(`/api/smart-lists/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteSmartList: (id: string) => request<void>(`/api/smart-lists/${id}`, { method: 'DELETE' }),

  /* ------------------------------ 习惯 ------------------------------ */
  // 手机端本地优先：习惯与打卡记录落在 IndexedDB，离线可打卡，联网后按 LWW 合并
  habits: (includeArchived = false) =>
    isLocalFirst()
      ? local.localHabits(includeArchived)
      : request<Habit[]>(`/api/habits?includeArchived=${includeArchived}`),
  createHabit: (payload: CreateHabitPayload) =>
    isLocalFirst()
      ? local.localCreateHabit(payload)
      : request<Habit>('/api/habits', { method: 'POST', body: JSON.stringify(payload) }),
  updateHabit: (id: string, payload: Partial<CreateHabitPayload> & { archived?: boolean }) =>
    isLocalFirst()
      ? local.localUpdateHabit(id, payload)
      : request<Habit>(`/api/habits/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteHabit: (id: string) =>
    isLocalFirst()
      ? local.localDeleteHabit(id)
      : request<void>(`/api/habits/${id}`, { method: 'DELETE' }),
  checkHabit: (id: string, date: string, status: 'done' | 'skip' = 'done', value = 1) =>
    isLocalFirst()
      ? local.localCheckHabit(id, { date, status, value })
      : request<Habit>(`/api/habits/${id}/check`, {
          method: 'POST',
          body: JSON.stringify({ date, status, value }),
        }),
  resetHabit: (id: string) =>
    isLocalFirst()
      ? local.localResetHabit(id)
      : request<void>(`/api/habits/${id}/reset`, { method: 'POST' }),
  habitStats: (id: string) =>
    isLocalFirst() ? local.localHabitStats(id) : request<HabitStats>(`/api/habits/${id}/stats`),
  habitLogs: (id: string, from?: string) =>
    isLocalFirst()
      ? local.localHabitLogs(id, from)
      : request<HabitLog[]>(`/api/habits/${id}/logs${toQuery({ from })}`),
  habitsToday: () =>
    isLocalFirst()
      ? local.localHabitsToday()
      : request<{
          total: number;
          done: number;
          items: { id: string; name: string; icon: string; color: string; done: boolean }[];
        }>('/api/habits/summary/today'),

  /* ------------------------------ 专注 ------------------------------ */
  focusSessions: (query: { from?: string; to?: string; limit?: number } = {}) =>
    request<FocusSession[]>(`/api/focus/sessions${toQuery(query)}`),
  createFocusSession: (payload: CreateFocusSessionPayload) =>
    request<FocusSession>('/api/focus/sessions', { method: 'POST', body: JSON.stringify(payload) }),
  deleteFocusSession: (id: string) => request<void>(`/api/focus/sessions/${id}`, { method: 'DELETE' }),
  focusStats: () => request<FocusStats>('/api/focus/stats'),
  frequentFocusTasks: () =>
    request<{ taskId: string | null; title: string; count: number }[]>('/api/focus/frequent-tasks'),

  /* ---------------------------- 纪念日 ---------------------------- */
  anniversaries: (includeArchived = false) =>
    isLocalFirst()
      ? local.localAnniversaries(includeArchived)
      : request<Anniversary[]>(`/api/anniversaries?includeArchived=${includeArchived}`),
  createAnniversary: (payload: CreateAnniversaryPayload) =>
    isLocalFirst()
      ? local.localCreateAnniversary(payload)
      : request<Anniversary>('/api/anniversaries', { method: 'POST', body: JSON.stringify(payload) }),
  updateAnniversary: (id: string, payload: Partial<CreateAnniversaryPayload> & { archived?: boolean }) =>
    isLocalFirst()
      ? local.localUpdateAnniversary(id, payload)
      : request<Anniversary>(`/api/anniversaries/${id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        }),
  deleteAnniversary: (id: string) =>
    isLocalFirst()
      ? local.localDeleteAnniversary(id)
      : request<void>(`/api/anniversaries/${id}`, { method: 'DELETE' }),

  /* --------------------------- 日历订阅 --------------------------- */
  calendars: () => request<CalendarSub[]>('/api/calendars'),
  createCalendar: (payload: CreateCalendarPayload) =>
    request<CalendarSub>('/api/calendars', { method: 'POST', body: JSON.stringify(payload) }),
  updateCalendar: (id: string, payload: Partial<CreateCalendarPayload>) =>
    request<CalendarSub>(`/api/calendars/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  syncCalendar: (id: string) =>
    request<{ calendar: CalendarSub; sync: { imported: number; error: string | null } }>(
      `/api/calendars/${id}/sync`,
      { method: 'POST' },
    ),
  deleteCalendar: (id: string) => request<void>(`/api/calendars/${id}`, { method: 'DELETE' }),
  calendarEvents: (from: string, to: string) =>
    request<CalendarEvent[]>(`/api/calendars/events${toQuery({ from, to })}`),

  /* ------------------------------ 设置 ------------------------------ */
  settings: () =>
    isLocalFirst() ? local.localGetSettings() : request<AppSettings>('/api/settings'),
  updateSettings: (patch: Partial<AppSettings>) =>
    isLocalFirst()
      ? local.localPatchSettings(patch)
      : request<AppSettings>('/api/settings', { method: 'PATCH', body: JSON.stringify(patch) }),
  resetSettings: () =>
    isLocalFirst()
      ? local.localResetSettings()
      : request<AppSettings>('/api/settings/reset', { method: 'POST' }),
  /** 手机端本地导出（桌面端走 exportUrl 下载） */
  exportLocalJson: () => local.localExportJson(),

  /* ------------------------------ 附件 ------------------------------ */
  uploadAttachment: (taskId: string, name: string, mime: string, dataBase64: string) =>
    request<Attachment>(`/api/tasks/${taskId}/attachments`, {
      method: 'POST',
      body: JSON.stringify({ name, mime, data: dataBase64 }),
    }),
  deleteAttachment: (id: string) => request<void>(`/api/attachments/${id}`, { method: 'DELETE' }),
  attachmentUrl: (id: string) => `${getServerUrl()}/api/attachments/${id}/raw`,

  /* ------------------------------ 农历 ------------------------------ */
  lunarCells: (year: number, month: number, weekStartsMonday = true) =>
    request<{ cells: LunarCell[] }>(
      `/api/lunar/cells${toQuery({ year, month, weekStartsMonday })}`,
    ),
  lunarToday: () => request<LunarToday>('/api/lunar/today'),

  /* ------------------------------ 备份 ------------------------------ */
  exportUrl: (format: 'json' | 'csv' | 'ics') =>
    `${getServerUrl()}/api/backup/export?format=${format}`,
  importData: (format: 'json' | 'csv' | 'ics', data: string, listId?: string) =>
    request<{ imported: number; skipped: number }>('/api/backup/import', {
      method: 'POST',
      body: JSON.stringify({ format, data, listId }),
    }),

  /* ------------------------------ 信息源 ------------------------------ */
  // 手机端自己抓：源与候选池落在 IndexedDB，抓取走 CapacitorHttp（不受 CORS 限制），
  // 解析/抽取复用 @ddl/shared 的同一套规则，不连电脑也能用。
  sources: () => (isLocalCollectDevice() ? local.localSources() : request<Source[]>('/api/sources')),
  /** 手机端机会式刷新：打开信息源页时补抓几个到点没抓的源（桌面/网页端无此概念） */
  refreshDueSources: (max = 3) =>
    isLocalCollectDevice() ? local.localRefreshDueSources(max) : Promise.resolve(0),
  createSource: (payload: CreateSourcePayload) =>
    isLocalCollectDevice()
      ? local.localCreateSource(payload)
      : request<Source>('/api/sources', { method: 'POST', body: JSON.stringify(payload) }),
  updateSource: (id: string, payload: UpdateSourcePayload) =>
    isLocalCollectDevice()
      ? local.localUpdateSource(id, payload)
      : request<Source>(`/api/sources/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  deleteSource: (id: string) =>
    isLocalCollectDevice()
      ? local.localDeleteSource(id)
      : request<void>(`/api/sources/${id}`, { method: 'DELETE' }),
  fetchSource: (id: string) =>
    isLocalCollectDevice()
      ? local.localFetchSource(id)
      : request<{ added: number; total: number; skipped: number; filtered: number }>(
          `/api/sources/${id}/fetch`,
          { method: 'POST' },
        ),

  candidates: (status: CandidateStatus = 'pending', limit = 50) =>
    isLocalCollectDevice()
      ? local.localCandidates(status, limit)
      : request<Candidate[]>(`/api/candidates?status=${status}&limit=${limit}`),
  acceptCandidate: (id: string) =>
    isLocalCollectDevice()
      ? local.localAcceptCandidate(id)
      : request<{ taskId: string }>(`/api/candidates/${id}/accept`, { method: 'POST' }),
  dismissCandidate: (id: string) =>
    isLocalCollectDevice()
      ? local.localDismissCandidate(id)
      : request<void>(`/api/candidates/${id}/dismiss`, { method: 'POST' }),
  dismissAllCandidates: () =>
    isLocalCollectDevice()
      ? local.localDismissAllCandidates()
      : request<{ dismissed: number }>('/api/candidates/dismiss-all', { method: 'POST' }),

  /* --------------------------- 剪藏 / 竞赛预设 --------------------------- */
  clipExtract: (text: string) =>
    isLocalCollectDevice()
      ? local.localClipExtract(text)
      : request<ClipExtractResult>('/api/clip/extract', {
          method: 'POST',
          body: JSON.stringify({ text }),
        }),
  sourcePresets: () =>
    isLocalCollectDevice()
      ? local.localSourcePresets()
      : request<PresetSource[]>('/api/sources/presets'),
  subscribePreset: (key: string) =>
    isLocalCollectDevice()
      ? local.localSubscribePreset(key)
      : request<Source>('/api/sources/presets/subscribe', {
          method: 'POST',
          body: JSON.stringify({ key }),
        }),
};
