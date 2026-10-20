CREATE TABLE "app"."reservation_charges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"label" text NOT NULL,
	"amount_minor" bigint NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservation_charges_label_length" CHECK (char_length("app"."reservation_charges"."label") between 1 and 80),
	CONSTRAINT "reservation_charges_amount" CHECK ("app"."reservation_charges"."amount_minor" <> 0)
);
--> statement-breakpoint
CREATE TABLE "app"."reservation_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"method" text NOT NULL,
	"paid_on" date NOT NULL,
	"note" text,
	"recorded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservation_payments_method" CHECK ("app"."reservation_payments"."method" in ('channel', 'card', 'bank_transfer', 'cash', 'other')),
	CONSTRAINT "reservation_payments_amount" CHECK ("app"."reservation_payments"."amount_minor" <> 0),
	CONSTRAINT "reservation_payments_note_length" CHECK ("app"."reservation_payments"."note" is null or char_length("app"."reservation_payments"."note") <= 400)
);
--> statement-breakpoint
ALTER TABLE "app"."reservations" ADD COLUMN "cancellation_reason" text;--> statement-breakpoint
ALTER TABLE "app"."reservations" ADD COLUMN "cancelled_by" uuid;--> statement-breakpoint
ALTER TABLE "app"."reservation_charges" ADD CONSTRAINT "reservation_charges_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "app"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reservation_charges" ADD CONSTRAINT "reservation_charges_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "app"."reservations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reservation_charges" ADD CONSTRAINT "reservation_charges_created_by_app_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "app"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reservation_payments" ADD CONSTRAINT "reservation_payments_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "app"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reservation_payments" ADD CONSTRAINT "reservation_payments_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "app"."reservations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reservation_payments" ADD CONSTRAINT "reservation_payments_recorded_by_app_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "app"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reservation_charges_reservation_idx" ON "app"."reservation_charges" USING btree ("reservation_id");--> statement-breakpoint
CREATE INDEX "reservation_payments_reservation_idx" ON "app"."reservation_payments" USING btree ("reservation_id");--> statement-breakpoint
ALTER TABLE "app"."reservations" ADD CONSTRAINT "reservations_cancelled_by_app_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "app"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reservations" ADD CONSTRAINT "reservations_cancellation_reason_length" CHECK ("app"."reservations"."cancellation_reason" is null or char_length("app"."reservations"."cancellation_reason") <= 400);--> statement-breakpoint
SELECT app.enable_tenant_rls('app.reservation_charges', 'SELECT, INSERT, DELETE');
--> statement-breakpoint
SELECT app.enable_tenant_rls('app.reservation_payments', 'SELECT, INSERT, DELETE');
--> statement-breakpoint
CREATE TRIGGER reservation_charges_audit AFTER INSERT OR UPDATE OR DELETE ON app.reservation_charges
  FOR EACH ROW EXECUTE FUNCTION app.audit_row();
--> statement-breakpoint
CREATE TRIGGER reservation_payments_audit AFTER INSERT OR UPDATE OR DELETE ON app.reservation_payments
  FOR EACH ROW EXECUTE FUNCTION app.audit_row();
