CREATE TABLE "app"."card_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"session_id" text NOT NULL,
	"payment_intent_id" text,
	"url" text,
	"expires_at" timestamp with time zone,
	"kept_minor" bigint,
	"kept_reason" text,
	"payment_id" uuid,
	"charge_id" uuid,
	"live" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	CONSTRAINT "card_requests_session_key" UNIQUE("session_id"),
	CONSTRAINT "card_requests_kind" CHECK ("app"."card_requests"."kind" in ('payment', 'deposit')),
	CONSTRAINT "card_requests_status" CHECK ("app"."card_requests"."status" in ('open', 'paid', 'held', 'kept', 'released', 'expired')),
	CONSTRAINT "card_requests_amount" CHECK ("app"."card_requests"."amount_minor" > 0),
	CONSTRAINT "card_requests_kept" CHECK ("app"."card_requests"."kept_minor" is null or ("app"."card_requests"."kept_minor" > 0 and "app"."card_requests"."kept_minor" <= "app"."card_requests"."amount_minor"))
);
--> statement-breakpoint
ALTER TABLE "app"."card_requests" ADD CONSTRAINT "card_requests_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "app"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."card_requests" ADD CONSTRAINT "card_requests_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "app"."reservations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."card_requests" ADD CONSTRAINT "card_requests_payment_id_reservation_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "app"."reservation_payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."card_requests" ADD CONSTRAINT "card_requests_charge_id_reservation_charges_id_fk" FOREIGN KEY ("charge_id") REFERENCES "app"."reservation_charges"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."card_requests" ADD CONSTRAINT "card_requests_created_by_app_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "card_requests_reservation_idx" ON "app"."card_requests" USING btree ("reservation_id");