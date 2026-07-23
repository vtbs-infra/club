CREATE TABLE "entitlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"creator_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"snapshot_member_id" uuid NOT NULL,
	"gift_package_id" uuid NOT NULL,
	"bili_uid" text NOT NULL,
	"tier" text NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	"revoke_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entitlements_tier_check" CHECK ("entitlements"."tier" in ('CAPTAIN', 'ADMIRAL', 'GOVERNOR')),
	CONSTRAINT "entitlements_revocation_check" CHECK (("entitlements"."revoked_at" is null and "entitlements"."revoked_by" is null and "entitlements"."revoke_reason" is null) or ("entitlements"."revoked_at" is not null and "entitlements"."revoked_by" is not null and length("entitlements"."revoke_reason") >= 3))
);
--> statement-breakpoint
CREATE TABLE "gift_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"creator_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"cover_file_id" uuid,
	"claim_start_at" timestamp with time zone NOT NULL,
	"claim_deadline_at" timestamp with time zone NOT NULL,
	"fulfillment_mode" text NOT NULL,
	"claim_form_schema" jsonb NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"published_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gift_campaigns_status_check" CHECK ("gift_campaigns"."status" in ('DRAFT', 'PUBLISHED', 'CLOSED', 'ARCHIVED')),
	CONSTRAINT "gift_campaigns_fulfillment_mode_check" CHECK ("gift_campaigns"."fulfillment_mode" in ('HIGHEST_ONLY', 'CUMULATIVE')),
	CONSTRAINT "gift_campaigns_claim_window_check" CHECK ("gift_campaigns"."claim_deadline_at" > "gift_campaigns"."claim_start_at")
);
--> statement-breakpoint
CREATE TABLE "gift_package_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gift_package_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gift_package_items_quantity_positive" CHECK ("gift_package_items"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "gift_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gift_tier_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"tier" text NOT NULL,
	"gift_package_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gift_tier_rules_tier_check" CHECK ("gift_tier_rules"."tier" in ('CAPTAIN', 'ADMIRAL', 'GOVERNOR'))
);
--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_campaign_id_gift_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."gift_campaigns"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_snapshot_member_id_snapshot_members_id_fk" FOREIGN KEY ("snapshot_member_id") REFERENCES "public"."snapshot_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_gift_package_id_gift_packages_id_fk" FOREIGN KEY ("gift_package_id") REFERENCES "public"."gift_packages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlements" ADD CONSTRAINT "entitlements_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_campaigns" ADD CONSTRAINT "gift_campaigns_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_campaigns" ADD CONSTRAINT "gift_campaigns_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_campaigns" ADD CONSTRAINT "gift_campaigns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_package_items" ADD CONSTRAINT "gift_package_items_gift_package_id_gift_packages_id_fk" FOREIGN KEY ("gift_package_id") REFERENCES "public"."gift_packages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_packages" ADD CONSTRAINT "gift_packages_campaign_id_gift_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."gift_campaigns"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_tier_rules" ADD CONSTRAINT "gift_tier_rules_campaign_id_gift_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."gift_campaigns"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_tier_rules" ADD CONSTRAINT "gift_tier_rules_gift_package_id_gift_packages_id_fk" FOREIGN KEY ("gift_package_id") REFERENCES "public"."gift_packages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "entitlements_campaign_member_package_unique" ON "entitlements" USING btree ("campaign_id","snapshot_member_id","gift_package_id");--> statement-breakpoint
CREATE INDEX "entitlements_bili_uid_idx" ON "entitlements" USING btree ("bili_uid");--> statement-breakpoint
CREATE INDEX "entitlements_campaign_revoked_idx" ON "entitlements" USING btree ("campaign_id","revoked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "gift_campaigns_creator_period_unique" ON "gift_campaigns" USING btree ("creator_id","period_start");--> statement-breakpoint
CREATE INDEX "gift_campaigns_organization_status_idx" ON "gift_campaigns" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "gift_package_items_package_sort_idx" ON "gift_package_items" USING btree ("gift_package_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "gift_packages_campaign_name_unique" ON "gift_packages" USING btree ("campaign_id","name");--> statement-breakpoint
CREATE INDEX "gift_packages_campaign_sort_idx" ON "gift_packages" USING btree ("campaign_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "gift_tier_rules_campaign_tier_unique" ON "gift_tier_rules" USING btree ("campaign_id","tier");
--> statement-breakpoint
CREATE FUNCTION prevent_published_campaign_rule_changes() RETURNS trigger AS $$
BEGIN
	IF OLD.status = 'DRAFT' THEN
		IF NEW.status NOT IN ('DRAFT', 'PUBLISHED') THEN
			RAISE EXCEPTION 'invalid campaign state transition';
		END IF;
		RETURN NEW;
	END IF;
	IF OLD.status = 'PUBLISHED' AND NEW.status NOT IN ('PUBLISHED', 'CLOSED') THEN
		RAISE EXCEPTION 'invalid campaign state transition';
	END IF;
	IF OLD.status = 'CLOSED' AND NEW.status NOT IN ('CLOSED', 'ARCHIVED') THEN
		RAISE EXCEPTION 'invalid campaign state transition';
	END IF;
	IF OLD.status = 'ARCHIVED' AND NEW.status <> 'ARCHIVED' THEN
		RAISE EXCEPTION 'invalid campaign state transition';
	END IF;
	IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
		OR NEW.creator_id IS DISTINCT FROM OLD.creator_id
		OR NEW.period_start IS DISTINCT FROM OLD.period_start
		OR NEW.claim_start_at IS DISTINCT FROM OLD.claim_start_at
		OR NEW.fulfillment_mode IS DISTINCT FROM OLD.fulfillment_mode
		OR NEW.claim_form_schema IS DISTINCT FROM OLD.claim_form_schema
		OR NEW.created_by IS DISTINCT FROM OLD.created_by
		OR NEW.published_at IS DISTINCT FROM OLD.published_at THEN
		RAISE EXCEPTION 'published campaign eligibility rules are immutable';
	END IF;
	IF NEW.claim_deadline_at < OLD.claim_deadline_at THEN
		RAISE EXCEPTION 'published campaign deadline cannot be shortened';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER gift_campaigns_published_immutability
	BEFORE UPDATE ON "gift_campaigns"
	FOR EACH ROW EXECUTE FUNCTION prevent_published_campaign_rule_changes();
--> statement-breakpoint
CREATE FUNCTION prevent_published_package_changes() RETURNS trigger AS $$
DECLARE campaign_status text;
BEGIN
	SELECT status INTO campaign_status FROM gift_campaigns WHERE id = COALESCE(NEW.campaign_id, OLD.campaign_id);
	IF campaign_status <> 'DRAFT' THEN
		RAISE EXCEPTION 'published campaign packages are immutable';
	END IF;
	RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER gift_packages_published_immutability
	BEFORE INSERT OR UPDATE OR DELETE ON "gift_packages"
	FOR EACH ROW EXECUTE FUNCTION prevent_published_package_changes();
--> statement-breakpoint
CREATE FUNCTION prevent_published_package_item_changes() RETURNS trigger AS $$
DECLARE campaign_status text;
BEGIN
	SELECT campaign.status INTO campaign_status
	FROM gift_packages package
	JOIN gift_campaigns campaign ON campaign.id = package.campaign_id
	WHERE package.id = COALESCE(NEW.gift_package_id, OLD.gift_package_id);
	IF campaign_status <> 'DRAFT' THEN
		RAISE EXCEPTION 'published campaign package items are immutable';
	END IF;
	RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER gift_package_items_published_immutability
	BEFORE INSERT OR UPDATE OR DELETE ON "gift_package_items"
	FOR EACH ROW EXECUTE FUNCTION prevent_published_package_item_changes();
--> statement-breakpoint
CREATE FUNCTION validate_tier_rule_change() RETURNS trigger AS $$
DECLARE campaign_status text;
DECLARE package_campaign_id uuid;
BEGIN
	SELECT status INTO campaign_status FROM gift_campaigns WHERE id = COALESCE(NEW.campaign_id, OLD.campaign_id);
	IF campaign_status <> 'DRAFT' THEN
		RAISE EXCEPTION 'published campaign tier rules are immutable';
	END IF;
	IF TG_OP <> 'DELETE' THEN
		SELECT campaign_id INTO package_campaign_id FROM gift_packages WHERE id = NEW.gift_package_id;
		IF package_campaign_id IS DISTINCT FROM NEW.campaign_id THEN
			RAISE EXCEPTION 'tier rule package belongs to another campaign';
		END IF;
	END IF;
	RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER gift_tier_rules_published_immutability
	BEFORE INSERT OR UPDATE OR DELETE ON "gift_tier_rules"
	FOR EACH ROW EXECUTE FUNCTION validate_tier_rule_change();
--> statement-breakpoint
CREATE FUNCTION preserve_entitlement_evidence() RETURNS trigger AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'entitlements cannot be deleted';
	END IF;
	IF OLD.revoked_at IS NOT NULL THEN
		RAISE EXCEPTION 'revoked entitlements are immutable';
	END IF;
	IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
		OR NEW.creator_id IS DISTINCT FROM OLD.creator_id
		OR NEW.campaign_id IS DISTINCT FROM OLD.campaign_id
		OR NEW.snapshot_member_id IS DISTINCT FROM OLD.snapshot_member_id
		OR NEW.gift_package_id IS DISTINCT FROM OLD.gift_package_id
		OR NEW.bili_uid IS DISTINCT FROM OLD.bili_uid
		OR NEW.tier IS DISTINCT FROM OLD.tier
		OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
		RAISE EXCEPTION 'entitlement source evidence is immutable';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER entitlements_preserve_evidence
	BEFORE UPDATE OR DELETE ON "entitlements"
	FOR EACH ROW EXECUTE FUNCTION preserve_entitlement_evidence();
