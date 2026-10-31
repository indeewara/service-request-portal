import { NotFoundException } from '@nestjs/common';
import { Role } from './auth.types.js';
import { assertCanAccessRequest } from './request-access.js';

const aliceRequest = { customerId: 'alice' };

describe('assertCanAccessRequest', () => {
  it('allows a customer to access their own request', () => {
    expect(() =>
      assertCanAccessRequest({ id: 'alice', role: Role.CUSTOMER }, aliceRequest),
    ).not.toThrow();
  });

  it("hides another customer's request behind a 404", () => {
    expect(() =>
      assertCanAccessRequest({ id: 'bob', role: Role.CUSTOMER }, aliceRequest),
    ).toThrow(NotFoundException);
  });

  it('allows staff to access any request', () => {
    expect(() =>
      assertCanAccessRequest({ id: 'staff', role: Role.STAFF }, aliceRequest),
    ).not.toThrow();
  });
});
