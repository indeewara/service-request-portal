export type CheckStatus = 'up' | 'down';

export class HealthChecks {
  database: CheckStatus;
  /** Redis, which also backs the email queue and live updates. */
  redis: CheckStatus;
  storage: CheckStatus;
}

export class HealthResponse {
  status: 'ok' | 'error';
  checks: HealthChecks;
}
