-- 0002_quadrant: 四象限维度（重要 / 紧急 两个正交布尔位）
-- 象限 = (is_important, is_urgent) 的组合，不再依赖 priority 猜测

alter table tasks add column if not exists is_important boolean not null default false;
alter table tasks add column if not exists is_urgent boolean not null default false;

-- 历史数据按既有优先级做一次性回填，避免全部堆在「不重要不紧急」
update tasks set is_important = true where priority >= 2;
update tasks set is_urgent = true where priority = 3;

create index if not exists tasks_quadrant_idx on tasks (is_important, is_urgent) where status = 'pending';
