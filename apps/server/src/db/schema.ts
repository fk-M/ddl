import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

/* ============================== 清单分组 ============================== */

export const listGroups = pgTable('list_groups', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  collapsed: boolean('collapsed').notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/* ============================== 清单 ============================== */

export const lists = pgTable('lists', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  color: text('color').notNull().default('#3b82f6'),
  icon: text('icon').notNull().default('list'),
  isInbox: boolean('is_inbox').notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
  groupId: uuid('group_id').references(() => listGroups.id, { onDelete: 'set null' }),
  /** task | note */
  kind: text('kind').notNull().default('task'),
  archived: boolean('archived').notNull().default(false),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  /** list | kanban */
  viewMode: text('view_mode').notNull().default('list'),
  kanbanColumns: jsonb('kanban_columns'),
  permission: text('permission').notNull().default('private'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/* ============================== 标签 ============================== */

export const tags = pgTable('tags', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  color: text('color').notNull().default('#6366f1'),
  parentId: uuid('parent_id').references((): AnyPgColumn => tags.id, { onDelete: 'cascade' }),
  sortOrder: integer('sort_order').notNull().default(0),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/* ============================== 任务 ============================== */

export const tasks = pgTable('tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  listId: uuid('list_id')
    .notNull()
    .references(() => lists.id, { onDelete: 'cascade' }),
  /** 父任务；为空表示顶层任务 */
  parentId: uuid('parent_id').references((): AnyPgColumn => tasks.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  notes: text('notes'),
  /** pending | completed */
  status: text('status').notNull().default('pending'),
  /** task | note */
  kind: text('kind').notNull().default('task'),
  columnId: text('column_id'),
  priority: integer('priority').notNull().default(0),
  /** 四象限：重要 */
  isImportant: boolean('is_important').notNull().default(false),
  /** 四象限：紧急 */
  isUrgent: boolean('is_urgent').notNull().default(false),
  dueAt: timestamp('due_at', { withTimezone: true }),
  allDay: boolean('all_day').notNull().default(false),
  remindAt: timestamp('remind_at', { withTimezone: true }),
  rrule: text('rrule'),
  /** due（按到期日重复）| completion（按完成日重复） */
  repeatFrom: text('repeat_from').notNull().default('due'),
  tags: text('tags')
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  estimatePomodoros: integer('estimate_pomodoros').notNull().default(0),
  actualPomodoros: integer('actual_pomodoros').notNull().default(0),
  pinned: boolean('pinned').notNull().default(false),
  sortOrder: doublePrecision('sort_order').notNull().default(0),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const taskReminders = pgTable('task_reminders', {
  id: uuid('id').primaryKey().defaultRandom(),
  taskId: uuid('task_id')
    .notNull()
    .references(() => tasks.id, { onDelete: 'cascade' }),
  remindAt: timestamp('remind_at', { withTimezone: true }).notNull(),
  channel: text('channel').notNull().default('inapp'),
  sound: text('sound'),
  snoozeMinutes: integer('snooze_minutes').notNull().default(5),
  persistent: boolean('persistent').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const attachments = pgTable('attachments', {
  id: uuid('id').primaryKey().defaultRandom(),
  taskId: uuid('task_id')
    .notNull()
    .references(() => tasks.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  mime: text('mime').notNull().default('application/octet-stream'),
  size: integer('size').notNull().default(0),
  storagePath: text('storage_path').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const taskTemplates = pgTable('task_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  kind: text('kind').notNull().default('task'),
  payload: jsonb('payload').notNull().default({}),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/* ============================== 习惯 ============================== */

export const habits = pgTable('habits', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  icon: text('icon').notNull().default('✅'),
  color: text('color').notNull().default('#22c55e'),
  /** daily | weekly | monthly | custom */
  freqType: text('freq_type').notNull().default('daily'),
  freqConfig: jsonb('freq_config').notNull().default({}),
  goalPerPeriod: integer('goal_per_period').notNull().default(1),
  unit: text('unit').notNull().default('次'),
  remindAt: text('remind_at'),
  archived: boolean('archived').notNull().default(false),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const habitLogs = pgTable('habit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  habitId: uuid('habit_id')
    .notNull()
    .references(() => habits.id, { onDelete: 'cascade' }),
  logDate: date('log_date').notNull(),
  /** done | skip */
  status: text('status').notNull().default('done'),
  value: integer('value').notNull().default(1),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/* ============================== 专注 ============================== */

export const focusSessions = pgTable('focus_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),
  taskTitle: text('task_title'),
  /** focus | shortBreak | longBreak */
  type: text('type').notNull().default('focus'),
  plannedSeconds: integer('planned_seconds').notNull().default(1500),
  actualSeconds: integer('actual_seconds').notNull().default(0),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  endedAt: timestamp('ended_at', { withTimezone: true }),
  completed: boolean('completed').notNull().default(false),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/* ============================== 倒数纪念日 ============================== */

export const anniversaries = pgTable('anniversaries', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  eventDate: date('event_date').notNull(),
  /** countdown | anniversary | birthday */
  type: text('type').notNull().default('countdown'),
  repeatYearly: boolean('repeat_yearly').notNull().default(false),
  lunar: boolean('lunar').notNull().default(false),
  color: text('color').notNull().default('#f97316'),
  icon: text('icon').notNull().default('🎂'),
  notes: text('notes'),
  archived: boolean('archived').notNull().default(false),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/* ============================== 智能清单 ============================== */

export const smartLists = pgTable('smart_lists', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  icon: text('icon').notNull().default('filter'),
  color: text('color').notNull().default('#0ea5e9'),
  filter: jsonb('filter').notNull().default({}),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/* ============================== 日历订阅 ============================== */

export const calendars = pgTable('calendars', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  url: text('url').notNull(),
  color: text('color').notNull().default('#8b5cf6'),
  enabled: boolean('enabled').notNull().default(true),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  lastError: text('last_error'),
  eventCount: integer('event_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const calendarEvents = pgTable('calendar_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  calendarId: uuid('calendar_id')
    .notNull()
    .references(() => calendars.id, { onDelete: 'cascade' }),
  uid: text('uid').notNull(),
  title: text('title').notNull(),
  description: text('description'),
  location: text('location'),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
  endsAt: timestamp('ends_at', { withTimezone: true }),
  allDay: boolean('all_day').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/* ============================== 设置 ============================== */

export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/* ============================== 信息收集（原有） ============================== */

export const sources = pgTable('sources', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  type: text('type').notNull().default('rss'),
  url: text('url').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  fetchIntervalMinutes: integer('fetch_interval_minutes').notNull().default(60),
  lastFetchedAt: timestamp('last_fetched_at', { withTimezone: true }),
  lastError: text('last_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const candidates = pgTable('candidates', {
  id: uuid('id').primaryKey().defaultRandom(),
  sourceId: uuid('source_id').references(() => sources.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  url: text('url'),
  excerpt: text('excerpt'),
  dueAt: timestamp('due_at', { withTimezone: true }),
  confidence: doublePrecision('confidence').notNull().default(0),
  fingerprint: text('fingerprint').notNull(),
  status: text('status').notNull().default('pending'),
  taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/* ============================== 行类型 ============================== */

export type ListRow = typeof lists.$inferSelect;
export type ListGroupRow = typeof listGroups.$inferSelect;
export type TaskRow = typeof tasks.$inferSelect;
export type TagRow = typeof tags.$inferSelect;
export type TaskReminderRow = typeof taskReminders.$inferSelect;
export type AttachmentRow = typeof attachments.$inferSelect;
export type TaskTemplateRow = typeof taskTemplates.$inferSelect;
export type HabitRow = typeof habits.$inferSelect;
export type HabitLogRow = typeof habitLogs.$inferSelect;
export type FocusSessionRow = typeof focusSessions.$inferSelect;
export type AnniversaryRow = typeof anniversaries.$inferSelect;
export type SmartListRow = typeof smartLists.$inferSelect;
export type CalendarRow = typeof calendars.$inferSelect;
export type CalendarEventRow = typeof calendarEvents.$inferSelect;
export type SourceRow = typeof sources.$inferSelect;
export type CandidateRow = typeof candidates.$inferSelect;
