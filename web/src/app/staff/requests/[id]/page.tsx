import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { StatusChange } from '@/features/staff/StatusChange';
import { ApiError } from '@/shared/api/client';
import { requestsApi } from '@/shared/api/endpoints';
import { RequestDetails } from '@/shared/ui/RequestDetails';

export const metadata: Metadata = { title: 'Request' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// SSR: fresh, private data. Only the status change (with its confirmation) runs in the browser.
export default async function StaffRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const [request, photos] = await Promise.all([requestsApi.get(id), requestsApi.photos(id)]).catch(
    (err) => {
      if (err instanceof ApiError && err.status === 404) notFound();
      throw err;
    },
  );

  return (
    <div className="stack">
      <p>
        <Link href="/staff">← Back to dashboard</Link>
      </p>
      <h1>Request for order {request.orderNumber}</h1>
      <div className="two-columns">
        <RequestDetails request={request} photos={photos} viewer="staff" />
        <StatusChange requestId={request.id} status={request.status} />
      </div>
    </div>
  );
}
