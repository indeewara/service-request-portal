import type { Metadata } from 'next';
import { CATEGORY_HELP, FAQS } from '@/features/help/content';
import { CATEGORIES, CATEGORY_LABELS } from '@/shared/labels';

export const metadata: Metadata = { title: 'Help' };

// ISR: built once, served from cache, rebuilt at most once a day after the content changes.
export const revalidate = 86400;

export default function HelpPage() {
  return (
    <div className="stack">
      <h1>Help</h1>
      <section aria-labelledby="categories-title" className="stack">
        <h2 id="categories-title">Request categories</h2>
        <dl className="definitions">
          {CATEGORIES.map((c) => (
            <div key={c}>
              <dt>{CATEGORY_LABELS[c]}</dt>
              <dd>{CATEGORY_HELP[c]}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section aria-labelledby="faq-title" className="stack">
        <h2 id="faq-title">Frequently asked questions</h2>
        {FAQS.map((faq) => (
          <details key={faq.question}>
            <summary>{faq.question}</summary>
            <p>{faq.answer}</p>
          </details>
        ))}
      </section>
    </div>
  );
}
