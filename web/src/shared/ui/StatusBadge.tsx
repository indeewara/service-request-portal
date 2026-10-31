import type { RequestStatus } from '@/shared/api/types';
import { STATUS_LABELS } from '@/shared/labels';

/** Status as text plus colour; the text carries the meaning, not the colour. */
export function StatusBadge({ status }: { status: RequestStatus }) {
  return <span className={`badge badge-${status.toLowerCase()}`}>{STATUS_LABELS[status]}</span>;
}
