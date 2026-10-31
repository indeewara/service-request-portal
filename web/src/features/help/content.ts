import type { RequestCategory } from '@/shared/api/types';

// Edited a few times a year. The /help page is rebuilt from this at most once a day (ISR).
export const CATEGORY_HELP: Record<RequestCategory, string> = {
  DAMAGED_DELIVERY: 'Goods arrived broken, cracked, wet or with torn packaging.',
  WRONG_ITEM: 'You received a different product, size or quantity than you ordered.',
  QUALITY_ISSUE: 'The product arrived intact but does not perform as it should.',
  OTHER: 'Anything else about an order, such as missing documents.',
};

export const FAQS = [
  {
    question: 'Where do I find my order number?',
    answer: 'It is printed on your delivery note and order confirmation, and starts with SO-.',
  },
  {
    question: 'What photos should I add?',
    answer:
      'Up to five JPEG or PNG photos, 5 MB each: the damaged item, the packaging and the label help us most.',
  },
  {
    question: 'How will I know what is happening?',
    answer:
      'We email you whenever the status changes, and your request page updates on its own while it is open.',
  },
  {
    question: 'What do the statuses mean?',
    answer:
      'New: we have it. In review: someone is looking into it. Resolved or Rejected: we have made a decision and explain it by email.',
  },
];
