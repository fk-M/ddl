import type { SyncPushInput, SyncSnapshot, SyncRow } from '@ddl/shared';
import {
  deleteRows,
  getAll,
  getMeta,
  putRows,
  replaceStore,
  setMeta,
  SYNC_STORES,
  type LocalRow,
  type SyncStore,
} from './local-db';
import { getServerUrl, isLocalFirst } from './server-url';

/** 同步完成、本地数据已变化时广播，供 QueryClient 失效缓存 */
export const SYNC_DATA_EVENT = 'ddl:synced';

export type SyncState = 'idle' | 'syncing' | 'ok' | 'offline';
export type SyncStatus = {
  state: SyncState;
  reach: boolean;
  lastSyncAt: string | null;
  message: string;
};

let status: SyncStatus = {
  state: 'idle',
  reach: false,
  lastSyncAt: null,
  message: '尚未同步',
};
const listeners = new Set<(next: SyncStatus) => void>();

export function getSyncStatus(): SyncStatus {
  return status;
}

export function subscribeSync(listener: (next: SyncStatus) => void): () => void {
  listeners.add(listener);
  listener(status);
  return () => {
    listeners.delete(listener);
  };
}

function setStatus(patch: Partial<SyncStatus>): void {
  status = { ...status, ...patch };
  for (const listener of listeners) listener(status);
}

function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

async function jsonFetch(url: string, init?: RequestInit, timeout = 10_000): Promise<unknown> {
  const response = await fetch(url, { ...init, signal: timeoutSignal(timeout) });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status} ${text.slice(0, 120)}`);
  return text ? JSON.parse(text) : null;
}

function stripMeta(row: LocalRow): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row };
  delete out._dirty;
  return out;
}

/**
 * 按 updatedAt 做 LWW 合并：
 * - 服务端版本更新（或相同）→ 用服务端版本并清掉 dirty；
 * - 本地 dirty 且更新更晚 → 保留本地（push 被服务端拒绝时的兜底）；
 * - 只存在于本地且非 dirty → 视为服务端已物理删除，丢弃。
 */
async function mergeStore(store: SyncStore, serverRows: SyncRow[]): Promise<void> {
  const localRows = await getAll<LocalRow>(store);
  const remaining = new Map(localRows.map((row) => [row.id, row]));
  const merged: LocalRow[] = [];
  for (const raw of serverRows ?? []) {
    const server = raw as unknown as LocalRow;
    const mine = remaining.get(server.id);
    if (mine && mine._dirty && String(mine.updatedAt) > String(server.updatedAt)) {
      merged.push(mine);
    } else {
      merged.push({ ...server, _dirty: false });
    }
    remaining.delete(server.id);
  }
  for (const row of remaining.values()) {
    if (row._dirty) merged.push(row);
  }
  await replaceStore(store, merged);
}

/**
 * 服务端看起来是「全新空库」：没有任务、标签、分组，也没有自定义清单，
 * 只剩一个默认收件箱。常见于电脑端重装、换了数据库目录或数据被重置。
 * 这种状态下照常做全量 merge，会把手机端**已经同步过**的数据当成
 * 「服务端已物理删除」而清空（见 mergeStore 的 remaining 循环）。
 */
function isVirginSnapshot(snapshot: SyncSnapshot): boolean {
  return (
    (snapshot.tasks?.length ?? 0) === 0 &&
    (snapshot.tags?.length ?? 0) === 0 &&
    (snapshot.listGroups?.length ?? 0) === 0 &&
    (snapshot.lists ?? []).filter((row) => row.isInbox !== true).length === 0
  );
}

/** 把本地全部行标记为待推送，让空服务端被回填，而不是反过来清空手机 */
async function markAllLocalDirty(): Promise<number> {
  let count = 0;
  for (const store of SYNC_STORES) {
    const rows = await getAll<LocalRow>(store);
    if (rows.length === 0) continue;
    await putRows(store, rows.map((row) => ({ ...row, _dirty: true })));
    count += rows.length;
  }
  return count;
}

/**
 * 手机完全离线首次启动时会自建一个「收件箱」，它的 id 与电脑端不同。
 * 直接推送会撞上 lists 的 is_inbox 唯一索引，因此先拉一次快照，
 * 把本地任务改挂到服务端收件箱，再丢弃本地那份草稿收件箱。
 */
async function alignInbox(serverLists: SyncRow[]): Promise<void> {
  const serverInbox = serverLists.find((row) => row.isInbox === true);
  if (!serverInbox) return;
  const localLists = await getAll<LocalRow>('lists');
  const draft = localLists.find((row) => Boolean(row.isInbox) && row.id !== serverInbox.id);
  if (!draft) return;
  const tasks = await getAll<LocalRow>('tasks');
  const moved = tasks
    .filter((row) => row.listId === draft.id)
    .map((row) => ({
      ...row,
      listId: serverInbox.id,
      updatedAt: new Date().toISOString(),
      _dirty: true,
    }));
  if (moved.length > 0) await putRows('tasks', moved);
  await deleteRows('lists', [draft.id]);
}

let inFlight: Promise<SyncStatus> | null = null;

export function syncNow(): Promise<SyncStatus> {
  if (!isLocalFirst()) return Promise.resolve(status);
  if (inFlight) return inFlight;
  inFlight = doSync().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function doSync(): Promise<SyncStatus> {
  setStatus({ state: 'syncing', message: '正在探测电脑服务…' });
  try {
    const base = getServerUrl();
    await jsonFetch(`${base}/health`, undefined, 2500);
    setStatus({ reach: true, message: '已连上电脑，正在对齐…' });

    // 先取一次快照用于收件箱对齐（见 alignInbox），再推送，最后再拉一次做合并
    const warmup = (await jsonFetch(`${base}/api/sync/pull`, undefined, 15_000)) as {
      data: SyncSnapshot;
    };
    await alignInbox(warmup.data.lists);
    // 空库保护必须在 alignInbox 之后：草稿收件箱已被删掉、任务已改挂服务端 inbox id，
    // 此时全量回填才不会撞 is_inbox 唯一索引或挂到不存在的清单上。
    if (isVirginSnapshot(warmup.data)) {
      const restored = await markAllLocalDirty();
      if (restored > 0) {
        setStatus({ reach: true, message: `电脑端是空库，正在回填本机 ${restored} 条数据…` });
      }
    } else {
      setStatus({ message: '已连上电脑，正在同步…' });
    }

    const payload: SyncPushInput = {
      listGroups: [],
      lists: [],
      tags: [],
      tasks: [],
      purgedIds: (await getMeta<string[]>('purgedIds')) ?? [],
    };
    for (const store of SYNC_STORES) {
      const rows = await getAll<LocalRow>(store);
      payload[store] = rows.filter((row) => row._dirty).map(stripMeta);
    }
    const hasChanges =
      SYNC_STORES.some((store) => payload[store].length > 0) || payload.purgedIds.length > 0;
    if (hasChanges) {
      await jsonFetch(
        `${base}/api/sync/push`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
        15_000,
      );
    }

    const pulled = (await jsonFetch(`${base}/api/sync/pull`, undefined, 15_000)) as {
      data: SyncSnapshot;
    };
    for (const store of SYNC_STORES) {
      await mergeStore(store, pulled.data[store] as SyncRow[]);
    }

    await setMeta('purgedIds', []);
    const stamp = new Date().toISOString();
    await setMeta('lastSyncAt', stamp);
    setStatus({ state: 'ok', reach: true, lastSyncAt: stamp, message: '已与电脑同步' });
    window.dispatchEvent(new Event(SYNC_DATA_EVENT));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    setStatus({ state: 'offline', reach: false, message: `离线使用中（${detail}）` });
  }
  return status;
}

let debounce: ReturnType<typeof setTimeout> | null = null;

/** 本地写操作后延迟触发，连续输入不会打出一串同步请求 */
export function scheduleSync(delay = 1500): void {
  if (!isLocalFirst()) return;
  if (debounce) clearTimeout(debounce);
  debounce = setTimeout(() => {
    debounce = null;
    void syncNow();
  }, delay);
}

/** 只在 Capacitor 手机端启动；桌面端直连内嵌服务，无需同步 */
export function startSyncEngine(): () => void {
  if (!isLocalFirst()) return () => undefined;
  void getMeta<string>('lastSyncAt').then((value) => {
    if (value) setStatus({ lastSyncAt: value });
  });
  void syncNow();
  const timer = setInterval(() => void syncNow(), 20_000);
  const onOnline = () => void syncNow();
  const onVisible = () => {
    if (document.visibilityState === 'visible') void syncNow();
  };
  window.addEventListener('online', onOnline);
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    clearInterval(timer);
    window.removeEventListener('online', onOnline);
    document.removeEventListener('visibilitychange', onVisible);
  };
}
