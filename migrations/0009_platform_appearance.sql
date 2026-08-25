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
ALTER TABLE "platform_appearance" ADD CONSTRAINT "platform_appearance_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
INSERT INTO "platform_appearance" ("id", "theme_preset") VALUES ('global', 'moe');
