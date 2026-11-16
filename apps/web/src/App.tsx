import { AppSettingsSchema, type AppSettings, type TaskQuery } from '@ddl/shared';
import { AlertCircle, LayoutGrid, List, Menu, Plus, Search } from 'lucide-react';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { useEffect, useMemo, useState } from 'react';
import { AnniversariesView } from './components/AnniversariesView';
import { CalendarView } from './components/CalendarView';
import { CommandPalette } from './components/CommandPalette';
import { FocusView } from './components/FocusView';
import { HabitsView } from './components/HabitsView';
import { KanbanView } from './components/KanbanView';
import { MatrixView } from './components/MatrixView';
import { QuickAdd } from './components/QuickAdd';
import { ReminderToasts } from './components/ReminderToasts';
import { SettingsView } from './components/SettingsView';
import { Sidebar } from './components/Sidebar';
import { SourcesView } from './components/SourcesView';
import { TagsView } from './components/TagsView';
import { TaskDetailPanel } from './components/TaskDetailPanel';
import { TaskListView } from './components/TaskList';
import { TrashView } from './components/TrashView';
import {
  useCreateList,
  useDeleteList,
  useCreateTask,
  useDeleteTask,
  useListGroupMutations,
  useListGroups,
  useLists,
  useSettings,
  useSmartLists,
  useTags,
  useTaskCounts,
  useTasks,
  useToggleTask,
  useUpdateList,
  useUpdateTask,
} from './hooks/useDdl';
import { useReminders } from './hooks/useReminders';
import { isOfflineSilentError } from './lib/api';
import { endOfNextWeekIso, endOfTodayIso, startOfTodayIso } from './lib/datetime';
import { CONTENT_WIDTH, WIDE_CONTENT_WIDTH, useLayoutMode } from './lib/layout';
import { isLocalFirst } from './lib/server-url';
import { applyTheme } from './lib/theme';

const VIEW_META: Record<string, { title: string; hint: string; emptyTitle: string; emptyHint: string }> = {
  inbox: {
    title: '收件箱',
    hint: '随手记下的待办都先放这',
    emptyTitle: '收件箱是空的',
    emptyHint: '在上方输入框写点什么，按回车就建好了',
  },
  today: {
    title: '今天',
    hint: '今天到期，以及已经逾期的事项',
    emptyTitle: '今天没有到期任务',
    emptyHint: '该做的都做完了，或者还没安排——去「最近 7 天」看看',
  },
  next7: {
    title: '最近 7 天',
    hint: '未来一周的安排',
    emptyTitle: '未来 7 天没有安排',
    emptyHint: '试试输入「周五下午3点 交周报」，时间会自动识别',
  },
  matrix: {
    title: '四象限',
    hint: '按「重要 × 紧急」把任务分成四类',
    emptyTitle: '还没有待办',
    emptyHint: '先添加任务，再用「重要 / 紧急」标签归类',
  },
  calendar: { title: '日历', hint: '按月查看排期与农历', emptyTitle: '', emptyHint: '' },
  focus: { title: '番茄专注', hint: '专注 25 分钟，休息 5 分钟', emptyTitle: '', emptyHint: '' },
  habits: { title: '习惯打卡', hint: '连续天数会替你记住坚持', emptyTitle: '', emptyHint: '' },
  anniversaries: { title: '倒数纪念日', hint: '重要的日子不忘记', emptyTitle: '', emptyHint: '' },
  tags: { title: '标签与过滤器', hint: '用标签组织，用智能清单筛选', emptyTitle: '', emptyHint: '' },
  trash: { title: '垃圾桶', hint: '误删的任务可以恢复', emptyTitle: '', emptyHint: '' },
  sources: { title: '信息源', hint: '订阅 RSS，自动识别截止时间', emptyTitle: '', emptyHint: '' },
  settings: { title: '设置', hint: '左侧分类切换，外观 / 提醒 / 任务 / 日历 / 数据 / 关于', emptyTitle: '', emptyHint: '' },
  all: {
    title: '全部任务',
    hint: '完整列表，包含已完成',
    emptyTitle: '还没有任何任务',
    emptyHint: '在上方输入框添加第一条待办',
  },
};

const FALLBACK_META = {
  title: '清单',
  hint: '这个清单下的事项',
  emptyTitle: '这个清单还是空的',
  emptyHint: '把相关的事都放进来，按清单分开管理',
};

const NON_TASK_VIEWS = ['calendar', 'sources', 'settings', 'focus', 'habits', 'anniversaries', 'tags', 'trash'];

export default function App() {
  // 支持 ?view=calendar 等直达参数，供可视化检测页逐页巡检；正常启动不受影响。
  const [view, setView] = useState(() => {
    try {
      return new URLSearchParams(window.location.search).get('view') ?? 'today';
    } catch {
      return 'today';
    }
  });
  const layoutMode = useLayoutMode();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [paletteOpen, setPaletteOpen] = useState(false);
  // 移动端侧栏抽屉
  const [navOpen, setNavOpen] = useState(false);

  const settingsQuery = useSettings();
  // 服务端可能还是旧版本（不认识新加的设置项），这里补一次默认值，避免新字段是 undefined
  const settings: AppSettings = useMemo(() => {
    const defaults = AppSettingsSchema.parse({});
    if (!settingsQuery.data) return defaults;
    const merged = { ...defaults } as Record<string, unknown>;
    for (const [key, value] of Object.entries(settingsQuery.data)) {
      if (value !== undefined) merged[key] = value;
    }
    return merged as AppSettings;
  }, [settingsQuery.data]);

  // 主题：跟随系统时需要监听系统切换
  useEffect(() => {
    const dispose = applyTheme(settings);
    return dispose;
  }, [settings.themeMode, settings.accentColor]); // eslint-disable-line react-hooks/exhaustive-deps

  const listsQuery = useLists();
  const lists = listsQuery.data ?? [];
  const groupsQuery = useListGroups();
  const groups = groupsQuery.data ?? [];
  const smartListsQuery = useSmartLists();
  const smartLists = smartListsQuery.data ?? [];
  const tagsQuery = useTags();
  const tags = tagsQuery.data ?? [];
  const countsQuery = useTaskCounts();
  const counts = countsQuery.data ?? {};

  const inbox = lists.find((list) => list.isInbox);

  const activeListId = view.startsWith('list:') ? view.slice('list:'.length) : undefined;
  const activeList = lists.find((list) => list.id === activeListId);
  const activeTag = view.startsWith('tag:') ? view.slice('tag:'.length) : undefined;
  const activeSmartId = view.startsWith('smart:') ? view.slice('smart:'.length) : undefined;
  const activeSmart = smartLists.find((item) => item.id === activeSmartId);

  const keyword = search.trim();

  const filter = useMemo<Partial<TaskQuery>>(() => {
    if (keyword) return { q: keyword, limit: 300 };

    if (activeSmart) {
      const f = activeSmart.filter;
      const next: Partial<TaskQuery> = { limit: 300 };
      if (f.status) next.status = f.status;
      if (f.priorities?.length) next.priorities = f.priorities;
      if (f.tagNames?.length) next.tags = f.tagNames;
      if (f.important) next.important = true;
      if (f.urgent) next.urgent = true;
      if (f.overdue) next.overdue = true;
      if (f.hasDue) next.hasDue = true;
      if (f.keyword) next.q = f.keyword;
      if (f.dueWithinDays !== undefined) {
        next.dueFrom = startOfTodayIso();
        next.dueTo = new Date(Date.now() + f.dueWithinDays * 86_400_000).toISOString();
      }
      return next;
    }

    if (activeTag) return { tags: [activeTag], limit: 300 };

    if (view === 'today') return { dueTo: endOfTodayIso() };
    if (view === 'next7') return { dueFrom: startOfTodayIso(), dueTo: endOfNextWeekIso() };
    if (activeListId) {
      return { listId: activeListId, kind: activeList?.kind === 'note' ? 'note' : 'task' };
    }
    if (view === 'inbox' && inbox) return { listId: inbox.id, kind: 'task' };
    return { kind: 'task', limit: 300 };
  }, [view, activeListId, activeList?.kind, activeSmart, activeTag, inbox?.id, keyword]);

  const tasksQuery = useTasks(filter);
  const tasks = tasksQuery.data ?? [];

  const createTask = useCreateTask();
  const toggleTask = useToggleTask();
  const deleteTask = useDeleteTask();
  const updateTask = useUpdateTask();
  const createList = useCreateList();
  const updateList = useUpdateList();
  const deleteList = useDeleteList();
  const groupMutations = useListGroupMutations();
  const { notices, dismiss } = useReminders(settings);

  // Cmd/Ctrl + K 唤起命令面板
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const baseMeta = activeListId
    ? { ...FALLBACK_META, title: activeList?.name ?? '清单' }
    : activeTag
      ? { ...FALLBACK_META, title: `#${activeTag}`, hint: '带这个标签的任务' }
      : activeSmart
        ? { ...FALLBACK_META, title: activeSmart.name, hint: '智能清单筛选结果' }
        : (VIEW_META[view] ?? FALLBACK_META);

  const meta = keyword
    ? {
        ...baseMeta,
        title: `搜索「${keyword}」`,
        hint: '匹配任务标题与备注',
        emptyTitle: '没有匹配的任务',
        emptyHint: '换个关键词，或者清空搜索框',
      }
    : baseMeta;

  const isTaskView = !NON_TASK_VIEWS.includes(view);
  const showKanban = isTaskView && activeList?.viewMode === 'kanban';
  const pendingCount = tasks.filter((task) => task.status === 'pending').length;
  const editingTask = editingId ? (tasks.find((task) => task.id === editingId) ?? null) : null;
  const defaultListId = activeListId ?? settings.defaultListId ?? inbox?.id;

  // 手机端离线时，习惯/设置等非核心模块的请求必然连不上电脑，
  // 这些连接错误（含 WebView 返回 HTML 造成的 INVALID_RESPONSE）属于预期状态，
  // 不该常驻成红色「服务器错误」横幅。桌面端仍会如实显示。
  const offlineSilent = (error: Error | null | undefined): boolean => isOfflineSilentError(error);
  const mutationError =
    [
      createTask.error,
      toggleTask.error,
      deleteTask.error,
      updateTask.error,
      listsQuery.error,
      settingsQuery.error,
    ].find((error) => Boolean(error) && !offlineSilent(error)) ?? null;

  function quickCreate(title: string, dueAt?: string | null) {
    createTask.mutate({
      title,
      dueAt: dueAt ?? undefined,
      listId: defaultListId,
      priority: settings.defaultPriority,
    });
  }

  return (
    <div
      className="flex h-full overflow-hidden"
      data-layout={layoutMode}
      data-view={view}
      data-local-first={isLocalFirst() ? '1' : '0'}
    >
      <Sidebar
        lists={lists}
        groups={groups}
        smartLists={smartLists}
        tags={tags}
        view={view}
        counts={counts}
        onSelect={(next) => {
          setSearch('');
          setView(next);
          setNavOpen(false);
        }}
        onCreateList={(name, groupId) => createList.mutate({ name, groupId: groupId ?? null })}
        onCreateGroup={(name) => groupMutations.create.mutate({ name })}
        onUpdateGroup={(id, name) => groupMutations.update.mutate({ id, patch: { name } })}
        onDeleteGroup={(id) => groupMutations.remove.mutate(id)}
        onUpdateList={(id, name) => updateList.mutate({ id, patch: { name } })}
        onDeleteList={(id) => deleteList.mutate(id)}
        showMiniCalendar={settings.showMiniCalendar}
        navOrder={settings.navOrder}
        mobileOpen={navOpen}
        onCloseMobile={() => setNavOpen(false)}
        onOpenMobile={() => setNavOpen(true)}
      />

      <main className="flex min-w-0 flex-1 flex-col bg-white">
        <header className="border-b border-neutral-100 px-4 pt-3 pb-3 sm:px-8 sm:pt-6 sm:pb-4 md:px-10 xl:px-8">
          <div className={CONTENT_WIDTH}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setNavOpen(true)}
                  className="-ml-1 shrink-0 rounded-lg p-1.5 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 md:hidden"
                  aria-label="打开菜单"
                >
                  <Menu className="size-5" />
                </button>
                <h1 className="truncate text-[19px] font-semibold tracking-tight text-neutral-900 sm:text-[21px]">
                  {meta.title}
                </h1>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {isTaskView && (
                  <div className="relative">
                    <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-neutral-400" />
                    <input
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="搜索"
                      className="h-8 w-24 rounded-lg border border-neutral-200 pr-2 pl-7 text-[12.5px] outline-none focus:border-neutral-400 sm:w-40 sm:pr-2 sm:pl-7 sm:focus:w-52"
                    />
                  </div>
                )}
                {isTaskView && (
                  <button
                    type="button"
                    onClick={() => setPaletteOpen(true)}
                    className="hidden h-8 items-center gap-1 rounded-lg border border-neutral-200 px-2 text-[11.5px] text-neutral-400 hover:border-neutral-400 sm:flex"
                    title="命令面板"
                  >
                    ⌘K
                  </button>
                )}
                {activeList && !activeList.isInbox && (
                  <button
                    type="button"
                    onClick={() =>
                      updateList.mutate({
                        id: activeList.id,
                        patch: { viewMode: showKanban ? 'list' : 'kanban' },
                      })
                    }
                    className="flex h-8 shrink-0 items-center gap-1 rounded-lg border border-neutral-200 px-2 text-[11.5px] text-neutral-500 hover:border-neutral-400"
                    aria-label={showKanban ? '切换到列表' : '切换到看板'}
                  >
                    {showKanban ? <List className="size-3" /> : <LayoutGrid className="size-3" />}
                    <span className="hidden sm:inline">{showKanban ? '列表' : '看板'}</span>
                  </button>
                )}
                <span className="hidden text-[12px] text-neutral-400 sm:inline">{pendingCount} 项待办</span>
              </div>
            </div>
            <p className="mt-1 truncate text-[12px] text-neutral-400 sm:text-[12.5px]">
              {meta.hint} · {format(new Date(), 'M月d日 EEEE', { locale: zhCN })}
            </p>

            {isTaskView && (
              <div className="mt-3.5">
                <QuickAdd
                  pending={createTask.isPending}
                  placeholder="添加任务，试试「明天下午3点 交周报」"
                  onSubmit={({ title, dueAt }) => quickCreate(title, dueAt)}
                />
              </div>
            )}

            {mutationError && (
              <div className="mt-3 flex items-start gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] text-red-700">
                <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                <span>{mutationError.message}</span>
              </div>
            )}
          </div>
        </header>

        <div
          className={
            // 四象限铺满可视区，由每个象限自己滚动，所以外层不能滚
            view === 'matrix'
              ? 'flex-1 overflow-hidden px-3 pt-3 pb-3 sm:px-5 sm:pt-4 sm:pb-4 md:px-8 xl:px-5'
              : 'flex-1 overflow-y-auto px-3 pt-3 pb-24 sm:px-5 sm:py-4 sm:pb-4 md:px-8 xl:px-5'
          }
        >
          <div
            className={
              view === 'matrix'
                ? `h-full ${WIDE_CONTENT_WIDTH}`
                : showKanban
                  ? 'h-full'
                  : view === 'calendar' || view === 'settings'
                    ? WIDE_CONTENT_WIDTH
                    : CONTENT_WIDTH
            }
          >
            {view === 'sources' ? (
              <SourcesView />
            ) : view === 'settings' ? (
              <SettingsView settings={settings} lists={lists} />
            ) : view === 'focus' ? (
              <FocusView settings={settings} />
            ) : view === 'habits' ? (
              <HabitsView />
            ) : view === 'anniversaries' ? (
              <AnniversariesView />
            ) : view === 'tags' ? (
              <TagsView
                onOpenTag={(name) => setView(`tag:${name}`)}
                onOpenSmart={(id) => setView(`smart:${id}`)}
              />
            ) : view === 'trash' ? (
              <TrashView />
            ) : view === 'calendar' ? (
              <CalendarView lists={lists} onOpen={setEditingId} showLunar={settings.showLunar} />
            ) : view === 'matrix' ? (
              <MatrixView
                tasks={tasks}
                lists={lists}
                loading={tasksQuery.isLoading}
                error={tasksQuery.error ? tasksQuery.error.message : null}
                togglingId={toggleTask.isPending ? (toggleTask.variables ?? null) : null}
                onToggle={(id) => toggleTask.mutate(id)}
                onOpen={setEditingId}
                onUpdate={(id, patch) => updateTask.mutate({ id, patch })}
                onDelete={(id) => deleteTask.mutate({ id })}
              />
            ) : showKanban && activeList ? (
              <KanbanView
                list={activeList}
                tasks={tasks}
                onOpen={setEditingId}
                onToggle={(id) => toggleTask.mutate(id)}
                onMove={(id, columnId) => updateTask.mutate({ id, patch: { columnId } })}
                onCreate={(title, columnId) =>
                  createTask.mutate({ title, columnId, listId: activeList.id })
                }
              />
            ) : (
              <TaskListView
                tasks={tasks}
                lists={lists}
                loading={tasksQuery.isLoading}
                error={tasksQuery.error ? tasksQuery.error.message : null}
                emptyTitle={meta.emptyTitle}
                emptyHint={meta.emptyHint}
                togglingId={toggleTask.isPending ? (toggleTask.variables ?? null) : null}
                completedDisplay={settings.completedDisplay}
                onToggle={(id) => toggleTask.mutate(id)}
                onOpen={setEditingId}
                onDelete={(id) => deleteTask.mutate({ id })}
                onDeleteMany={(ids) => ids.forEach((id) => deleteTask.mutate({ id }))}
              />
            )}
          </div>
        </div>
      </main>

      {editingTask && (
        <TaskDetailPanel
          key={editingTask.id}
          task={editingTask}
          lists={lists}
          saving={updateTask.isPending}
          onClose={() => setEditingId(null)}
          onSave={(patch) =>
            updateTask.mutate({ id: editingTask.id, patch }, { onSuccess: () => setEditingId(null) })
          }
          onDelete={() => {
            deleteTask.mutate({ id: editingTask.id }, { onSuccess: () => setEditingId(null) });
          }}
        />
      )}

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        lists={lists}
        smartLists={smartLists}
        onNavigate={(next) => {
          setSearch('');
          setView(next);
        }}
        onCreate={(title) => quickCreate(title)}
        onSearch={(text) => {
          setSearch(text);
          setView('all');
        }}
      />

      <ReminderToasts notices={notices} onDismiss={dismiss} />

      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        className="fixed right-5 flex size-12 items-center justify-center rounded-full text-white shadow-lg transition-transform active:scale-95 sm:hidden"
        style={{
          backgroundColor: 'var(--accent)',
          bottom: 'calc(1.25rem + env(safe-area-inset-bottom))',
        }}
        aria-label="新建"
      >
        <Plus className="size-5" />
      </button>
    </div>
  );
}
