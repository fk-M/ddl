import { useEffect, useMemo } from 'react';
import { useAnniversaries, useTasks } from '../hooks/useDdl';
import { endOfTodayIso } from '../lib/datetime';
import { isNativeWidget, syncNativeWidget } from '../lib/widget';

/**
 * 手机端小组件的「数据泵」：只在 Capacitor 里挂载。
 * 今日任务或纪念日一变（含同步完成后的 invalidate）就把快照推给原生，
 * 让桌面上的小组件尽量贴近真实数据——App 没开时它显示的是最后一次快照。
 */
export function WidgetSync() {
  const todayFilter = useMemo(() => ({ dueTo: endOfTodayIso(), limit: 100 }), []);
  const tasksQuery = useTasks(todayFilter);
  const anniversariesQuery = useAnniversaries();

  const tasks = tasksQuery.data;
  const anniversaries = anniversariesQuery.data;

  useEffect(() => {
    if (!tasks || !anniversaries) return;
    void syncNativeWidget(tasks, anniversaries);
  }, [tasks, anniversaries]);

  // 回到前台时重新取一次：放在后台几小时后，"今天"的边界可能已经变了
  const refetchTasks = tasksQuery.refetch;
  const refetchAnniversaries = anniversariesQuery.refetch;
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void refetchTasks();
        void refetchAnniversaries();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refetchTasks, refetchAnniversaries]);

  return null;
}
