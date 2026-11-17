import { useEffect, useMemo, useRef } from 'react';
import { useAnniversaries, useLists, useTasks } from '../hooks/useDdl';
import { api } from '../lib/api';
import {
  findInboxListId,
  isNativeWidget,
  syncNativeWidget,
  takeWidgetCompleted,
} from '../lib/widget';

/**
 * 手机端小组件的「数据泵」：只在 Capacitor（Android）里挂载。
 *
 * 两件事：
 * 1. 任务/纪念日一变（含同步完成后的 invalidate）就把快照推给原生，
 *    快照里带着「今天 / 收件箱 / 最近 7 天 / 四象限」四种视图的数据；
 * 2. 把用户在桌面上点掉的任务真正写成完成 —— 原生改不了 IndexedDB，
 *    只能在 SharedPreferences 里排队，回到 App 时才由这里回冲。
 */
export function WidgetSync() {
  const tasksQuery = useTasks(
    useMemo(() => ({ status: 'pending' as const, kind: 'task' as const, limit: 300 }), []),
  );
  const listsQuery = useLists();
  const anniversariesQuery = useAnniversaries();

  const tasks = tasksQuery.data;
  const anniversaries = anniversariesQuery.data;
  const inboxListId = useMemo(() => findInboxListId(listsQuery.data), [listsQuery.data]);

  useEffect(() => {
    if (!tasks || !anniversaries) return;
    void syncNativeWidget(tasks, anniversaries, { inboxListId });
  }, [tasks, anniversaries, inboxListId]);

  // 回冲「桌面上点掉的任务」：只做一次，避免和推快照抢同一条记录
  const flushing = useRef(false);
  const refetchTasks = tasksQuery.refetch;
  const flushCompleted = useMemo(
    () => async () => {
      if (!isNativeWidget() || flushing.current) return;
      flushing.current = true;
      try {
        const ids = await takeWidgetCompleted();
        if (ids.length === 0) return;
        for (const id of ids) {
          try {
            await api.updateTask(id, { status: 'completed' });
          } catch {
            // 任务可能已被删除或已在别处完成，跳过即可
          }
        }
        await refetchTasks();
      } finally {
        flushing.current = false;
      }
    },
    [refetchTasks],
  );

  // 冷启动 + 回到前台：两个时机都要试一次，后台放几小时可能攒了好几条
  const refetchAnniversaries = anniversariesQuery.refetch;
  useEffect(() => {
    void flushCompleted();
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void flushCompleted();
        void refetchTasks();
        void refetchAnniversaries();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [flushCompleted, refetchTasks, refetchAnniversaries]);

  return null;
}
