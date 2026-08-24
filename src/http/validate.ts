import type { ZodError, ZodType } from 'zod'
import { ApiError, ErrorCode } from './errors.js'

/** First message per field, in the §10 `fields` shape. */
export function fieldErrors(error: ZodError): Record<string, string> {
  const fields: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = issue.path.length > 0 ? issue.path.join('.') : '_'
    if (!(key in fields)) fields[key] = issue.message
  }
  return fields
}

export function toValidationError(error: ZodError, fallback: string): ApiError {
  const fields = fieldErrors(error)
  const first = Object.values(fields)[0]
  return new ApiError(ErrorCode.VALIDATION_ERROR, first ?? fallback, { fields })
}

/** Parse or throw a 422 carrying per-field messages. */
export function parseOrThrow<T>(
  schema: ZodType<T>,
  value: unknown,
  fallback = 'Please check the details you entered.',
): T {
  const result = schema.safeParse(value)
  if (!result.success) throw toValidationError(result.error, fallback)
  return result.data
}

/** Same, but for query strings — a bad filter is a 400, not a form error. */
export function parseQueryOrThrow<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) {
    const fields = fieldErrors(result.error)
    throw new ApiError(
      ErrorCode.BAD_REQUEST,
      Object.values(fields)[0] ?? 'Invalid query parameters.',
      { fields },
    )
  }
  return result.data
}
