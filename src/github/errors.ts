import { AppError } from '../domain/errors';
export function githubError(
  status: number,
  _message: string,
  retryAfter?: number,
  remaining?: number,
): AppError {
  if (status === 401)
    return new AppError('unauthorized', 'The token is invalid or expired.');
  if (
    status === 429 ||
    (status === 403 && (retryAfter !== undefined || remaining === 0))
  )
    return new AppError(
      'rate-limited',
      'GitHub rate limit exceeded.',
      retryAfter,
    );
  if (status === 403)
    return new AppError(
      'forbidden',
      'GitHub refused access to this repository.',
    );
  if (status === 404)
    return new AppError(
      'not-found',
      'Repository was not found or is not accessible.',
    );
  return new AppError('network', `GitHub request failed (${status}).`);
}
