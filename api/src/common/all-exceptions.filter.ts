import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { STATUS_CODES } from 'node:http';
import { ErrorBody } from './error-body.dto.js';

// Errors from Express middleware (body parser: 413, 415) mark client-safe ones with expose.
const isExposedHttpError = (
  e: unknown,
): e is { status: number; message: string } =>
  typeof e === 'object' &&
  e !== null &&
  (e as { expose?: unknown }).expose === true &&
  typeof (e as { status?: unknown }).status === 'number';

/**
 * Every error leaves the API as an ErrorBody. Unexpected errors become a
 * generic 500; the real error is logged with the correlation id, never sent.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost) {
    const req = host.switchToHttp().getRequest<Request>();
    const res = host.switchToHttp().getResponse<Response>();
    // e.g. an SSE stream that already started: nothing more can be sent.
    if (res.headersSent) return;
    // Inside the request logger every line already carries correlationId (adding it again would duplicate the key).
    // Errors raised before it ran (body parser: 413, 415, bad JSON) get it here.
    const beforeRequestLogger = !(req as { log?: unknown }).log;
    const correlation = beforeRequestLogger
      ? { correlationId: req.correlationId }
      : {};

    let statusCode: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let details: string[] | undefined;

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const response = exception.getResponse();
      const raw =
        typeof response === 'string'
          ? response
          : (response as { message?: unknown }).message;
      if (Array.isArray(raw)) {
        message = 'Validation failed';
        details = raw.map(String);
      } else if (typeof raw === 'string') {
        message = raw;
      }
    } else if (isExposedHttpError(exception)) {
      statusCode = exception.status;
      message = exception.message;
    } else {
      // Only the stack: driver errors can carry row values (e.g. a duplicate email) in other fields.
      this.logger.error({
        msg: 'Unhandled error',
        ...correlation,
        stack: exception instanceof Error ? exception.stack : String(exception),
      });
    }

    const body: ErrorBody = {
      statusCode,
      error: STATUS_CODES[statusCode] ?? 'Error',
      message,
      ...(details && { details }),
      correlationId: req.correlationId,
    };
    if (beforeRequestLogger) {
      this.logger.warn({
        msg: 'request rejected before routing',
        ...correlation,
        // Not req/res: those keys go through pino-http's serializers, which expect the raw objects.
        method: req.method,
        path: req.path,
        statusCode,
      });
    }
    res.status(statusCode).json(body);
  }
}
