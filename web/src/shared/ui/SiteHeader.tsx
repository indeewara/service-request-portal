import Link from 'next/link';
import { logout } from '@/shared/auth/logout';

/** Static header: links only, no per-user data, so pages using it can stay static. */
export function SiteHeader({
  links,
  signedIn,
}: {
  links: { href: string; label: string }[];
  signedIn: boolean;
}) {
  return (
    <header className="site-header">
      <div className="container header-inner">
        <Link href="/" className="brand">
          Service Request Portal
        </Link>
        <nav aria-label="Main">
          <ul>
            {links.map((link) => (
              <li key={link.href}>
                <Link href={link.href}>{link.label}</Link>
              </li>
            ))}
            {signedIn && (
              <li>
                <form action={logout}>
                  <button type="submit" className="link-button">
                    Log out
                  </button>
                </form>
              </li>
            )}
          </ul>
        </nav>
      </div>
    </header>
  );
}
