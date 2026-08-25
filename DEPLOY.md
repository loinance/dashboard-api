# Deploying dashboard-api to Railway

The app is a plain Node process: build with `tsc`, run `node dist/index.js`.
`railway.json` already pins the builder, the start command and the health check,
so a service pointed at this repository needs no build configuration in the
dashboard — only environment variables.

## 1. Services

Create two services in one Railway project:

- **Postgres** — Railway's Postgres 16 template.
- **dashboard-api** — this repository. Set the service root directory to
  `dashboard-api/` if the project is deployed from the parent folder.

## 2. Variables

Set these on the **dashboard-api** service. `DATABASE_URL` must be a reference
to the database service, not a pasted string, so it keeps working when the
credentials rotate.

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| `JWT_SECRET` | 48 random bytes — `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
| `CORS_ORIGIN` | the dashboard's https origin, comma-separated for more than one |
| `TRUST_PROXY` | `1` — Railway's edge proxy is exactly one hop |
| `TURNSTILE_SECRET` | the Cloudflare Turnstile **secret** key |
| `LOG_LEVEL` | `info` |
| `RUN_NIGHTLY_JOBS` | `true` on exactly one replica, otherwise `false` |

Do **not** set `PORT` — Railway injects it. Do not set `HOST`; it defaults to
`::`, which Railway's IPv6-only private network requires and which still accepts
IPv4 traffic from the public edge.

Four variables have no safe default and the process exits at boot with a named
message rather than starting half-configured: `DATABASE_URL`, `JWT_SECRET`,
`CORS_ORIGIN`, and — in production only — `TURNSTILE_SECRET`. A deploy that dies
immediately with `[dashboard-api] Invalid environment:` is one of these, and the
log names which.

### Left unset on purpose

- `DATABASE_SSL` — inferred from the database host. `postgres.railway.internal`
  does not speak TLS at all, and Railway's public proxy presents a self-signed
  certificate; neither survives a plain `require`. Set it explicitly only to
  override that.
- `COOKIE_SAMESITE` — defaults to `none` in production, because the API and the
  dashboard are on different registrable domains and `lax` would drop the
  session cookie from every admin XHR. Set it to `lax` if you put both behind
  one domain.
- `COOKIE_DOMAIN` — leave empty unless the API and the dashboard share a parent
  domain.

## 3. Migrations

The schema is not created automatically. Pick one:

- **Pre-deploy command** (preferred, and required if you ever run more than one
  replica). In the service's deploy settings set:
  `npm run db:migrate:prod`
- **On boot.** Set `RUN_MIGRATIONS_ON_BOOT=true`. The process applies pending
  migrations before it listens, retrying a few times while a fresh database
  finishes starting, and refuses to start if they fail.

Then create the first admin, from the service shell (`railway run` or the web
terminal):

```bash
npm run seed:user:prod -- --email you@example.com --name "Your Name" --role admin
```

## 4. Health checks

- `/healthz` — liveness, always `200`, touches nothing. This is what
  `railway.json` points the platform at, so a database blip restarts nothing.
- `/api/health` — readiness, `200`/`503` with `{ ok, db }`. Use this for
  external uptime monitoring.

## 5. Front end

Point the site's `VITE_API_BASE` (or the equivalent proxy target) at the
service's public domain, and add that same origin to `CORS_ORIGIN` here. The
frontend sends `credentials: 'include'`, so the origin must match exactly —
no trailing slash, no wildcard.
