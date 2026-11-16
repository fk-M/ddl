import { z } from 'zod';

/* ============================== 基础枚举 ============================== */

export const TaskStatusSchema = z.enum(['pending', 'completed']);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

/** 优先级：0 无，1 低，2 中，3 高 */
export const PrioritySchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);
export type Priority = z.infer<typeof PrioritySchema>;

/** 内容类型：任务 / 笔记 */
export const NodeKindSchema = z.enum(['task', 'note']);
export type NodeKind = z.infer<typeof NodeKindSchema>;

export const ViewModeSchema = z.enum(['list', 'kanban']);
export type ViewMode = z.infer<typeof ViewModeSchema>;

export const RepeatFromSchema = z.enum(['due', 'completion']);
export type RepeatFrom = z.infer<typeof RepeatFromSchema>;

/** 修改重复任务的作用范围 */
export const RepeatScopeSchema = z.enum(['this', 'future', 'all']);
export type RepeatScope = z.infer<typeof RepeatScopeSchema>;

const IsoDateTime = z.string().datetime({ offset: true });
const HexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, '颜色需为 #RRGGBB 格式');
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期需为 YYYY-MM-DD 格式');

/* ============================== 清单分组 ============================== */

export const ListGroupSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  collapsed: z.boolean(),
  sortOrder: z.number().int(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type ListGroup = z.infer<typeof ListGroupSchema>;

export const CreateListGroupInputSchema = z.object({
  name: z.string().trim().min(1, '分组名称不能为空').max(80),
  collapsed: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
});
export type CreateListGroupInput = z.infer<typeof CreateListGroupInputSchema>;
export type CreateListGroupPayload = z.input<typeof CreateListGroupInputSchema>;
export const UpdateListGroupInputSchema = CreateListGroupInputSchema.partial();

/* ============================== 清单 ============================== */

export const KanbanColumnSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(40),
});
export type KanbanColumn = z.infer<typeof KanbanColumnSchema>;

export const ListSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  color: z.string(),
  icon: z.string(),
  isInbox: z.boolean(),
  sortOrder: z.number().int(),
  groupId: z.string().uuid().nullable(),
  kind: NodeKindSchema,
  archived: z.boolean(),
  viewMode: ViewModeSchema,
  kanbanColumns: z.array(KanbanColumnSchema),
  permission: z.string(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type TaskList = z.infer<typeof ListSchema>;

export const CreateListInputSchema = z.object({
  name: z.string().trim().min(1, '清单名称不能为空').max(80),
  color: HexColor.default('#3b82f6'),
  icon: z.string().trim().max(40).default('list'),
  sortOrder: z.number().int().default(0),
  groupId: z.string().uuid().nullable().optional(),
  kind: NodeKindSchema.default('task'),
  viewMode: ViewModeSchema.default('list'),
  kanbanColumns: z.array(KanbanColumnSchema).max(20).optional(),
});
export type CreateListInput = z.infer<typeof CreateListInputSchema>;
export type CreateListPayload = z.input<typeof CreateListInputSchema>;

export const UpdateListInputSchema = CreateListInputSchema.partial().extend({
  archived: z.boolean().optional(),
});
export type UpdateListInput = z.infer<typeof UpdateListInputSchema>;
export type UpdateListPayload = z.input<typeof UpdateListInputSchema>;

/* ============================== 标签 ============================== */

export const TagSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  color: z.string(),
  parentId: z.string().uuid().nullable(),
  sortOrder: z.number().int(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Tag = z.infer<typeof TagSchema>;

export const CreateTagInputSchema = z.object({
  name: z.string().trim().min(1, '标签名称不能为空').max(40),
  color: HexColor.default('#6366f1'),
  parentId: z.string().uuid().nullable().optional(),
  sortOrder: z.number().int().default(0),
});
export const UpdateTagInputSchema = CreateTagInputSchema.partial();
export type CreateTagPayload = z.input<typeof CreateTagInputSchema>;
export type UpdateTagPayload = z.input<typeof UpdateTagInputSchema>;

/* ============================== 提醒 ============================== */

export const ReminderChannelSchema = z.enum(['inapp', 'system']);
export type ReminderChannel = z.infer<typeof ReminderChannelSchema>;

export const TaskReminderSchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid(),
  remindAt: IsoDateTime,
  channel: ReminderChannelSchema,
  sound: z.string().nullable(),
  snoozeMinutes: z.number().int(),
  persistent: z.boolean(),
});
export type TaskReminder = z.infer<typeof TaskReminderSchema>;

export const TaskReminderInputSchema = z.object({
  remindAt: IsoDateTime,
  channel: ReminderChannelSchema.default('inapp'),
  sound: z.string().max(60).nullable().optional(),
  snoozeMinutes: z.number().int().min(0).max(1440).default(5),
  persistent: z.boolean().default(false),
});
export type TaskReminderInput = z.input<typeof TaskReminderInputSchema>;

/* ============================== 附件 ============================== */

export const AttachmentSchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid(),
  name: z.string(),
  mime: z.string(),
  size: z.number().int(),
  url: z.string(),
  createdAt: IsoDateTime,
});
export type Attachment = z.infer<typeof AttachmentSchema>;

/* ============================== 任务 ============================== */

export const TaskSchema = z.object({
  id: z.string().uuid(),
  listId: z.string().uuid(),
  title: z.string(),
  notes: z.string().nullable(),
  status: TaskStatusSchema,
  kind: NodeKindSchema,
  columnId: z.string().nullable(),
  priority: PrioritySchema,
  isImportant: z.boolean(),
  isUrgent: z.boolean(),
  parentId: z.string().uuid().nullable(),
  dueAt: IsoDateTime.nullable(),
  allDay: z.boolean(),
  remindAt: IsoDateTime.nullable(),
  rrule: z.string().nullable(),
  repeatFrom: RepeatFromSchema,
  tags: z.array(z.string()),
  estimatePomodoros: z.number().int(),
  actualPomodoros: z.number().int(),
  pinned: z.boolean(),
  sortOrder: z.number(),
  completedAt: IsoDateTime.nullable(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  reminders: z.array(TaskReminderSchema).default([]),
  attachments: z.array(AttachmentSchema).default([]),
  childCount: z.number().int().default(0),
  childDoneCount: z.number().int().default(0),
});
export type Task = z.infer<typeof TaskSchema>;

export const CreateTaskInputSchema = z.object({
  title: z.string().trim().min(1, '任务标题不能为空').max(500),
  listId: z.string().uuid().optional(),
  notes: z.string().max(50_000).nullable().optional(),
  kind: NodeKindSchema.default('task'),
  columnId: z.string().max(40).nullable().optional(),
  priority: PrioritySchema.default(0),
  isImportant: z.boolean().default(false),
  isUrgent: z.boolean().default(false),
  parentId: z.string().uuid().nullable().optional(),
  dueAt: IsoDateTime.nullable().optional(),
  allDay: z.boolean().default(false),
  remindAt: IsoDateTime.nullable().optional(),
  rrule: z.string().max(800).nullable().optional(),
  repeatFrom: RepeatFromSchema.default('due'),
  tags: z.array(z.string().trim().min(1).max(40)).max(30).default([]),
  estimatePomodoros: z.number().int().min(0).max(99).default(0),
  pinned: z.boolean().default(false),
  sortOrder: z.number().optional(),
  reminders: z.array(TaskReminderInputSchema).max(10).optional(),
  /** 重复任务改动范围 */
  scope: RepeatScopeSchema.optional(),
});
export type CreateTaskInput = z.infer<typeof CreateTaskInputSchema>;
export type CreateTaskPayload = z.input<typeof CreateTaskInputSchema>;

export const UpdateTaskInputSchema = CreateTaskInputSchema.partial().extend({
  status: TaskStatusSchema.optional(),
});
export type UpdateTaskInput = z.infer<typeof UpdateTaskInputSchema>;
export type UpdateTaskPayload = z.input<typeof UpdateTaskInputSchema>;

export const TaskSortSchema = z.enum([
  'manual',
  'dueAt',
  'priority',
  'createdAt',
  'completedAt',
  'title',
  'list',
  'tag',
]);
export type TaskSort = z.infer<typeof TaskSortSchema>;

export const TaskQuerySchema = z.object({
  listId: z.string().uuid().optional(),
  listIds: z.array(z.string().uuid()).optional(),
  parentId: z.string().uuid().optional(),
  topLevelOnly: z.coerce.boolean().optional(),
  status: TaskStatusSchema.optional(),
  kind: NodeKindSchema.optional(),
  dueFrom: IsoDateTime.optional(),
  dueTo: IsoDateTime.optional(),
  hasDue: z.coerce.boolean().optional(),
  overdue: z.coerce.boolean().optional(),
  priorities: z.array(PrioritySchema).optional(),
  tags: z.array(z.string()).optional(),
  important: z.coerce.boolean().optional(),
  urgent: z.coerce.boolean().optional(),
  completedFrom: IsoDateTime.optional(),
  completedTo: IsoDateTime.optional(),
  since: IsoDateTime.optional(),
  q: z.string().trim().min(1).max(200).optional(),
  sort: TaskSortSchema.optional(),
  order: z.enum(['asc', 'desc']).optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
  /** 是否包含垃圾桶内记录 */
  trashed: z.coerce.boolean().optional(),
});
export type TaskQuery = z.infer<typeof TaskQuerySchema>;

/* ============================== 批量操作 ============================== */

export const BatchActionSchema = z.enum([
  'complete',
  'uncomplete',
  'delete',
  'restore',
  'purge',
  'move',
  'setDue',
  'setPriority',
  'addTags',
  'removeTags',
  'setQuadrant',
  'setImportant',
  'setUrgent',
  'pin',
  'unpin',
]);
export type BatchAction = z.infer<typeof BatchActionSchema>;

export const BatchTaskInputSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
  action: BatchActionSchema,
  payload: z
    .object({
      listId: z.string().uuid().optional(),
      dueAt: IsoDateTime.nullable().optional(),
      priority: PrioritySchema.optional(),
      tags: z.array(z.string()).optional(),
      isImportant: z.boolean().optional(),
      isUrgent: z.boolean().optional(),
    })
    .optional(),
});
export type BatchTaskInput = z.infer<typeof BatchTaskInputSchema>;

/* ============================== 智能清单 ============================== */

export const SmartFilterSchema = z.object({
  listIds: z.array(z.string().uuid()).optional(),
  tagNames: z.array(z.string()).optional(),
  priorities: z.array(PrioritySchema).optional(),
  status: TaskStatusSchema.optional(),
  kind: NodeKindSchema.optional(),
  hasDue: z.boolean().optional(),
  overdue: z.boolean().optional(),
  dueWithinDays: z.number().int().min(0).max(3650).optional(),
  important: z.boolean().optional(),
  urgent: z.boolean().optional(),
  keyword: z.string().max(200).optional(),
});
export type SmartFilter = z.infer<typeof SmartFilterSchema>;

export const SmartListSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  icon: z.string(),
  color: z.string(),
  filter: SmartFilterSchema,
  sortOrder: z.number().int(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type SmartList = z.infer<typeof SmartListSchema>;

export const CreateSmartListInputSchema = z.object({
  name: z.string().trim().min(1, '名称不能为空').max(60),
  icon: z.string().max(40).default('filter'),
  color: HexColor.default('#0ea5e9'),
  filter: SmartFilterSchema.default({}),
  sortOrder: z.number().int().default(0),
});
export const UpdateSmartListInputSchema = CreateSmartListInputSchema.partial();
export type CreateSmartListPayload = z.input<typeof CreateSmartListInputSchema>;
export type UpdateSmartListPayload = z.input<typeof UpdateSmartListInputSchema>;

/* ============================== 模板 ============================== */

export const TaskTemplateSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  kind: NodeKindSchema,
  payload: z.record(z.string(), z.unknown()),
  sortOrder: z.number().int(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type TaskTemplate = z.infer<typeof TaskTemplateSchema>;

export const CreateTaskTemplateInputSchema = z.object({
  name: z.string().trim().min(1, '模板名不能为空').max(60),
  kind: NodeKindSchema.default('task'),
  payload: z.record(z.string(), z.unknown()).default({}),
  sortOrder: z.number().int().default(0),
});
export const UpdateTaskTemplateInputSchema = CreateTaskTemplateInputSchema.partial();
export type CreateTaskTemplatePayload = z.input<typeof CreateTaskTemplateInputSchema>;

/* ============================== 习惯 ============================== */

export const HabitFreqTypeSchema = z.enum(['daily', 'weekly', 'monthly', 'custom']);
export type HabitFreqType = z.infer<typeof HabitFreqTypeSchema>;

export const HabitFreqConfigSchema = z.object({
  /** weekly: 1-7（周一起） */
  weekDays: z.array(z.number().int().min(1).max(7)).optional(),
  /** monthly: 1-31 */
  monthDays: z.array(z.number().int().min(1).max(31)).optional(),
  /** custom: 每 N 天 */
  everyNDays: z.number().int().min(1).max(365).optional(),
});
export type HabitFreqConfig = z.infer<typeof HabitFreqConfigSchema>;

export const HabitLogSchema = z.object({
  id: z.string().uuid(),
  habitId: z.string().uuid(),
  logDate: IsoDate,
  status: z.enum(['done', 'skip']),
  value: z.number().int(),
  note: z.string().nullable(),
});
export type HabitLog = z.infer<typeof HabitLogSchema>;

export const HabitSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  icon: z.string(),
  color: z.string(),
  freqType: HabitFreqTypeSchema,
  freqConfig: HabitFreqConfigSchema,
  goalPerPeriod: z.number().int(),
  unit: z.string(),
  remindAt: z.string().nullable(),
  archived: z.boolean(),
  sortOrder: z.number().int(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  /** 今日是否已打卡 */
  doneToday: z.boolean().default(false),
  /** 当前连续天数 */
  streak: z.number().int().default(0),
  /** 历史最长连续 */
  bestStreak: z.number().int().default(0),
  /** 累计打卡次数 */
  totalCheckIns: z.number().int().default(0),
  /** 近 30 天完成率 0-1 */
  completionRate: z.number().default(0),
  /** 最近 90 天已打卡的日期（YYYY-MM-DD），用于周视图与热力图 */
  recentDates: z.array(z.string()).default([]),
});
export type Habit = z.infer<typeof HabitSchema>;

export const CreateHabitInputSchema = z.object({
  name: z.string().trim().min(1, '习惯名称不能为空').max(60),
  icon: z.string().max(8).default('✅'),
  color: HexColor.default('#22c55e'),
  freqType: HabitFreqTypeSchema.default('daily'),
  freqConfig: HabitFreqConfigSchema.default({}),
  goalPerPeriod: z.number().int().min(1).max(100).default(1),
  unit: z.string().max(10).default('次'),
  remindAt: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable()
    .optional(),
  sortOrder: z.number().int().default(0),
});
export const UpdateHabitInputSchema = CreateHabitInputSchema.partial().extend({
  archived: z.boolean().optional(),
});
export type CreateHabitPayload = z.input<typeof CreateHabitInputSchema>;
export type UpdateHabitPayload = z.input<typeof UpdateHabitInputSchema>;

export const CheckInInputSchema = z.object({
  date: IsoDate,
  status: z.enum(['done', 'skip']).default('done'),
  value: z.number().int().min(1).max(100).default(1),
  note: z.string().max(500).nullable().optional(),
});
export type CheckInInput = z.input<typeof CheckInInputSchema>;

export const HabitStatsSchema = z.object({
  totalCheckIns: z.number().int(),
  currentStreak: z.number().int(),
  bestStreak: z.number().int(),
  monthCheckIns: z.number().int(),
  completionRate: z.number(),
  calendar: z.array(
    z.object({
      date: IsoDate,
      status: z.enum(['done', 'skip']),
      value: z.number().int(),
    }),
  ),
});
export type HabitStats = z.infer<typeof HabitStatsSchema>;

/* ============================== 专注 ============================== */

export const FocusTypeSchema = z.enum(['focus', 'shortBreak', 'longBreak']);
export type FocusType = z.infer<typeof FocusTypeSchema>;

export const FocusSessionSchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid().nullable(),
  taskTitle: z.string().nullable(),
  type: FocusTypeSchema,
  plannedSeconds: z.number().int(),
  actualSeconds: z.number().int(),
  startedAt: IsoDateTime,
  endedAt: IsoDateTime.nullable(),
  completed: z.boolean(),
  note: z.string().nullable(),
});
export type FocusSession = z.infer<typeof FocusSessionSchema>;

export const CreateFocusSessionInputSchema = z.object({
  taskId: z.string().uuid().nullable().optional(),
  taskTitle: z.string().max(500).nullable().optional(),
  type: FocusTypeSchema.default('focus'),
  plannedSeconds: z.number().int().min(1).max(86_400).default(1500),
  actualSeconds: z.number().int().min(0).max(86_400).default(0),
  startedAt: IsoDateTime.optional(),
  endedAt: IsoDateTime.nullable().optional(),
  completed: z.boolean().default(false),
  note: z.string().max(2000).nullable().optional(),
});
export type CreateFocusSessionPayload = z.input<typeof CreateFocusSessionInputSchema>;

export const FocusStatsSchema = z.object({
  todaySeconds: z.number().int(),
  todayCount: z.number().int(),
  weekSeconds: z.number().int(),
  weekCount: z.number().int(),
  totalSeconds: z.number().int(),
  totalCount: z.number().int(),
  focusDays: z.number().int(),
  /** 近 14 天每日专注秒数 */
  daily: z.array(z.object({ date: IsoDate, seconds: z.number().int(), count: z.number().int() })),
  /** 按任务聚合 */
  topTasks: z.array(z.object({ taskId: z.string().nullable(), title: z.string(), seconds: z.number().int() })),
});
export type FocusStats = z.infer<typeof FocusStatsSchema>;

/* ============================== 倒数纪念日 ============================== */

export const AnniversaryTypeSchema = z.enum(['countdown', 'anniversary', 'birthday']);
export type AnniversaryType = z.infer<typeof AnniversaryTypeSchema>;

export const AnniversarySchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  eventDate: IsoDate,
  type: AnniversaryTypeSchema,
  repeatYearly: z.boolean(),
  lunar: z.boolean(),
  color: z.string(),
  icon: z.string(),
  notes: z.string().nullable(),
  archived: z.boolean(),
  sortOrder: z.number().int(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
  /** 距今天的天数（正数=还有 N 天，负数=已过 N 天） */
  daysUntil: z.number().int().default(0),
  /** 今年是第几年（仅纪念日/生日） */
  years: z.number().int().default(0),
});
export type Anniversary = z.infer<typeof AnniversarySchema>;

export const CreateAnniversaryInputSchema = z.object({
  title: z.string().trim().min(1, '名称不能为空').max(60),
  eventDate: IsoDate,
  type: AnniversaryTypeSchema.default('countdown'),
  repeatYearly: z.boolean().default(false),
  lunar: z.boolean().default(false),
  color: HexColor.default('#f97316'),
  icon: z.string().max(8).default('🎂'),
  notes: z.string().max(2000).nullable().optional(),
  sortOrder: z.number().int().default(0),
});
export const UpdateAnniversaryInputSchema = CreateAnniversaryInputSchema.partial().extend({
  archived: z.boolean().optional(),
});
export type CreateAnniversaryPayload = z.input<typeof CreateAnniversaryInputSchema>;
export type UpdateAnniversaryPayload = z.input<typeof UpdateAnniversaryInputSchema>;

/* ============================== 日历订阅 ============================== */

export const CalendarSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  url: z.string(),
  color: z.string(),
  enabled: z.boolean(),
  lastSyncedAt: IsoDateTime.nullable(),
  lastError: z.string().nullable(),
  eventCount: z.number().int(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Calendar = z.infer<typeof CalendarSchema>;

export const CreateCalendarInputSchema = z.object({
  name: z.string().trim().min(1, '名称不能为空').max(60),
  url: z.string().trim().url('请填写合法的 .ics 地址'),
  color: HexColor.default('#8b5cf6'),
  enabled: z.boolean().default(true),
});
export const UpdateCalendarInputSchema = CreateCalendarInputSchema.partial();
export type CreateCalendarPayload = z.input<typeof CreateCalendarInputSchema>;
export type UpdateCalendarPayload = z.input<typeof UpdateCalendarInputSchema>;

export const CalendarEventSchema = z.object({
  id: z.string().uuid(),
  calendarId: z.string().uuid(),
  calendarName: z.string(),
  calendarColor: z.string(),
  uid: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  location: z.string().nullable(),
  startsAt: IsoDateTime,
  endsAt: IsoDateTime.nullable(),
  allDay: z.boolean(),
});
export type CalendarEvent = z.infer<typeof CalendarEventSchema>;

/* ============================== 设置 ============================== */

export const AppSettingsSchema = z.object({
  /** 主题模式 */
  themeMode: z.enum(['light', 'dark', 'system']).default('system'),
  /** 主题色 */
  accentColor: z.string().default('#3b82f6'),
  /** 应用图标皮肤 */
  iconPack: z.string().default('Default'),
  /** 默认清单 */
  defaultListId: z.string().uuid().nullable().default(null),
  /** 默认优先级 */
  defaultPriority: PrioritySchema.default(0),
  /** 默认提醒提前分钟数 */
  defaultRemindMinutes: z.number().int().min(0).max(10_080).default(0),
  /** 新建任务默认是否全天 */
  defaultAllDay: z.boolean().default(false),
  /** 逾期任务位置 */
  overduePosition: z.enum(['top', 'bottom']).default('top'),
  /** 是否隐藏已完成 */
  hideCompleted: z.boolean().default(false),
  /** 24 小时制 */
  use24Hour: z.boolean().default(true),
  /** 周一为一周首日 */
  weekStartsMonday: z.boolean().default(true),
  /** 显示农历 */
  showLunar: z.boolean().default(true),
  /** 提醒铃声 */
  remindSound: z.string().default('chimes'),
  /** 提醒音量 0-100 */
  remindVolume: z.number().int().min(0).max(100).default(70),
  /** 完成音效 */
  completionSound: z.string().default('drip'),
  /** 完成音效开关 */
  completionSoundEnabled: z.boolean().default(true),
  /** 番茄时长（分钟） */
  pomodoroMinutes: z.number().int().min(1).max(180).default(25),
  /** 短休息（分钟） */
  shortBreakMinutes: z.number().int().min(1).max(60).default(5),
  /** 长休息（分钟） */
  longBreakMinutes: z.number().int().min(1).max(120).default(15),
  /** 长休息间隔番茄数 */
  longBreakInterval: z.number().int().min(1).max(12).default(4),
  /** 自动开始下一个番茄 */
  autoStartNext: z.boolean().default(false),
  /** 自动开始休息 */
  autoStartBreak: z.boolean().default(false),
  /** 专注白噪音 */
  whiteNoise: z.string().default('none'),
  /** 每日专注目标（分钟） */
  dailyFocusGoalMinutes: z.number().int().min(0).max(1440).default(120),
  /** 密码锁 */
  lockEnabled: z.boolean().default(false),
  lockHash: z.string().default(''),
  /** 时区偏移（分钟） */
  timezoneOffset: z.number().int().default(-480),
  /** 侧边栏是否显示 Mini 日历 */
  showMiniCalendar: z.boolean().default(true),
  /** 侧边栏显示标签 */
  showTagsInSidebar: z.boolean().default(true),
  /**
   * 侧边栏导航顺序（视图 key 数组）。空数组表示用内置顺序；
   * 未出现在数组里的项排在后面，保持原有相对次序。
   */
  navOrder: z.array(z.string()).default([]),
  /** 已完成任务的展示方式：隐藏 / 折叠在列表底部 / 直接展开 */
  completedDisplay: z.enum(['hidden', 'collapsed', 'expanded']).default('collapsed'),
});
export type AppSettings = z.infer<typeof AppSettingsSchema>;
export type AppSettingsPatch = Partial<AppSettings>;

/* ============================== 信息源（原有） ============================== */

export const SourceSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  type: z.string(),
  url: z.string(),
  enabled: z.boolean(),
  fetchIntervalMinutes: z.number().int(),
  lastFetchedAt: IsoDateTime.nullable(),
  lastError: z.string().nullable(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Source = z.infer<typeof SourceSchema>;

export const CreateSourceInputSchema = z.object({
  name: z.string().trim().min(1, '信息源名称不能为空').max(80),
  url: z.string().trim().url('请填写合法的 RSS 地址'),
  fetchIntervalMinutes: z.number().int().min(5).max(10080).default(60),
  enabled: z.boolean().default(true),
});
export type CreateSourceInput = z.infer<typeof CreateSourceInputSchema>;
export type CreateSourcePayload = z.input<typeof CreateSourceInputSchema>;

export const UpdateSourceInputSchema = CreateSourceInputSchema.partial();
export type UpdateSourceInput = z.infer<typeof UpdateSourceInputSchema>;
export type UpdateSourcePayload = z.input<typeof UpdateSourceInputSchema>;

export const CandidateStatusSchema = z.enum(['pending', 'accepted', 'dismissed']);
export type CandidateStatus = z.infer<typeof CandidateStatusSchema>;

export const CandidateSchema = z.object({
  id: z.string().uuid(),
  sourceId: z.string().uuid().nullable(),
  sourceName: z.string().nullable(),
  title: z.string(),
  url: z.string().nullable(),
  excerpt: z.string().nullable(),
  dueAt: IsoDateTime.nullable(),
  confidence: z.number(),
  status: CandidateStatusSchema,
  taskId: z.string().uuid().nullable(),
  createdAt: IsoDateTime,
});
export type Candidate = z.infer<typeof CandidateSchema>;

/* ============================== 剪藏抽取 ============================== */

/** 剪藏入口的抽取结果：把粘贴的文字或链接识别成一条潜在的 DDL */
export const ClipExtractResultSchema = z.object({
  /** 建议作为任务标题的文字（链接场景取页面标题，纯文本场景取首行） */
  title: z.string(),
  /** 识别到的截止时间；识别不到则为 null */
  dueAt: IsoDateTime.nullable(),
  /** 抽取置信度 0~1 */
  confidence: z.number(),
  /** 抽取方式：规则 / LLM / 未识别 */
  method: z.enum(['rule', 'llm', 'none']),
  /** 命中的原文片段，便于用户核对 */
  matchedText: z.string().nullable(),
  /** 抓取到的正文摘要（链接场景）；纯文本场景为用户输入本身 */
  excerpt: z.string().nullable(),
  /** 输入是链接且成功抓到页面时为 true，失败回退纯文本时为 false */
  fetched: z.boolean(),
});
export type ClipExtractResult = z.infer<typeof ClipExtractResultSchema>;

/* ============================== 竞赛预设源 ============================== */

/** 内置的竞赛信息源预设，一键订阅后即可进入采集链路 */
export const PresetSourceSchema = z.object({
  key: z.string(),
  name: z.string(),
  url: z.string(),
  description: z.string(),
  fetchIntervalMinutes: z.number().int(),
  /** 当前账号是否已订阅该预设（按 url 去重判定） */
  subscribed: z.boolean(),
});
export type PresetSource = z.infer<typeof PresetSourceSchema>;

/* ============================== 通用 ============================== */

export type ApiSuccess<T> = { data: T };
export type ApiError = {
  error: {
    code: string;
    message: string;
    requestId?: string;
    details?: unknown;
  };
};

export const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  BAD_REQUEST: 'BAD_REQUEST',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/* ============================== 双端同步协议 ==============================
 * 同步记录 = 数据库行的 camelCase 形态（与 drizzle $inferSelect 属性名一致），
 * 所有时间统一为 UTC ISO 字符串。与面向 UI 的 Task DTO 不同，这里保留
 * deletedAt 作为墓碑，保证「一端删除」能同步到另一端而不会复活。
 * 合并策略：按 updatedAt 最后写入优先（LWW），由服务端在写入时判定。
 */
export type SyncRow = { id: string; updatedAt: string } & Record<string, unknown>;

export type SyncSnapshot = {
  serverTime: string;
  listGroups: SyncRow[];
  lists: SyncRow[];
  tags: SyncRow[];
  tasks: SyncRow[];
};

/** 客户端只推送本地产生变更的记录，服务端逐条做 LWW 判定 */
export const SyncPushSchema = z.object({
  listGroups: z.array(z.record(z.unknown())).default([]),
  lists: z.array(z.record(z.unknown())).default([]),
  tags: z.array(z.record(z.unknown())).default([]),
  tasks: z.array(z.record(z.unknown())).default([]),
  /** 客户端彻底删除（清空垃圾桶 / 删清单）的 id，服务端物理删除以免下一轮 pull 复活 */
  purgedIds: z.array(z.string().uuid()).default([]),
});
export type SyncPushInput = z.output<typeof SyncPushSchema>;

export type SyncPushResult = {
  serverTime: string;
  applied: { listGroups: number; lists: number; tags: number; tasks: number };
};
