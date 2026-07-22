CREATE TABLE "snapshot_attempt_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_attempt_id" uuid NOT NULL,
	"bili_uid" text NOT NULL,
	"display_name_at_capture" text NOT NULL,
	"tier" text NOT NULL,
	"raw_tier" text NOT NULL,
	"source_page" integer NOT NULL,
	"source_position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "snapshot_attempt_members_tier_check" CHECK ("snapshot_attempt_members"."tier" in ('CAPTAIN', 'ADMIRAL', 'GOVERNOR'))
);
--> statement-breakpoint
CREATE TABLE "snapshot_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_run_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"scheduler_started_at" timestamp with time zone NOT NULL,
	"capture_started_at" timestamp with time zone,
	"capture_completed_at" timestamp with time zone,
	"punctuality" text,
	"consistency_status" text DEFAULT 'PENDING' NOT NULL,
	"declared_total" integer,
	"normalized_total" integer,
	"source_name" text NOT NULL,
	"source_version" text NOT NULL,
	"failure_code" text,
	"failure_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "snapshot_attempts_punctuality_check" CHECK ("snapshot_attempts"."punctuality" is null or "snapshot_attempts"."punctuality" in ('ON_TIME', 'LATE')),
	CONSTRAINT "snapshot_attempts_consistency_check" CHECK ("snapshot_attempts"."consistency_status" in ('PENDING', 'CONSISTENT', 'INCONSISTENT'))
);
--> statement-breakpoint
CREATE TABLE "snapshot_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_run_id" uuid NOT NULL,
	"bili_uid" text NOT NULL,
	"display_name_at_snapshot" text NOT NULL,
	"tier" text NOT NULL,
	"raw_tier" text NOT NULL,
	"source_position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "snapshot_members_tier_check" CHECK ("snapshot_members"."tier" in ('CAPTAIN', 'ADMIRAL', 'GOVERNOR'))
);
--> statement-breakpoint
CREATE TABLE "snapshot_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_attempt_id" uuid NOT NULL,
	"page_number" integer NOT NULL,
	"object_key" text NOT NULL,
	"content_hash_sha256" text NOT NULL,
	"content_encoding" text DEFAULT 'gzip' NOT NULL,
	"compressed_size" integer NOT NULL,
	"uncompressed_size" integer NOT NULL,
	"item_count" integer NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "snapshot_pages_page_positive" CHECK ("snapshot_pages"."page_number" > 0),
	CONSTRAINT "snapshot_pages_hash_check" CHECK ("snapshot_pages"."content_hash_sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "snapshot_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"creator_id" uuid NOT NULL,
	"creator_bilibili_uid" text NOT NULL,
	"creator_room_id" text NOT NULL,
	"period_start" date NOT NULL,
	"cutoff_timezone" text NOT NULL,
	"scheduled_cutoff_at" timestamp with time zone NOT NULL,
	"on_time_window_end_at" timestamp with time zone NOT NULL,
	"accepted_attempt_id" uuid,
	"status" text DEFAULT 'SCHEDULED' NOT NULL,
	"finalized_at" timestamp with time zone,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "snapshot_runs_status_check" CHECK ("snapshot_runs"."status" in ('SCHEDULED', 'RUNNING', 'FAILED', 'PENDING_APPROVAL', 'FINALIZED', 'REJECTED'))
);
--> statement-breakpoint
ALTER TABLE "snapshot_attempt_members" ADD CONSTRAINT "snapshot_attempt_members_snapshot_attempt_id_snapshot_attempts_id_fk" FOREIGN KEY ("snapshot_attempt_id") REFERENCES "public"."snapshot_attempts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshot_attempts" ADD CONSTRAINT "snapshot_attempts_snapshot_run_id_snapshot_runs_id_fk" FOREIGN KEY ("snapshot_run_id") REFERENCES "public"."snapshot_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshot_members" ADD CONSTRAINT "snapshot_members_snapshot_run_id_snapshot_runs_id_fk" FOREIGN KEY ("snapshot_run_id") REFERENCES "public"."snapshot_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshot_pages" ADD CONSTRAINT "snapshot_pages_snapshot_attempt_id_snapshot_attempts_id_fk" FOREIGN KEY ("snapshot_attempt_id") REFERENCES "public"."snapshot_attempts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshot_runs" ADD CONSTRAINT "snapshot_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshot_runs" ADD CONSTRAINT "snapshot_runs_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshot_runs" ADD CONSTRAINT "snapshot_runs_accepted_attempt_id_snapshot_attempts_id_fk" FOREIGN KEY ("accepted_attempt_id") REFERENCES "public"."snapshot_attempts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshot_runs" ADD CONSTRAINT "snapshot_runs_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "snapshot_attempt_members_attempt_uid_unique" ON "snapshot_attempt_members" USING btree ("snapshot_attempt_id","bili_uid");--> statement-breakpoint
CREATE UNIQUE INDEX "snapshot_attempts_run_number_unique" ON "snapshot_attempts" USING btree ("snapshot_run_id","attempt_number");--> statement-breakpoint
CREATE INDEX "snapshot_attempts_run_created_idx" ON "snapshot_attempts" USING btree ("snapshot_run_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "snapshot_members_run_uid_unique" ON "snapshot_members" USING btree ("snapshot_run_id","bili_uid");--> statement-breakpoint
CREATE INDEX "snapshot_members_bili_uid_idx" ON "snapshot_members" USING btree ("bili_uid");--> statement-breakpoint
CREATE UNIQUE INDEX "snapshot_pages_attempt_page_unique" ON "snapshot_pages" USING btree ("snapshot_attempt_id","page_number");--> statement-breakpoint
CREATE UNIQUE INDEX "snapshot_pages_object_key_unique" ON "snapshot_pages" USING btree ("object_key");--> statement-breakpoint
CREATE UNIQUE INDEX "snapshot_runs_creator_period_unique" ON "snapshot_runs" USING btree ("creator_id","period_start");--> statement-breakpoint
CREATE INDEX "snapshot_runs_due_idx" ON "snapshot_runs" USING btree ("status","scheduled_cutoff_at");--> statement-breakpoint
CREATE INDEX "snapshot_runs_organization_period_idx" ON "snapshot_runs" USING btree ("organization_id","period_start");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_finalized_snapshot_member_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF EXISTS (
		SELECT 1 FROM snapshot_runs
		WHERE id = OLD.snapshot_run_id AND status = 'FINALIZED'
	) THEN
		RAISE EXCEPTION 'finalized snapshot members are immutable';
	END IF;
	RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER snapshot_members_prevent_finalized_update
BEFORE UPDATE ON snapshot_members
FOR EACH ROW EXECUTE FUNCTION prevent_finalized_snapshot_member_mutation();
--> statement-breakpoint
CREATE TRIGGER snapshot_members_prevent_finalized_delete
BEFORE DELETE ON snapshot_members
FOR EACH ROW EXECUTE FUNCTION prevent_finalized_snapshot_member_mutation();
