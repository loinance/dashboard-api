import type { NextFunction, Request, Response } from 'express'
import { ApiError, ErrorCode } from '../http/errors.js'
import { logger } from '../logger.js'

/** Anything that reaches here without matching a route (§10 `NOT_FOUND`). */
export function notFoundHandler(_req: Request, _res: Response, next: NextFunction): void {
  next(new ApiError(ErrorCode.NOT_FOUND, 'Not found.'))
}

/**
 * The single place a response body is shaped for a failure. Nothing else in the
 * codebase writes an error to the wire, so §10's contract cannot drift.
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    // Streaming export already started — destroying is the only honest option;
    // a half-written workbook must not look like a complete one.
    next(err)
    return
  }

  if (err instanceof ApiError) {
    if (err.retryAfter) res.setHeader('Retry-After', String(err.retryAfter))
    // 4xx is routine traffic, not an incident.
    logger.info({ code: err.code, status: err.status, path: req.path }, 'request rejected')
    res.status(err.status).json(err.toBody())
    return
  }

  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json(new ApiError(ErrorCode.BAD_REQUEST, 'Malformed JSON body.').toBody())
    return
  }

  logger.error({ err, path: req.path, method: req.method }, 'unhandled error')

  // Never leak a SQL error, a stack trace, or anything else internal (§10).
  res
    .status(500)
    .json(
      new ApiError(ErrorCode.INTERNAL, 'Something went wrong at our end. Please try again.').toBody(),
    )
}
