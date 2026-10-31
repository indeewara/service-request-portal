import Link from 'next/link';

export default function NotFound() {
  return (
    <main id="main" className="container stack">
      <h1>Page not found</h1>
      <p>This page doesn&apos;t exist, or you don&apos;t have access to it.</p>
      <p>
        <Link href="/">Go to the start page</Link>
      </p>
    </main>
  );
}
