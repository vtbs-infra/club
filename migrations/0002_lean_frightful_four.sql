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
CREATE TABLE "verification_rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bili_room_id" text NOT NULL,
	"bili_owner_uid" text NOT NULL,
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
ALTER TABLE "bilibili_bindings" ADD CONSTRAINT "bilibili_bindings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bilibili_bindings" ADD CONSTRAINT "bilibili_bindings_challenge_id_binding_challenges_id_fk" FOREIGN KEY ("challenge_id") REFERENCES "public"."binding_challenges"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "binding_challenges" ADD CONSTRAINT "binding_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "binding_challenges" ADD CONSTRAINT "binding_challenges_verification_room_id_verification_rooms_id_fk" FOREIGN KEY ("verification_room_id") REFERENCES "public"."verification_rooms"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bilibili_bindings_challenge_unique" ON "bilibili_bindings" USING btree ("challenge_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bilibili_bindings_active_user_unique" ON "bilibili_bindings" USING btree ("user_id") WHERE "bilibili_bindings"."unbound_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "bilibili_bindings_active_uid_unique" ON "bilibili_bindings" USING btree ("bili_uid") WHERE "bilibili_bindings"."unbound_at" is null;--> statement-breakpoint
CREATE INDEX "bilibili_bindings_user_history_idx" ON "bilibili_bindings" USING btree ("user_id","bound_at");--> statement-breakpoint
CREATE UNIQUE INDEX "binding_challenges_active_user_unique" ON "binding_challenges" USING btree ("user_id") WHERE "binding_challenges"."status" = 'ACTIVE';--> statement-breakpoint
CREATE UNIQUE INDEX "binding_challenges_consumed_event_unique" ON "binding_challenges" USING btree ("consumed_event_id") WHERE "binding_challenges"."consumed_event_id" is not null;--> statement-breakpoint
CREATE INDEX "binding_challenges_match_idx" ON "binding_challenges" USING btree ("verification_room_id","code_digest","status");--> statement-breakpoint
CREATE INDEX "binding_challenges_expiry_idx" ON "binding_challenges" USING btree ("status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "verification_rooms_bili_room_id_unique" ON "verification_rooms" USING btree ("bili_room_id");--> statement-breakpoint
CREATE INDEX "verification_rooms_selection_idx" ON "verification_rooms" USING btree ("enabled","priority");