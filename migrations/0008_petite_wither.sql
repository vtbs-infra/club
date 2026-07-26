CREATE TABLE "platform_appearance" (
	"id" text PRIMARY KEY NOT NULL,
	"theme" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_appearance_singleton_check" CHECK ("platform_appearance"."id" = 'global'),
	CONSTRAINT "platform_appearance_theme_check" CHECK ("platform_appearance"."theme" in ('moe', 'neon', 'archive', 'pixel')),
	CONSTRAINT "platform_appearance_version_check" CHECK ("platform_appearance"."version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "platform_appearance" ADD CONSTRAINT "platform_appearance_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;