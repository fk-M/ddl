import type {
  Anniversary,
  AppSettings,
  BatchTaskInput,
  Calendar as CalendarSub,
  CalendarEvent,
  Candidate,
  ClipExtractResult,
  CreateAnniversaryPayload,
  CreateCalendarPayload,
  CreateFocusSessionPayload,
  CreateHabitPayload,
  CreateListGroupPayload,
  CreateListPayload,
  CreateSmartListPayload,
  CreateSourcePayload,
  PresetSource,
  CreateTagPayload,
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
  UpdateTaskPayload,
} from '@ddl/shared';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { ApiError, api, type LunarCell, type LunarToday } from '../lib/api';

const STALE_TIME = 5_000;

/** 4xx 是业务错误，重试无意义；网络错误与 5xx 最多重试 2 次 */
function shouldRetry(failureCount: number, error: Error): boolean {
  if (error instanceof ApiError && !error.retryable) return false;
  return failureCount < 2;
}

type TaskFilter = Partial<TaskQuery>;
export type { TaskFilter };

function invalidateTaskRelated(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: ['tasks'] });
  void queryClient.invalidateQueries({ queryKey: ['task-counts'] });
  void queryClient.invalidateQueries({ queryKey: ['tags'] });
  // 手机端完全离线首次建任务时会自动补一个收件箱，侧栏清单列表也要跟着刷新
  void queryClient.invalidateQueries({ queryKey: ['lists'] });
}

/* ============================== 清单 ============================== */

export function useLists(includeArchived = false) {
  return useQuery<TaskList[], Error>({
    queryKey: ['lists', includeArchived],
    queryFn: () => api.lists(includeArchived),
    staleTime: STALE_TIME,
    retry: shouldRetry,
  });
}

export function useListGroups() {
  return useQuery<ListGroup[], Error>({
    queryKey: ['list-groups'],
    queryFn: api.listGroups,
    staleTime: STALE_TIME,
    retry: shouldRetry,
  });
}

export function useCreateList() {
  const queryClient = useQueryClient();
  return useMutation<TaskList, Error, CreateListPayload>({
    mutationFn: api.createList,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['lists'] });
      void queryClient.invalidateQueries({ queryKey: ['list-groups'] });
    },
  });
}

export function useUpdateList() {
  const queryClient = useQueryClient();
  return useMutation<TaskList, Error, { id: string; patch: UpdateListPayload }>({
    mutationFn: ({ id, patch }) => api.updateList(id, patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['lists'] });
    },
  });
}

export function useDeleteList() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: api.deleteList,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['lists'] });
      invalidateTaskRelated(queryClient);
    },
  });
}

export function useDuplicateList() {
  const queryClient = useQueryClient();
  return useMutation<TaskList, Error, { id: string; onlyPending?: boolean }>({
    mutationFn: ({ id, onlyPending }) => api.duplicateList(id, onlyPending ?? false),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['lists'] });
      invalidateTaskRelated(queryClient);
    },
  });
}

export function useArchiveList() {
  const queryClient = useQueryClient();
  return useMutation<TaskList, Error, { id: string; archived: boolean }>({
    mutationFn: ({ id, archived }) => api.archiveList(id, archived),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['lists'] });
    },
  });
}

export function useListGroupMutations() {
  const queryClient = useQueryClient();
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['list-groups'] });
    void queryClient.invalidateQueries({ queryKey: ['lists'] });
  };

  const create = useMutation<ListGroup, Error, CreateListGroupPayload>({
    mutationFn: api.createListGroup,
    onSuccess: refresh,
  });
  const update = useMutation<ListGroup, Error, { id: string; patch: Partial<CreateListGroupPayload> }>({
    mutationFn: ({ id, patch }) => api.updateListGroup(id, patch),
    onSuccess: refresh,
  });
  const remove = useMutation<void, Error, string>({
    mutationFn: api.deleteListGroup,
    onSuccess: refresh,
  });

  return { create, update, remove };
}

/* ============================== 任务 ============================== */

export function useTasks(filter: TaskFilter) {
  return useQuery<Task[], Error>({
    queryKey: ['tasks', filter],
    queryFn: () => api.tasks(filter),
    staleTime: STALE_TIME,
    retry: shouldRetry,
  });
}

export function useTaskCounts() {
  return useQuery<Record<string, number>, Error>({
    queryKey: ['task-counts'],
    queryFn: api.taskCounts,
    staleTime: STALE_TIME,
    retry: shouldRetry,
  });
}

export function useCreateTask() {
  const queryClient = useQueryClient();
  return useMutation<Task, Error, CreateTaskPayload>({
    mutationFn: api.createTask,
    onSuccess: () => invalidateTaskRelated(queryClient),
  });
}

export function useToggleTask() {
  const queryClient = useQueryClient();
  return useMutation<{ task: Task; spawned: Task | null; undo: string }, Error, string>({
    mutationFn: api.toggleTask,
    onSuccess: () => invalidateTaskRelated(queryClient),
  });
}

export function useDeleteTask() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, { id: string; purge?: boolean }>({
    mutationFn: ({ id, purge }) => api.deleteTask(id, purge ?? false),
    onSuccess: () => invalidateTaskRelated(queryClient),
  });
}

export function useRestoreTask() {
  const queryClient = useQueryClient();
  return useMutation<{ ok: boolean }, Error, string>({
    mutationFn: api.restoreTask,
    onSuccess: () => invalidateTaskRelated(queryClient),
  });
}

export function useEmptyTrash() {
  const queryClient = useQueryClient();
  return useMutation<{ removed: number }, Error, void>({
    mutationFn: api.emptyTrash,
    onSuccess: () => invalidateTaskRelated(queryClient),
  });
}

export function useUpdateTask() {
  const queryClient = useQueryClient();
  return useMutation<Task, Error, { id: string; patch: UpdateTaskPayload }>({
    mutationFn: ({ id, patch }) => api.updateTask(id, patch),
    onSuccess: () => invalidateTaskRelated(queryClient),
  });
}

export function useSetQuadrant() {
  const queryClient = useQueryClient();
  return useMutation<Task, Error, { id: string; isImportant: boolean; isUrgent: boolean }>({
    mutationFn: ({ id, isImportant, isUrgent }) => api.setQuadrant(id, isImportant, isUrgent),
    onSuccess: () => invalidateTaskRelated(queryClient),
  });
}

export function useReorderTask() {
  const queryClient = useQueryClient();
  return useMutation<{ ok: boolean }, Error, { id: string; sortOrder: number }>({
    mutationFn: ({ id, sortOrder }) => api.reorderTask(id, sortOrder),
    onSuccess: () => invalidateTaskRelated(queryClient),
  });
}

export function useBatchTasks() {
  const queryClient = useQueryClient();
  return useMutation<{ affected: number }, Error, BatchTaskInput>({
    mutationFn: api.batchTasks,
    onSuccess: () => invalidateTaskRelated(queryClient),
  });
}

/** 某个任务的子任务 */
export function useSubtasks(parentId: string | null) {
  return useQuery<Task[], Error>({
    queryKey: ['tasks', 'subtasks', parentId],
    queryFn: () => api.tasks({ parentId: parentId ?? undefined }),
    enabled: Boolean(parentId),
    staleTime: STALE_TIME,
    retry: shouldRetry,
  });
}

/* ============================== 标签 ============================== */

export function useTags() {
  return useQuery<(Tag & { taskCount: number })[], Error>({
    queryKey: ['tags'],
    queryFn: api.tags,
    staleTime: STALE_TIME,
    retry: shouldRetry,
  });
}

export function useTagMutations() {
  const queryClient = useQueryClient();
  const refresh = () => invalidateTaskRelated(queryClient);

  const create = useMutation<Tag, Error, CreateTagPayload>({
    mutationFn: api.createTag,
    onSuccess: refresh,
  });
  const update = useMutation<Tag, Error, { id: string; patch: Partial<CreateTagPayload> }>({
    mutationFn: ({ id, patch }) => api.updateTag(id, patch),
    onSuccess: refresh,
  });
  const remove = useMutation<void, Error, string>({
    mutationFn: api.deleteTag,
    onSuccess: refresh,
  });

  return { create, update, remove };
}

/* ============================== 模板 ============================== */

export function useTemplates() {
  return useQuery<TaskTemplate[], Error>({
    queryKey: ['templates'],
    queryFn: api.templates,
    staleTime: STALE_TIME,
    retry: shouldRetry,
  });
}

export function useTemplateMutations() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['templates'] });

  const create = useMutation<TaskTemplate, Error, CreateTaskTemplatePayload>({
    mutationFn: api.createTemplate,
    onSuccess: refresh,
  });
  const update = useMutation<TaskTemplate, Error, { id: string; patch: Partial<CreateTaskTemplatePayload> }>({
    mutationFn: ({ id, patch }) => api.updateTemplate(id, patch),
    onSuccess: refresh,
  });
  const remove = useMutation<void, Error, string>({
    mutationFn: api.deleteTemplate,
    onSuccess: refresh,
  });

  return { create, update, remove };
}

/* ============================== 智能清单 ============================== */

export function useSmartLists() {
  return useQuery<SmartList[], Error>({
    queryKey: ['smart-lists'],
    queryFn: api.smartLists,
    staleTime: STALE_TIME,
    retry: shouldRetry,
  });
}

export function useSmartListMutations() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['smart-lists'] });

  const create = useMutation<SmartList, Error, CreateSmartListPayload>({
    mutationFn: api.createSmartList,
    onSuccess: refresh,
  });
  const update = useMutation<SmartList, Error, { id: string; patch: Partial<CreateSmartListPayload> }>({
    mutationFn: ({ id, patch }) => api.updateSmartList(id, patch),
    onSuccess: refresh,
  });
  const remove = useMutation<void, Error, string>({
    mutationFn: api.deleteSmartList,
    onSuccess: refresh,
  });

  return { create, update, remove };
}

/* ============================== 习惯 ============================== */

export function useHabits(includeArchived = false) {
  return useQuery<Habit[], Error>({
    queryKey: ['habits', includeArchived],
    queryFn: () => api.habits(includeArchived),
    staleTime: STALE_TIME,
    retry: shouldRetry,
  });
}

export function useHabitMutations() {
  const queryClient = useQueryClient();
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['habits'] });
    void queryClient.invalidateQueries({ queryKey: ['habits-today'] });
  };

  const create = useMutation<Habit, Error, CreateHabitPayload>({
    mutationFn: api.createHabit,
    onSuccess: refresh,
  });
  const update = useMutation<
    Habit,
    Error,
    { id: string; patch: Partial<CreateHabitPayload> & { archived?: boolean } }
  >({
    mutationFn: ({ id, patch }) => api.updateHabit(id, patch),
    onSuccess: refresh,
  });
  const remove = useMutation<void, Error, string>({
    mutationFn: api.deleteHabit,
    onSuccess: refresh,
  });
  const check = useMutation<Habit, Error, { id: string; date: string; status?: 'done' | 'skip' }>({
    mutationFn: ({ id, date, status }) => api.checkHabit(id, date, status ?? 'done'),
    onSuccess: refresh,
  });
  const reset = useMutation<void, Error, string>({
    mutationFn: api.resetHabit,
    onSuccess: refresh,
  });

  return { create, update, remove, check, reset };
}

export function useHabitStats(id: string | null) {
  return useQuery<HabitStats, Error>({
    queryKey: ['habit-stats', id],
    queryFn: () => api.habitStats(id!),
    enabled: Boolean(id),
    staleTime: STALE_TIME,
    retry: shouldRetry,
  });
}

export function useHabitLogs(id: string | null, from?: string) {
  return useQuery<HabitLog[], Error>({
    queryKey: ['habit-logs', id, from],
    queryFn: () => api.habitLogs(id!, from),
    enabled: Boolean(id),
    staleTime: STALE_TIME,
    retry: shouldRetry,
  });
}

export function useHabitsToday() {
  return useQuery<
    { total: number; done: number; items: { id: string; name: string; icon: string; color: string; done: boolean }[] },
    Error
  >({
    queryKey: ['habits-today'],
    queryFn: api.habitsToday,
    staleTime: STALE_TIME,
    retry: shouldRetry,
  });
}

/* ============================== 专注 ============================== */

export function useFocusStats() {
  return useQuery<FocusStats, Error>({
    queryKey: ['focus-stats'],
    queryFn: api.focusStats,
    staleTime: STALE_TIME,
    retry: shouldRetry,
  });
}

export function useFocusSessions(limit = 50) {
  return useQuery<FocusSession[], Error>({
    queryKey: ['focus-sessions', limit],
    queryFn: () => api.focusSessions({ limit }),
    staleTime: STALE_TIME,
    retry: shouldRetry,
  });
}

export function useCreateFocusSession() {
  const queryClient = useQueryClient();
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['focus-stats'] });
    void queryClient.invalidateQueries({ queryKey: ['focus-sessions'] });
    void queryClient.invalidateQueries({ queryKey: ['tasks'] });
  };

  const create = useMutation<FocusSession, Error, CreateFocusSessionPayload>({
    mutationFn: api.createFocusSession,
    onSuccess: refresh,
  });
  const remove = useMutation<void, Error, string>({
    mutationFn: api.deleteFocusSession,
    onSuccess: refresh,
  });

  return { create, remove };
}

export function useFrequentFocusTasks() {
  return useQuery<{ taskId: string | null; title: string; count: number }[], Error>({
    queryKey: ['focus-frequent'],
    queryFn: api.frequentFocusTasks,
    staleTime: STALE_TIME,
    retry: shouldRetry,
  });
}

/* ============================== 纪念日 ============================== */

export function useAnniversaries(includeArchived = false) {
  return useQuery<Anniversary[], Error>({
    queryKey: ['anniversaries', includeArchived],
    queryFn: () => api.anniversaries(includeArchived),
    staleTime: STALE_TIME,
    retry: shouldRetry,
  });
}

export function useAnniversaryMutations() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['anniversaries'] });

  const create = useMutation<Anniversary, Error, CreateAnniversaryPayload>({
    mutationFn: api.createAnniversary,
    onSuccess: refresh,
  });
  const update = useMutation<
    Anniversary,
    Error,
    { id: string; patch: Partial<CreateAnniversaryPayload> & { archived?: boolean } }
  >({
    mutationFn: ({ id, patch }) => api.updateAnniversary(id, patch),
    onSuccess: refresh,
  });
  const remove = useMutation<void, Error, string>({
    mutationFn: api.deleteAnniversary,
    onSuccess: refresh,
  });

  return { create, update, remove };
}

/* ============================== 日历订阅 ============================== */

export function useCalendars() {
  return useQuery<CalendarSub[], Error>({
    queryKey: ['calendars'],
    queryFn: api.calendars,
    staleTime: STALE_TIME,
    retry: shouldRetry,
  });
}

export function useCalendarMutations() {
  const queryClient = useQueryClient();
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['calendars'] });
    void queryClient.invalidateQueries({ queryKey: ['calendar-events'] });
  };

  const create = useMutation<CalendarSub, Error, CreateCalendarPayload>({
    mutationFn: api.createCalendar,
    onSuccess: refresh,
  });
  const update = useMutation<CalendarSub, Error, { id: string; patch: Partial<CreateCalendarPayload> }>({
    mutationFn: ({ id, patch }) => api.updateCalendar(id, patch),
    onSuccess: refresh,
  });
  const sync = useMutation<{ calendar: CalendarSub; sync: { imported: number; error: string | null } }, Error, string>({
    mutationFn: api.syncCalendar,
    onSuccess: refresh,
  });
  const remove = useMutation<void, Error, string>({
    mutationFn: api.deleteCalendar,
    onSuccess: refresh,
  });

  return { create, update, sync, remove };
}

export function useCalendarEvents(from: string, to: string, enabled = true) {
  return useQuery<CalendarEvent[], Error>({
    queryKey: ['calendar-events', from, to],
    queryFn: () => api.calendarEvents(from, to),
    enabled,
    staleTime: 30_000,
    retry: shouldRetry,
  });
}

/* ============================== 设置 ============================== */

export function useSettings() {
  return useQuery<AppSettings, Error>({
    queryKey: ['settings'],
    queryFn: api.settings,
    staleTime: 60_000,
    retry: shouldRetry,
  });
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useMutation<AppSettings, Error, Partial<AppSettings>>({
    mutationFn: api.updateSettings,
    onSuccess: (data) => {
      queryClient.setQueryData(['settings'], data);
    },
  });
}

/* ============================== 农历 ============================== */

export function useLunarCells(year: number, month: number, weekStartsMonday = true) {
  return useQuery<{ cells: LunarCell[] }, Error>({
    queryKey: ['lunar-cells', year, month, weekStartsMonday],
    queryFn: () => api.lunarCells(year, month, weekStartsMonday),
    staleTime: 60 * 60_000,
    retry: shouldRetry,
  });
}

export function useLunarToday() {
  return useQuery<LunarToday, Error>({
    queryKey: ['lunar-today'],
    queryFn: api.lunarToday,
    staleTime: 60 * 60_000,
    retry: shouldRetry,
  });
}

/* ============================== 信息源 ============================== */

export function useSources() {
  return useQuery<Source[], Error>({
    queryKey: ['sources'],
    queryFn: api.sources,
    staleTime: STALE_TIME,
    retry: shouldRetry,
  });
}

export function useCreateSource() {
  const queryClient = useQueryClient();
  return useMutation<Source, Error, CreateSourcePayload>({
    mutationFn: api.createSource,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sources'] });
    },
  });
}

export function useDeleteSource() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: api.deleteSource,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sources'] });
      void queryClient.invalidateQueries({ queryKey: ['candidates'] });
    },
  });
}

export function useFetchSource() {
  const queryClient = useQueryClient();
  return useMutation<
    { added: number; total: number; skipped: number; filtered: number },
    Error,
    string
  >({
    mutationFn: api.fetchSource,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['sources'] });
      void queryClient.invalidateQueries({ queryKey: ['candidates'] });
    },
  });
}

export function useCandidates(status: 'pending' | 'accepted' | 'dismissed' = 'pending') {
  return useQuery<Candidate[], Error>({
    queryKey: ['candidates', status],
    queryFn: () => api.candidates(status),
    staleTime: STALE_TIME,
    retry: shouldRetry,
  });
}

export function useCandidateActions() {
  const queryClient = useQueryClient();

  const accept = useMutation<{ taskId: string }, Error, string>({
    mutationFn: api.acceptCandidate,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['candidates'] });
      invalidateTaskRelated(queryClient);
    },
  });

  const dismiss = useMutation<void, Error, string>({
    mutationFn: api.dismissCandidate,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['candidates'] });
    },
  });

  const dismissAll = useMutation<{ dismissed: number }, Error, void>({
    mutationFn: api.dismissAllCandidates,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['candidates'] });
    },
  });

  return { accept, dismiss, dismissAll };
}

/* ============================== 剪藏 / 竞赛预设 ============================== */

/** 剪藏抽取：把粘贴的文字或链接识别成潜在 DDL（不直接建任务，由 UI 确认） */
export function useClipExtract() {
  return useMutation<ClipExtractResult, Error, string>({
    mutationFn: api.clipExtract,
  });
}

/** 内置竞赛预设源列表（标注是否已订阅） */
export function usePresets() {
  return useQuery<PresetSource[], Error>({
    queryKey: ['source-presets'],
    queryFn: api.sourcePresets,
    staleTime: STALE_TIME,
    retry: shouldRetry,
  });
}

/** 一键订阅某个竞赛预设源 */
export function useSubscribePreset() {
  const queryClient = useQueryClient();
  return useMutation<Source, Error, string>({
    mutationFn: api.subscribePreset,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['source-presets'] });
      void queryClient.invalidateQueries({ queryKey: ['sources'] });
      void queryClient.invalidateQueries({ queryKey: ['candidates'] });
    },
  });
}
