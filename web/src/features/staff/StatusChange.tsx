'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import type { RequestStatus } from '@/shared/api/types';
import { NEXT_STATUSES, STATUS_LABELS } from '@/shared/labels';
import { changeStatus } from './actions';

/** Pick the next status, then confirm in a dialog before anything changes. */
export function StatusChange({ requestId, status }: { requestId: string; status: RequestStatus }) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const options = NEXT_STATUSES[status];
  const [picked, setPicked] = useState<RequestStatus>();
  // After a change the page re-renders with the new status; fall back to its first option.
  const choice = picked && options.includes(picked) ? picked : options[0];
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState('');
  const [pending, startTransition] = useTransition();

  if (options.length === 0) {
    return (
      <p className="notice" role="status">
        {message || `This request is ${STATUS_LABELS[status].toLowerCase()} and can't change any more.`}
      </p>
    );
  }

  const confirm = () =>
    startTransition(async () => {
      if (!choice) return;
      const result = await changeStatus(requestId, choice);
      dialogRef.current?.close();
      if (!result.ok) return setError(result.error);
      setError(undefined);
      setMessage(`Status changed to ${STATUS_LABELS[choice]}. The customer will be emailed.`);
      router.refresh();
    });

  return (
    <section aria-labelledby="change-title" className="stack panel">
      <h2 id="change-title">Change status</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          dialogRef.current?.showModal();
        }}
        className="stack"
      >
        <fieldset className="stack">
          <legend>New status</legend>
          {options.map((option) => (
            <label key={option} className="choice">
              <input
                type="radio"
                name="status"
                value={option}
                checked={choice === option}
                onChange={() => setPicked(option)}
              />
              {STATUS_LABELS[option]}
            </label>
          ))}
        </fieldset>
        <div>
          <button type="submit" className="button">
            Change status…
          </button>
        </div>
      </form>

      {error && (
        <p className="error-summary" role="alert">
          {error}
        </p>
      )}
      <p role="status">{message}</p>

      {/* Native modal dialog: traps focus, closes on Escape, returns focus afterwards. */}
      <dialog ref={dialogRef} aria-labelledby="confirm-title" className="dialog">
        <h2 id="confirm-title">Change status?</h2>
        <p>
          Move this request from <strong>{STATUS_LABELS[status]}</strong> to{' '}
          <strong>{choice && STATUS_LABELS[choice]}</strong>? The customer is emailed and sees the change
          straight away.
        </p>
        <div className="actions">
          <button type="button" className="button" onClick={confirm} disabled={pending} autoFocus>
            {pending ? 'Changing…' : 'Yes, change status'}
          </button>
          <button type="button" className="button secondary" onClick={() => dialogRef.current?.close()}>
            Cancel
          </button>
        </div>
      </dialog>
    </section>
  );
}
