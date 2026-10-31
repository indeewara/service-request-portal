'use client';

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main id="main" className="container stack">
      <h1>Something went wrong</h1>
      <p role="alert">We couldn&apos;t load this page. Please try again in a moment.</p>
      <div>
        <button type="button" className="button" onClick={reset}>
          Try again
        </button>
      </div>
    </main>
  );
}
