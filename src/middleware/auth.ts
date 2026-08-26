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

/**
 * Pulls the session token out of the request.
 *
 * The cookie is still the preferred carrier, but it only arrives when the
 * browser is willing to send a third-party cookie — Safari and Brave never are,
 * Chrome stops in incognito, and a misconfigured `SameSite` drops it everywhere.
 * `Authorization: Bearer` is the fallback the dashboard sends, so the API living
 * on a different registrable domain than the site cannot lock an admin out.
 *
 * Either way this is the same signed JWT: nothing here trusts a client-supplied
 * user id. The header is read first so an explicit token wins over a stale cookie.
 */
function readToken(req: Request): string | null {
  const header = req.get('authorization')
  if (header) {
    const [scheme, value] = header.split(' ')
    if (scheme?.toLowerCase() === 'bearer' && value) return value
  }

  const cookie = req.cookies?.[env.cookieName]
  if (typeof cookie === 'string' && cookie.length > 0) return cookie

  return null
}

/** Reads the session token if present. Never rejects — see `requireAuth`. */
export async function loadSession(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const token = readToken(req)
  if (token) {
    const claims = await verifySession(token)
    if (claims) req.user = claims
  }
  next()
}

/** §6 — every `/api/admin/*` route requires a valid session. */
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
