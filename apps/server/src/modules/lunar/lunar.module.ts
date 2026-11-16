import { buildMonthCells, festivalsOf, solarTerm, solarToLunar, toDateKey } from '../../lib/lunar';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

export function registerLunarRoutes(app: FastifyInstance): void {
  app.get('/api/lunar/cells', async (request) => {
    const query = z
      .object({
        year: z.coerce.number().int().min(1900).max(2100),
        month: z.coerce.number().int().min(1).max(12),
        weekStartsMonday: z.coerce.boolean().default(true),
      })
      .parse(request.query);

    return { data: { cells: buildMonthCells(query.year, query.month, query.weekStartsMonday) } };
  });

  app.get('/api/lunar/today', async () => {
    const today = new Date();
    const lunar = solarToLunar(today);
    return {
      data: {
        date: toDateKey(today),
        lunarLabel: lunar.label,
        lunarYear: lunar.year,
        lunarMonth: lunar.month,
        lunarDay: lunar.day,
        isLeap: lunar.isLeap,
        term: solarTerm(today),
        festivals: festivalsOf(today),
      },
    };
  });

  app.get('/api/lunar/day', async (request) => {
    const query = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(request.query);
    const date = new Date(`${query.date}T00:00:00`);
    const lunar = solarToLunar(date);
    return {
      data: {
        date: query.date,
        lunarLabel: lunar.label,
        term: solarTerm(date),
        festivals: festivalsOf(date),
      },
    };
  });
}
