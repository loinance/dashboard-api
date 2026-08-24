-- citext gives `users.email` case-insensitive uniqueness in the database rather
-- than in application code, so two rows differing only in case cannot exist.
-- gen_random_uuid() is built into Postgres 13+, so pgcrypto is not needed.
CREATE EXTENSION IF NOT EXISTS citext;--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid,
	"action" text NOT NULL,
	"entity_id" uuid,
	"payload" jsonb,
	"ip" "inet"
);
--> statement-breakpoint
CREATE TABLE "blocked_ips" (
	"ip" "inet" PRIMARY KEY NOT NULL,
	"reason" text NOT NULL,
	"blocked_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"full_name" text NOT NULL,
	"mobile" text NOT NULL,
	"loan_type" text NOT NULL,
	"amount" bigint NOT NULL,
	"income" bigint NOT NULL,
	"employment" text NOT NULL,
	"consent_at" timestamp with time zone NOT NULL,
	"consent_text" text NOT NULL,
	"consent_version" text DEFAULT 'v1' NOT NULL,
	"ip" "inet",
	"user_agent" text,
	"referer" text,
	"page_url" text,
	"utm" jsonb,
	"source" text DEFAULT 'hero',
	"risk_flags" text[] DEFAULT '{}' NOT NULL,
	"is_suspect" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"notes" text,
	"owner_id" uuid,
	"first_call_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "submission_attempts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"ip" "inet" NOT NULL,
	"mobile" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"outcome" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" "citext" NOT NULL,
	"password_hash" text NOT NULL,
	"name" text NOT NULL,
	"role" text DEFAULT 'agent' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocked_ips" ADD CONSTRAINT "blocked_ips_blocked_by_users_id_fk" FOREIGN KEY ("blocked_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_action_at_idx" ON "audit_log" USING btree ("action","at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "leads_created_at_idx" ON "leads" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "leads_loan_type_idx" ON "leads" USING btree ("loan_type");--> statement-breakpoint
CREATE INDEX "leads_status_idx" ON "leads" USING btree ("status");--> statement-breakpoint
CREATE INDEX "leads_mobile_idx" ON "leads" USING btree ("mobile");--> statement-breakpoint
CREATE INDEX "leads_ip_created_idx" ON "leads" USING btree ("ip","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "leads_suspect_idx" ON "leads" USING btree ("is_suspect") WHERE is_suspect = true;--> statement-breakpoint
CREATE INDEX "submission_attempts_ip_at_idx" ON "submission_attempts" USING btree ("ip","at" DESC NULLS LAST);