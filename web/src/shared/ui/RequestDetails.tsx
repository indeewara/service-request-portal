import type { Photo, RequestDetails as Details } from '@/shared/api/types';
import { CATEGORY_LABELS, STATUS_LABELS, formatDateTime } from '@/shared/labels';
import { StatusBadge } from './StatusBadge';

/**
 * Read-only view of one request, shared by the customer and staff pages.
 * Customer-written text is rendered as React text (escaped), never as HTML.
 */
export function RequestDetails({
  request,
  photos,
  viewer,
}: {
  request: Details;
  photos: Photo[];
  viewer: 'customer' | 'staff';
}) {
  const who = (userId: string) =>
    userId === request.customerId
      ? viewer === 'customer'
        ? 'You'
        : (request.customer?.name ?? 'Customer')
      : 'Service team';

  return (
    <div className="stack">
      <dl className="facts">
        <div>
          <dt>Status</dt>
          <dd>
            <StatusBadge status={request.status} />
          </dd>
        </div>
        <div>
          <dt>Order number</dt>
          <dd>{request.orderNumber}</dd>
        </div>
        <div>
          <dt>Category</dt>
          <dd>{CATEGORY_LABELS[request.category]}</dd>
        </div>
        <div>
          <dt>Submitted</dt>
          <dd>{formatDateTime(request.createdAt)}</dd>
        </div>
        {request.customer && (
          <div>
            <dt>Customer</dt>
            <dd>
              {request.customer.name}
              <br />
              <a href={`mailto:${request.customer.email}`} className="contact-email">
                {request.customer.email}
              </a>
            </dd>
          </div>
        )}
      </dl>

      <section aria-labelledby="description-title">
        <h2 id="description-title">Description</h2>
        <p className="customer-text">{request.description}</p>
      </section>

      <section aria-labelledby="photos-title">
        <h2 id="photos-title">Photos</h2>
        {photos.length === 0 ? (
          <p>No photos.</p>
        ) : (
          <ul className="photos">
            {photos.map((photo, i) => (
              <li key={photo.id}>
                {/* Pre-signed links expire after 5 minutes; reloading the page issues new ones. */}
                <a href={photo.url} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URLs, nothing to optimise or cache */}
                  <img src={photo.url} alt={`Photo ${i + 1} of ${photos.length} (opens full size)`} />
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="history-title">
        <h2 id="history-title">Status history</h2>
        <ol className="history">
          {request.history.map((change) => (
            <li key={change.id}>
              <strong>{STATUS_LABELS[change.toStatus]}</strong>
              <span>
                {formatDateTime(change.changedAt)} · {who(change.changedBy)}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
