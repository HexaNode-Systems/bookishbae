/**
 * API error vocabulary.
 *
 * Two audiences are being served at once and they want different things. The
 * buyer wants a sentence they can act on. An attacker wants to know whether
 * the thing they just probed exists. So every error carries a stable machine
 * `code` plus a `message` written for a human, and nothing else — no stack, no
 * SQL, no internal id. Unexpected failures are logged in full server-side and
 * reduced to a request id on the way out.
 */

export type ApiErrorCode =
  | 'bad_request'
  | 'validation_failed'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'gone'
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'rate_limited'
  | 'payment_failed'
  | 'download_limit_reached'
  | 'not_purchased'
  | 'upstream_error'
  | 'internal_error';

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  bad_request: 400,
  validation_failed: 422,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  gone: 410,
  payload_too_large: 413,
  unsupported_media_type: 415,
  rate_limited: 429,
  payment_failed: 402,
  download_limit_reached: 403,
  not_purchased: 403,
  upstream_error: 502,
  internal_error: 500,
};

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  /** Field-level detail, safe to show. Never put internals here. */
  readonly details?: Record<string, unknown>;
  readonly headers?: Record<string, string>;

  constructor(
    code: ApiErrorCode,
    message: string,
    options: { details?: Record<string, unknown>; headers?: Record<string, string>; status?: number } = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = options.status ?? STATUS_BY_CODE[code];
    this.details = options.details;
    this.headers = options.headers;
  }

  toJSON() {
    return {
      error: { code: this.code, message: this.message, ...(this.details ? { details: this.details } : {}) },
    };
  }
}

export const badRequest = (message = 'That request did not look right.', details?: Record<string, unknown>) =>
  new ApiError('bad_request', message, { details });

export const unauthenticated = (message = 'Please sign in to continue.') =>
  new ApiError('unauthenticated', message);

export const forbidden = (message = 'You do not have access to that.') =>
  new ApiError('forbidden', message);

export const notFound = (message = 'We could not find that.') => new ApiError('not_found', message);

export const conflict = (message: string, details?: Record<string, unknown>) =>
  new ApiError('conflict', message, { details });

export const rateLimited = (retryAfter: number) =>
  new ApiError('rate_limited', 'Too many requests. Give it a moment and try again.', {
    headers: { 'Retry-After': String(retryAfter) },
    details: { retry_after_seconds: retryAfter },
  });

export const internalError = (requestId: string) =>
  new ApiError('internal_error', 'Something went wrong on our side. Please try again.', {
    details: { request_id: requestId },
  });

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}
