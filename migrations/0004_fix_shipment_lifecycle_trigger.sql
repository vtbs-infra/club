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
		OR (TG_OP = 'INSERT' AND order_status NOT IN ('SUBMITTED', 'PROCESSING')) THEN
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
$$ LANGUAGE plpgsql;
