ALTER TABLE "creators" RENAME COLUMN "active" TO "monthly_sync_enabled";--> statement-breakpoint
DROP INDEX "creators_active_idx";--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN "binding_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "creators" ADD COLUMN "profile_synced_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "creators" ADD CONSTRAINT "creators_binding_id_bilibili_bindings_id_fk" FOREIGN KEY ("binding_id") REFERENCES "public"."bilibili_bindings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "creators_binding_unique" ON "creators" USING btree ("binding_id");--> statement-breakpoint
CREATE INDEX "creators_monthly_sync_enabled_idx" ON "creators" USING btree ("monthly_sync_enabled");