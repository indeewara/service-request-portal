import type { RequestCategory, RequestStatus } from './api/types';

export const CATEGORY_LABELS: Record<RequestCategory, string> = {
  DAMAGED_DELIVERY: 'Damaged delivery',
  WRONG_ITEM: 'Wrong item',
  QUALITY_ISSUE: 'Quality issue',
  OTHER: 'Other',
};

export const STATUS_LABELS: Record<RequestStatus, string> = {
  NEW: 'New',
  IN_REVIEW: 'In review',
  RESOLVED: 'Resolved',
  REJECTED: 'Rejected',
};

export const CATEGORIES = Object.keys(CATEGORY_LABELS) as RequestCategory[];
export const STATUSES = Object.keys(STATUS_LABELS) as RequestStatus[];

/** Same transitions the API enforces; used only to offer sensible choices in the UI. */
export const NEXT_STATUSES: Record<RequestStatus, RequestStatus[]> = {
  NEW: ['IN_REVIEW'],
  IN_REVIEW: ['RESOLVED', 'REJECTED'],
  RESOLVED: [],
  REJECTED: [],
};

const dateTime = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
});
export const formatDateTime = (iso: string) => `${dateTime.format(new Date(iso))} UTC`;
