import { ConflictException } from '@nestjs/common';
import { RequestStatus as S } from './service-request.entity.js';
import { assertValidTransition } from './status-workflow.js';

const ALLOWED = [
  [S.NEW, S.IN_REVIEW],
  [S.IN_REVIEW, S.RESOLVED],
  [S.IN_REVIEW, S.REJECTED],
];
const isAllowed = (from: S, to: S) =>
  ALLOWED.some(([f, t]) => f === from && t === to);

// Every from → to pair, so a new status or a changed rule can't slip through untested.
const ALL_PAIRS = Object.values(S).flatMap((from) =>
  Object.values(S).map((to) => [from, to] as const),
);

describe('status workflow', () => {
  it.each(ALL_PAIRS.filter(([f, t]) => isAllowed(f, t)))(
    'allows %s → %s',
    (from, to) => {
      expect(() => assertValidTransition(from, to)).not.toThrow();
    },
  );

  it.each(ALL_PAIRS.filter(([f, t]) => !isAllowed(f, t)))(
    'rejects %s → %s',
    (from, to) => {
      expect(() => assertValidTransition(from, to)).toThrow(ConflictException);
    },
  );

  it('covers all 16 pairs', () => {
    expect(ALL_PAIRS).toHaveLength(16);
  });

  it('explains the rejection', () => {
    expect(() => assertValidTransition(S.RESOLVED, S.NEW)).toThrow(
      'Cannot change status from RESOLVED to NEW',
    );
  });
});
