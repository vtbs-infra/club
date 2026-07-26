CREATE TABLE "site_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"object_key" text NOT NULL,
	"thumbnail_object_key" text NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_assets_mime_type_check" CHECK ("site_assets"."mime_type" = 'image/webp'),
	CONSTRAINT "site_assets_dimensions_positive" CHECK ("site_assets"."width" > 0 and "site_assets"."height" > 0 and "site_assets"."size_bytes" > 0),
	CONSTRAINT "site_assets_sha256_check" CHECK ("site_assets"."sha256" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "site_page_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"content_json" jsonb NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "site_page_versions_version_positive" CHECK ("site_page_versions"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "site_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"published_version_id" uuid,
	"draft_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "site_assets" ADD CONSTRAINT "site_assets_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_page_versions" ADD CONSTRAINT "site_page_versions_page_id_site_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."site_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_page_versions" ADD CONSTRAINT "site_page_versions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_pages" ADD CONSTRAINT "site_pages_published_version_id_site_page_versions_id_fk" FOREIGN KEY ("published_version_id") REFERENCES "public"."site_page_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "site_pages" ADD CONSTRAINT "site_pages_draft_version_id_site_page_versions_id_fk" FOREIGN KEY ("draft_version_id") REFERENCES "public"."site_page_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "site_assets_object_key_unique" ON "site_assets" USING btree ("object_key");--> statement-breakpoint
CREATE UNIQUE INDEX "site_assets_thumbnail_object_key_unique" ON "site_assets" USING btree ("thumbnail_object_key");--> statement-breakpoint
CREATE INDEX "site_assets_created_idx" ON "site_assets" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "site_page_versions_page_version_unique" ON "site_page_versions" USING btree ("page_id","version");--> statement-breakpoint
CREATE INDEX "site_page_versions_page_created_idx" ON "site_page_versions" USING btree ("page_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "site_pages_slug_unique" ON "site_pages" USING btree ("slug");