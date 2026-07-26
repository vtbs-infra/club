CREATE TABLE "announcement_reads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"announcement_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "announcements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" text NOT NULL,
	"organization_id" uuid,
	"creator_id" uuid,
	"campaign_id" uuid,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"severity" text DEFAULT 'INFO' NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "announcements_scope_check" CHECK ("announcements"."scope" in ('PLATFORM', 'ORGANIZATION', 'CREATOR', 'CAMPAIGN')),
	CONSTRAINT "announcements_severity_check" CHECK ("announcements"."severity" in ('INFO', 'WARNING', 'CRITICAL')),
	CONSTRAINT "announcements_version_positive" CHECK ("announcements"."version" > 0),
	CONSTRAINT "announcements_expiry_check" CHECK ("announcements"."expires_at" is null or "announcements"."published_at" is null or "announcements"."expires_at" > "announcements"."published_at"),
	CONSTRAINT "announcements_scope_identity_check" CHECK ((
        ("announcements"."scope" = 'PLATFORM' and "announcements"."organization_id" is null and "announcements"."creator_id" is null and "announcements"."campaign_id" is null)
        or ("announcements"."scope" = 'ORGANIZATION' and "announcements"."organization_id" is not null and "announcements"."creator_id" is null and "announcements"."campaign_id" is null)
        or ("announcements"."scope" = 'CREATOR' and "announcements"."organization_id" is not null and "announcements"."creator_id" is not null and "announcements"."campaign_id" is null)
        or ("announcements"."scope" = 'CAMPAIGN' and "announcements"."organization_id" is not null and "announcements"."creator_id" is null and "announcements"."campaign_id" is not null)
      ))
);
--> statement-breakpoint
ALTER TABLE "announcement_reads" ADD CONSTRAINT "announcement_reads_announcement_id_announcements_id_fk" FOREIGN KEY ("announcement_id") REFERENCES "public"."announcements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_reads" ADD CONSTRAINT "announcement_reads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_campaign_id_gift_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."gift_campaigns"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "announcement_reads_announcement_user_unique" ON "announcement_reads" USING btree ("announcement_id","user_id");--> statement-breakpoint
CREATE INDEX "announcement_reads_user_read_idx" ON "announcement_reads" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE INDEX "announcements_visibility_idx" ON "announcements" USING btree ("scope","published_at","expires_at");--> statement-breakpoint
CREATE INDEX "announcements_organization_created_idx" ON "announcements" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "announcements_creator_created_idx" ON "announcements" USING btree ("creator_id","created_at");--> statement-breakpoint
CREATE INDEX "announcements_campaign_created_idx" ON "announcements" USING btree ("campaign_id","created_at");
--> statement-breakpoint
CREATE FUNCTION enforce_announcement_identity_and_version() RETURNS trigger AS $$
DECLARE target_organization_id uuid;
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'announcements cannot be deleted';
	END IF;
	IF NEW.scope = 'CREATOR' THEN
		SELECT organization_id INTO target_organization_id FROM creators WHERE id = NEW.creator_id;
	ELSIF NEW.scope = 'CAMPAIGN' THEN
		SELECT organization_id INTO target_organization_id FROM gift_campaigns WHERE id = NEW.campaign_id;
	ELSE
		target_organization_id := NEW.organization_id;
	END IF;
	IF NEW.scope <> 'PLATFORM' AND target_organization_id IS DISTINCT FROM NEW.organization_id THEN
		RAISE EXCEPTION 'announcement target does not belong to organization';
	END IF;
	IF TG_OP = 'UPDATE' THEN
		IF NEW.scope IS DISTINCT FROM OLD.scope
			OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
			OR NEW.creator_id IS DISTINCT FROM OLD.creator_id
			OR NEW.campaign_id IS DISTINCT FROM OLD.campaign_id
			OR NEW.created_by IS DISTINCT FROM OLD.created_by
			OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
			RAISE EXCEPTION 'announcement identity is immutable';
		END IF;
		IF NEW.version <> OLD.version + 1 THEN
			RAISE EXCEPTION 'announcement version must increment exactly once';
		END IF;
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER announcements_identity_and_version
	BEFORE INSERT OR UPDATE OR DELETE ON "announcements"
	FOR EACH ROW EXECUTE FUNCTION enforce_announcement_identity_and_version();
--> statement-breakpoint
CREATE FUNCTION preserve_announcement_reads() RETURNS trigger AS $$
BEGIN
	IF TG_OP <> 'INSERT' THEN
		RAISE EXCEPTION 'announcement reads are immutable';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER announcement_reads_immutable
	BEFORE UPDATE OR DELETE ON "announcement_reads"
	FOR EACH ROW EXECUTE FUNCTION preserve_announcement_reads();
