ALTER TABLE "idempotency_records" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "idempotency_records" CASCADE;--> statement-breakpoint
DROP INDEX "creators_active_idx";--> statement-breakpoint
CREATE INDEX "creators_active_idx" ON "creators" USING btree ("active");--> statement-breakpoint
ALTER TABLE "creators" DROP COLUMN "archived_at";--> statement-breakpoint
ALTER TABLE "verification_rooms" DROP COLUMN "bili_owner_uid";