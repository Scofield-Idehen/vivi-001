ALTER TABLE "app"."reservation_revisions" ADD COLUMN "import_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."reservation_revisions" ADD COLUMN "import_error" text;