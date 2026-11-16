import type {
  BatchTaskInput,
  CreateTaskInput,
  Task,
  TaskQuery,
  TaskReminderInput,
  TaskStatus,
  UpdateTaskInput,
} from '@ddl/shared';
import { BadRequestError, NotFoundError } from '../../lib/errors';
import { isValidRrule, nextOccurrence } from '../../lib/recurrence';
import type { ListsRepo } from '../lists/lists.repo';
import { toTaskDto, type TasksRepo } from './tasks.repo';

function assertRruleValid(rrule: string | null | undefined): void {
  if (rrule === null || rrule === undefined || rrule === '') return;
  if (!isValidRrule(rrule)) {
    throw new BadRequestError('重复规则格式不合法', { rrule });
  }
}

export function createTasksService(tasksRepo: TasksRepo, listsRepo: ListsRepo) {
  async function resolveListId(listId: string | undefined | null): Promise<string> {
    if (listId) {
      const list = await listsRepo.findById(listId);
      if (!list) throw new NotFoundError('指定的清单不存在');
      return list.id;
    }
    const inbox = await listsRepo.findInbox();
    if (!inbox) throw new NotFoundError('收件箱不存在，请先执行数据库迁移');
    return inbox.id;
  }

  async function requireTask(id: string) {
    const row = await tasksRepo.findById(id);
    if (!row) throw new NotFoundError('任务不存在');
    return row;
  }

  /** 只支持两层：父任务必须是顶层任务，且不能指向自己 */
  async function assertParentValid(parentId: string | null | undefined, selfId?: string): Promise<void> {
    if (parentId === null || parentId === undefined) return;
    if (selfId && parentId === selfId) throw new BadRequestError('任务不能挂在自己下面');
    const parent = await tasksRepo.findById(parentId);
    if (!parent) throw new NotFoundError('父任务不存在');
    if (parent.parentId) throw new BadRequestError('子任务下不能再建子任务');
  }

  /** 给一批任务补上提醒 / 附件 / 子任务统计 */
  async function hydrate(rows: Awaited<ReturnType<TasksRepo['findMany']>>): Promise<Task[]> {
    const ids = rows.map((row) => row.id);
    const [childStats, reminders, attachmentMap] = await Promise.all([
      tasksRepo.childStats(ids),
      tasksRepo.remindersFor(ids),
      tasksRepo.attachmentsFor(ids),
    ]);
    return rows.map((row) => {
      const stats = childStats.get(row.id);
      return toTaskDto(row, {
        reminders: reminders.get(row.id) ?? [],
        attachments: attachmentMap.get(row.id) ?? [],
        childCount: stats?.total ?? 0,
        childDoneCount: stats?.done ?? 0,
      });
    });
  }

  return {
    async list(query: TaskQuery): Promise<Task[]> {
      const rows = await tasksRepo.findMany(query);
      return hydrate(rows);
    },

    async counts(): Promise<Record<string, number>> {
      const map = await tasksRepo.countsByList();
      return Object.fromEntries(map);
    },

    async get(id: string): Promise<Task> {
      const row = await requireTask(id);
      return (await hydrate([row]))[0]!;
    },

    async children(id: string): Promise<Task[]> {
      await requireTask(id);
      return hydrate(await tasksRepo.findChildren(id));
    },

    async create(input: CreateTaskInput): Promise<Task> {
      assertRruleValid(input.rrule);
      await assertParentValid(input.parentId);
      const listId = await resolveListId(input.listId);
      const row = await tasksRepo.insert(input, listId);
      if (input.reminders && input.reminders.length > 0) {
        await tasksRepo.addReminders(row.id, input.reminders);
      }
      return (await hydrate([row]))[0]!;
    },

    async update(id: string, patch: UpdateTaskInput): Promise<Task> {
      const existing = await requireTask(id);
      assertRruleValid(patch.rrule);
      await assertParentValid(patch.parentId, id);
      if (patch.listId !== undefined) await resolveListId(patch.listId);

      const nextPatch: UpdateTaskInput = { ...patch };

      // 改重复任务的范围：本次 / 本次及以后 / 全部
      // 'this' 把当前实例从系列中摘出来（清空 rrule），避免影响后续实例
      if (existing.rrule) {
        if (patch.scope === 'this') nextPatch.rrule = null;
        else if (patch.scope === 'all' || patch.scope === 'future') {
          // 系列规则随本实例一起更新，后续派生实例会自动继承
        }
      }
      delete nextPatch.scope;
      delete nextPatch.reminders;

      const row = await tasksRepo.update(id, nextPatch);
      if (!row) throw new NotFoundError('任务不存在');

      if (patch.reminders !== undefined) {
        await tasksRepo.replaceReminders(id, patch.reminders);
      }

      return (await hydrate([row]))[0]!;
    },

    async toggle(id: string): Promise<{ task: Task; spawned: Task | null; undo: string }> {
      const existing = await requireTask(id);
      const nextStatus: TaskStatus = existing.status === 'completed' ? 'pending' : 'completed';
      const row = await tasksRepo.update(id, { status: nextStatus });
      if (!row) throw new NotFoundError('任务不存在');

      let spawned: Task | null = null;

      if (nextStatus === 'completed' && existing.rrule) {
        // 到期重复：以原到期日为基准；完成重复：以本次完成时刻为基准
        const anchor =
          existing.repeatFrom === 'completion'
            ? new Date()
            : (existing.dueAt ?? new Date());
        const nextDue = nextOccurrence(existing.rrule, anchor);
        if (nextDue) {
          const created = await tasksRepo.spawnNextOccurrence(existing, nextDue);
          spawned = (await hydrate([created]))[0]!;
        }
      }

      return {
        task: (await hydrate([row]))[0]!,
        spawned,
        undo: nextStatus === 'completed' ? 'completed' : 'uncompleted',
      };
    },

    async remove(id: string): Promise<void> {
      const removed = await tasksRepo.softDelete(id);
      if (!removed) throw new NotFoundError('任务不存在');
    },

    async restore(id: string): Promise<void> {
      const ok = await tasksRepo.restore(id);
      if (!ok) throw new NotFoundError('任务不存在');
    },

    async purge(id: string): Promise<void> {
      const ok = await tasksRepo.purge(id);
      if (!ok) throw new NotFoundError('任务不存在');
    },

    async emptyTrash(): Promise<number> {
      return tasksRepo.emptyTrash();
    },

    async batch(input: BatchTaskInput): Promise<{ affected: number }> {
      const { ids, action, payload } = input;
      const now = new Date();

      switch (action) {
        case 'complete':
        case 'uncomplete': {
          const affected = await tasksRepo.batchUpdate(ids, {
            status: action === 'complete' ? 'completed' : 'pending',
            completedAt: action === 'complete' ? now : null,
          });
          return { affected };
        }
        case 'delete': {
          let affected = 0;
          for (const id of ids) {
            if (await tasksRepo.softDelete(id)) affected += 1;
          }
          return { affected };
        }
        case 'restore': {
          let affected = 0;
          for (const id of ids) {
            if (await tasksRepo.restore(id)) affected += 1;
          }
          return { affected };
        }
        case 'purge': {
          let affected = 0;
          for (const id of ids) {
            if (await tasksRepo.purge(id)) affected += 1;
          }
          return { affected };
        }
        case 'move': {
          if (!payload?.listId) throw new BadRequestError('移动任务需要指定目标清单');
          await resolveListId(payload.listId);
          return { affected: await tasksRepo.batchUpdate(ids, { listId: payload.listId }) };
        }
        case 'setDue': {
          const dueAt = payload?.dueAt ? new Date(payload.dueAt) : null;
          return { affected: await tasksRepo.batchUpdate(ids, { dueAt }) };
        }
        case 'setPriority': {
          if (payload?.priority === undefined) throw new BadRequestError('需要指定优先级');
          return { affected: await tasksRepo.batchUpdate(ids, { priority: payload.priority }) };
        }
        case 'setImportant': {
          if (payload?.isImportant === undefined) throw new BadRequestError('需要指定重要标记');
          return { affected: await tasksRepo.batchUpdate(ids, { isImportant: payload.isImportant }) };
        }
        case 'setUrgent': {
          if (payload?.isUrgent === undefined) throw new BadRequestError('需要指定紧急标记');
          return { affected: await tasksRepo.batchUpdate(ids, { isUrgent: payload.isUrgent }) };
        }
        case 'pin':
        case 'unpin': {
          return { affected: await tasksRepo.batchUpdate(ids, { pinned: action === 'pin' }) };
        }
        case 'addTags':
        case 'removeTags': {
          let affected = 0;
          for (const id of ids) {
            const row = await tasksRepo.findById(id);
            if (!row) continue;
            const current = new Set(row.tags ?? []);
            for (const tag of payload?.tags ?? []) {
              if (action === 'addTags') current.add(tag);
              else current.delete(tag);
            }
            await tasksRepo.update(id, { tags: [...current] });
            affected += 1;
          }
          return { affected };
        }
        default:
          throw new BadRequestError(`不支持的批量操作：${action}`);
      }
    },

    /** 设置四象限（批量拖位用） */
    async setQuadrant(id: string, important: boolean, urgent: boolean): Promise<Task> {
      const row = await tasksRepo.update(id, { isImportant: important, isUrgent: urgent });
      if (!row) throw new NotFoundError('任务不存在');
      return (await hydrate([row]))[0]!;
    },

    /** 手动排序：把任务移动到目标排序值 */
    async reorder(id: string, sortOrder: number): Promise<void> {
      await requireTask(id);
      await tasksRepo.update(id, { sortOrder });
    },

    /** 专注完成时累加番茄数 */
    async incrementPomodoro(id: string): Promise<void> {
      await tasksRepo.bumpPomodoro(id);
    },
  };
}

export type TasksService = ReturnType<typeof createTasksService>;
