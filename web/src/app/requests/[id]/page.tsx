import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { LiveStatus } from '@/features/requests/LiveStatus';
import { ApiError } from '@/shared/api/client';
import { requestsApi } from '@/shared/api/endpoints';
import { RequestDetails } from '@/shared/ui/RequestDetails';

export const metadata: Metadata = { title: 'Your request' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// SSR, never cached: private data and photo links that expire after 5 minutes.
export default async function CustomerRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const data = await Promise.all([requestsApi.get(id), requestsApi.photos(id)]).catch((err) => {
    // The API answers 404 for other customers' requests too.
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  });
  const [request, photos] = data;

  return (
    <div className="stack">
      <h1>Request for order {request.orderNumber}</h1>
      <LiveStatus requestId={request.id} />
      <RequestDetails request={request} photos={photos} viewer="customer" />
    </div>
  );
}
