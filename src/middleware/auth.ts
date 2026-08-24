import type { NextFunction, Request, Response } from 'express'
import { env } from '../env.js'
import { ApiError, ErrorCode } from '../http/errors.js'
import { verifySession } from '../modules/auth/jwt.js'
import type { SessionClaims } from '../modules/auth/jwt.js'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionClaims
    }
  }
}

/** Reads the session cookie if present. Never rejects — see `requireAuth`. */
export async function loadSession(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const token = req.cookies?.[env.cookieName]
  if (typeof token === 'string' && token.length > 0) {
    const claims = await verifySession(token)
    if (claims) req.user = claims
  }
  next()
}

/** §6 — every `/api/admin/*` route requires a valid cookie. */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) {
    next(new ApiError(ErrorCode.UNAUTHENTICATED, 'Please sign in to continue.'))
    return
  }
  next()
}

/** §8.4 — abuse management is admin-only. */
export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) {
    next(new ApiError(ErrorCode.UNAUTHENTICATED, 'Please sign in to continue.'))
    return
  }
  if (req.user.role !== 'admin') {
    next(new ApiError(ErrorCode.FORBIDDEN, 'This action needs an admin account.'))
    return
  }
  next()
}
