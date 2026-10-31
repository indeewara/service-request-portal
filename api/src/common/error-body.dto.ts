/** Shape of every error response. */
export class ErrorBody {
  /** HTTP status code. */
  statusCode: number;
  /** HTTP status text, e.g. `Bad Request`. */
  error: string;
  /** One human-readable sentence. */
  message: string;
  /** Validation failures only: one line per invalid field. */
  details?: string[];
  /** Echo of `x-correlation-id`; quote it when reporting a problem. */
  correlationId?: string;
}
