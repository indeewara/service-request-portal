import Link from 'next/link';
import type { StaffFilters } from '@/shared/api/types';
import { CATEGORIES, CATEGORY_LABELS, STATUSES, STATUS_LABELS } from '@/shared/labels';

/**
 * A plain GET form: applying it puts the filters in the URL, so the view can
 * be bookmarked or shared, and it works without JavaScript.
 */
export function Filters({ filters }: { filters: StaffFilters }) {
  return (
    <form method="get" action="/staff" role="search" aria-label="Filter requests" className="filters">
      <div className="field">
        <label htmlFor="status">Status</label>
        <select id="status" name="status" defaultValue={filters.status ?? ''}>
          <option value="">Any status</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="category">Category</label>
        <select id="category" name="category" defaultValue={filters.category ?? ''}>
          <option value="">Any category</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="from">Submitted from</label>
        <input id="from" name="from" type="date" defaultValue={filters.from} />
      </div>
      <div className="field">
        <label htmlFor="to">Submitted to</label>
        <input id="to" name="to" type="date" defaultValue={filters.to} />
      </div>
      <div className="filter-actions">
        <button type="submit" className="button">
          Apply filters
        </button>
        <Link href="/staff">Clear filters</Link>
      </div>
    </form>
  );
}
