DROP TRIGGER "gift_orders_lifecycle" ON "gift_orders";--> statement-breakpoint
DROP TRIGGER "gift_order_status_history_append_only" ON "gift_order_status_history";--> statement-breakpoint
ALTER TABLE "gift_order_status_history" DROP CONSTRAINT "gift_order_status_history_from_check";--> statement-breakpoint
ALTER TABLE "gift_order_status_history" DROP CONSTRAINT "gift_order_status_history_to_check";--> statement-breakpoint
ALTER TABLE "gift_orders" DROP CONSTRAINT "gift_orders_status_check";--> statement-breakpoint
UPDATE "gift_orders"
SET "status" = 'SUBMITTED'
WHERE "status" = 'PROCESSING';--> statement-breakpoint
DELETE FROM "gift_order_status_history"
WHERE "to_status" = 'PROCESSING';--> statement-breakpoint
UPDATE "gift_order_status_history"
SET "from_status" = 'SUBMITTED'
WHERE "from_status" = 'PROCESSING';--> statement-breakpoint
ALTER TABLE "gift_orders" DROP COLUMN "processing_at";--> statement-breakpoint
ALTER TABLE "gift_order_status_history" ADD CONSTRAINT "gift_order_status_history_from_check" CHECK ("gift_order_status_history"."from_status" is null or "gift_order_status_history"."from_status" in ('CLAIMABLE', 'SUBMITTED', 'SHIPPED', 'COMPLETED', 'EXPIRED', 'CANCELLED'));--> statement-breakpoint
ALTER TABLE "gift_order_status_history" ADD CONSTRAINT "gift_order_status_history_to_check" CHECK ("gift_order_status_history"."to_status" in ('CLAIMABLE', 'SUBMITTED', 'SHIPPED', 'COMPLETED', 'EXPIRED', 'CANCELLED'));--> statement-breakpoint
ALTER TABLE "gift_orders" ADD CONSTRAINT "gift_orders_status_check" CHECK ("gift_orders"."status" in ('CLAIMABLE', 'SUBMITTED', 'SHIPPED', 'COMPLETED', 'EXPIRED', 'CANCELLED'));--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_gift_order_lifecycle() RETURNS trigger AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'gift orders cannot be deleted';
	END IF;
	IF NEW.order_number IS DISTINCT FROM OLD.order_number
		OR NEW.creator_id IS DISTINCT FROM OLD.creator_id
		OR NEW.gift_release_id IS DISTINCT FROM OLD.gift_release_id
		OR NEW.snapshot_member_id IS DISTINCT FROM OLD.snapshot_member_id
		OR NEW.bili_uid IS DISTINCT FROM OLD.bili_uid
		OR NEW.bili_display_name IS DISTINCT FROM OLD.bili_display_name
		OR NEW.tier IS DISTINCT FROM OLD.tier
		OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
		OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
		RAISE EXCEPTION 'gift order identity is immutable';
	END IF;
	IF OLD.user_id IS NOT NULL AND NEW.user_id IS DISTINCT FROM OLD.user_id THEN
		RAISE EXCEPTION 'gift order claimant is immutable';
	END IF;
	IF NEW.version <> OLD.version + 1 THEN
		RAISE EXCEPTION 'gift order version must increment exactly once';
	END IF;
	IF NOT (
		(OLD.status = 'CLAIMABLE' AND NEW.status IN ('SUBMITTED', 'EXPIRED'))
		OR (OLD.status = 'SUBMITTED' AND NEW.status IN ('SHIPPED', 'CANCELLED'))
		OR (OLD.status = 'SHIPPED' AND NEW.status = 'COMPLETED')
	) THEN
		RAISE EXCEPTION 'invalid gift order state transition';
	END IF;
	IF NEW.status = 'SUBMITTED' AND (NEW.user_id IS NULL OR NEW.submitted_at IS NULL) THEN
		RAISE EXCEPTION 'submitted gift orders require a claimant and timestamp';
	END IF;
	IF NEW.status = 'SHIPPED' AND NEW.shipped_at IS NULL THEN
		RAISE EXCEPTION 'shipped gift orders require a timestamp';
	END IF;
	IF NEW.status = 'COMPLETED' AND NEW.completed_at IS NULL THEN
		RAISE EXCEPTION 'completed gift orders require a timestamp';
	END IF;
	IF NEW.status = 'EXPIRED' AND NEW.expired_at IS NULL THEN
		RAISE EXCEPTION 'expired gift orders require a timestamp';
	END IF;
	IF NEW.status = 'CANCELLED' AND (NEW.cancelled_at IS NULL OR NEW.cancel_reason IS NULL) THEN
		RAISE EXCEPTION 'cancelled gift orders require a timestamp and reason';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER gift_orders_lifecycle
	BEFORE UPDATE OR DELETE ON "gift_orders"
	FOR EACH ROW EXECUTE FUNCTION enforce_gift_order_lifecycle();--> statement-breakpoint
CREATE TRIGGER gift_order_status_history_append_only
	BEFORE UPDATE OR DELETE ON "gift_order_status_history"
	FOR EACH ROW EXECUTE FUNCTION club_reject_mutation();--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_shipment_lifecycle() RETURNS trigger AS $$
DECLARE order_status text;
DECLARE order_creator_id uuid;
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'shipments cannot be deleted';
	END IF;
	SELECT status, creator_id INTO order_status, order_creator_id
	FROM gift_orders WHERE id = NEW.gift_order_id;
	IF order_status IS NULL
		OR order_creator_id IS DISTINCT FROM NEW.creator_id
		OR (TG_OP = 'INSERT' AND order_status <> 'SUBMITTED') THEN
		RAISE EXCEPTION 'shipment does not match a fulfillable gift order';
	END IF;
	IF TG_OP = 'UPDATE' THEN
		IF NEW.shipment_number IS DISTINCT FROM OLD.shipment_number
			OR NEW.gift_order_id IS DISTINCT FROM OLD.gift_order_id
			OR NEW.creator_id IS DISTINCT FROM OLD.creator_id
			OR NEW.carrier_code IS DISTINCT FROM OLD.carrier_code
			OR NEW.carrier_name IS DISTINCT FROM OLD.carrier_name
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
		RAISE EXCEPTION 'delivered shipments require a timestamp';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP FUNCTION IF EXISTS validate_shipment_item_insert();
