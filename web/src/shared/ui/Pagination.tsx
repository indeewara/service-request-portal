import Link from 'next/link';

/** Previous/next links that keep the current filters in the URL. */
export function Pagination({
  path,
  query,
  page,
  pageSize,
  total,
}: {
  path: string;
  query: Record<string, string | undefined>;
  page: number;
  pageSize: number;
  total: number;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const href = (p: number) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) if (value) params.set(key, value);
    if (p > 1) params.set('page', String(p));
    const qs = params.toString();
    return qs ? `${path}?${qs}` : path;
  };
  return (
    <nav aria-label="Pagination" className="pagination">
      {page > 1 ? <Link href={href(page - 1)}>Previous</Link> : <span aria-hidden="true" />}
      <span>
        Page {Math.min(page, pages)} of {pages}
      </span>
      {page < pages ? <Link href={href(page + 1)}>Next</Link> : <span aria-hidden="true" />}
    </nav>
  );
}
