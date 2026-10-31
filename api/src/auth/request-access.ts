import { NotFoundException } from '@nestjs/common';
import { AuthUser, Role } from './auth.types.js';

/**
 * Staff can access any request; customers only their own.
 * Throws 404 rather than 403 so customers cannot probe for other customers' request IDs.
 * Every endpoint that loads a single request must call this.
 */
export function assertCanAccessRequest(
  user: AuthUser,
  request: { customerId: string },
): void {
  if (user.role === Role.STAFF) return;
  if (request.customerId !== user.id) {
    throw new NotFoundException('Request not found');
  }
}
