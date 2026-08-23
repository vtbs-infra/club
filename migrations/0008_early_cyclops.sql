ALTER TABLE "announcements" ADD COLUMN "public_visible" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "gift_releases" ADD COLUMN "public_visible" boolean DEFAULT false NOT NULL;