/** 手机端离线本地库：IndexedDB 存同步记录（与服务端 SyncRow 同形） */
export const SYNC_STORES = [
  'listGroups',
  'lists',
  'tags',
  'tasks',
  'habits',
  'habitLogs',
  'anniversaries',
] as const;
export type SyncStore = (typeof SYNC_STORES)[number];

export type LocalRow = {
  id: string;
  updatedAt: string;
  /** 本地产生、尚未同步到服务端的变更 */
  _dirty?: boolean;
  [key: string]: unknown;
};

/**
 * 不参与同步协议的本地表。
 * 信息源与候选池只跟「这台设备抓了什么」有关，不跟账号走；
 * 手机端自己抓取时全离线可用，因此单独存放、不并入 SYNC_STORES。
 */
export const EXTRA_STORES = ['sources', 'candidates'] as const;
export type ExtraStore = (typeof EXTRA_STORES)[number];
export type AnyStore = SyncStore | ExtraStore;

/**
 * 附件单独存放，不参与同步协议：
 * 服务端附件是二进制文件 + 文件系统路径，无法像结构化行一样 LWW 合并；
 * 手机端离线也要能查看，所以直接把 Blob 存进 IndexedDB。
 */
export const ATTACHMENT_STORE = 'attachments' as const;

export type LocalAttachmentRow = {
  id: string;
  taskId: string;
  name: string;
  mime: string;
  size: number;
  /** 文件正文，IndexedDB 原生支持 Blob，无需 base64 */
  blob: Blob;
  createdAt: string;
};

const DB_NAME = 'ddl-local';
/**
 * v3：新增 habits / habitLogs / anniversaries 三个同步 store（习惯与纪念日本地化）
 * v4：新增 sources / candidates（手机端自己抓信息源，不再依赖电脑）
 */
const DB_VERSION = 4;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const store of SYNC_STORES) {
        if (!db.objectStoreNames.contains(store)) {
          db.createObjectStore(store, { keyPath: 'id' });
        }
      }
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      // 老用户从 v1 升上来时只补建这一张表，同步数据原样保留
      if (!db.objectStoreNames.contains(ATTACHMENT_STORE)) {
        const attachments = db.createObjectStore(ATTACHMENT_STORE, { keyPath: 'id' });
        attachments.createIndex('taskId', 'taskId', { unique: false });
      }
      // v4：信息源与候选池（不进同步协议，纯本机数据）
      for (const store of EXTRA_STORES) {
        if (!db.objectStoreNames.contains(store)) {
          db.createObjectStore(store, { keyPath: 'id' });
        }
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      // 另一个标签页/新版本要升级数据库时主动让位，否则升级会一直 blocked，
      // 表现为所有本地查询永远停在「加载中」（多开标签页时最容易踩到）
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      // 清掉缓存的连接，让下一次调用重新尝试（对方关闭后会成功升级）
      dbPromise = null;
      reject(new Error('本地数据库被其他标签页占用，请关闭多余页面后重试'));
    };
  });
  return dbPromise;
}

export async function getAll<T = LocalRow>(store: AnyStore): Promise<T[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const request = tx.objectStore(store).getAll() as IDBRequest<T[]>;
    request.onsuccess = () => resolve(request.result ?? []);
    request.onerror = () => reject(request.error);
  });
}

export async function getRow<T = LocalRow>(store: AnyStore, id: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const request = tx.objectStore(store).get(id) as IDBRequest<T | undefined>;
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function putRows(store: AnyStore, rows: LocalRow[]): Promise<void> {
  if (rows.length === 0) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const objectStore = tx.objectStore(store);
    for (const row of rows) objectStore.put(row);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function deleteRows(store: AnyStore, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const objectStore = tx.objectStore(store);
    for (const id of ids) objectStore.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('meta', 'readonly');
    const request = tx.objectStore('meta').get(key) as IDBRequest<T | undefined>;
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('meta', 'readwrite');
    tx.objectStore('meta').put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** 首次启动且本地为空时，用服务端快照做种子；也用于同步合并后的整表覆盖 */
export async function replaceStore(store: SyncStore, rows: LocalRow[]): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const objectStore = tx.objectStore(store);
    objectStore.clear();
    for (const row of rows) objectStore.put(row);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/* --------------------------- 附件：本地 Blob 存储 --------------------------- */

export async function listAttachmentsByTask(taskId: string): Promise<LocalAttachmentRow[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ATTACHMENT_STORE, 'readonly');
    const request = tx
      .objectStore(ATTACHMENT_STORE)
      .index('taskId')
      .getAll(taskId) as IDBRequest<LocalAttachmentRow[]>;
    request.onsuccess = () => resolve(request.result ?? []);
    request.onerror = () => reject(request.error);
  });
}

export async function getAttachmentRow(id: string): Promise<LocalAttachmentRow | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ATTACHMENT_STORE, 'readonly');
    const request = tx.objectStore(ATTACHMENT_STORE).get(id) as IDBRequest<
      LocalAttachmentRow | undefined
    >;
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function putAttachmentRow(row: LocalAttachmentRow): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(ATTACHMENT_STORE, 'readwrite');
    tx.objectStore(ATTACHMENT_STORE).put(row);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function deleteAttachmentRow(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(ATTACHMENT_STORE, 'readwrite');
    tx.objectStore(ATTACHMENT_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** 删除任务时一并清理附件，避免 Blob 长期占用存储 */
export async function deleteAttachmentsByTask(taskId: string): Promise<void> {
  const rows = await listAttachmentsByTask(taskId);
  if (rows.length === 0) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(ATTACHMENT_STORE, 'readwrite');
    const objectStore = tx.objectStore(ATTACHMENT_STORE);
    for (const row of rows) objectStore.delete(row.id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
