import type {
  Candidate,
  CandidateStatus,
  CreateSourceInput,
  PresetSource,
  Source,
  UpdateSourceInput,
} from '@ddl/shared';
import { ConflictError, NotFoundError } from '../../lib/errors';
import type { TasksService } from '../tasks/tasks.service';
import { toCandidateDto, type CandidatesRepo } from './candidates.repo';
import type { CollectService } from './collect.service';
import { COMPETITION_PRESETS } from './presets';
import { toSourceDto, type SourcesRepo } from './sources.repo';

export function createSourcesService(
  sourcesRepo: SourcesRepo,
  candidatesRepo: CandidatesRepo,
  tasksService: TasksService,
  collectService: CollectService,
) {
  return {
    async list(): Promise<Source[]> {
      const rows = await sourcesRepo.findAll();
      return rows.map(toSourceDto);
    },

    async create(input: CreateSourceInput): Promise<Source> {
      const existing = await sourcesRepo.findByUrl(input.url);
      if (existing) throw new ConflictError('该 RSS 地址已经添加过');
      return toSourceDto(await sourcesRepo.insert(input));
    },

    async update(id: string, patch: UpdateSourceInput): Promise<Source> {
      const existing = await sourcesRepo.findById(id);
      if (!existing) throw new NotFoundError('信息源不存在');
      const row = await sourcesRepo.update(id, patch);
      if (!row) throw new NotFoundError('信息源不存在');
      return toSourceDto(row);
    },

    async remove(id: string): Promise<void> {
      const removed = await sourcesRepo.remove(id);
      if (!removed) throw new NotFoundError('信息源不存在');
    },

    async fetchNow(id: string): Promise<{ added: number; total: number; skipped: number; filtered: number }> {
      return collectService.fetchSource(id);
    },

    async listCandidates(status: CandidateStatus, limit: number): Promise<Candidate[]> {
      const rows = await candidatesRepo.findMany(status, limit);
      return rows.map((item) => toCandidateDto(item.row, item.sourceName));
    },

    /** 确认候选 → 建任务。这是整个链路里唯一会产生任务的入口，避免自动污染任务列表 */
    async acceptCandidate(id: string): Promise<{ taskId: string }> {
      const candidate = await candidatesRepo.findById(id);
      if (!candidate) throw new NotFoundError('候选不存在');
      if (candidate.status !== 'pending') throw new ConflictError('该候选已处理过');

      const task = await tasksService.create({
        title: candidate.title.slice(0, 500),
        notes: candidate.url ? `来源：${candidate.url}` : null,
        kind: 'task',
        priority: 0,
        isImportant: false,
        isUrgent: false,
        allDay: false,
        tags: [],
        dueAt: candidate.dueAt ? candidate.dueAt.toISOString() : null,
        rrule: null,
        repeatFrom: 'due',
        estimatePomodoros: 0,
        pinned: false,
      });

      await candidatesRepo.markStatus(id, 'accepted', task.id);
      return { taskId: task.id };
    },

    async dismissCandidate(id: string): Promise<void> {
      const candidate = await candidatesRepo.findById(id);
      if (!candidate) throw new NotFoundError('候选不存在');
      await candidatesRepo.markStatus(id, 'dismissed');
    },

    /** 一键忽略全部待确认候选 */
    async dismissAllCandidates(): Promise<number> {
      return candidatesRepo.dismissAllPending();
    },

    async pendingCount(): Promise<number> {
      return candidatesRepo.countPending();
    },

    /** 内置竞赛预设源列表，按当前已订阅的 url 标注 subscribed */
    async listPresets(): Promise<PresetSource[]> {
      const subscribedUrls = new Set((await sourcesRepo.findAll()).map((row) => row.url));
      return COMPETITION_PRESETS.map((preset) => ({
        key: preset.key,
        name: preset.name,
        url: preset.url,
        description: preset.description,
        fetchIntervalMinutes: preset.fetchIntervalMinutes,
        subscribed: subscribedUrls.has(preset.url),
      }));
    },

    /** 一键订阅某个竞赛预设源（已订阅则直接返回已有源，按 url 去重） */
    async subscribePreset(key: string): Promise<Source> {
      const preset = COMPETITION_PRESETS.find((item) => item.key === key);
      if (!preset) throw new NotFoundError('预设源不存在');
      const existing = await sourcesRepo.findByUrl(preset.url);
      if (existing) return toSourceDto(existing);
      const input: CreateSourceInput = {
        name: preset.name,
        url: preset.url,
        fetchIntervalMinutes: preset.fetchIntervalMinutes,
        enabled: true,
      };
      return toSourceDto(await sourcesRepo.insert(input));
    },
  };
}

export type SourcesService = ReturnType<typeof createSourcesService>;
