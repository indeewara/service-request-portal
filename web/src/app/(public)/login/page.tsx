import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';
import { LoginForm } from '@/features/auth/LoginForm';

export const metadata: Metadata = { title: 'Log in' };

// Static: the form reads ?next= and ?expired in the browser.
export default function LoginPage() {
  return (
    <div className="narrow stack">
      <h1>Log in</h1>
      <Suspense>
        <LoginForm />
      </Suspense>
      <p>
        Need help first? <Link href="/help">Read the help page</Link>.
      </p>
    </div>
  );
}
