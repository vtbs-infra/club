CREATE TABLE "addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"label" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"ciphertext" text NOT NULL,
	"initialization_vector" text NOT NULL,
	"authentication_tag" text NOT NULL,
	"key_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "addresses_key_version_positive" CHECK ("addresses"."key_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "claim_addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" uuid NOT NULL,
	"source_address_id" uuid,
	"ciphertext" text NOT NULL,
	"initialization_vector" text NOT NULL,
	"authentication_tag" text NOT NULL,
	"key_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claim_addresses_key_version_positive" CHECK ("claim_addresses"."key_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "claim_entitlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" uuid NOT NULL,
	"entitlement_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claim_option_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" uuid NOT NULL,
	"field_key" text NOT NULL,
	"ciphertext" text NOT NULL,
	"initialization_vector" text NOT NULL,
	"authentication_tag" text NOT NULL,
	"key_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claim_option_values_key_version_positive" CHECK ("claim_option_values"."key_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "claim_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_id" uuid NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"actor_user_id" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claim_status_history_from_check" CHECK ("claim_status_history"."from_status" is null or "claim_status_history"."from_status" in ('SUBMITTED', 'PROCESSING', 'SHIPPED', 'COMPLETED', 'CANCELLED')),
	CONSTRAINT "claim_status_history_to_check" CHECK ("claim_status_history"."to_status" in ('SUBMITTED', 'PROCESSING', 'SHIPPED', 'COMPLETED', 'CANCELLED'))
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"claim_number" text NOT NULL,
	"organization_id" uuid NOT NULL,
	"creator_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"bili_uid" text NOT NULL,
	"status" text DEFAULT 'SUBMITTED' NOT NULL,
	"submitted_at" timestamp with time zone NOT NULL,
	"processing_at" timestamp with time zone,
	"shipped_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "claims_status_check" CHECK ("claims"."status" in ('SUBMITTED', 'PROCESSING', 'SHIPPED', 'COMPLETED', 'CANCELLED')),
	CONSTRAINT "claims_version_positive" CHECK ("claims"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "idempotency_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_records_hash_check" CHECK ("idempotency_records"."request_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_addresses" ADD CONSTRAINT "claim_addresses_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_entitlements" ADD CONSTRAINT "claim_entitlements_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_entitlements" ADD CONSTRAINT "claim_entitlements_entitlement_id_entitlements_id_fk" FOREIGN KEY ("entitlement_id") REFERENCES "public"."entitlements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_option_values" ADD CONSTRAINT "claim_option_values_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_status_history" ADD CONSTRAINT "claim_status_history_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claim_status_history" ADD CONSTRAINT "claim_status_history_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_campaign_id_gift_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."gift_campaigns"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "addresses_user_created_idx" ON "addresses" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "addresses_user_default_unique" ON "addresses" USING btree ("user_id") WHERE "addresses"."is_default" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "claim_addresses_claim_unique" ON "claim_addresses" USING btree ("claim_id");--> statement-breakpoint
CREATE UNIQUE INDEX "claim_entitlements_claim_entitlement_unique" ON "claim_entitlements" USING btree ("claim_id","entitlement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "claim_entitlements_entitlement_unique" ON "claim_entitlements" USING btree ("entitlement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "claim_option_values_claim_key_unique" ON "claim_option_values" USING btree ("claim_id","field_key");--> statement-breakpoint
CREATE INDEX "claim_status_history_claim_created_idx" ON "claim_status_history" USING btree ("claim_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "claims_claim_number_unique" ON "claims" USING btree ("claim_number");--> statement-breakpoint
CREATE UNIQUE INDEX "claims_campaign_bili_uid_unique" ON "claims" USING btree ("campaign_id","bili_uid");--> statement-breakpoint
CREATE INDEX "claims_organization_status_idx" ON "claims" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "claims_user_updated_idx" ON "claims" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_records_actor_scope_key_unique" ON "idempotency_records" USING btree ("actor_user_id","scope","key");--> statement-breakpoint
CREATE INDEX "idempotency_records_expiry_idx" ON "idempotency_records" USING btree ("expires_at");
--> statement-breakpoint
CREATE SEQUENCE claim_number_sequence START WITH 1 INCREMENT BY 1 NO CYCLE;
--> statement-breakpoint
CREATE FUNCTION enforce_claim_transition() RETURNS trigger AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'claims cannot be deleted';
	END IF;
	IF NEW.claim_number IS DISTINCT FROM OLD.claim_number
		OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
		OR NEW.creator_id IS DISTINCT FROM OLD.creator_id
		OR NEW.campaign_id IS DISTINCT FROM OLD.campaign_id
		OR NEW.user_id IS DISTINCT FROM OLD.user_id
		OR NEW.bili_uid IS DISTINCT FROM OLD.bili_uid
		OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
		RAISE EXCEPTION 'claim identity is immutable';
	END IF;
	IF NEW.version <> OLD.version + 1 THEN
		RAISE EXCEPTION 'claim version must increment exactly once';
	END IF;
	IF NEW.status <> OLD.status AND NOT (
		(OLD.status = 'SUBMITTED' AND NEW.status IN ('PROCESSING', 'CANCELLED'))
		OR (OLD.status = 'PROCESSING' AND NEW.status IN ('SHIPPED', 'CANCELLED'))
		OR (OLD.status = 'SHIPPED' AND NEW.status = 'COMPLETED')
		OR (OLD.status = 'CANCELLED' AND NEW.status = 'SUBMITTED')
	) THEN
		RAISE EXCEPTION 'invalid claim state transition';
	END IF;
	IF NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
		AND NOT (OLD.status = 'CANCELLED' AND NEW.status = 'SUBMITTED') THEN
		RAISE EXCEPTION 'submitted timestamp is immutable outside resubmission';
	END IF;
	IF NEW.status = 'PROCESSING' AND NEW.processing_at IS NULL THEN
		RAISE EXCEPTION 'processing timestamp is required';
	END IF;
	IF NEW.status = 'SHIPPED' AND NEW.shipped_at IS NULL THEN
		RAISE EXCEPTION 'shipped timestamp is required';
	END IF;
	IF NEW.status = 'COMPLETED' AND NEW.completed_at IS NULL THEN
		RAISE EXCEPTION 'completed timestamp is required';
	END IF;
	IF NEW.status = 'CANCELLED' AND (NEW.cancelled_at IS NULL OR length(NEW.cancel_reason) < 3) THEN
		RAISE EXCEPTION 'cancel timestamp and reason are required';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER claims_state_and_identity
	BEFORE UPDATE OR DELETE ON "claims"
	FOR EACH ROW EXECUTE FUNCTION enforce_claim_transition();
--> statement-breakpoint
CREATE FUNCTION preserve_claim_entitlements() RETURNS trigger AS $$
DECLARE claim_record claims%ROWTYPE;
DECLARE entitlement_record entitlements%ROWTYPE;
BEGIN
	IF TG_OP <> 'INSERT' THEN
		RAISE EXCEPTION 'claim entitlement links are immutable';
	END IF;
	SELECT * INTO claim_record FROM claims WHERE id = NEW.claim_id;
	SELECT * INTO entitlement_record FROM entitlements WHERE id = NEW.entitlement_id;
	IF entitlement_record.revoked_at IS NOT NULL
		OR entitlement_record.campaign_id IS DISTINCT FROM claim_record.campaign_id
		OR entitlement_record.organization_id IS DISTINCT FROM claim_record.organization_id
		OR entitlement_record.creator_id IS DISTINCT FROM claim_record.creator_id
		OR entitlement_record.bili_uid IS DISTINCT FROM claim_record.bili_uid THEN
		RAISE EXCEPTION 'claim entitlement does not match claim identity';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER claim_entitlements_preserve_identity
	BEFORE INSERT OR UPDATE OR DELETE ON "claim_entitlements"
	FOR EACH ROW EXECUTE FUNCTION preserve_claim_entitlements();
--> statement-breakpoint
CREATE FUNCTION enforce_submitted_claim_mutability() RETURNS trigger AS $$
DECLARE claim_status text;
BEGIN
	SELECT status INTO claim_status FROM claims WHERE id = COALESCE(NEW.claim_id, OLD.claim_id);
	IF claim_status <> 'SUBMITTED' THEN
		RAISE EXCEPTION 'claim address and options are frozen';
	END IF;
	RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER claim_addresses_submitted_only
	BEFORE INSERT OR UPDATE OR DELETE ON "claim_addresses"
	FOR EACH ROW EXECUTE FUNCTION enforce_submitted_claim_mutability();
--> statement-breakpoint
CREATE TRIGGER claim_option_values_submitted_only
	BEFORE INSERT OR UPDATE OR DELETE ON "claim_option_values"
	FOR EACH ROW EXECUTE FUNCTION enforce_submitted_claim_mutability();
--> statement-breakpoint
CREATE FUNCTION preserve_claim_status_history() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION 'claim status history is append-only';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER claim_status_history_append_only
	BEFORE UPDATE OR DELETE ON "claim_status_history"
	FOR EACH ROW EXECUTE FUNCTION preserve_claim_status_history();
--> statement-breakpoint
CREATE FUNCTION preserve_idempotency_identity() RETURNS trigger AS $$
BEGIN
	IF NEW.actor_user_id IS DISTINCT FROM OLD.actor_user_id
		OR NEW.scope IS DISTINCT FROM OLD.scope
		OR NEW.key IS DISTINCT FROM OLD.key
		OR NEW.request_hash IS DISTINCT FROM OLD.request_hash
		OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
		OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
		RAISE EXCEPTION 'idempotency identity is immutable';
	END IF;
	IF OLD.response_body IS NOT NULL THEN
		RAISE EXCEPTION 'completed idempotency response is immutable';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER idempotency_records_preserve_identity
	BEFORE UPDATE ON "idempotency_records"
	FOR EACH ROW EXECUTE FUNCTION preserve_idempotency_identity();
