import type { CreateListInput, ListGroup, TaskList, UpdateListInput } from '@ddl/shared';
import { ConflictError, NotFoundError } from '../../lib/errors';
import { toGroupDto, toListDto, type ListsRepo } from './lists.repo';

export function createListsService(repo: ListsRepo) {
  return {
    async list(includeArchived = false): Promise<TaskList[]> {
      const rows = await repo.findAll(includeArchived);
      return rows.map(toListDto);
    },

    async archived(): Promise<TaskList[]> {
      return (await repo.findArchived()).map(toListDto);
    },

    async get(id: string): Promise<TaskList> {
      const row = await repo.findById(id);
      if (!row) throw new NotFoundError('清单不存在');
      return toListDto(row);
    },

    async create(input: CreateListInput): Promise<TaskList> {
      const row = await repo.insert(input);
      return toListDto(row);
    },

    async update(id: string, patch: UpdateListInput): Promise<TaskList> {
      const existing = await repo.findById(id);
      if (!existing) throw new NotFoundError('清单不存在');
      if (existing.isInbox && patch.name !== undefined) throw new ConflictError('收件箱不支持重命名');
      const row = await repo.update(id, patch);
      if (!row) throw new NotFoundError('清单不存在');
      return toListDto(row);
    },

    async remove(id: string): Promise<void> {
      const existing = await repo.findById(id);
      if (!existing) throw new NotFoundError('清单不存在');
      if (existing.isInbox) throw new ConflictError('收件箱不可删除');
      await repo.remove(id);
    },

    async duplicate(id: string, onlyPending: boolean): Promise<TaskList> {
      const source = await repo.findById(id);
      if (!source) throw new NotFoundError('清单不存在');
      if (source.isInbox) throw new ConflictError('收件箱不可复制');
      return toListDto(await repo.duplicate(source, onlyPending));
    },

    async archive(id: string, archived: boolean): Promise<TaskList> {
      const existing = await repo.findById(id);
      if (!existing) throw new NotFoundError('清单不存在');
      if (existing.isInbox) throw new ConflictError('默认清单无法归档');
      const row = await repo.update(id, { archived });
      if (!row) throw new NotFoundError('清单不存在');
      return toListDto(row);
    },

    /* ---------------- 分组 ---------------- */

    async groups(): Promise<ListGroup[]> {
      return (await repo.findGroups()).map(toGroupDto);
    },

    async createGroup(name: string): Promise<ListGroup> {
      const rows = await repo.findGroups();
      return toGroupDto(await repo.insertGroup(name, rows.length));
    },

    async updateGroup(
      id: string,
      patch: { name?: string; collapsed?: boolean; sortOrder?: number },
    ): Promise<ListGroup> {
      const row = await repo.updateGroup(id, patch);
      if (!row) throw new NotFoundError('分组不存在');
      return toGroupDto(row);
    },

    async removeGroup(id: string): Promise<void> {
      const ok = await repo.removeGroup(id);
      if (!ok) throw new NotFoundError('分组不存在');
    },
  };
}

export type ListsService = ReturnType<typeof createListsService>;
