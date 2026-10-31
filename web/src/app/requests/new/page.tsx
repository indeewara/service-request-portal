import type { Metadata } from 'next';
import { RequestForm } from '@/features/requests/RequestForm';

export const metadata: Metadata = { title: 'New request' };

// Static shell: no per-user data here. The form is the only Client Component.
export default function NewRequestPage() {
  return (
    <div className="narrow stack">
      <h1>Report a problem with an order</h1>
      <p>Tell us what went wrong. You can add photos of the damage or the wrong item.</p>
      <RequestForm />
    </div>
  );
}
