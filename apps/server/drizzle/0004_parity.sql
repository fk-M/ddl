-- 0004: 对齐滴答清单 —— 全量能力扩展

-- ============ 清单分组（文件夹） ============
CREATE TABLE IF NOT EXISTS list_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  collapsed boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============ 清单扩展 ============
ALTER TABLE lists ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES list_groups(id) ON DELETE SET NULL;
ALTER TABLE lists ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'task';      -- task | note
ALTER TABLE lists ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;
ALTER TABLE lists ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE lists ADD COLUMN IF NOT EXISTS view_mode text NOT NULL DEFAULT 'list'; -- list | kanban
ALTER TABLE lists ADD COLUMN IF NOT EXISTS kanban_columns jsonb;
ALTER TABLE lists ADD COLUMN IF NOT EXISTS permission text NOT NULL DEFAULT 'private';

CREATE INDEX IF NOT EXISTS lists_group_idx ON lists(group_id);
CREATE INDEX IF NOT EXISTS lists_deleted_idx ON lists(deleted_at);

-- ============ 标签（支持父子层级） ============
CREATE TABLE IF NOT EXISTS tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  color text NOT NULL DEFAULT '#6366f1',
  parent_id uuid REFERENCES tags(id) ON DELETE CASCADE,
  sort_order integer NOT NULL DEFAULT 0,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tags_parent_idx ON tags(parent_id);

-- ============ 任务扩展 ============
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'task';        -- task | note
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS column_id text;                            -- 看板列
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS deleted_at timestamptz;                    -- 垃圾桶
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS estimate_pomodoros integer NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS actual_pomodoros integer NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS repeat_from text NOT NULL DEFAULT 'due';   -- due | completion
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS pinned boolean NOT NULL DEFAULT false;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS item_status text;                          -- 检查项完成态（预留）

CREATE INDEX IF NOT EXISTS tasks_deleted_idx ON tasks(deleted_at);
CREATE INDEX IF NOT EXISTS tasks_completed_idx ON tasks(completed_at);

-- ============ 多提醒 ============
CREATE TABLE IF NOT EXISTS task_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  remind_at timestamptz NOT NULL,
  channel text NOT NULL DEFAULT 'inapp',   -- inapp | system
  sound text,
  snooze_minutes integer NOT NULL DEFAULT 5,
  persistent boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS task_reminders_task_idx ON task_reminders(task_id);
CREATE INDEX IF NOT EXISTS task_reminders_at_idx ON task_reminders(remind_at);

-- ============ 附件 ============
CREATE TABLE IF NOT EXISTS attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  name text NOT NULL,
  mime text NOT NULL DEFAULT 'application/octet-stream',
  size integer NOT NULL DEFAULT 0,
  storage_path text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS attachments_task_idx ON attachments(task_id);

-- ============ 任务 / 笔记模板 ============
CREATE TABLE IF NOT EXISTS task_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'task',       -- task | note
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============ 习惯打卡 ============
CREATE TABLE IF NOT EXISTS habits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  icon text NOT NULL DEFAULT '✅',
  color text NOT NULL DEFAULT '#22c55e',
  freq_type text NOT NULL DEFAULT 'daily',   -- daily | weekly | monthly | custom
  freq_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  goal_per_period integer NOT NULL DEFAULT 1,
  unit text NOT NULL DEFAULT '次',
  remind_at text,                            -- HH:mm
  archived boolean NOT NULL DEFAULT false,
  deleted_at timestamptz,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS habit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  habit_id uuid NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
  log_date date NOT NULL,
  status text NOT NULL DEFAULT 'done',       -- done | skip
  value integer NOT NULL DEFAULT 1,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (habit_id, log_date)
);
CREATE INDEX IF NOT EXISTS habit_logs_habit_idx ON habit_logs(habit_id, log_date);

-- ============ 专注（番茄 + 正计时） ============
CREATE TABLE IF NOT EXISTS focus_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid REFERENCES tasks(id) ON DELETE SET NULL,
  task_title text,
  type text NOT NULL DEFAULT 'focus',        -- focus | shortBreak | longBreak
  planned_seconds integer NOT NULL DEFAULT 1500,
  actual_seconds integer NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  completed boolean NOT NULL DEFAULT false,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS focus_started_idx ON focus_sessions(started_at);

-- ============ 倒数纪念日 ============
CREATE TABLE IF NOT EXISTS anniversaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  event_date date NOT NULL,
  type text NOT NULL DEFAULT 'countdown',    -- countdown | anniversary | birthday
  repeat_yearly boolean NOT NULL DEFAULT false,
  lunar boolean NOT NULL DEFAULT false,
  color text NOT NULL DEFAULT '#f97316',
  icon text NOT NULL DEFAULT '🎂',
  notes text,
  archived boolean NOT NULL DEFAULT false,
  deleted_at timestamptz,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============ 智能清单 / 过滤器 ============
CREATE TABLE IF NOT EXISTS smart_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  icon text NOT NULL DEFAULT 'filter',
  color text NOT NULL DEFAULT '#0ea5e9',
  filter jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============ 日历订阅（ICS） ============
CREATE TABLE IF NOT EXISTS calendars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  url text NOT NULL,
  color text NOT NULL DEFAULT '#8b5cf6',
  enabled boolean NOT NULL DEFAULT true,
  last_synced_at timestamptz,
  last_error text,
  event_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS calendar_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_id uuid NOT NULL REFERENCES calendars(id) ON DELETE CASCADE,
  uid text NOT NULL,
  title text NOT NULL,
  description text,
  location text,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  all_day boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (calendar_id, uid)
);
CREATE INDEX IF NOT EXISTS calendar_events_start_idx ON calendar_events(starts_at);

-- ============ 设置（KV） ============
CREATE TABLE IF NOT EXISTS settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT 'null'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
