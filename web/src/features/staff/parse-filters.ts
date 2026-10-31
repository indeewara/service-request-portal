import { z } from 'zod';
import type { StaffFilters } from '@/shared/api/types';

const date = z.iso.date().optional().catch(undefined);

/** Reads the dashboard filters from the URL. Bad values are dropped, not errors: it's a shared link. */
const schema = z.object({
  status: z.enum(['NEW', 'IN_REVIEW', 'RESOLVED', 'REJECTED']).optional().catch(undefined),
  category: z.enum(['DAMAGED_DELIVERY', 'WRONG_ITEM', 'QUALITY_ISSUE', 'OTHER']).optional().catch(undefined),
  from: date,
  to: date,
  page: z.coerce.number().int().min(1).catch(1),
});

export function parseFilters(params: Record<string, string | string[] | undefined>): StaffFilters {
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;
  return schema.parse({
    status: first(params.status),
    category: first(params.category),
    from: first(params.from),
    to: first(params.to),
    page: first(params.page) ?? 1,
  });
}
