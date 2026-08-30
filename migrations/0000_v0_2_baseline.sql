CREATE TABLE "announcement_reads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"announcement_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"announcement_version" integer NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "announcement_reads_version_positive" CHECK ("announcement_reads"."announcement_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "announcements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" text NOT NULL,
	"creator_id" uuid,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"severity" text DEFAULT 'INFO' NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"public_visible" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"published_at" timestamp with time zone,
	"withdrawn_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_by_user_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "announcements_scope_check" CHECK ("announcements"."scope" in ('PLATFORM', 'CREATOR')),
	CONSTRAINT "announcements_severity_check" CHECK ("announcements"."severity" in ('INFO', 'WARNING', 'CRITICAL')),
	CONSTRAINT "announcements_version_positive" CHECK ("announcements"."version" > 0),
	CONSTRAINT "announcements_expiry_check" CHECK ("announcements"."status" = 'DRAFT' or "announcements"."expires_at" is null or "announcements"."expires_at" > "announcements"."published_at"),
	CONSTRAINT "announcements_lifecycle_check" CHECK ((
        ("announcements"."status" = 'DRAFT' and "announcements"."published_at" is null and "announcements"."withdrawn_at" is null)
        or ("announcements"."status" = 'PUBLISHED' and "announcements"."published_at" is not null and "announcements"."withdrawn_at" is null)
        or ("announcements"."status" = 'WITHDRAWN' and "announcements"."published_at" is not null and "announcements"."withdrawn_at" is not null and "announcements"."withdrawn_at" >= "announcements"."published_at")
      )),
	CONSTRAINT "announcements_public_scope_check" CHECK (not "announcements"."public_visible" or "announcements"."scope" = 'PLATFORM'),
	CONSTRAINT "announcements_scope_identity_check" CHECK ((
        ("announcements"."scope" = 'PLATFORM' and "announcements"."creator_id" is null)
        or ("announcements"."scope" = 'CREATOR' and "announcements"."creator_id" is not null)
      ))
);
--> statement-breakpoint
CREATE TABLE "platform_appearance" (
	"id" text PRIMARY KEY DEFAULT 'global' NOT NULL,
	"theme_preset" text DEFAULT 'moe' NOT NULL,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_appearance_singleton_check" CHECK ("platform_appearance"."id" = 'global'),
	CONSTRAINT "platform_appearance_theme_preset_check" CHECK ("platform_appearance"."theme_preset" in ('moe', 'neon', 'archive', 'pixel'))
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"role" text DEFAULT 'USER' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_role_check" CHECK ("users"."role" in ('USER', 'CREATOR', 'PLATFORM_ADMIN'))
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
CREATE TABLE "gift_order_addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gift_order_id" uuid NOT NULL,
	"source_address_id" uuid,
	"ciphertext" text NOT NULL,
	"initialization_vector" text NOT NULL,
	"authentication_tag" text NOT NULL,
	"key_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gift_order_addresses_key_version_positive" CHECK ("gift_order_addresses"."key_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "gift_order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gift_order_id" uuid NOT NULL,
	"gift_package_id" uuid NOT NULL,
	"package_snapshot" jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gift_order_option_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gift_order_id" uuid NOT NULL,
	"field_key" text NOT NULL,
	"field_label" text NOT NULL,
	"ciphertext" text NOT NULL,
	"initialization_vector" text NOT NULL,
	"authentication_tag" text NOT NULL,
	"key_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gift_order_option_values_key_version_positive" CHECK ("gift_order_option_values"."key_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "gift_order_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gift_order_id" uuid NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"actor_user_id" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gift_order_status_history_from_check" CHECK ("gift_order_status_history"."from_status" is null or "gift_order_status_history"."from_status" in ('CLAIMABLE', 'SUBMITTED', 'SHIPPED', 'COMPLETED', 'EXPIRED', 'CANCELLED')),
	CONSTRAINT "gift_order_status_history_to_check" CHECK ("gift_order_status_history"."to_status" in ('CLAIMABLE', 'SUBMITTED', 'SHIPPED', 'COMPLETED', 'EXPIRED', 'CANCELLED'))
);
--> statement-breakpoint
CREATE TABLE "gift_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_number" text NOT NULL,
	"creator_id" uuid NOT NULL,
	"gift_release_id" uuid NOT NULL,
	"snapshot_member_id" uuid NOT NULL,
	"user_id" uuid,
	"bili_uid" text NOT NULL,
	"bili_display_name" text NOT NULL,
	"tier" text NOT NULL,
	"status" text DEFAULT 'CLAIMABLE' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"submitted_at" timestamp with time zone,
	"shipped_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"expired_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gift_orders_status_check" CHECK ("gift_orders"."status" in ('CLAIMABLE', 'SUBMITTED', 'SHIPPED', 'COMPLETED', 'EXPIRED', 'CANCELLED')),
	CONSTRAINT "gift_orders_tier_check" CHECK ("gift_orders"."tier" in ('CAPTAIN', 'ADMIRAL', 'GOVERNOR')),
	CONSTRAINT "gift_orders_version_positive" CHECK ("gift_orders"."version" > 0)
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
	"gift_release_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gift_releases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"eligibility_month" date NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"cover_object_key" text,
	"public_visible" boolean DEFAULT false NOT NULL,
	"claim_start_at" timestamp with time zone NOT NULL,
	"claim_deadline_at" timestamp with time zone NOT NULL,
	"fulfillment_mode" text DEFAULT 'HIGHEST_ONLY' NOT NULL,
	"form_schema" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"published_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"created_by_user_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gift_releases_status_check" CHECK ("gift_releases"."status" in ('DRAFT', 'PUBLISHED', 'CLOSED')),
	CONSTRAINT "gift_releases_fulfillment_mode_check" CHECK ("gift_releases"."fulfillment_mode" in ('HIGHEST_ONLY', 'CUMULATIVE')),
	CONSTRAINT "gift_releases_claim_window_check" CHECK ("gift_releases"."claim_deadline_at" > "gift_releases"."claim_start_at"),
	CONSTRAINT "gift_releases_version_positive" CHECK ("gift_releases"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "gift_tier_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gift_release_id" uuid NOT NULL,
	"tier" text NOT NULL,
	"gift_package_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gift_tier_rules_tier_check" CHECK ("gift_tier_rules"."tier" in ('CAPTAIN', 'ADMIRAL', 'GOVERNOR'))
);
--> statement-breakpoint
CREATE TABLE "shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shipment_number" text NOT NULL,
	"gift_order_id" uuid NOT NULL,
	"creator_id" uuid NOT NULL,
	"carrier_code" text NOT NULL,
	"carrier_name" text NOT NULL,
	"tracking_number" text NOT NULL,
	"tracking_url" text,
	"status" text DEFAULT 'LABEL_CREATED' NOT NULL,
	"delivered_at" timestamp with time zone,
	"last_tracking_refresh_at" timestamp with time zone,
	"next_tracking_refresh_at" timestamp with time zone,
	"exception_message" text,
	"tracking_failure_count" integer DEFAULT 0 NOT NULL,
	"last_tracking_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipments_status_check" CHECK ("shipments"."status" in ('LABEL_CREATED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'EXCEPTION')),
	CONSTRAINT "shipments_tracking_identity_check" CHECK (length("shipments"."carrier_code") between 1 and 80 and length("shipments"."tracking_number") between 1 and 160)
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
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_user_id" uuid,
	"creator_id" uuid,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"before_summary" jsonb,
	"after_summary" jsonb,
	"request_id" text,
	"ip_address" text,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bilibili_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"challenge_id" uuid NOT NULL,
	"bili_uid" text NOT NULL,
	"bili_display_name" text,
	"bound_at" timestamp with time zone DEFAULT now() NOT NULL,
	"unbound_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "binding_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"verification_room_id" uuid NOT NULL,
	"code_digest" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"consumed_event_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "binding_challenges_status_check" CHECK ("binding_challenges"."status" in ('ACTIVE', 'CONSUMED', 'EXPIRED', 'CANCELLED', 'CONFLICT'))
);
--> statement-breakpoint
CREATE TABLE "creators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"binding_id" uuid NOT NULL,
	"bilibili_uid" text NOT NULL,
	"room_id" text NOT NULL,
	"display_name" text NOT NULL,
	"timezone" text DEFAULT 'Asia/Shanghai' NOT NULL,
	"monthly_sync_enabled" boolean DEFAULT true NOT NULL,
	"profile_synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification_rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bili_room_id" text NOT NULL,
	"display_name" text NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"health_status" text DEFAULT 'UNKNOWN' NOT NULL,
	"last_connected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "verification_rooms_health_status_check" CHECK ("verification_rooms"."health_status" in ('UNKNOWN', 'CONNECTING', 'HEALTHY', 'UNHEALTHY'))
);
--> statement-breakpoint
CREATE TABLE "snapshot_attempt_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_attempt_id" uuid NOT NULL,
	"bili_uid" text NOT NULL,
	"display_name_at_capture" text NOT NULL,
	"tier" text NOT NULL,
	"raw_tier" text NOT NULL,
	"source_page" integer NOT NULL,
	"source_position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "snapshot_attempt_members_tier_check" CHECK ("snapshot_attempt_members"."tier" in ('CAPTAIN', 'ADMIRAL', 'GOVERNOR'))
);
--> statement-breakpoint
CREATE TABLE "snapshot_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_run_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"scheduler_started_at" timestamp with time zone NOT NULL,
	"capture_started_at" timestamp with time zone,
	"capture_completed_at" timestamp with time zone,
	"punctuality" text,
	"consistency_status" text DEFAULT 'PENDING' NOT NULL,
	"declared_total" integer,
	"normalized_total" integer,
	"source_name" text NOT NULL,
	"source_version" text NOT NULL,
	"initiated_by" text DEFAULT 'SCHEDULER' NOT NULL,
	"requested_by_user_id" uuid,
	"failure_code" text,
	"failure_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "snapshot_attempts_punctuality_check" CHECK ("snapshot_attempts"."punctuality" is null or "snapshot_attempts"."punctuality" in ('ON_TIME', 'LATE')),
	CONSTRAINT "snapshot_attempts_consistency_check" CHECK ("snapshot_attempts"."consistency_status" in ('PENDING', 'CONSISTENT', 'INCONSISTENT')),
	CONSTRAINT "snapshot_attempts_initiated_by_check" CHECK ("snapshot_attempts"."initiated_by" in ('SCHEDULER', 'ADMIN'))
);
--> statement-breakpoint
CREATE TABLE "snapshot_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_run_id" uuid NOT NULL,
	"bili_uid" text NOT NULL,
	"display_name_at_snapshot" text NOT NULL,
	"tier" text NOT NULL,
	"raw_tier" text NOT NULL,
	"source_position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "snapshot_members_tier_check" CHECK ("snapshot_members"."tier" in ('CAPTAIN', 'ADMIRAL', 'GOVERNOR'))
);
--> statement-breakpoint
CREATE TABLE "snapshot_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_attempt_id" uuid NOT NULL,
	"capture_kind" text NOT NULL,
	"page_number" integer NOT NULL,
	"declared_page_count" integer NOT NULL,
	"declared_total" integer NOT NULL,
	"object_key" text NOT NULL,
	"content_hash_sha256" text NOT NULL,
	"content_encoding" text DEFAULT 'gzip' NOT NULL,
	"compressed_size" integer NOT NULL,
	"uncompressed_size" integer NOT NULL,
	"item_count" integer NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "snapshot_pages_page_positive" CHECK ("snapshot_pages"."page_number" > 0),
	CONSTRAINT "snapshot_pages_capture_kind_check" CHECK ("snapshot_pages"."capture_kind" in ('PAGE', 'RECHECK')),
	CONSTRAINT "snapshot_pages_declared_counts_check" CHECK ("snapshot_pages"."declared_page_count" > 0 and "snapshot_pages"."declared_total" >= 0),
	CONSTRAINT "snapshot_pages_hash_check" CHECK ("snapshot_pages"."content_hash_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "snapshot_pages_sizes_non_negative" CHECK ("snapshot_pages"."compressed_size" >= 0 and "snapshot_pages"."uncompressed_size" >= 0 and "snapshot_pages"."item_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "snapshot_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"creator_bilibili_uid" text NOT NULL,
	"creator_room_id" text NOT NULL,
	"period_start" date NOT NULL,
	"cutoff_timezone" text NOT NULL,
	"scheduled_cutoff_at" timestamp with time zone NOT NULL,
	"on_time_window_end_at" timestamp with time zone NOT NULL,
	"accepted_attempt_id" uuid,
	"status" text DEFAULT 'SCHEDULED' NOT NULL,
	"finalized_at" timestamp with time zone,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "snapshot_runs_status_check" CHECK ("snapshot_runs"."status" in ('SCHEDULED', 'RUNNING', 'FAILED', 'PENDING_APPROVAL', 'FINALIZED', 'REJECTED', 'CANCELLED'))
);
--> statement-breakpoint
ALTER TABLE "announcement_reads" ADD CONSTRAINT "announcement_reads_announcement_id_announcements_id_fk" FOREIGN KEY ("announcement_id") REFERENCES "public"."announcements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_reads" ADD CONSTRAINT "announcement_reads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_appearance" ADD CONSTRAINT "platform_appearance_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_order_addresses" ADD CONSTRAINT "gift_order_addresses_gift_order_id_gift_orders_id_fk" FOREIGN KEY ("gift_order_id") REFERENCES "public"."gift_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_order_items" ADD CONSTRAINT "gift_order_items_gift_order_id_gift_orders_id_fk" FOREIGN KEY ("gift_order_id") REFERENCES "public"."gift_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_order_items" ADD CONSTRAINT "gift_order_items_gift_package_id_gift_packages_id_fk" FOREIGN KEY ("gift_package_id") REFERENCES "public"."gift_packages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_order_option_values" ADD CONSTRAINT "gift_order_option_values_gift_order_id_gift_orders_id_fk" FOREIGN KEY ("gift_order_id") REFERENCES "public"."gift_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_order_status_history" ADD CONSTRAINT "gift_order_status_history_gift_order_id_gift_orders_id_fk" FOREIGN KEY ("gift_order_id") REFERENCES "public"."gift_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_order_status_history" ADD CONSTRAINT "gift_order_status_history_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_orders" ADD CONSTRAINT "gift_orders_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_orders" ADD CONSTRAINT "gift_orders_gift_release_id_gift_releases_id_fk" FOREIGN KEY ("gift_release_id") REFERENCES "public"."gift_releases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_orders" ADD CONSTRAINT "gift_orders_snapshot_member_id_snapshot_members_id_fk" FOREIGN KEY ("snapshot_member_id") REFERENCES "public"."snapshot_members"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_orders" ADD CONSTRAINT "gift_orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_package_items" ADD CONSTRAINT "gift_package_items_gift_package_id_gift_packages_id_fk" FOREIGN KEY ("gift_package_id") REFERENCES "public"."gift_packages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_packages" ADD CONSTRAINT "gift_packages_gift_release_id_gift_releases_id_fk" FOREIGN KEY ("gift_release_id") REFERENCES "public"."gift_releases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_releases" ADD CONSTRAINT "gift_releases_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_releases" ADD CONSTRAINT "gift_releases_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_tier_rules" ADD CONSTRAINT "gift_tier_rules_gift_release_id_gift_releases_id_fk" FOREIGN KEY ("gift_release_id") REFERENCES "public"."gift_releases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_tier_rules" ADD CONSTRAINT "gift_tier_rules_gift_package_id_gift_packages_id_fk" FOREIGN KEY ("gift_package_id") REFERENCES "public"."gift_packages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_gift_order_id_gift_orders_id_fk" FOREIGN KEY ("gift_order_id") REFERENCES "public"."gift_orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking_events" ADD CONSTRAINT "tracking_events_shipment_id_shipments_id_fk" FOREIGN KEY ("shipment_id") REFERENCES "public"."shipments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bilibili_bindings" ADD CONSTRAINT "bilibili_bindings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bilibili_bindings" ADD CONSTRAINT "bilibili_bindings_challenge_id_binding_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."binding_challenges"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "binding_challenges" ADD CONSTRAINT "binding_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "binding_challenges" ADD CONSTRAINT "binding_challenges_verification_room_id_verification_rooms_id_fk" FOREIGN KEY ("verification_room_id") REFERENCES "public"."verification_rooms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creators" ADD CONSTRAINT "creators_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creators" ADD CONSTRAINT "creators_binding_id_bilibili_bindings_id_fk" FOREIGN KEY ("binding_id") REFERENCES "public"."bilibili_bindings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshot_attempt_members" ADD CONSTRAINT "snapshot_attempt_members_snapshot_attempt_id_snapshot_attempts_id_fk" FOREIGN KEY ("snapshot_attempt_id") REFERENCES "public"."snapshot_attempts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshot_attempts" ADD CONSTRAINT "snapshot_attempts_snapshot_run_id_snapshot_runs_id_fk" FOREIGN KEY ("snapshot_run_id") REFERENCES "public"."snapshot_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshot_attempts" ADD CONSTRAINT "snapshot_attempts_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshot_members" ADD CONSTRAINT "snapshot_members_snapshot_run_id_snapshot_runs_id_fk" FOREIGN KEY ("snapshot_run_id") REFERENCES "public"."snapshot_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshot_pages" ADD CONSTRAINT "snapshot_pages_snapshot_attempt_id_snapshot_attempts_id_fk" FOREIGN KEY ("snapshot_attempt_id") REFERENCES "public"."snapshot_attempts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshot_runs" ADD CONSTRAINT "snapshot_runs_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshot_runs" ADD CONSTRAINT "snapshot_runs_accepted_attempt_id_snapshot_attempts_id_fk" FOREIGN KEY ("accepted_attempt_id") REFERENCES "public"."snapshot_attempts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshot_runs" ADD CONSTRAINT "snapshot_runs_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "announcement_reads_announcement_user_version_unique" ON "announcement_reads" USING btree ("announcement_id","user_id","announcement_version");--> statement-breakpoint
CREATE INDEX "announcement_reads_user_read_idx" ON "announcement_reads" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE INDEX "announcements_visibility_idx" ON "announcements" USING btree ("scope","status","published_at","expires_at");--> statement-breakpoint
CREATE INDEX "announcements_creator_created_idx" ON "announcements" USING btree ("creator_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_provider_account_unique" ON "accounts" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "accounts_user_id_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_unique" ON "sessions" USING btree ("token");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "verifications_identifier_idx" ON "verifications" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "addresses_user_created_idx" ON "addresses" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "addresses_user_default_unique" ON "addresses" USING btree ("user_id") WHERE "addresses"."is_default" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "gift_order_addresses_order_unique" ON "gift_order_addresses" USING btree ("gift_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gift_order_items_order_package_unique" ON "gift_order_items" USING btree ("gift_order_id","gift_package_id");--> statement-breakpoint
CREATE INDEX "gift_order_items_order_sort_idx" ON "gift_order_items" USING btree ("gift_order_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "gift_order_option_values_order_key_unique" ON "gift_order_option_values" USING btree ("gift_order_id","field_key");--> statement-breakpoint
CREATE INDEX "gift_order_status_history_order_created_idx" ON "gift_order_status_history" USING btree ("gift_order_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "gift_orders_number_unique" ON "gift_orders" USING btree ("order_number");--> statement-breakpoint
CREATE UNIQUE INDEX "gift_orders_release_member_unique" ON "gift_orders" USING btree ("gift_release_id","snapshot_member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gift_orders_release_uid_unique" ON "gift_orders" USING btree ("gift_release_id","bili_uid");--> statement-breakpoint
CREATE INDEX "gift_orders_uid_updated_idx" ON "gift_orders" USING btree ("bili_uid","updated_at");--> statement-breakpoint
CREATE INDEX "gift_orders_user_updated_idx" ON "gift_orders" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "gift_orders_creator_status_idx" ON "gift_orders" USING btree ("creator_id","status");--> statement-breakpoint
CREATE INDEX "gift_package_items_package_sort_idx" ON "gift_package_items" USING btree ("gift_package_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "gift_packages_release_name_unique" ON "gift_packages" USING btree ("gift_release_id","name");--> statement-breakpoint
CREATE INDEX "gift_packages_release_sort_idx" ON "gift_packages" USING btree ("gift_release_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "gift_releases_creator_month_unique" ON "gift_releases" USING btree ("creator_id","eligibility_month");--> statement-breakpoint
CREATE INDEX "gift_releases_creator_status_idx" ON "gift_releases" USING btree ("creator_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "gift_tier_rules_release_tier_unique" ON "gift_tier_rules" USING btree ("gift_release_id","tier");--> statement-breakpoint
CREATE UNIQUE INDEX "shipments_number_unique" ON "shipments" USING btree ("shipment_number");--> statement-breakpoint
CREATE UNIQUE INDEX "shipments_order_unique" ON "shipments" USING btree ("gift_order_id");--> statement-breakpoint
CREATE INDEX "shipments_creator_status_idx" ON "shipments" USING btree ("creator_id","status");--> statement-breakpoint
CREATE INDEX "shipments_tracking_due_idx" ON "shipments" USING btree ("next_tracking_refresh_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tracking_events_shipment_provider_unique" ON "tracking_events" USING btree ("shipment_id","provider_event_id");--> statement-breakpoint
CREATE INDEX "tracking_events_shipment_occurred_idx" ON "tracking_events" USING btree ("shipment_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_logs_created_id_idx" ON "audit_logs" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "audit_logs_creator_created_idx" ON "audit_logs" USING btree ("creator_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_created_idx" ON "audit_logs" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "bilibili_bindings_challenge_unique" ON "bilibili_bindings" USING btree ("challenge_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bilibili_bindings_active_user_unique" ON "bilibili_bindings" USING btree ("user_id") WHERE "bilibili_bindings"."unbound_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "bilibili_bindings_active_uid_unique" ON "bilibili_bindings" USING btree ("bili_uid") WHERE "bilibili_bindings"."unbound_at" is null;--> statement-breakpoint
CREATE INDEX "bilibili_bindings_user_history_idx" ON "bilibili_bindings" USING btree ("user_id","bound_at");--> statement-breakpoint
CREATE UNIQUE INDEX "binding_challenges_active_user_unique" ON "binding_challenges" USING btree ("user_id") WHERE "binding_challenges"."status" = 'ACTIVE';--> statement-breakpoint
CREATE UNIQUE INDEX "binding_challenges_consumed_event_unique" ON "binding_challenges" USING btree ("consumed_event_id") WHERE "binding_challenges"."consumed_event_id" is not null;--> statement-breakpoint
CREATE INDEX "binding_challenges_match_idx" ON "binding_challenges" USING btree ("verification_room_id","code_digest","status");--> statement-breakpoint
CREATE INDEX "binding_challenges_expiry_idx" ON "binding_challenges" USING btree ("status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "creators_user_unique" ON "creators" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "creators_binding_unique" ON "creators" USING btree ("binding_id");--> statement-breakpoint
CREATE UNIQUE INDEX "creators_bilibili_uid_unique" ON "creators" USING btree ("bilibili_uid");--> statement-breakpoint
CREATE UNIQUE INDEX "creators_room_id_unique" ON "creators" USING btree ("room_id");--> statement-breakpoint
CREATE INDEX "creators_monthly_sync_enabled_idx" ON "creators" USING btree ("monthly_sync_enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "verification_rooms_bili_room_id_unique" ON "verification_rooms" USING btree ("bili_room_id");--> statement-breakpoint
CREATE INDEX "verification_rooms_selection_idx" ON "verification_rooms" USING btree ("enabled","priority");--> statement-breakpoint
CREATE UNIQUE INDEX "snapshot_attempt_members_attempt_uid_unique" ON "snapshot_attempt_members" USING btree ("snapshot_attempt_id","bili_uid");--> statement-breakpoint
CREATE UNIQUE INDEX "snapshot_attempts_run_number_unique" ON "snapshot_attempts" USING btree ("snapshot_run_id","attempt_number");--> statement-breakpoint
CREATE INDEX "snapshot_attempts_run_created_idx" ON "snapshot_attempts" USING btree ("snapshot_run_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "snapshot_members_run_uid_unique" ON "snapshot_members" USING btree ("snapshot_run_id","bili_uid");--> statement-breakpoint
CREATE INDEX "snapshot_members_bili_uid_idx" ON "snapshot_members" USING btree ("bili_uid");--> statement-breakpoint
CREATE UNIQUE INDEX "snapshot_pages_attempt_kind_page_unique" ON "snapshot_pages" USING btree ("snapshot_attempt_id","capture_kind","page_number");--> statement-breakpoint
CREATE UNIQUE INDEX "snapshot_pages_object_key_unique" ON "snapshot_pages" USING btree ("object_key");--> statement-breakpoint
CREATE UNIQUE INDEX "snapshot_runs_creator_period_unique" ON "snapshot_runs" USING btree ("creator_id","period_start");--> statement-breakpoint
CREATE INDEX "snapshot_runs_due_idx" ON "snapshot_runs" USING btree ("status","scheduled_cutoff_at");--> statement-breakpoint
CREATE INDEX "snapshot_runs_creator_period_idx" ON "snapshot_runs" USING btree ("creator_id","period_start");--> statement-breakpoint

-- Deployment singleton data.
INSERT INTO "platform_appearance" ("id", "theme_preset") VALUES ('global', 'moe');--> statement-breakpoint

-- Append-only audit, evidence, and frozen fulfillment records.
CREATE FUNCTION club_reject_mutation() RETURNS trigger AS $$
BEGIN
	RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER audit_logs_append_only
	BEFORE UPDATE OR DELETE ON "audit_logs"
	FOR EACH ROW EXECUTE FUNCTION club_reject_mutation();--> statement-breakpoint
CREATE TRIGGER snapshot_pages_append_only
	BEFORE UPDATE OR DELETE ON "snapshot_pages"
	FOR EACH ROW EXECUTE FUNCTION club_reject_mutation();--> statement-breakpoint
CREATE TRIGGER snapshot_attempt_members_append_only
	BEFORE UPDATE OR DELETE ON "snapshot_attempt_members"
	FOR EACH ROW EXECUTE FUNCTION club_reject_mutation();--> statement-breakpoint
CREATE TRIGGER gift_order_items_append_only
	BEFORE UPDATE OR DELETE ON "gift_order_items"
	FOR EACH ROW EXECUTE FUNCTION club_reject_mutation();--> statement-breakpoint
CREATE TRIGGER gift_order_addresses_append_only
	BEFORE UPDATE OR DELETE ON "gift_order_addresses"
	FOR EACH ROW EXECUTE FUNCTION club_reject_mutation();--> statement-breakpoint
CREATE TRIGGER gift_order_option_values_append_only
	BEFORE UPDATE OR DELETE ON "gift_order_option_values"
	FOR EACH ROW EXECUTE FUNCTION club_reject_mutation();--> statement-breakpoint
CREATE TRIGGER gift_order_status_history_append_only
	BEFORE UPDATE OR DELETE ON "gift_order_status_history"
	FOR EACH ROW EXECUTE FUNCTION club_reject_mutation();--> statement-breakpoint
CREATE TRIGGER tracking_events_append_only
	BEFORE UPDATE OR DELETE ON "tracking_events"
	FOR EACH ROW EXECUTE FUNCTION club_reject_mutation();--> statement-breakpoint
CREATE TRIGGER announcement_reads_append_only
	BEFORE UPDATE OR DELETE ON "announcement_reads"
	FOR EACH ROW EXECUTE FUNCTION club_reject_mutation();--> statement-breakpoint

-- Monthly roster evidence becomes immutable at its durable boundaries.
CREATE FUNCTION preserve_completed_snapshot_attempt() RETURNS trigger AS $$
BEGIN
	IF TG_OP = 'DELETE' OR OLD.capture_completed_at IS NOT NULL THEN
		RAISE EXCEPTION 'completed snapshot attempts are immutable';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER snapshot_attempts_preserve_completed
	BEFORE UPDATE OR DELETE ON "snapshot_attempts"
	FOR EACH ROW EXECUTE FUNCTION preserve_completed_snapshot_attempt();--> statement-breakpoint

CREATE FUNCTION preserve_finalized_snapshot_run() RETURNS trigger AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'snapshot runs cannot be deleted';
	END IF;
	IF OLD.status = 'FINALIZED' THEN
		RAISE EXCEPTION 'finalized snapshot runs are immutable';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER snapshot_runs_preserve_finalized
	BEFORE UPDATE OR DELETE ON "snapshot_runs"
	FOR EACH ROW EXECUTE FUNCTION preserve_finalized_snapshot_run();--> statement-breakpoint

CREATE FUNCTION prevent_finalized_snapshot_member_mutation() RETURNS trigger AS $$
BEGIN
	IF EXISTS (
		SELECT 1 FROM snapshot_runs
		WHERE id = OLD.snapshot_run_id AND status = 'FINALIZED'
	) THEN
		RAISE EXCEPTION 'finalized snapshot members are immutable';
	END IF;
	IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER snapshot_members_prevent_finalized_update
	BEFORE UPDATE ON "snapshot_members"
	FOR EACH ROW EXECUTE FUNCTION prevent_finalized_snapshot_member_mutation();--> statement-breakpoint
CREATE TRIGGER snapshot_members_prevent_finalized_delete
	BEFORE DELETE ON "snapshot_members"
	FOR EACH ROW EXECUTE FUNCTION prevent_finalized_snapshot_member_mutation();--> statement-breakpoint

-- Gift release content is editable only while the release is a draft.
CREATE FUNCTION enforce_gift_release_lifecycle() RETURNS trigger AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		IF OLD.status <> 'DRAFT' THEN
			RAISE EXCEPTION 'only draft gift releases can be deleted';
		END IF;
		RETURN OLD;
	END IF;
	IF NEW.creator_id IS DISTINCT FROM OLD.creator_id
		OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
		OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
		RAISE EXCEPTION 'gift release identity is immutable';
	END IF;
	IF OLD.status = 'DRAFT' THEN
		IF NEW.status NOT IN ('DRAFT', 'PUBLISHED') THEN
			RAISE EXCEPTION 'invalid gift release state transition';
		END IF;
		IF NEW.status = 'DRAFT' AND (NEW.published_at IS NOT NULL OR NEW.closed_at IS NOT NULL) THEN
			RAISE EXCEPTION 'draft gift releases cannot have lifecycle timestamps';
		END IF;
		IF NEW.status = 'PUBLISHED' AND (
			NEW.published_at IS NULL
			OR NEW.closed_at IS NOT NULL
			OR NEW.version <> OLD.version + 1
		) THEN
			RAISE EXCEPTION 'published gift release lifecycle is invalid';
		END IF;
	ELSIF OLD.status = 'PUBLISHED' THEN
		IF NEW.status <> 'CLOSED'
			OR NEW.eligibility_month IS DISTINCT FROM OLD.eligibility_month
			OR NEW.title IS DISTINCT FROM OLD.title
			OR NEW.description IS DISTINCT FROM OLD.description
			OR NEW.cover_object_key IS DISTINCT FROM OLD.cover_object_key
			OR NEW.public_visible IS DISTINCT FROM OLD.public_visible
			OR NEW.claim_start_at IS DISTINCT FROM OLD.claim_start_at
			OR NEW.claim_deadline_at IS DISTINCT FROM OLD.claim_deadline_at
			OR NEW.fulfillment_mode IS DISTINCT FROM OLD.fulfillment_mode
			OR NEW.form_schema IS DISTINCT FROM OLD.form_schema
			OR NEW.published_at IS DISTINCT FROM OLD.published_at
			OR NEW.closed_at IS NULL
			OR NEW.version <> OLD.version + 1 THEN
			RAISE EXCEPTION 'published gift releases are immutable except for closure';
		END IF;
	ELSIF OLD.status = 'CLOSED' THEN
		RAISE EXCEPTION 'closed gift releases are immutable';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER gift_releases_lifecycle
	BEFORE UPDATE OR DELETE ON "gift_releases"
	FOR EACH ROW EXECUTE FUNCTION enforce_gift_release_lifecycle();--> statement-breakpoint

CREATE FUNCTION prevent_published_gift_package_mutation() RETURNS trigger AS $$
BEGIN
	IF TG_OP IN ('UPDATE', 'DELETE') AND EXISTS (
		SELECT 1 FROM gift_releases WHERE id = OLD.gift_release_id AND status <> 'DRAFT'
	) THEN
		RAISE EXCEPTION 'published gift packages are immutable';
	END IF;
	IF TG_OP IN ('INSERT', 'UPDATE') AND EXISTS (
		SELECT 1 FROM gift_releases WHERE id = NEW.gift_release_id AND status <> 'DRAFT'
	) THEN
		RAISE EXCEPTION 'published gift packages are immutable';
	END IF;
	IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER gift_packages_published_immutability
	BEFORE INSERT OR UPDATE OR DELETE ON "gift_packages"
	FOR EACH ROW EXECUTE FUNCTION prevent_published_gift_package_mutation();--> statement-breakpoint

CREATE FUNCTION prevent_published_gift_item_mutation() RETURNS trigger AS $$
DECLARE old_release_id uuid;
DECLARE new_release_id uuid;
BEGIN
	IF TG_OP IN ('UPDATE', 'DELETE') THEN
		SELECT gift_release_id INTO old_release_id FROM gift_packages WHERE id = OLD.gift_package_id;
	END IF;
	IF TG_OP IN ('INSERT', 'UPDATE') THEN
		SELECT gift_release_id INTO new_release_id FROM gift_packages WHERE id = NEW.gift_package_id;
	END IF;
	IF EXISTS (
		SELECT 1 FROM gift_releases
		WHERE id IN (old_release_id, new_release_id) AND status <> 'DRAFT'
	) THEN
		RAISE EXCEPTION 'published gift package items are immutable';
	END IF;
	IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER gift_package_items_published_immutability
	BEFORE INSERT OR UPDATE OR DELETE ON "gift_package_items"
	FOR EACH ROW EXECUTE FUNCTION prevent_published_gift_item_mutation();--> statement-breakpoint

CREATE FUNCTION prevent_published_gift_rule_mutation() RETURNS trigger AS $$
BEGIN
	IF TG_OP IN ('UPDATE', 'DELETE') AND EXISTS (
		SELECT 1 FROM gift_releases WHERE id = OLD.gift_release_id AND status <> 'DRAFT'
	) THEN
		RAISE EXCEPTION 'published gift tier rules are immutable';
	END IF;
	IF TG_OP IN ('INSERT', 'UPDATE') AND EXISTS (
		SELECT 1 FROM gift_releases WHERE id = NEW.gift_release_id AND status <> 'DRAFT'
	) THEN
		RAISE EXCEPTION 'published gift tier rules are immutable';
	END IF;
	IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER gift_tier_rules_published_immutability
	BEFORE INSERT OR UPDATE OR DELETE ON "gift_tier_rules"
	FOR EACH ROW EXECUTE FUNCTION prevent_published_gift_rule_mutation();--> statement-breakpoint

-- Gift orders and shipments can only follow the product lifecycle.
CREATE FUNCTION enforce_gift_order_lifecycle() RETURNS trigger AS $$
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

CREATE FUNCTION enforce_shipment_lifecycle() RETURNS trigger AS $$
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
CREATE TRIGGER shipments_lifecycle
	BEFORE UPDATE OR DELETE ON "shipments"
	FOR EACH ROW EXECUTE FUNCTION enforce_shipment_lifecycle();--> statement-breakpoint

-- Announcement identity is stable and publication state follows an explicit lifecycle.
CREATE FUNCTION enforce_announcement_lifecycle() RETURNS trigger AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		IF OLD.status <> 'DRAFT' THEN
			RAISE EXCEPTION 'only draft announcements can be deleted';
		END IF;
		RETURN OLD;
	END IF;
	IF NEW.scope IS DISTINCT FROM OLD.scope
		OR NEW.creator_id IS DISTINCT FROM OLD.creator_id
		OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
		OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
		RAISE EXCEPTION 'announcement identity is immutable';
	END IF;
	IF NEW.version <> OLD.version + 1 THEN
		RAISE EXCEPTION 'announcement version must increment exactly once';
	END IF;
	IF (OLD.status = 'DRAFT' AND NEW.status NOT IN ('DRAFT', 'PUBLISHED'))
		OR (OLD.status = 'PUBLISHED' AND NEW.status NOT IN ('PUBLISHED', 'WITHDRAWN'))
		OR (OLD.status = 'WITHDRAWN' AND NEW.status NOT IN ('WITHDRAWN', 'PUBLISHED')) THEN
		RAISE EXCEPTION 'invalid announcement status transition';
	END IF;
	IF OLD.status = 'PUBLISHED' AND NEW.published_at IS DISTINCT FROM OLD.published_at THEN
		RAISE EXCEPTION 'published announcement publication time is immutable until republished';
	END IF;
	IF OLD.status = 'WITHDRAWN' AND NEW.status = 'WITHDRAWN'
		AND (NEW.published_at IS DISTINCT FROM OLD.published_at
			OR NEW.withdrawn_at IS DISTINCT FROM OLD.withdrawn_at) THEN
		RAISE EXCEPTION 'withdrawn announcement lifecycle times are immutable until republished';
	END IF;
	IF OLD.status = 'WITHDRAWN' AND NEW.status = 'PUBLISHED'
		AND NEW.published_at < OLD.withdrawn_at THEN
		RAISE EXCEPTION 'republished announcement time cannot precede withdrawal';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER announcements_lifecycle
	BEFORE UPDATE OR DELETE ON "announcements"
	FOR EACH ROW EXECUTE FUNCTION enforce_announcement_lifecycle();
