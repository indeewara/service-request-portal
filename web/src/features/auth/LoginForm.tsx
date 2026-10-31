'use client';

import { useSearchParams } from 'next/navigation';
import { useActionState } from 'react';
import { login, type LoginState } from './actions';

export function LoginForm() {
  // Read in the browser, so the login page itself stays static.
  const params = useSearchParams();
  const next = params.get('next') ?? undefined;
  const expired = params.has('expired');
  const [state, action, pending] = useActionState<LoginState, FormData>(login, {});
  return (
    <form action={action} className="stack" noValidate>
      {expired && !state.error && (
        <p className="notice" role="status">
          Your session has ended. Please log in again.
        </p>
      )}
      {state.error && (
        <p className="error-summary" role="alert" id="login-error">
          {state.error}
        </p>
      )}
      <input type="hidden" name="next" value={next ?? ''} />
      <div className="field">
        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          aria-describedby={state.error ? 'login-error' : undefined}
        />
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-describedby={state.error ? 'login-error' : undefined}
        />
      </div>
      <button type="submit" className="button" disabled={pending}>
        {pending ? 'Logging in…' : 'Log in'}
      </button>
    </form>
  );
}
