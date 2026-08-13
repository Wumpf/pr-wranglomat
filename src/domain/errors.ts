export type ErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not-found'
  | 'rate-limited'
  | 'network'
  | 'cancelled'
  | 'invalid-response'
  | 'storage';
export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public retryAfter?: number,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
