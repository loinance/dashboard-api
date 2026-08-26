import { SignJWT, jwtVerify } from 'jose'
import type { CookieOptions, Response } from 'express'
import { env } from '../../env.js'

const secret = new TextEncoder().encode(env.JWT_SECRET)
const ALGORITHM = 'HS256'
const ISSUER = 'loinance-api'

export interface SessionClaims {
  sub: string
  role: 'admin' | 'agent'
  name: string
  email: string
}

export async function signSession(claims: SessionClaims): Promise<string> {
  return new SignJWT({ role: claims.role, name: claims.name, email: claims.email })
    .setProtectedHeader({ alg: ALGORITHM })
    .setSubject(claims.sub)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${env.SESSION_HOURS}h`)
    .sign(secret)
}

export async function verifySession(token: string): Promise<SessionClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret, {
      issuer: ISSUER,
      algorithms: [ALGORITHM],
    })
    if (!payload.sub) return null
    return {
      sub: payload.sub,
      role: payload.role === 'admin' ? 'admin' : 'agent',
      name: String(payload.name ?? ''),
      email: String(payload.email ?? ''),
    }
  } catch {
    return null
  }
}

/**
 * §6 — HttpOnly so an XSS bug cannot read it, Secure in production, SameSite
 * from `COOKIE_SAMESITE` (`lax` locally so the top-level export download still
 * carries it; `none` once the API and the dashboard are on separate domains,
 * where `lax` would drop the cookie from every admin XHR).
 *
 * The cookie is the preferred carrier and an XSS bug still cannot read it. It is
 * no longer the only one: `/auth/login` also returns the token in its body so the
 * dashboard can fall back to `Authorization: Bearer` on browsers that block
 * third-party cookies outright. That copy does live in the tab's storage, which
 * is the trade this deployment accepts to stay reachable from a different domain.
 */
function cookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: env.isProd,
    sameSite: env.cookieSameSite,
    path: '/',
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
  }
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(env.cookieName, token, {
    ...cookieOptions(),
    maxAge: env.SESSION_HOURS * 60 * 60 * 1000,
  })
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(env.cookieName, cookieOptions())
}
