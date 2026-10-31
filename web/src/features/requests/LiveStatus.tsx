'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { RequestStatus } from '@/shared/api/types';
import { STATUS_LABELS } from '@/shared/labels';

/**
 * Listens for status changes (Server-Sent Events) and re-renders the page's
 * server data when one arrives. The event only says "something changed"; the
 * page fetches the real details again, so a missed event can't leave it wrong.
 */
export function LiveStatus({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [connected, setConnected] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const source = new EventSource(`/api/requests/${requestId}/events`);
    let reconnecting = false;
    source.onopen = () => {
      setConnected(true);
      // Events may have been missed while disconnected: fetch the current state.
      if (reconnecting) router.refresh();
    };
    source.onerror = () => {
      setConnected(false);
      reconnecting = true; // EventSource retries by itself
    };
    source.addEventListener('status', (event) => {
      const { status } = JSON.parse((event as MessageEvent<string>).data) as { status: RequestStatus };
      setMessage(`Status updated to ${STATUS_LABELS[status]}`);
      router.refresh();
    });
    return () => source.close();
  }, [requestId, router]);

  return (
    <div className="live">
      <span className={connected ? 'live-dot on' : 'live-dot'} aria-hidden="true" />
      <span>{connected ? 'Live updates on' : 'Connecting to live updates…'}</span>
      {/* Announced by screen readers when a change arrives. */}
      <span role="status" className="live-message">
        {message}
      </span>
    </div>
  );
}
