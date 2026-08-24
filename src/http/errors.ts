/**
 * §10 — one error shape everywhere, so the frontend has a single error path.
 *
 *   { ok: false, error: { code, message, fields? } }
 *
 * `message` is written to be shown to a user as-is. Nothing here ever carries a
 * SQL error, a stack trace, or whether an email exists.
 */

export const ErrorCode = {
  BAD_REQUEST: 'BAD_REQUEST',
  CAPTCHA_FAILED: 'CAPTCHA_FAILED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  FORBIDDEN: 'FORBIDDEN',
  IP_BLOCKED: 'IP_BLOCKED',
  BAD_ORIGIN: 'BAD_ORIGIN',
  NOT_FOUND: 'NOT_FOUND',
  EXPORT_TOO_LARGE: 'EXPORT_TOO_LARGE',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL: 'INTERNAL',
} as const

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode]

const statusByCode: Record<ErrorCodeValue, number> = {
  BAD_REQUEST: 400,
  CAPTCHA_FAILED: 400,
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  SESSION_EXPIRED: 401,
  FORBIDDEN: 403,
  IP_BLOCKED: 403,
  BAD_ORIGIN: 403,
  NOT_FOUND: 404,
  EXPORT_TOO_LARGE: 413,
  VALIDATION_ERROR: 422,
  RATE_LIMITED: 429,
  INTERNAL: 500,
}

interface ApiErrorOptions {
  /** Per-field messages, safe to render next to the input. */
  fields?: Record<string, string>
  /** Seconds, sent as `Retry-After` on 429. */
  retryAfter?: number
  /** Logged, never sent to the client. */
  cause?: unknown
}

export class ApiError extends Error {
  readonly code: ErrorCodeValue
  readonly status: number
  readonly fields?: Record<string, string>
  readonly retryAfter?: number

  constructor(code: ErrorCodeValue, message: string, options: ApiErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined)
    this.name = 'ApiError'
    this.code = code
    this.status = statusByCode[code]
    this.fields = options.fields
    this.retryAfter = options.retryAfter
  }

  toBody() {
    return {
      ok: false as const,
      error: {
        code: this.code,
        message: this.message,
        ...(this.fields ? { fields: this.fields } : {}),
      },
    }
  }
}

export const badRequest = (message = 'That request could not be understood.') =>
  new ApiError(ErrorCode.BAD_REQUEST, message)

export const unauthenticated = (message = 'Please sign in to continue.') =>
  new ApiError(ErrorCode.UNAUTHENTICATED, message)

export const forbidden = (message = 'You do not have access to this.') =>
  new ApiError(ErrorCode.FORBIDDEN, message)

export const notFound = (message = 'Not found.') => new ApiError(ErrorCode.NOT_FOUND, message)

export const validationError = (fields: Record<string, string>, message?: string) =>
  new ApiError(
    ErrorCode.VALIDATION_ERROR,
    message ?? Object.values(fields)[0] ?? 'Please check the details you entered.',
    { fields },
  )
