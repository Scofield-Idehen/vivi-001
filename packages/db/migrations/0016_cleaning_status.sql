CREATE TYPE "app"."cleaning_status" AS ENUM('clean', 'dirty');--> statement-breakpoint
ALTER TABLE "app"."properties" ADD COLUMN "cleaning_status" "app"."cleaning_status" DEFAULT 'clean' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."properties" ADD COLUMN "cleaning_changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."properties" ADD COLUMN "cleaning_changed_by" uuid;--> statement-breakpoint
ALTER TABLE "app"."properties" ADD CONSTRAINT "properties_cleaning_changed_by_app_users_id_fk" FOREIGN KEY ("cleaning_changed_by") REFERENCES "app"."app_users"("id") ON DELETE set null ON UPDATE no action;