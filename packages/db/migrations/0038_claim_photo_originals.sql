ALTER TABLE "app"."claim_files" ADD COLUMN "stamp" text;--> statement-breakpoint
ALTER TABLE "app"."claim_files" ADD COLUMN "original_path" text;--> statement-breakpoint
ALTER TABLE "app"."claim_files" ADD COLUMN "original_type" text;--> statement-breakpoint
ALTER TABLE "app"."claim_files" ADD COLUMN "original_bytes" bigint;--> statement-breakpoint
ALTER TABLE "app"."claim_files" ADD CONSTRAINT "claim_files_stamp_length" CHECK ("app"."claim_files"."stamp" is null or char_length("app"."claim_files"."stamp") <= 300);