CREATE TABLE "app"."message_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"name" text NOT NULL,
	"trigger" text NOT NULL,
	"send_time" time,
	"body" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_templates_trigger" CHECK ("app"."message_templates"."trigger" in ('booking_confirmed', 'before_arrival', 'arrival_day', 'before_departure', 'manual')),
	CONSTRAINT "message_templates_name_length" CHECK (char_length("app"."message_templates"."name") between 1 and 80),
	CONSTRAINT "message_templates_body_length" CHECK (char_length("app"."message_templates"."body") between 1 and 8000)
);
--> statement-breakpoint
CREATE TABLE "app"."message_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"external_thread_id" text,
	"last_message_at" timestamp with time zone,
	"last_direction" text,
	"last_preview" text,
	"unread_count" integer DEFAULT 0 NOT NULL,
	"awaiting_since" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_threads_reservation_key" UNIQUE("reservation_id"),
	CONSTRAINT "message_threads_status" CHECK ("app"."message_threads"."status" in ('open', 'done')),
	CONSTRAINT "message_threads_last_direction" CHECK ("app"."message_threads"."last_direction" is null or "app"."message_threads"."last_direction" in ('in', 'out'))
);
--> statement-breakpoint
CREATE TABLE "app"."messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"direction" text NOT NULL,
	"via" text NOT NULL,
	"body" text NOT NULL,
	"status" text NOT NULL,
	"note" text,
	"sent_by" uuid,
	"template_id" uuid,
	"automatic" boolean DEFAULT false NOT NULL,
	"external_id" text,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_external_key" UNIQUE("organisation_id","via","external_id"),
	CONSTRAINT "messages_direction" CHECK ("app"."messages"."direction" in ('in', 'out')),
	CONSTRAINT "messages_via" CHECK ("app"."messages"."via" in ('airbnb', 'booking_com', 'vrbo', 'expedia', 'email', 'sms')),
	CONSTRAINT "messages_status" CHECK ("app"."messages"."status" in ('received', 'queued', 'sent', 'waiting', 'failed')),
	CONSTRAINT "messages_body_length" CHECK (char_length("app"."messages"."body") between 1 and 8000)
);
--> statement-breakpoint
ALTER TABLE "app"."message_templates" ADD CONSTRAINT "message_templates_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "app"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."message_threads" ADD CONSTRAINT "message_threads_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "app"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."message_threads" ADD CONSTRAINT "message_threads_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "app"."reservations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."message_threads" ADD CONSTRAINT "message_threads_property_fk" FOREIGN KEY ("organisation_id","property_id") REFERENCES "app"."properties"("organisation_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."messages" ADD CONSTRAINT "messages_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "app"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."messages" ADD CONSTRAINT "messages_thread_id_message_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "app"."message_threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."messages" ADD CONSTRAINT "messages_sent_by_app_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "app"."app_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."messages" ADD CONSTRAINT "messages_template_id_message_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "app"."message_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "message_templates_org_idx" ON "app"."message_templates" USING btree ("organisation_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "message_templates_trigger_once" ON "app"."message_templates" USING btree ("organisation_id","trigger") WHERE "app"."message_templates"."trigger" <> 'manual';--> statement-breakpoint
CREATE INDEX "message_threads_org_last_idx" ON "app"."message_threads" USING btree ("organisation_id","last_message_at");--> statement-breakpoint
CREATE INDEX "message_threads_org_status_idx" ON "app"."message_threads" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE INDEX "messages_thread_idx" ON "app"."messages" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_org_status_idx" ON "app"."messages" USING btree ("organisation_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_template_once" ON "app"."messages" USING btree ("thread_id","template_id") WHERE "app"."messages"."automatic";--> statement-breakpoint
SELECT app.enable_tenant_rls('app.message_threads', 'SELECT, INSERT, UPDATE');
--> statement-breakpoint
SELECT app.enable_tenant_rls('app.message_templates');
--> statement-breakpoint
SELECT app.enable_tenant_rls('app.messages', 'SELECT, INSERT, UPDATE');
--> statement-breakpoint
CREATE TRIGGER message_threads_touch BEFORE UPDATE ON app.message_threads
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER message_templates_touch BEFORE UPDATE ON app.message_templates
  FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER message_templates_audit AFTER INSERT OR UPDATE OR DELETE ON app.message_templates
  FOR EACH ROW EXECUTE FUNCTION app.audit_row();
--> statement-breakpoint
CREATE TRIGGER messages_audit AFTER INSERT OR UPDATE OR DELETE ON app.messages
  FOR EACH ROW EXECUTE FUNCTION app.audit_row();
--> statement-breakpoint
-- Every booking has a thread from the moment it exists, so the Inbox never has to make one.
CREATE OR REPLACE FUNCTION app.reservation_thread()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp
AS $$
BEGIN
  INSERT INTO app.message_threads (organisation_id, reservation_id, property_id)
  VALUES (NEW.organisation_id, NEW.id, NEW.property_id)
  ON CONFLICT (reservation_id) DO NOTHING;
  RETURN NEW;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.reservation_thread() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER reservations_thread AFTER INSERT ON app.reservations
  FOR EACH ROW EXECUTE FUNCTION app.reservation_thread();
--> statement-breakpoint
INSERT INTO app.message_threads (organisation_id, reservation_id, property_id)
SELECT r.organisation_id, r.id, r.property_id FROM app.reservations r
ON CONFLICT (reservation_id) DO NOTHING;
--> statement-breakpoint
-- The thread keeps what the list shows: the last message, what the guest is still waiting on, and
-- how many of theirs nobody has opened. A message from the guest reopens a thread marked done.
CREATE OR REPLACE FUNCTION app.message_added()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp
AS $$
BEGIN
  UPDATE app.message_threads t
     SET last_message_at = NEW.created_at,
         last_direction = NEW.direction,
         last_preview = left(regexp_replace(NEW.body, '\s+', ' ', 'g'), 140),
         unread_count = CASE WHEN NEW.direction = 'in' THEN t.unread_count + 1 ELSE t.unread_count END,
         -- An automatic message is not an answer: the guest keeps waiting until a person replies.
         awaiting_since = CASE WHEN NEW.direction = 'in' THEN coalesce(t.awaiting_since, NEW.created_at)
                               WHEN NEW.automatic THEN t.awaiting_since
                               ELSE NULL END,
         status = CASE WHEN NEW.direction = 'in' THEN 'open' ELSE t.status END
   WHERE t.id = NEW.thread_id;
  RETURN NEW;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.message_added() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER messages_added AFTER INSERT ON app.messages
  FOR EACH ROW EXECUTE FUNCTION app.message_added();
--> statement-breakpoint
-- The automatic messages every workspace starts with. Off until the team reads them, except the
-- confirmation; an admin changes the words, the time, or switches each on and off, in the Inbox.
CREATE OR REPLACE FUNCTION app.standard_message_templates(p_org uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp
AS $$
DECLARE
  n integer;
BEGIN
  INSERT INTO app.message_templates (organisation_id, name, trigger, send_time, body, enabled, position)
  SELECT p_org, s.name, s.trigger, s.send_time::time, s.body, s.enabled, s.position
    FROM (VALUES
      ('Booking confirmed', 'booking_confirmed', NULL,
       E'Hi {{guest_first_name}},\n\nThank you for booking {{property}}. We have you from {{check_in}} to {{check_out}}, {{nights}} nights.\n\nEverything you need for your stay is on your page, which fills in as the day comes: {{stay_link}}\n\nIf anything comes up before then, just reply here.\n\n{{operator}}',
       true, 1),
      ('The day before arrival', 'before_arrival', '10:00',
       E'Hi {{guest_first_name}},\n\nYou arrive tomorrow. Check-in at {{property}} is from {{check_in_time}}. Your page has the address, how to get in, and the Wi-Fi; the door code appears there on the day: {{stay_link}}\n\nSafe travels,\n{{operator}}',
       true, 2),
      ('Day of arrival', 'arrival_day', '09:00',
       E'Hi {{guest_first_name}},\n\nToday is the day. From {{check_in_time}} your door code is on your page: {{stay_link}}\n\nReply here if you need anything on the way.\n\n{{operator}}',
       false, 3),
      ('The day before check-out', 'before_departure', '17:00',
       E'Hi {{guest_first_name}},\n\nA quick note that check-out tomorrow is by {{check_out_time}}. Leave the keys as you found them and pull the door closed behind you.\n\nThank you for staying with us.\n{{operator}}',
       true, 4)
    ) AS s(name, trigger, send_time, body, enabled, position)
   WHERE NOT EXISTS (
     SELECT 1 FROM app.message_templates t WHERE t.organisation_id = p_org AND t.trigger = s.trigger
   );
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.standard_message_templates(uuid) FROM PUBLIC;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.organisation_standard_fields()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp
AS $$
BEGIN
  PERFORM app.standard_custom_fields(NEW.id);
  PERFORM app.standard_task_templates(NEW.id);
  PERFORM app.standard_message_templates(NEW.id);
  RETURN NEW;
END
$$;
--> statement-breakpoint
SELECT app.standard_message_templates(o.id) FROM app.organisations o;
