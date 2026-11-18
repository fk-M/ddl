// 合并两个 PGlite 数据目录：把 --from 库里比 --to 库更新的行补进去。
//
// 用途：项目里存在两份独立数据库 —— start-lan.bat 用的 apps/server/data/pglite
// 与桌面 App 用的 %APPDATA%\DDL\data\pglite。两份库互不相通，需要合并成一份。
//
// 语义与 /api/sync/push 完全一致：
// - 有 updated_at 的表按 LWW（只写更新的那一版）
// - 没有 updated_at 的表（habit_logs）按「已存在就不动」
// - 收件箱 id 两边不同，老库任务改挂到目标库的收件箱，老库那条收件箱本身丢弃
//   （否则会撞 lists.is_inbox 唯一索引）
//
// 用法：node scripts/merge-libraries.mjs --from <目录> --to <目录> [--dry]
import { existsSync } from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const fromDir = option('from');
const toDir = option('to');
const dryRun = flag('dry');

if (!fromDir || !toDir) {
  console.error('用法：node scripts/merge-libraries.mjs --from <源库目录> --to <目标库目录> [--dry]');
  process.exit(1);
}

for (const dir of [fromDir, toDir]) {
  if (!existsSync(path.join(dir, 'PG_VERSION'))) {
    console.error(`[错误] 不是有效的 PGlite 数据目录：${dir}`);
    process.exit(1);
  }
}

/** 外键依赖顺序：被引用的表必须先写 */
const TABLE_ORDER = [
  'list_groups',
  'lists',
  'tags',
  'tasks',
  'task_reminders',
  'attachments',
  'task_templates',
  'habits',
  'habit_logs',
  'anniversaries',
  'focus_sessions',
  'smart_lists',
  'calendars',
  'calendar_events',
  'sources',
  'candidates',
];

/** 不参与合并：设置属于「这台机器现在的选择」，被老库覆盖会突然改掉用户的界面偏好 */
const SKIP_TABLES = new Set(['settings']);

const q = (name) => `"${name}"`;

async function main() {
  console.log(`源库  ：${path.resolve(fromDir)}`);
  console.log(`目标库：${path.resolve(toDir)}`);
  console.log(dryRun ? '模式  ：试运行，不写入\n' : '模式  ：实际写入\n');

  const from = new PGlite(fromDir);
  const to = new PGlite(toDir);

  const report = [];
  const rowCounts = [];
  try {
    // 两库共有的表
    const listed = await from.query(
      `select table_name from information_schema.tables
       where table_schema = 'public' and table_type = 'BASE TABLE'`,
    );
    const targetTables = new Set(
      (
        await to.query(
          `select table_name from information_schema.tables
           where table_schema = 'public' and table_type = 'BASE TABLE'`,
        )
      ).rows.map((r) => r.table_name),
    );
    const tables = TABLE_ORDER.filter(
      (t) =>
        listed.rows.some((r) => r.table_name === t) &&
        targetTables.has(t) &&
        !SKIP_TABLES.has(t),
    );

    // 收件箱对齐：两个库各自生成的 inbox id 不同，必须合并成一个
    const inboxFrom = (
      await from.query(`select id from lists where is_inbox = true limit 1`)
    ).rows[0]?.id;
    const inboxTo = (await to.query(`select id from lists where is_inbox = true limit 1`)).rows[0]
      ?.id;
    const remapInbox = Boolean(inboxFrom && inboxTo && inboxFrom !== inboxTo);
    if (remapInbox) {
      console.log(`收件箱 id 不同，源库 ${inboxFrom} 的任务将改挂到目标库 ${inboxTo}\n`);
    }

    for (const table of tables) {
      const columns = (
        await from.query(
          `select column_name from information_schema.columns
           where table_schema = 'public' and table_name = $1
           order by ordinal_position`,
          [table],
        )
      ).rows.map((r) => r.column_name);

      const targetColumns = new Set(
        (
          await to.query(
            `select column_name from information_schema.columns
             where table_schema = 'public' and table_name = $1`,
            [table],
          )
        ).rows.map((r) => r.column_name),
      );
      const usable = columns.filter((c) => targetColumns.has(c));
      if (usable.length === 0) continue;

      const pk = (
        await to.query(
          `select kcu.column_name
           from information_schema.table_constraints tc
           join information_schema.key_column_usage kcu
             on tc.constraint_name = kcu.constraint_name
            and tc.table_schema = kcu.table_schema
           where tc.table_schema = 'public'
             and tc.table_name = $1
             and tc.constraint_type = 'PRIMARY KEY'
           order by kcu.ordinal_position
           limit 1`,
          [table],
        )
      ).rows[0]?.column_name;
      if (!pk) {
        report.push({ table, inserted: 0, updated: 0, skipped: 0, failed: 0, note: '无主键，已跳过' });
        continue;
      }

      const hasUpdatedAt = usable.includes('updated_at');
      const rows = (await from.query(`select * from ${q(table)}`)).rows;
      const toCount = (await to.query(`select count(*)::int as n from ${q(table)}`)).rows[0]?.n ?? 0;
      rowCounts.push({ table, from: rows.length, to: toCount });

      let inserted = 0;
      let updated = 0;
      let skipped = 0;
      let failed = 0;
      const failures = [];

      for (const raw of rows) {
        const row = { ...raw };
        // 老库的草稿收件箱本身不写入，任务改挂到目标库的收件箱
        if (table === 'lists' && remapInbox && row.id === inboxFrom) {
          skipped += 1;
          continue;
        }
        if (table === 'tasks' && remapInbox && row.list_id === inboxFrom) {
          row.list_id = inboxTo;
        }

        const values = usable.map((c) => row[c]);
        const setClause = usable
          .filter((c) => c !== pk)
          .map((c) => `${q(c)} = excluded.${q(c)}`)
          .join(', ');
        const sql = hasUpdatedAt
          ? `insert into ${q(table)} (${usable.map(q).join(',')})
             values (${usable.map((_, i) => `$${i + 1}`).join(',')})
             on conflict (${q(pk)}) do update set ${setClause}
             where excluded."updated_at" > ${q(table)}."updated_at"
             returning (xmax = 0) as ins`
          : `insert into ${q(table)} (${usable.map(q).join(',')})
             values (${usable.map((_, i) => `$${i + 1}`).join(',')})
             on conflict (${q(pk)}) do nothing
             returning (xmax = 0) as ins`;

        if (dryRun) {
          skipped += 1;
          continue;
        }
        try {
          const res = await to.query(sql, values);
          if (res.rows.length === 0) skipped += 1;
          else if (res.rows[0].ins) inserted += 1;
          else updated += 1;
        } catch (error) {
          failed += 1;
          if (failures.length < 3) {
            failures.push(`${row[pk]}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }

      report.push({ table, inserted, updated, skipped, failed, failures });
    }
  } finally {
    await from.close();
    await to.close();
  }

  console.log('\n两库现有行数对比');
  console.log('表名               源库    目标库');
  console.log('--------------------------------');
  for (const r of rowCounts) {
    console.log(
      `${r.table.padEnd(18, ' ')} ${String(r.from).padStart(6)} ${String(r.to).padStart(8)}`,
    );
  }

  console.log('\n合并结果');
  console.log('表名               新增    更新    跳过    失败');
  console.log('------------------------------------------------');
  for (const r of report) {
    const name = r.table.padEnd(18, ' ');
    console.log(
      `${name} ${String(r.inserted).padStart(6)} ${String(r.updated).padStart(7)} ${String(
        r.skipped,
      ).padStart(7)} ${String(r.failed).padStart(7)}${r.note ? `  (${r.note})` : ''}`,
    );
  }
  const totals = report.reduce(
    (acc, r) => ({
      inserted: acc.inserted + r.inserted,
      updated: acc.updated + r.updated,
      skipped: acc.skipped + r.skipped,
      failed: acc.failed + r.failed,
    }),
    { inserted: 0, updated: 0, skipped: 0, failed: 0 },
  );
  console.log('------------------------------------------------');
  console.log(
    `合计               ${String(totals.inserted).padStart(6)} ${String(totals.updated).padStart(
      7,
    )} ${String(totals.skipped).padStart(7)} ${String(totals.failed).padStart(7)}`,
  );

  const problems = report.filter((r) => r.failures?.length);
  for (const r of problems) {
    console.log(`\n[${r.table}] 失败示例：`);
    for (const f of r.failures) console.log(`  - ${f}`);
  }
  if (dryRun) console.log('\n（试运行，未写入任何数据）');
}

main().catch((error) => {
  console.error('[合并失败]', error);
  process.exit(1);
});
