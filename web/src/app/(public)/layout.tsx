import { SiteHeader } from '@/shared/ui/SiteHeader';

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader
        signedIn={false}
        links={[
          { href: '/help', label: 'Help' },
          { href: '/', label: 'Your account' },
        ]}
      />
      <main id="main" className="container">
        {children}
      </main>
    </>
  );
}
