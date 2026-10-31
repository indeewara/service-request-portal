import Link from 'next/link';
import type { ServiceRequest } from '@/shared/api/types';
import { CATEGORY_LABELS, formatDateTime } from '@/shared/labels';
import { StatusBadge } from '@/shared/ui/StatusBadge';

export function RequestsTable({ items, caption }: { items: ServiceRequest[]; caption: string }) {
  if (items.length === 0) return <p>No requests match these filters.</p>;
  return (
    // Scrolls sideways on narrow screens; focusable so keyboard users can scroll it too.
    <div className="table-scroll" role="region" aria-label={caption} tabIndex={0}>
      <table>
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Order</th>
            <th scope="col">Category</th>
            <th scope="col">Status</th>
            <th scope="col">Submitted</th>
          </tr>
        </thead>
        <tbody>
          {items.map((r) => (
            <tr key={r.id}>
              <th scope="row">
                <Link href={`/staff/requests/${r.id}`}>{r.orderNumber}</Link>
              </th>
              <td>{CATEGORY_LABELS[r.category]}</td>
              <td>
                <StatusBadge status={r.status} />
              </td>
              <td>{formatDateTime(r.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
