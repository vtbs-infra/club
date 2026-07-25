CREATE TABLE "shipment_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"claim_entitlement_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_number" text NOT NULL,
	"shipment_key" text NOT NULL,
	"claim_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"creator_id" uuid NOT NULL,
	"carrier_code" text NOT NULL,
	"tracking_number" text NOT NULL,
	"tracking_url" text,
	"status" text DEFAULT 'LABEL_CREATED' NOT NULL,
	"delivered_at" timestamp with time zone,
	"last_tracking_refresh_at" timestamp with time zone,
	"next_tracking_refresh_at" timestamp with time zone,
	"exception_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipments_status_check" CHECK ("shipments"."status" in ('LABEL_CREATED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'EXCEPTION')),
	CONSTRAINT "shipments_tracking_identity_check" CHECK (length("shipments"."shipment_key") between 1 and 120 and length("shipments"."carrier_code") between 1 and 80 and length("shipments"."tracking_number") between 1 and 160)
);
--> statement-breakpoint
CREATE TABLE "tracking_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_id" uuid NOT NULL,
	"provider_event_id" text NOT NULL,
	"status" text NOT NULL,
	"description" text NOT NULL,
	"location" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tracking_events_status_check" CHECK ("tracking_events"."status" in ('LABEL_CREATED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'EXCEPTION'))
);
--> statement-breakpoint
ALTER TABLE "shipment_items" ADD CONSTRAINT "shipment_items_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_items" ADD CONSTRAINT "shipment_items_claim_entitlement_id_claim_entitlements_id_fk" FOREIGN KEY ("claim_entitlement_id") REFERENCES "public"."claim_entitlements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."claims"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking_events" ADD CONSTRAINT "tracking_events_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "shipment_items_shipment_entitlement_unique" ON "shipment_items" USING btree ("shipment_id","claim_entitlement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shipment_items_claim_entitlement_unique" ON "shipment_items" USING btree ("claim_entitlement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shipments_shipment_number_unique" ON "shipments" USING btree ("shipment_number");--> statement-breakpoint
CREATE UNIQUE INDEX "shipments_claim_key_unique" ON "shipments" USING btree ("claim_id","shipment_key");--> statement-breakpoint
CREATE INDEX "shipments_organization_status_idx" ON "shipments" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "shipments_tracking_due_idx" ON "shipments" USING btree ("next_tracking_refresh_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tracking_events_shipment_provider_unique" ON "tracking_events" USING btree ("shipment_id","provider_event_id");--> statement-breakpoint
CREATE INDEX "tracking_events_shipment_occurred_idx" ON "tracking_events" USING btree ("shipment_id","occurred_at");
--> statement-breakpoint
CREATE SEQUENCE shipment_number_sequence START WITH 1 INCREMENT BY 1 NO CYCLE;
--> statement-breakpoint
CREATE FUNCTION enforce_shipment_identity_and_state() RETURNS trigger AS $$
DECLARE claim_record claims%ROWTYPE;
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'shipments cannot be deleted';
	END IF;
	SELECT * INTO claim_record FROM claims WHERE id = NEW.claim_id;
	IF claim_record.id IS NULL
		OR NEW.organization_id IS DISTINCT FROM claim_record.organization_id
		OR NEW.creator_id IS DISTINCT FROM claim_record.creator_id THEN
		RAISE EXCEPTION 'shipment does not match claim identity';
	END IF;
	IF claim_record.status NOT IN ('PROCESSING', 'SHIPPED', 'COMPLETED') THEN
		RAISE EXCEPTION 'claim is not ready for fulfillment';
	END IF;
	IF TG_OP = 'UPDATE' THEN
		IF NEW.shipment_number IS DISTINCT FROM OLD.shipment_number
			OR NEW.shipment_key IS DISTINCT FROM OLD.shipment_key
			OR NEW.claim_id IS DISTINCT FROM OLD.claim_id
			OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
			OR NEW.creator_id IS DISTINCT FROM OLD.creator_id
			OR NEW.carrier_code IS DISTINCT FROM OLD.carrier_code
			OR NEW.tracking_number IS DISTINCT FROM OLD.tracking_number
			OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
			RAISE EXCEPTION 'shipment identity is immutable';
		END IF;
		IF NEW.status <> OLD.status AND NOT (
			(OLD.status = 'LABEL_CREATED' AND NEW.status IN ('IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'EXCEPTION'))
			OR (OLD.status = 'IN_TRANSIT' AND NEW.status IN ('OUT_FOR_DELIVERY', 'DELIVERED', 'EXCEPTION'))
			OR (OLD.status = 'OUT_FOR_DELIVERY' AND NEW.status IN ('DELIVERED', 'EXCEPTION'))
			OR (OLD.status = 'EXCEPTION' AND NEW.status IN ('IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED'))
		) THEN
			RAISE EXCEPTION 'invalid shipment state transition';
		END IF;
	END IF;
	IF NEW.status = 'DELIVERED' AND NEW.delivered_at IS NULL THEN
		RAISE EXCEPTION 'delivered timestamp is required';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER shipments_identity_and_state
	BEFORE INSERT OR UPDATE OR DELETE ON "shipments"
	FOR EACH ROW EXECUTE FUNCTION enforce_shipment_identity_and_state();
--> statement-breakpoint
CREATE FUNCTION preserve_shipment_items() RETURNS trigger AS $$
DECLARE shipment_claim_id uuid;
DECLARE entitlement_claim_id uuid;
DECLARE claim_status text;
BEGIN
	IF TG_OP <> 'INSERT' THEN
		RAISE EXCEPTION 'shipment items are immutable';
	END IF;
	SELECT claim_id INTO shipment_claim_id FROM shipments WHERE id = NEW.shipment_id;
	SELECT claim_id INTO entitlement_claim_id
		FROM claim_entitlements WHERE id = NEW.claim_entitlement_id;
	SELECT status INTO claim_status FROM claims WHERE id = shipment_claim_id;
	IF shipment_claim_id IS NULL
		OR entitlement_claim_id IS DISTINCT FROM shipment_claim_id
		OR claim_status NOT IN ('PROCESSING', 'SHIPPED') THEN
		RAISE EXCEPTION 'shipment item does not match a fulfillable claim entitlement';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER shipment_items_preserve_identity
	BEFORE INSERT OR UPDATE OR DELETE ON "shipment_items"
	FOR EACH ROW EXECUTE FUNCTION preserve_shipment_items();
--> statement-breakpoint
CREATE FUNCTION preserve_tracking_events() RETURNS trigger AS $$
BEGIN
	IF TG_OP <> 'INSERT' THEN
		RAISE EXCEPTION 'tracking events are append-only';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER tracking_events_append_only
	BEFORE UPDATE OR DELETE ON "tracking_events"
	FOR EACH ROW EXECUTE FUNCTION preserve_tracking_events();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_claim_transition() RETURNS trigger AS $$
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
	IF NEW.status = 'SHIPPED' THEN
		IF NEW.shipped_at IS NULL THEN
			RAISE EXCEPTION 'shipped timestamp is required';
		END IF;
		IF NOT EXISTS (SELECT 1 FROM shipments WHERE claim_id = NEW.id)
			OR EXISTS (
				SELECT 1 FROM claim_entitlements ce
				WHERE ce.claim_id = NEW.id
					AND NOT EXISTS (
						SELECT 1 FROM shipment_items si
						WHERE si.claim_entitlement_id = ce.id
					)
			) THEN
			RAISE EXCEPTION 'every claim entitlement must be assigned before shipping';
		END IF;
	END IF;
	IF NEW.status = 'COMPLETED' AND NEW.completed_at IS NULL THEN
		RAISE EXCEPTION 'completed timestamp is required';
	END IF;
	IF NEW.status = 'CANCELLED' THEN
		IF NEW.cancelled_at IS NULL OR NEW.cancel_reason IS NULL OR length(NEW.cancel_reason) < 3 THEN
			RAISE EXCEPTION 'cancel timestamp and reason are required';
		END IF;
		IF EXISTS (SELECT 1 FROM shipments WHERE claim_id = NEW.id) THEN
			RAISE EXCEPTION 'a claim with shipments cannot be cancelled';
		END IF;
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
