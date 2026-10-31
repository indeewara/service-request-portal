import type { Metadata } from 'next';
import { Filters } from '@/features/staff/Filters';
import { parseFilters } from '@/features/staff/parse-filters';
import { RequestsTable } from '@/features/staff/RequestsTable';
import { requestsApi } from '@/shared/api/endpoints';
import { Pagination } from '@/shared/ui/Pagination';

export const metadata: Metadata = { title: 'Staff dashboard' };

// SSR from the URL: the server renders exactly the filtered page, so a bookmarked link shows the same view.
export default async function StaffDashboard({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filters = parseFilters(await searchParams);
  const { items, total, pageSize } = await requestsApi.list(filters);
  const { page, ...query } = filters;

  return (
    <div className="stack">
      <h1>Service requests</h1>
      <Filters filters={filters} />
      <p role="status">
        {total} {total === 1 ? 'request' : 'requests'} found
      </p>
      <RequestsTable items={items} caption="Service requests, newest first" />
      <Pagination path="/staff" query={query} page={page} pageSize={pageSize} total={total} />
    </div>
  );
}
