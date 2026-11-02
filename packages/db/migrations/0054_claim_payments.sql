ALTER TABLE "app"."card_requests" ADD COLUMN "claim_id" uuid;--> statement-breakpoint
CREATE INDEX "card_requests_claim_idx" ON "app"."card_requests" USING btree ("claim_id");