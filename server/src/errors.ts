/**
 * Shared application error. Thrown by middleware/routes, translated to a
 * uniform `{ error: { code, message, details? } }` response by errorHandler.
 */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'AppError';
  }
}