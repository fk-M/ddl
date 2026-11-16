-- 0003_features: 子任务 / 信息源 / 候选收集箱

-- 子任务：自引用，父任务删除时级联
alter table tasks add column if not exists parent_id uuid references tasks(id) on delete cascade;
create index if not exists tasks_parent_idx on tasks (parent_id);

-- 信息源（P2 第一期只支持 RSS / Atom）
create table if not exists sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null default 'rss' check (type in ('rss')),
  url text not null,
  enabled boolean not null default true,
  fetch_interval_minutes integer not null default 60 check (fetch_interval_minutes between 5 and 10080),
  last_fetched_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists sources_url_uniq on sources (url);

-- 候选收集箱：采集结果必须先落到这里，人工确认后才变成任务
create table if not exists candidates (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references sources(id) on delete set null,
  title text not null,
  url text,
  excerpt text,
  due_at timestamptz,
  confidence double precision not null default 0,
  fingerprint text not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'dismissed')),
  task_id uuid references tasks(id) on delete set null,
  created_at timestamptz not null default now()
);

-- 同一篇文章只入库一次
create unique index if not exists candidates_fingerprint_uniq on candidates (fingerprint);
create index if not exists candidates_status_idx on candidates (status, created_at desc);
