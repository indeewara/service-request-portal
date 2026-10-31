import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

export const CORRELATION_HEADER = 'x-correlation-id';
// Accept the caller's id only if it looks like an id, so it can't inject into logs.
const SAFE_ID = /^[\w-]{1,100}$/;

declare module 'express' {
  interface Request {
    correlationId?: string;
  }
}

/** Reuses the caller's x-correlation-id or creates one, and echoes it on the response. */
export function correlationId(req: Request, res: Response, next: NextFunction) {
  const incoming = req.header(CORRELATION_HEADER);
  req.correlationId = incoming && SAFE_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader(CORRELATION_HEADER, req.correlationId);
  next();
}

/** The current request's correlation id, e.g. to pass into a background job. */
export const CorrelationId = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string | undefined =>
    ctx.switchToHttp().getRequest<Request>().correlationId,
);
