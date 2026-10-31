import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Params } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import type { AuthUser } from '../auth/auth.types.js';

const PERSONAL_FIELDS = [
  'email',
  'name',
  'description',
  'password',
  'passwordHash',
  'to',
];

type Req = IncomingMessage & {
  correlationId?: string;
  user?: AuthUser;
};

/**
 * JSON logs, one line per event. Every line logged while handling a request
 * carries its correlationId. Personal data stays out by construction: the
 * request/response serializers whitelist method, path and status (no headers,
 * no bodies), and the code only ever logs ids.
 */
export const loggerParams = (level: string): Params => ({
  pinoHttp: [
    {
      level,
      formatters: { level: (label: string) => ({ level: label }) },
      // Set by the correlationId middleware, which runs first.
      genReqId: (req: Req) => req.correlationId ?? randomUUID(),
      customAttributeKeys: { reqId: 'correlationId' },
      // The load balancer polls /health every few seconds; failures are still logged by the check itself.
      autoLogging: { ignore: (req: IncomingMessage) => req.url === '/health' },
      // Logs inside a request get only the correlationId, not the whole request.
      quietReqLogger: true,
      serializers: {
        req: (req: { method: string; url: string }) => ({
          method: req.method,
          // Path only: query strings are dropped in case a future filter carries text.
          path: req.url.split('?')[0],
        }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
      // Ids are pseudonymous and help trace who did what; never email or name.
      customProps: (req: Req) =>
        req.user ? { userId: req.user.id, role: req.user.role } : {},
      customLogLevel: (
        _req: IncomingMessage,
        res: ServerResponse,
        err?: Error,
      ) =>
        err || res.statusCode >= 500
          ? 'error'
          : res.statusCode >= 400
            ? 'warn'
            : 'info',
      // Safety net in case someone logs a user or request object by mistake.
      redact: {
        paths: [...PERSONAL_FIELDS, ...PERSONAL_FIELDS.map((f) => `*.${f}`)],
        censor: '[redacted]',
      },
    },
    // Plain stdout (not pino's default fd writer) so tests can capture the lines.
    process.stdout,
  ],
});
