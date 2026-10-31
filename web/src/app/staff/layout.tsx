import { SiteHeader } from '@/shared/ui/SiteHeader';

export default function StaffLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader
        signedIn
        links={[
          { href: '/staff', label: 'Dashboard' },
          { href: '/help', label: 'Help' },
        ]}
      />
      <main id="main" className="container">
        {children}
      </main>
    </>
  );
}
