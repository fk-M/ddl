import type { AppSettings, TaskList } from '@ddl/shared';
import clsx from 'clsx';
import {
  Bell,
  CalendarDays,
  Database,
  Download,
  Info,
  LayoutGrid,
  Link2,
  ListChecks,
  Palette,
  RefreshCw,
  Trash2,
  Upload,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useCalendarMutations, useCalendars, useEmptyTrash, useUpdateSettings } from '../hooks/useDdl';
import {
  api,
  visibleError,
  defaultServerUrl,
  getServerUrl,
  normalizeServerUrl,
  setServerUrl,
} from '../lib/api';
import { isLocalFirst } from '../lib/server-url';
import { getSyncStatus, subscribeSync, syncNow, type SyncStatus } from '../lib/sync-engine';
import { COMPLETION_SOUNDS, NOISE_KINDS, REMIND_SOUNDS, playCompletionSound, playRemindSound, type NoiseKind } from '../lib/sound';
import { ACCENT_PRESETS, ICON_PACKS } from '../lib/theme';
import { NavOrderCard } from './NavOrderCard';
import { NotifyCard } from './NotifyCard';
import { Button, Card, ErrorBar, Field, SectionTitle, Toggle, inputClass, selectClass } from './ui';
import { UpdateCard } from './UpdateCard';
import { WidgetCard } from './WidgetCard';

type Props = {
  settings: AppSettings;
  lists: TaskList[];
};

/** 设置分区：宽屏左侧导航 / 窄屏顶部横向标签 */
const SECTIONS = [
  { key: 'appearance', label: '外观', icon: Palette },
  { key: 'reminder', label: '提醒与专注', icon: Bell },
  { key: 'widget', label: '桌面小组件', icon: LayoutGrid },
  { key: 'task', label: '任务与视图', icon: ListChecks },
  { key: 'calendar', label: '日历', icon: CalendarDays },
  { key: 'data', label: '数据与同步', icon: Database },
  { key: 'about', label: '更新与关于', icon: Info },
] as const;

type SectionKey = (typeof SECTIONS)[number]['key'];

const SECTION_STORAGE_KEY = 'ddl.settings.section';

function readInitialSection(): SectionKey {
  try {
    const saved = localStorage.getItem(SECTION_STORAGE_KEY);
    if (saved && SECTIONS.some((section) => section.key === saved)) return saved as SectionKey;
  } catch {
    /* 隐私模式下 localStorage 可能不可用，忽略 */
  }
  return 'appearance';
}

export function SettingsView({ settings, lists }: Props) {
  const updateSettings = useUpdateSettings();
  const emptyTrash = useEmptyTrash();
  const calendarsQuery = useCalendars();
  const calendarMutations = useCalendarMutations();

  const [active, setActive] = useState<SectionKey>(readInitialSection);
  const [importFormat, setImportFormat] = useState<'json' | 'csv' | 'ics'>('json');
  const [importText, setImportText] = useState('');
  const [importResult, setImportResult] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState('');
  const [calUrl, setCalUrl] = useState('');
  const [calName, setCalName] = useState('');
  const [serverUrl, setServerUrlInput] = useState(getServerUrl());
  const [probe, setProbe] = useState<{ state: 'idle' | 'running' | 'ok' | 'fail'; text: string }>({
    state: 'idle',
    text: '',
  });
  const [sync, setSync] = useState<SyncStatus>(getSyncStatus());
  useEffect(() => subscribeSync(setSync), []);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(SECTION_STORAGE_KEY, active);
    } catch {
      /* 忽略写入失败 */
    }
  }, [active]);

  function patch(next: Partial<AppSettings>) {
    updateSettings.mutate(next);
  }

  /** 直接打一次 /health 与真实接口，把失败原因展示出来，便于定位手机端连接问题 */
  async function testConnection() {
    const base = normalizeServerUrl(serverUrl.trim() ? serverUrl : getServerUrl(), 3001);
    const target = base || '（同源）';
    setProbe({ state: 'running', text: `正在测试 ${target} …` });
    const started = Date.now();
    try {
      const health = await fetch(`${base}/health`);
      const healthBody = (await health.text()).slice(0, 80);
      if (!health.ok) throw new Error(`/health 返回 HTTP ${health.status}`);

      // 带上自定义头，强制触发 CORS 预检，复现业务请求的真实链路
      const apiRes = await fetch(`${base}/api/tasks?limit=1`, {
        headers: { 'Content-Type': 'application/json' },
      });
      if (!apiRes.ok) throw new Error(`/api/tasks 返回 HTTP ${apiRes.status}`);
      setProbe({
        state: 'ok',
        text: `连接成功（${Date.now() - started}ms）\n目标：${target}\n/health ${health.status} ${healthBody}\n/api/tasks ${apiRes.status}（CORS 预检通过）`,
      });
    } catch (error) {
      const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
      const hint =
        error instanceof TypeError
          ? '\n\n多半是：① 手机与电脑不通（同一 Wi-Fi？校园网客户端隔离？）② 明文 HTTP 被系统拦截 ③ CORS 预检失败。\n可先用手机浏览器打开 ' +
            (base ? `${base}/health` : '当前站点 /health') +
            ' 判断网络是否可达。'
          : '';
      setProbe({
        state: 'fail',
        text: `失败（${Date.now() - started}ms）\n目标：${target}\n${detail}${hint}`,
      });
    }
  }

  async function doImport() {
    if (!importText.trim()) return;
    setImporting(true);
    setImportResult(null);
    try {
      const result = await api.importData(importFormat, importText);
      setImportResult(`导入成功 ${result.imported} 条，跳过 ${result.skipped} 条`);
      setImportText('');
    } catch (error) {
      setImportResult(error instanceof Error ? error.message : '导入失败');
    } finally {
      setImporting(false);
    }
  }

  async function doExportJson() {
    setExporting(true);
    setExportMessage('');
    try {
      const text = await api.exportLocalJson();
      const stamp = new Date().toISOString().slice(0, 10);
      const { saveTextFile } = await import('../lib/export-file');
      await saveTextFile(`ddl-backup-${stamp}.json`, text);
      setExportMessage('备份已生成，可在电脑端「设置 → 数据 → 导入」里恢复');
    } catch (error) {
      setExportMessage(error instanceof Error ? error.message : '导出失败');
    } finally {
      setExporting(false);
    }
  }

  const calendars = calendarsQuery.data ?? [];
  const error = visibleError(updateSettings.error, emptyTrash.error, calendarMutations.create.error);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-3 pb-10 md:max-w-5xl md:flex-row md:items-start md:gap-5">
      {/* 分类导航：宽屏竖排吸顶，窄屏横向滚动 */}
      <nav className="ddl-no-scrollbar flex shrink-0 gap-1.5 overflow-x-auto pb-1 md:sticky md:top-2 md:w-44 md:flex-col md:gap-1 md:self-start md:overflow-visible md:pb-0">
        {SECTIONS.map((section) => {
          const Icon = section.icon;
          const selected = active === section.key;
          return (
            <button
              key={section.key}
              type="button"
              onClick={() => setActive(section.key)}
              className={clsx(
                'flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px] whitespace-nowrap transition-colors',
                'md:rounded-lg md:px-2.5 md:py-2 md:text-[13px]',
                selected
                  ? 'bg-neutral-900 font-medium text-white'
                  : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200 md:bg-transparent md:hover:bg-neutral-100',
              )}
            >
              <Icon className="size-3.5 shrink-0" />
              {section.label}
            </button>
          );
        })}
      </nav>

      <div className="min-w-0 flex-1 space-y-4">
        {error && <ErrorBar message={error.message} />}

        {active === 'appearance' && (
          <Card id="settings-appearance">
            <SectionTitle>外观</SectionTitle>
            <Field label="主题模式">
              <select
                value={settings.themeMode}
                onChange={(event) => patch({ themeMode: event.target.value as AppSettings['themeMode'] })}
                className={selectClass}
              >
                <option value="light">浅色</option>
                <option value="dark">深色</option>
                <option value="system">跟随系统</option>
              </select>
            </Field>

            <div className="mt-3">
              <span className="mb-1 block text-[11.5px] font-medium tracking-wide text-neutral-500">主题色</span>
              <div className="flex flex-wrap gap-2">
                {ACCENT_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => patch({ accentColor: preset.id })}
                    className={clsx(
                      'size-7 rounded-full border-2 transition-transform',
                      settings.accentColor === preset.id
                        ? 'scale-110 border-neutral-800'
                        : 'border-transparent hover:scale-105',
                    )}
                    style={{ backgroundColor: preset.id }}
                    title={preset.label}
                    aria-label={preset.label}
                  />
                ))}
              </div>
            </div>

            <div className="mt-3">
              <Field label="应用图标皮肤" hint="对齐滴答清单的 32 套图标包；网页端仅做记录，打包桌面端后生效">
                <select
                  value={settings.iconPack}
                  onChange={(event) => patch({ iconPack: event.target.value })}
                  className={selectClass}
                >
                  {ICON_PACKS.map((pack) => (
                    <option key={pack} value={pack}>
                      {pack}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </Card>
        )}

        {active === 'reminder' && (
          <>
            <Card id="settings-reminder">
              <SectionTitle>提醒与通知</SectionTitle>
              <Toggle
                label="默认提醒（全天任务）"
                hint="新建全天任务时自动加一条提醒"
                checked={settings.defaultAllDay}
                onChange={(next) => patch({ defaultAllDay: next })}
              />

              <div className="mt-2 grid grid-cols-2 gap-3">
                <Field label="默认提前提醒（分钟）">
                  <input
                    type="number"
                    min={0}
                    max={10080}
                    value={settings.defaultRemindMinutes}
                    onChange={(event) => patch({ defaultRemindMinutes: Number(event.target.value) || 0 })}
                    className={inputClass}
                  />
                </Field>
                <Field label="提醒音量">
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={settings.remindVolume}
                    onChange={(event) => patch({ remindVolume: Number(event.target.value) })}
                    className="w-full accent-neutral-900"
                  />
                </Field>
              </div>

              <div className="mt-2 grid grid-cols-2 gap-3">
                <Field label="提醒铃声">
                  <div className="flex items-center gap-1.5">
                    <select
                      value={settings.remindSound}
                      onChange={(event) => patch({ remindSound: event.target.value })}
                      className={selectClass}
                    >
                      {REMIND_SOUNDS.map((sound) => (
                        <option key={sound.id} value={sound.id}>
                          {sound.label}
                        </option>
                      ))}
                    </select>
                    <Button
                      size="sm"
                      className="shrink-0 whitespace-nowrap"
                      onClick={() => playRemindSound(settings.remindSound, settings.remindVolume)}
                    >
                      试听
                    </Button>
                  </div>
                </Field>
                <Field label="完成音效">
                  <div className="flex items-center gap-1.5">
                    <select
                      value={settings.completionSound}
                      onChange={(event) => patch({ completionSound: event.target.value })}
                      className={selectClass}
                    >
                      {COMPLETION_SOUNDS.map((sound) => (
                        <option key={sound.id} value={sound.id}>
                          {sound.label}
                        </option>
                      ))}
                    </select>
                    <Button
                      size="sm"
                      className="shrink-0 whitespace-nowrap"
                      onClick={() => playCompletionSound(settings.completionSound, settings.remindVolume)}
                    >
                      试听
                    </Button>
                  </div>
                </Field>
              </div>

              <Toggle
                label="完成音效开关"
                checked={settings.completionSoundEnabled}
                onChange={(next) => patch({ completionSoundEnabled: next })}
              />
            </Card>

            <NotifyCard />

            <Card id="settings-focus">
              <SectionTitle>番茄专注</SectionTitle>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Field label="番茄时长">
                  <input
                    type="number"
                    min={1}
                    max={180}
                    value={settings.pomodoroMinutes}
                    onChange={(event) => patch({ pomodoroMinutes: Number(event.target.value) || 25 })}
                    className={inputClass}
                  />
                </Field>
                <Field label="短休息">
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={settings.shortBreakMinutes}
                    onChange={(event) => patch({ shortBreakMinutes: Number(event.target.value) || 5 })}
                    className={inputClass}
                  />
                </Field>
                <Field label="长休息">
                  <input
                    type="number"
                    min={1}
                    max={120}
                    value={settings.longBreakMinutes}
                    onChange={(event) => patch({ longBreakMinutes: Number(event.target.value) || 15 })}
                    className={inputClass}
                  />
                </Field>
                <Field label="长休息间隔">
                  <input
                    type="number"
                    min={1}
                    max={12}
                    value={settings.longBreakInterval}
                    onChange={(event) => patch({ longBreakInterval: Number(event.target.value) || 4 })}
                    className={inputClass}
                  />
                </Field>
              </div>

              <Toggle
                label="自动开始休息"
                checked={settings.autoStartBreak}
                onChange={(next) => patch({ autoStartBreak: next })}
              />
              <Toggle
                label="自动开始下一个番茄"
                checked={settings.autoStartNext}
                onChange={(next) => patch({ autoStartNext: next })}
              />

              <div className="mt-2 grid grid-cols-2 gap-3">
                <Field label="背景音">
                  <select
                    value={settings.whiteNoise}
                    onChange={(event) => patch({ whiteNoise: event.target.value as NoiseKind })}
                    className={selectClass}
                  >
                    {NOISE_KINDS.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="每日专注目标（分钟）">
                  <input
                    type="number"
                    min={0}
                    max={1440}
                    value={settings.dailyFocusGoalMinutes}
                    onChange={(event) => patch({ dailyFocusGoalMinutes: Number(event.target.value) || 0 })}
                    className={inputClass}
                  />
                </Field>
              </div>
            </Card>
          </>
        )}

        {active === 'task' && (
          <Card id="settings-task">
            <SectionTitle>任务与视图</SectionTitle>
            <div className="mb-3">
              <Field label="打开应用后首先显示">
                <select
                  value={settings.startView}
                  onChange={(event) =>
                    patch({ startView: event.target.value as AppSettings['startView'] })
                  }
                  className={selectClass}
                >
                  <option value="today">今天</option>
                  <option value="inbox">收件箱</option>
                  <option value="next7">最近 7 天</option>
                  <option value="calendar">日历</option>
                  <option value="matrix">四象限</option>
                  <option value="all">全部任务</option>
                </select>
              </Field>
              <p className="mt-1 text-[11.5px] leading-relaxed text-neutral-400">
                下次打开应用时生效。带 <code className="rounded bg-neutral-100 px-1">?view=</code>{' '}
                参数的链接仍然优先（检测页靠它直达某一页）。
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="默认清单">
                <select
                  value={settings.defaultListId ?? ''}
                  onChange={(event) => patch({ defaultListId: event.target.value || null })}
                  className={selectClass}
                >
                  <option value="">收件箱</option>
                  {lists.map((list) => (
                    <option key={list.id} value={list.id}>
                      {list.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="默认优先级">
                <select
                  value={settings.defaultPriority}
                  onChange={(event) =>
                    patch({ defaultPriority: Number(event.target.value) as AppSettings['defaultPriority'] })
                  }
                  className={selectClass}
                >
                  <option value={0}>无</option>
                  <option value={1}>低</option>
                  <option value={2}>中</option>
                  <option value={3}>高</option>
                </select>
              </Field>
            </div>

            <div className="mt-2 grid grid-cols-2 gap-3">
              <Field label="逾期任务位置">
                <select
                  value={settings.overduePosition}
                  onChange={(event) =>
                    patch({ overduePosition: event.target.value as AppSettings['overduePosition'] })
                  }
                  className={selectClass}
                >
                  <option value="top">置顶</option>
                  <option value="bottom">沉底</option>
                </select>
              </Field>
              <Field label="一周起始日">
                <select
                  value={settings.weekStartsMonday ? 'mon' : 'sun'}
                  onChange={(event) => patch({ weekStartsMonday: event.target.value === 'mon' })}
                  className={selectClass}
                >
                  <option value="mon">周一</option>
                  <option value="sun">周日</option>
                </select>
              </Field>
            </div>

            <Field
              label="已完成任务显示"
              hint="控制列表底部「已完成」区域的默认状态；移到垃圾桶的任务可在「垃圾桶」里恢复"
            >
              <select
                value={settings.completedDisplay}
                onChange={(event) =>
                  patch({ completedDisplay: event.target.value as AppSettings['completedDisplay'] })
                }
                className={selectClass}
              >
                <option value="collapsed">折叠在列表底部（可展开）</option>
                <option value="expanded">直接展开显示</option>
                <option value="hidden">完全隐藏</option>
              </select>
            </Field>

            <Toggle
              label="24 小时制"
              checked={settings.use24Hour}
              onChange={(next) => patch({ use24Hour: next })}
            />
            <Toggle
              label="显示农历"
              hint="日历中显示农历日期与节气"
              checked={settings.showLunar}
              onChange={(next) => patch({ showLunar: next })}
            />
            <Toggle
              label="侧边栏显示 Mini 日历"
              checked={settings.showMiniCalendar}
              onChange={(next) => patch({ showMiniCalendar: next })}
            />

            <div className="mt-4 border-t border-neutral-100 pt-3">
              <span className="mb-1 block text-[11.5px] font-medium tracking-wide text-neutral-500">
                侧边栏顺序
              </span>
              <NavOrderCard order={settings.navOrder} onChange={(next) => patch({ navOrder: next })} />
            </div>
          </Card>
        )}

        {active === 'calendar' && (
            <Card id="settings-calendar">
              <SectionTitle>日历订阅（.ics）</SectionTitle>
              {isLocalFirst() && (
                <p className="mb-3 rounded-lg bg-neutral-50 px-3 py-2 text-[11.5px] leading-relaxed text-neutral-500">
                  订阅的拉取与解析都在电脑端服务里完成。手机要先和电脑连同一网络、并在「服务端连接」里填好地址，
                  才能添加订阅；已有日程会随同步一起下来。
                </p>
              )}
            <div className="flex gap-2">
              <input
                value={calName}
                onChange={(event) => setCalName(event.target.value)}
                placeholder="名称"
                className="h-9 w-28 rounded-lg border border-neutral-200 bg-white px-2.5 text-[13px] outline-none focus:border-neutral-400"
              />
              <input
                value={calUrl}
                onChange={(event) => setCalUrl(event.target.value)}
                placeholder="https://... .ics"
                className="h-9 min-w-0 flex-1 rounded-lg border border-neutral-200 bg-white px-2.5 text-[13px] outline-none focus:border-neutral-400"
              />
              <Button
                variant="primary"
                disabled={!calUrl.trim()}
                onClick={() => {
                  calendarMutations.create.mutate(
                    { name: calName.trim() || '订阅日历', url: calUrl.trim() },
                    {
                      onSuccess: () => {
                        setCalUrl('');
                        setCalName('');
                      },
                    },
                  );
                }}
              >
                <Link2 className="size-3.5" />
                订阅
              </Button>
            </div>

            <div className="mt-3 space-y-1.5">
              {calendars.length === 0 && (
                <p className="text-[12px] text-neutral-400">
                  还没有订阅。粘一个 .ics 链接进来，就能把外部日程叠加到日历里。
                </p>
              )}
              {calendars.map((calendar) => (
                <div
                  key={calendar.id}
                  className="flex items-center gap-2 rounded-lg border border-neutral-200/80 px-2.5 py-2"
                >
                  <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: calendar.color }} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] text-neutral-800">{calendar.name}</p>
                    <p className="truncate text-[11px] text-neutral-400">
                      {calendar.eventCount} 个日程
                      {calendar.lastError ? ` · 同步失败：${calendar.lastError}` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => calendarMutations.sync.mutate(calendar.id)}
                    className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                    aria-label="同步"
                  >
                    <RefreshCw className={clsx('size-3.5', calendarMutations.sync.isPending && 'animate-spin')} />
                  </button>
                  <button
                    type="button"
                    onClick={() => calendarMutations.remove.mutate(calendar.id)}
                    className="rounded p-1 text-neutral-300 hover:bg-red-50 hover:text-red-600"
                    aria-label="取消订阅"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </Card>
        )}

        {active === 'widget' && <WidgetCard />}

        {active === 'data' && (
          <>
            <Card id="settings-data">
              <SectionTitle>数据</SectionTitle>
              <div className="flex flex-wrap gap-2">
                {isLocalFirst() ? (
                  <Button onClick={doExportJson} disabled={exporting}>
                    <Download className="size-3.5" />
                    {exporting ? '生成中…' : '导出 JSON 备份'}
                  </Button>
                ) : (
                  (['json', 'csv', 'ics'] as const).map((format) => (
                    <a
                      key={format}
                      href={api.exportUrl(format)}
                      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 text-[13px] text-neutral-700 hover:bg-neutral-50"
                    >
                      <Download className="size-3.5" />
                      导出 {format.toUpperCase()}
                    </a>
                  ))
                )}
                <Button
                  variant="danger"
                  onClick={() => {
                    if (window.confirm('清空垃圾桶后不可恢复，确定继续？')) emptyTrash.mutate();
                  }}
                >
                  <Trash2 className="size-3.5" />
                  清空垃圾桶
                </Button>
              </div>
              {isLocalFirst() && (
                <p className="mt-2 text-[11.5px] leading-relaxed text-neutral-400">
                  手机端导出的是完整 JSON 备份（含清单、任务、标签与设置），可直接在电脑端导入；
                  CSV / ICS 需要在电脑端导出。{exportMessage && ` ${exportMessage}`}
                </p>
              )}

              <div className="mt-4 rounded-lg border border-neutral-200/80 p-3">
                <p className="mb-2 text-[12px] font-medium text-neutral-700">导入</p>
                {isLocalFirst() ? (
                  <p className="text-[12px] leading-relaxed text-neutral-500">
                    手机端暂不支持导入（解析与落库都在电脑端服务里）。
                    请把备份文件拿到电脑上，用「设置 → 数据 → 导入」恢复。
                  </p>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={importFormat}
                        onChange={(event) => setImportFormat(event.target.value as 'json' | 'csv' | 'ics')}
                        className="h-8 rounded-lg border border-neutral-200 bg-white px-2 text-[12px] outline-none"
                      >
                        <option value="json">DDL 备份 JSON</option>
                        <option value="csv">CSV（title,list,dueAt,tags…）</option>
                        <option value="ics">iCalendar .ics</option>
                      </select>
                      <Button size="sm" onClick={() => fileRef.current?.click()}>
                        <Upload className="size-3.5" />
                        选择文件
                      </Button>
                      <input
                        ref={fileRef}
                        type="file"
                        accept=".json,.csv,.ics,text/calendar,application/json,text/csv"
                        className="hidden"
                        onChange={async (event) => {
                          const file = event.target.files?.[0];
                          if (!file) return;
                          setImportText(await file.text());
                          event.target.value = '';
                        }}
                      />
                      {importText && (
                        <span className="text-[11.5px] text-neutral-500">已读取 {importText.length} 字符</span>
                      )}
                    </div>
                    <textarea
                      value={importText}
                      onChange={(event) => setImportText(event.target.value)}
                      placeholder="也可以直接粘贴内容"
                      rows={3}
                      className="mt-2 w-full rounded-lg border border-neutral-200 bg-white p-2 text-[12px] outline-none focus:border-neutral-400"
                    />
                    <div className="mt-2 flex items-center gap-2">
                      <Button
                        variant="primary"
                        size="sm"
                        disabled={!importText.trim() || importing}
                        onClick={doImport}
                      >
                        {importing ? '导入中…' : '开始导入'}
                      </Button>
                      {importResult && <span className="text-[11.5px] text-neutral-600">{importResult}</span>}
                    </div>
                  </>
                )}
              </div>
            </Card>

            {isLocalFirst() && (
              <Card id="settings-sync">
                <SectionTitle>离线使用与同步</SectionTitle>
                <p className="mb-3 text-[12px] leading-relaxed text-neutral-500">
                  手机上的任务、清单和标签保存在本机，不连电脑也能新建、编辑、完成和删除。
                  只有手机与电脑在同一网络、且电脑端服务可达时才会自动双向同步；
                  两端都改过同一条任务时，以修改时间更晚的一方为准。
                </p>
                <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-[12px] font-medium text-neutral-700">
                      <span
                        className={clsx(
                          'inline-block h-2 w-2 rounded-full',
                          sync.state === 'syncing'
                            ? 'bg-blue-500'
                            : sync.reach
                              ? 'bg-emerald-500'
                              : 'bg-amber-500',
                        )}
                      />
                      {sync.state === 'syncing' ? '同步中…' : sync.reach ? '已连上电脑' : '离线使用'}
                    </span>
                    <button
                      type="button"
                      className="flex items-center gap-1 text-[12px] text-blue-600 hover:underline disabled:opacity-50"
                      onClick={() => void syncNow()}
                      disabled={sync.state === 'syncing'}
                    >
                      <RefreshCw size={12} />
                      立即同步
                    </button>
                  </div>
                  <p className="mt-1.5 text-[11.5px] leading-relaxed text-neutral-500">
                    {sync.message}
                    {sync.lastSyncAt && ` · 上次同步 ${new Date(sync.lastSyncAt).toLocaleString('zh-CN')}`}
                  </p>
                </div>
              </Card>
            )}

            <Card id="settings-server">
              <SectionTitle>服务端连接</SectionTitle>
              <p className="mb-3 text-[12px] leading-relaxed text-neutral-500">
                桌面端由外壳内置服务与数据库，地址留空即可。手机端现在可完全离线使用，
                这个地址<strong className="font-medium text-neutral-700">仅用于同网时的数据同步</strong>，留空也不会影响本机记任务。
                需要同步时填同一局域网内的电脑，例如{' '}
                <code className="rounded bg-neutral-100 px-1">http://192.168.1.10:3001</code>；
                只填 <code className="rounded bg-neutral-100 px-1">192.168.1.10</code> 也可以，会自动补协议和端口。
              </p>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="flex-1">
                  <Field label="服务端地址">
                    <input
                      className={inputClass}
                      placeholder={defaultServerUrl || '留空使用当前站点地址'}
                      value={serverUrl}
                      onChange={(event) => setServerUrlInput(event.target.value)}
                    />
                  </Field>
                </div>
                <Button
                  variant="primary"
                  className="shrink-0"
                  onClick={() => {
                    setServerUrl(serverUrl);
                    window.location.reload();
                  }}
                >
                  保存并重连
                </Button>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <span className="text-[12px] text-neutral-500">
                  当前生效：{getServerUrl() || '同源（当前页面地址）'}
                </span>
                <button
                  type="button"
                  className="text-[12px] text-blue-600 hover:underline"
                  onClick={testConnection}
                  disabled={probe.state === 'running'}
                >
                  {probe.state === 'running' ? '测试中…' : '测试连接'}
                </button>
                {getServerUrl() && (
                  <button
                    type="button"
                    className="text-[12px] text-blue-600 hover:underline"
                    onClick={() => {
                      setServerUrl('');
                      setServerUrlInput('');
                      window.location.reload();
                    }}
                  >
                    恢复默认
                  </button>
                )}
              </div>
              {probe.text && (
                <pre
                  className={clsx(
                    'mt-2 rounded-lg px-3 py-2 text-[11.5px] leading-relaxed whitespace-pre-wrap break-all',
                    probe.state === 'ok'
                      ? 'bg-emerald-50 text-emerald-700'
                      : probe.state === 'fail'
                        ? 'bg-red-50 text-red-700'
                        : 'bg-neutral-50 text-neutral-500',
                  )}
                >
                  {probe.text}
                </pre>
              )}
            </Card>
          </>
        )}

        {active === 'about' && (
          <>
            <UpdateCard />

            <Card id="settings-diagnostics">
              <SectionTitle>可视化检测</SectionTitle>
              <p className="text-[12px] leading-relaxed text-neutral-500">
                逐项检查运行环境、接口连通、本地数据与每个页面的渲染完整性，并给出手机 / 平板 / 桌面三档布局预览。
                电脑与手机分别打开同一地址即可对比结果。
              </p>
              <a
                href="./diagnostics.html"
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 px-3 py-1.5 text-[12.5px] text-neutral-700 hover:border-neutral-400"
              >
                打开可视化检测页 ↗
              </a>
            </Card>

            <Card id="settings-about">
              <SectionTitle>关于</SectionTitle>
              <p className="text-[12px] leading-relaxed text-neutral-500">
                {isLocalFirst()
                  ? '手机端核心数据存在本机 IndexedDB，离线完整可用；主题、提醒、导航顺序等设置也保存在本机。习惯、专注、纪念日、信息源与附件需联网时可用。'
                  : '数据保存在本机 PGlite 数据库，附件存于 apps/server/data/attachments。'}
                团队协作、第三方日历 OAuth、微信/邮件推送需要云账号，暂未接入；.ics 订阅已可替代日历只读同步。
              </p>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
