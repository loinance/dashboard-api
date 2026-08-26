import { Router } from 'express'
import { z } from 'zod'
import { env } from '../../env.js'
import { ApiError, ErrorCode } from '../../http/errors.js'
import { parseOrThrow } from '../../http/validate.js'
import { requireAuth } from '../../middleware/auth.js'
import { clearSessionCookie, setSessionCookie, signSession } from './jwt.js'
import { authenticate, findUserById, markLoggedIn, toPublicUser } from './service.js'

export const authRoutes: Router = Router()

const LoginSchema = z.object({
  email: z.email('Enter a valid email address.').max(200).transform((v) => v.toLowerCase()),
  password: z.string().min(1, 'Enter your password.').max(200),
})

/**
 * §6 — no public signup. Accounts are seeded or created by an admin, so this is
 * the only auth surface. Every failure returns the same message: whether an
 * email exists is not something an unauthenticated caller gets to learn.
 */
authRoutes.post('/auth/login', async (req, res) => {
  const { email, password } = parseOrThrow(LoginSchema, req.body)

  const user = await authenticate(email, password)

  if (!user) {
    throw new ApiError(ErrorCode.INVALID_CREDENTIALS, 'Email or password is incorrect.')
  }

  const token = await signSession({
    sub: user.id,
    role: user.role === 'admin' ? 'admin' : 'agent',
    name: user.name,
    email: user.email,
  })

  setSessionCookie(res, token)
  await markLoggedIn(user.id)

  /* The cookie is still set and still preferred. `token` is returned as well so
     the dashboard has something to send as `Authorization: Bearer` on the
     browsers that refuse a third-party cookie — see `readToken` in
     `middleware/auth.ts`. It is the same JWT, with the same 8-hour expiry. */
  res.status(200).json({
    user: toPublicUser(user),
    token,
    expiresIn: env.SESSION_HOURS * 60 * 60,
  })
})

authRoutes.post('/auth/logout', (_req, res) => {
  clearSessionCookie(res)
  res.status(204).end()
})

/**
 * The frontend calls this on load to decide whether to show the dashboard.
 * Re-reads the user so a deactivated account loses access without waiting for
 * its 8-hour token to expire.
 */
authRoutes.get('/auth/me', requireAuth, async (req, res) => {
  const user = await findUserById(req.user!.sub)
  if (!user || !user.isActive) {
    clearSessionCookie(res)
    throw new ApiError(ErrorCode.UNAUTHENTICATED, 'Please sign in to continue.')
  }
  res.status(200).json({ user: toPublicUser(user) })
})
