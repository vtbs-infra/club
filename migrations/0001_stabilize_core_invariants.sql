ALTER TABLE "shipment_items" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "shipment_items" CASCADE;--> statement-breakpoint
ALTER TABLE "shipments" DROP CONSTRAINT "shipments_tracking_identity_check";--> statement-breakpoint
ALTER TABLE "gift_order_addresses" DROP CONSTRAINT "gift_order_addresses_source_address_id_addresses_id_fk";
--> statement-breakpoint
DROP INDEX "shipments_order_key_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "shipments_order_unique" ON "shipments" USING btree ("gift_order_id");--> statement-breakpoint
ALTER TABLE "shipments" DROP COLUMN "shipment_key";--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_tracking_identity_check" CHECK (length("shipments"."carrier_code") between 1 and 80 and length("shipments"."tracking_number") between 1 and 160);