-- Only `leads` and `users` are kept. Dropping `submission_attempts` removes the
-- IP rate limit on POST /api/leads, and dropping `audit_log` removes both the
-- audit trail and the login brute-force throttle that counted `login_failed`
-- rows in it. Deliberate — see the app code, which no longer enforces either.
DROP TABLE "audit_log" CASCADE;--> statement-breakpoint
DROP TABLE "blocked_ips" CASCADE;--> statement-breakpoint
DROP TABLE "submission_attempts" CASCADE;