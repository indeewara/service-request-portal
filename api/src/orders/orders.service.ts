import { Injectable } from '@nestjs/common';

/**
 * Stand-in for the existing ERP order lookup. Any order number starting with
 * `SO-` is treated as valid. Async so callers already handle a real HTTP call.
 */
@Injectable()
export class OrdersService {
  async exists(orderNumber: string): Promise<boolean> {
    return orderNumber.startsWith('SO-');
  }
}
