ALTER TABLE "app"."reservations" ADD COLUMN "check_in_time" time;--> statement-breakpoint
ALTER TABLE "app"."reservations" ADD COLUMN "check_out_time" time;--> statement-breakpoint
CREATE INDEX "reservations_org_check_in_idx" ON "app"."reservations" USING btree ("organisation_id","check_in");--> statement-breakpoint
ALTER TABLE "app"."reservations" ADD CONSTRAINT "reservations_notes_length" CHECK (char_length("app"."reservations"."notes") <= 4000);