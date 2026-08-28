DROP INDEX "snapshot_pages_attempt_page_unique";--> statement-breakpoint
ALTER TABLE "snapshot_attempts" ADD COLUMN "initiated_by" text DEFAULT 'SCHEDULER' NOT NULL;--> statement-breakpoint
ALTER TABLE "snapshot_attempts" ADD COLUMN "requested_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "snapshot_pages" ADD COLUMN "capture_kind" text NOT NULL;--> statement-breakpoint
ALTER TABLE "snapshot_pages" ADD COLUMN "declared_page_count" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "snapshot_pages" ADD COLUMN "declared_total" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "snapshot_attempts" ADD CONSTRAINT "snapshot_attempts_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "snapshot_pages_attempt_kind_page_unique" ON "snapshot_pages" USING btree ("snapshot_attempt_id","capture_kind","page_number");--> statement-breakpoint
ALTER TABLE "snapshot_attempts" ADD CONSTRAINT "snapshot_attempts_initiated_by_check" CHECK ("snapshot_attempts"."initiated_by" in ('SCHEDULER', 'ADMIN'));--> statement-breakpoint
ALTER TABLE "snapshot_pages" ADD CONSTRAINT "snapshot_pages_capture_kind_check" CHECK ("snapshot_pages"."capture_kind" in ('PAGE', 'RECHECK'));--> statement-breakpoint
ALTER TABLE "snapshot_pages" ADD CONSTRAINT "snapshot_pages_declared_counts_check" CHECK ("snapshot_pages"."declared_page_count" > 0 and "snapshot_pages"."declared_total" >= 0);