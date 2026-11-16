import type { AppSettings, Task } from '@ddl/shared';
import clsx from 'clsx';
import { Coffee, Pause, Play, RotateCcw, SkipForward, Square, Volume2, VolumeX } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCreateFocusSession, useFocusStats, useTasks } from '../hooks/useDdl';
import { visibleError } from '../lib/api';
import { NOISE_KINDS, playCompletionSound, startNoise, stopNoise, type NoiseKind } from '../lib/sound';
import { Button, Card, EmptyState, ErrorBar, MiniBars, SectionTitle, Stat, inputClass } from './ui';

type Phase = 'focus' | 'shortBreak' | 'longBreak';

const PHASE_LABEL: Record<Phase, string> = {
  focus: '专注',
  shortBreak: '短休息',
  longBreak: '长休息',
};

function fmt(seconds: number): string {
  const safe = Math.max(0, seconds);
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function fmtDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} 秒`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (hours > 0) return `${hours} 小时 ${minutes} 分`;
  return `${minutes} 分钟`;
}

export function FocusView({ settings }: { settings: AppSettings }) {
  const statsQuery = useFocusStats();
  const statsError = visibleError(statsQuery.error);
  const tasksQuery = useTasks({ status: 'pending', limit: 100 });
  const { create } = useCreateFocusSession();

  const [phase, setPhase] = useState<Phase>('focus');
  const [running, setRunning] = useState(false);
  const [remaining, setRemaining] = useState(settings.pomodoroMinutes * 60);
  const [round, setRound] = useState(0);
  const [taskId, setTaskId] = useState<string>('');
  const [noise, setNoise] = useState<NoiseKind>(settings.whiteNoise as NoiseKind);
  const [muted, setMuted] = useState(false);

  const startedAtRef = useRef<Date | null>(null);
  const plannedRef = useRef(settings.pomodoroMinutes * 60);

  const tasks = useMemo(() => tasksQuery.data ?? [], [tasksQuery.data]);
  const activeTask: Task | undefined = tasks.find((item) => item.id === taskId);

  const plannedSeconds = useMemo(() => {
    if (phase === 'focus') return settings.pomodoroMinutes * 60;
    if (phase === 'shortBreak') return settings.shortBreakMinutes * 60;
    return settings.longBreakMinutes * 60;
  }, [phase, settings.pomodoroMinutes, settings.shortBreakMinutes, settings.longBreakMinutes]);

  /** 切换阶段时重置计时 */
  const resetPhase = useCallback(
    (next: Phase) => {
      setPhase(next);
      setRunning(false);
      const seconds =
        next === 'focus'
          ? settings.pomodoroMinutes * 60
          : next === 'shortBreak'
            ? settings.shortBreakMinutes * 60
            : settings.longBreakMinutes * 60;
      setRemaining(seconds);
      plannedRef.current = seconds;
      startedAtRef.current = null;
    },
    [settings.pomodoroMinutes, settings.shortBreakMinutes, settings.longBreakMinutes],
  );

  // 设置里的时长变化时，如果没在跑就同步显示
  useEffect(() => {
    if (running) return;
    setRemaining(plannedSeconds);
    plannedRef.current = plannedSeconds;
  }, [plannedSeconds, running]);

  const persist = useCallback(
    (completed: boolean, actualSeconds: number) => {
      const started = startedAtRef.current;
      if (!started || actualSeconds < 10) return;
      create.mutate({
        taskId: taskId || null,
        taskTitle: activeTask?.title ?? null,
        type: phase,
        plannedSeconds: plannedRef.current,
        actualSeconds,
        startedAt: started.toISOString(),
        endedAt: new Date().toISOString(),
        completed,
      });
    },
    [activeTask?.title, create, phase, taskId],
  );

  /** 计时归零 */
  const handleFinish = useCallback(() => {
    setRunning(false);
    const planned = plannedRef.current;
    persist(true, planned);

    if (!muted) playCompletionSound(settings.completionSound, settings.remindVolume);

    if (phase === 'focus') {
      const nextRound = round + 1;
      setRound(nextRound);
      const isLong = nextRound % Math.max(1, settings.longBreakInterval) === 0;
      const next: Phase = isLong ? 'longBreak' : 'shortBreak';
      resetPhase(next);
      if (settings.autoStartBreak) {
        startedAtRef.current = new Date();
        setRunning(true);
      }
    } else {
      resetPhase('focus');
      if (settings.autoStartNext) {
        startedAtRef.current = new Date();
        setRunning(true);
      }
    }
  }, [muted, persist, phase, resetPhase, round, settings]);

  // 主计时循环
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          window.clearInterval(timer);
          handleFinish();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [running, handleFinish]);

  // 白噪音随开关与设置联动
  useEffect(() => {
    if (!running || phase !== 'focus' || noise === 'none') {
      stopNoise();
      return;
    }
    startNoise(noise, Math.min(settings.remindVolume, 50));
    return () => stopNoise();
  }, [running, phase, noise, settings.remindVolume]);

  function toggleRun() {
    if (!running) {
      if (!startedAtRef.current) startedAtRef.current = new Date();
      setRunning(true);
      return;
    }
    setRunning(false);
  }

  function abandon() {
    const actual = plannedRef.current - remaining;
    setRunning(false);
    persist(false, actual);
    stopNoise();
    resetPhase('focus');
    setRound(0);
  }

  const stats = statsQuery.data;
  const progress = plannedSeconds > 0 ? 1 - remaining / plannedSeconds : 0;
  const dailyBars = (stats?.daily ?? []).map((item) => ({
    label: item.date.slice(5),
    value: Math.round(item.seconds / 60),
  }));

  const goalProgress =
    settings.dailyFocusGoalMinutes > 0
      ? Math.min(1, Math.round((stats?.todaySeconds ?? 0) / 60) / settings.dailyFocusGoalMinutes)
      : 0;

  return (
    <div className="mx-auto w-full max-w-3xl md:max-w-4xl xl:max-w-3xl">
      {statsError && (
        <div className="mb-3">
          <ErrorBar message={statsError.message} />
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        {/* 计时器 */}
        <Card className="flex flex-col items-center">
          <div className="relative flex size-[210px] items-center justify-center">
            <svg viewBox="0 0 100 100" className="absolute inset-0 -rotate-90">
              <circle cx="50" cy="50" r="45" fill="none" stroke="rgba(148,148,160,0.16)" strokeWidth="5" />
              <circle
                cx="50"
                cy="50"
                r="45"
                fill="none"
                stroke="var(--accent)"
                strokeWidth="5"
                strokeLinecap="round"
                strokeDasharray={`${2 * Math.PI * 45}`}
                strokeDashoffset={`${2 * Math.PI * 45 * (1 - progress)}`}
                style={{ transition: 'stroke-dashoffset 0.6s linear' }}
              />
            </svg>
            <div className="z-10 text-center">
              <p className="text-[11px] tracking-wide text-neutral-400">{PHASE_LABEL[phase]}</p>
              <p className="mt-1 text-[38px] leading-none font-semibold tabular-nums text-neutral-900">
                {fmt(remaining)}
              </p>
              <p className="mt-1.5 text-[11px] text-neutral-400">第 {round + 1} 个番茄</p>
            </div>
          </div>

          <div className="mt-4 flex items-center gap-2">
            <Button variant="primary" onClick={toggleRun} className="h-10 px-5">
              {running ? <Pause className="size-4" /> : <Play className="size-4" />}
              {running ? '暂停' : '开始'}
            </Button>
            <Button variant="ghost" onClick={abandon} title="放弃当前番茄">
              <Square className="size-3.5" />
              放弃
            </Button>
            <Button
              variant="ghost"
              title="跳到下一阶段"
              onClick={() => {
                persist(false, plannedRef.current - remaining);
                resetPhase(phase === 'focus' ? 'shortBreak' : 'focus');
              }}
            >
              <SkipForward className="size-3.5" />
            </Button>
            <Button variant="ghost" title="重置" onClick={() => resetPhase(phase)}>
              <RotateCcw className="size-3.5" />
            </Button>
          </div>

          <div className="mt-4 w-full space-y-2">
            <label className="block">
              <span className="mb-1 block text-[11px] text-neutral-400">关联任务</span>
              <select
                value={taskId}
                onChange={(event) => setTaskId(event.target.value)}
                className={inputClass}
              >
                <option value="">不关联</option>
                {tasks.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.title}
                  </option>
                ))}
              </select>
            </label>

            <div className="flex items-center gap-2">
              <span className="text-[11px] text-neutral-400">背景音</span>
              <select
                value={noise}
                onChange={(event) => setNoise(event.target.value as NoiseKind)}
                className="h-8 flex-1 rounded-lg border border-neutral-200 bg-white px-2 text-[12px] outline-none"
              >
                {NOISE_KINDS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setMuted((prev) => !prev)}
                className="rounded p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                title={muted ? '开启提示音' : '静音'}
              >
                {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
              </button>
            </div>
          </div>
        </Card>

        {/* 统计 */}
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2.5">
            <Stat label="今日专注" value={Math.round((stats?.todaySeconds ?? 0) / 60)} unit="分钟" />
            <Stat label="今日番茄" value={stats?.todayCount ?? 0} unit="个" />
            <Stat label="本周专注" value={Math.round((stats?.weekSeconds ?? 0) / 60)} unit="分钟" />
            <Stat label="累计天数" value={stats?.focusDays ?? 0} unit="天" />
          </div>

          <Card>
            <SectionTitle>近 14 天（分钟）</SectionTitle>
            {dailyBars.length === 0 ? (
              <p className="py-6 text-center text-[12px] text-neutral-400">还没有专注记录</p>
            ) : (
              <MiniBars data={dailyBars} color="var(--accent)" height={64} />
            )}
          </Card>

          <Card>
            <SectionTitle>今日目标</SectionTitle>
            <div className="flex items-baseline justify-between">
              <p className="text-[13px] text-neutral-700">
                {Math.round((stats?.todaySeconds ?? 0) / 60)} / {settings.dailyFocusGoalMinutes} 分钟
              </p>
              <p className="text-[12px] tabular-nums text-neutral-400">
                {Math.round(goalProgress * 100)}%
              </p>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-neutral-100">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${goalProgress * 100}%`, backgroundColor: 'var(--accent)' }}
              />
            </div>
          </Card>

          <Card>
            <SectionTitle>专注最多的任务</SectionTitle>
            {(stats?.topTasks ?? []).length === 0 ? (
              <p className="py-4 text-center text-[12px] text-neutral-400">还没有关联任务的专注</p>
            ) : (
              <ul className="space-y-1.5">
                {(stats?.topTasks ?? []).map((item) => (
                  <li key={`${item.taskId ?? item.title}`} className="flex items-center justify-between gap-3">
                    <span className="truncate text-[12.5px] text-neutral-700">{item.title}</span>
                    <span className="shrink-0 text-[11.5px] tabular-nums text-neutral-400">
                      {fmtDuration(item.seconds)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {phase !== 'focus' && (
            <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12.5px] text-emerald-700">
              <Coffee className="size-3.5" />
              休息一下，等会儿再战
            </div>
          )}

          {statsQuery.isLoading && <p className="text-center text-[12px] text-neutral-400">加载统计…</p>}
          {(stats?.totalCount ?? 0) === 0 && !statsQuery.isLoading && (
            <EmptyState title="还没有专注记录" hint="点开始，完成你的第一个番茄" />
          )}
        </div>
      </div>
    </div>
  );
}
