-- 0001_init: 清单与任务基础表
-- 说明：与 src/db/schema.ts 保持一致；变更请新增迁移文件，不要修改已应用的文件

create table if not exists lists (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  color text not null default '#3b82f6',
  icon text not null default 'list',
  is_inbox boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 收件箱全局唯一
create unique index if not exists lists_inbox_uniq on lists (is_inbox) where is_inbox;

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references lists(id) on delete cascade,
  title text not null,
  notes text,
  status text not null default 'pending' check (status in ('pending', 'completed')),
  priority integer not null default 0 check (priority between 0 and 3),
  due_at timestamptz,
  all_day boolean not null default false,
  remind_at timestamptz,
  rrule text,
  tags text[] not null default '{}',
  sort_order double precision not null default 0,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tasks_list_status_idx on tasks (list_id, status);
create index if not exists tasks_due_idx on tasks (due_at);
create index if not exists tasks_updated_idx on tasks (updated_at);

insert into lists (name, color, icon, is_inbox, sort_order)
values ('收件箱', '#64748b', 'inbox', true, 0)
on conflict do nothing;
