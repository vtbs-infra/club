ALTER TABLE "shipments" ADD COLUMN "tracking_failure_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "shipments" ADD COLUMN "last_tracking_error" text;