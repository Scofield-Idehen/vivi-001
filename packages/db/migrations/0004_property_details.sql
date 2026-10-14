CREATE TYPE "app"."space_type" AS ENUM('entire_place', 'private_room', 'shared_room');--> statement-breakpoint
ALTER TABLE "app"."properties" ADD COLUMN "space_type" "app"."space_type" DEFAULT 'entire_place' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."properties" ADD COLUMN "beds" integer;--> statement-breakpoint
ALTER TABLE "app"."properties" ADD COLUMN "bathrooms" numeric(3, 1);--> statement-breakpoint
ALTER TABLE "app"."properties" ADD CONSTRAINT "properties_beds_range" CHECK ("app"."properties"."beds" is null or "app"."properties"."beds" between 0 and 100);--> statement-breakpoint
ALTER TABLE "app"."properties" ADD CONSTRAINT "properties_bathrooms_halves" CHECK ("app"."properties"."bathrooms" is null or ("app"."properties"."bathrooms" >= 0 and "app"."properties"."bathrooms" * 2 = trunc("app"."properties"."bathrooms" * 2)));