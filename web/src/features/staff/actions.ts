'use server';

import { z } from 'zod';
import { ApiError } from '@/shared/api/client';
import { requestsApi } from '@/shared/api/endpoints';

const input = z.object({
  id: z.uuid(),
  status: z.enum(['NEW', 'IN_REVIEW', 'RESOLVED', 'REJECTED']),
});

export async function changeStatus(
  id: string,
  status: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = input.safeParse({ id, status });
  if (!parsed.success) return { ok: false, error: 'Unknown status.' };
  try {
    // The API checks the caller is staff and the transition is allowed.
    await requestsApi.changeStatus(parsed.data.id, parsed.data.status);
    return { ok: true };
  } catch (err) {
    if (err instanceof ApiError) return { ok: false, error: err.message };
    throw err;
  }
}
