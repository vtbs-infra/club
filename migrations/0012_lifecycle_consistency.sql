DROP INDEX "announcement_reads_announcement_user_unique";--> statement-breakpoint
ALTER TABLE "announcement_reads" ADD COLUMN "announcement_version" integer NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "announcement_reads_announcement_user_version_unique" ON "announcement_reads" USING btree ("announcement_id","user_id","announcement_version");--> statement-breakpoint
ALTER TABLE "announcement_reads" ADD CONSTRAINT "announcement_reads_version_positive" CHECK ("announcement_reads"."announcement_version" > 0);