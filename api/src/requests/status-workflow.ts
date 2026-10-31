import { ConflictException } from '@nestjs/common';
import { RequestStatus } from './service-request.entity.js';

// NEW → IN_REVIEW → RESOLVED | REJECTED. RESOLVED and REJECTED are final.
const TRANSITIONS: Record<RequestStatus, RequestStatus[]> = {
  [RequestStatus.NEW]: [RequestStatus.IN_REVIEW],
  [RequestStatus.IN_REVIEW]: [RequestStatus.RESOLVED, RequestStatus.REJECTED],
  [RequestStatus.RESOLVED]: [],
  [RequestStatus.REJECTED]: [],
};

export function assertValidTransition(
  from: RequestStatus,
  to: RequestStatus,
): void {
  if (!TRANSITIONS[from].includes(to)) {
    throw new ConflictException(`Cannot change status from ${from} to ${to}`);
  }
}
