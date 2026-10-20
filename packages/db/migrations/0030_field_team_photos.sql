ALTER TABLE "app"."properties" ADD COLUMN "maintainer_user_id" uuid;--> statement-breakpoint
ALTER TABLE "app"."task_photos" ADD COLUMN "stage" text DEFAULT 'found' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."task_photos" ADD COLUMN "stamp" text;--> statement-breakpoint
ALTER TABLE "app"."properties" ADD CONSTRAINT "properties_maintainer_user_id_app_users_id_fk" FOREIGN KEY ("maintainer_user_id") REFERENCES "app"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."task_photos" ADD CONSTRAINT "task_photos_stage" CHECK ("app"."task_photos"."stage" in ('before', 'after', 'found'));--> statement-breakpoint
ALTER TABLE "app"."task_photos" ADD CONSTRAINT "task_photos_stamp_length" CHECK ("app"."task_photos"."stamp" is null or char_length("app"."task_photos"."stamp") <= 300);