ALTER TABLE "app"."owners" ADD COLUMN "guesty_owner_id" text;--> statement-breakpoint
ALTER TABLE "app"."owners" ADD CONSTRAINT "owners_guesty_key" UNIQUE("organisation_id","guesty_owner_id");