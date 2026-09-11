CREATE TABLE "bilibili_login_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"club_session_id" text NOT NULL,
	"state" text DEFAULT 'CREATING' NOT NULL,
	"base_revision" integer NOT NULL,
	"qr_context" jsonb,
	"candidate_credentials" jsonb,
	"account" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"next_poll_at" timestamp with time zone DEFAULT now() NOT NULL,
	"operation_id" uuid,
	"operation_expires_at" timestamp with time zone,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bilibili_login_attempts_state_check" CHECK ("bilibili_login_attempts"."state" in ('CREATING', 'WAITING', 'VERIFYING', 'READY', 'ACTIVATING', 'APPLIED', 'CANCELLED', 'EXPIRED', 'FAILED')),
	CONSTRAINT "bilibili_login_attempts_terminal_secrets_check" CHECK ("bilibili_login_attempts"."state" in ('CREATING', 'WAITING', 'VERIFYING', 'READY', 'ACTIVATING') or ("bilibili_login_attempts"."qr_context" is null and "bilibili_login_attempts"."candidate_credentials" is null))
);
--> statement-breakpoint
CREATE TABLE "bilibili_sessions" (
	"id" text PRIMARY KEY DEFAULT 'global' NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"validity" text DEFAULT 'NOT_CONFIGURED' NOT NULL,
	"reachability" text DEFAULT 'UNKNOWN' NOT NULL,
	"account" jsonb,
	"credentials" jsonb,
	"pending_credentials" jsonb,
	"operation" text,
	"operation_id" uuid,
	"operation_expires_at" timestamp with time zone,
	"error_code" text,
	"logged_in_at" timestamp with time zone,
	"checked_at" timestamp with time zone,
	"refreshed_at" timestamp with time zone,
	"next_check_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bilibili_sessions_singleton_check" CHECK ("bilibili_sessions"."id" = 'global'),
	CONSTRAINT "bilibili_sessions_revision_check" CHECK ("bilibili_sessions"."revision" >= 0),
	CONSTRAINT "bilibili_sessions_validity_check" CHECK ("bilibili_sessions"."validity" in ('NOT_CONFIGURED', 'CHECKING', 'VALID', 'REAUTH_REQUIRED')),
	CONSTRAINT "bilibili_sessions_reachability_check" CHECK ("bilibili_sessions"."reachability" in ('UNKNOWN', 'HEALTHY', 'UNAVAILABLE')),
	CONSTRAINT "bilibili_sessions_operation_check" CHECK (("bilibili_sessions"."operation" is null and "bilibili_sessions"."operation_id" is null and "bilibili_sessions"."operation_expires_at" is null) or ("bilibili_sessions"."operation" is not null and "bilibili_sessions"."operation" in ('CHECKING', 'REFRESHING', 'VERIFYING') and "bilibili_sessions"."operation_id" is not null and "bilibili_sessions"."operation_expires_at" is not null)),
	CONSTRAINT "bilibili_sessions_valid_credentials_check" CHECK ("bilibili_sessions"."validity" <> 'VALID' or ("bilibili_sessions"."credentials" is not null and "bilibili_sessions"."account" is not null))
);
--> statement-breakpoint
ALTER TABLE "bilibili_login_attempts" ADD CONSTRAINT "bilibili_login_attempts_admin_user_id_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bilibili_login_attempts" ADD CONSTRAINT "bilibili_login_attempts_club_session_id_sessions_id_fk" FOREIGN KEY ("club_session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bilibili_login_attempts_active_admin_unique" ON "bilibili_login_attempts" USING btree ("admin_user_id") WHERE "bilibili_login_attempts"."state" in ('CREATING', 'WAITING', 'VERIFYING', 'READY', 'ACTIVATING');--> statement-breakpoint
CREATE INDEX "bilibili_login_attempts_expiry_idx" ON "bilibili_login_attempts" USING btree ("expires_at");