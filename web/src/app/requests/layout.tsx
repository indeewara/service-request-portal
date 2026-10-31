import { SiteHeader } from '@/shared/ui/SiteHeader';

// Static on purpose (no cookies here), so /requests/new can be served as a static page.
export default function CustomerLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader
        signedIn
        links={[
          { href: '/requests', label: 'My requests' },
          { href: '/requests/new', label: 'New request' },
          { href: '/help', label: 'Help' },
        ]}
      />
      <main id="main" className="container">
        {children}
      </main>
    </>
  );
}
