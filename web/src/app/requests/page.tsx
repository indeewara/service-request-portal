import type { Metadata } from 'next';
import Link from 'next/link';
import { requestsApi } from '@/shared/api/endpoints';
import { CATEGORY_LABELS, formatDateTime } from '@/shared/labels';
import { Pagination } from '@/shared/ui/Pagination';
import { StatusBadge } from '@/shared/ui/StatusBadge';

export const metadata: Metadata = { title: 'My requests' };

// SSR: the signed-in customer's own requests, always fresh.
export default async function MyRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const page = Math.max(1, Number((await searchParams).page) || 1);
  const { items, total, pageSize } = await requestsApi.mine(page);
  return (
    <div className="stack">
      <div className="page-title">
        <h1>My requests</h1>
        <Link href="/requests/new" className="button">
          New request
        </Link>
      </div>
      {items.length === 0 ? (
        <p>You haven&apos;t raised any requests yet.</p>
      ) : (
        <ul className="cards">
          {items.map((r) => (
            <li key={r.id}>
              <Link href={`/requests/${r.id}`}>Order {r.orderNumber}</Link>
              <span>{CATEGORY_LABELS[r.category]}</span>
              <StatusBadge status={r.status} />
              <span>{formatDateTime(r.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
      <Pagination path="/requests" query={{}} page={page} pageSize={pageSize} total={total} />
    </div>
  );
}
