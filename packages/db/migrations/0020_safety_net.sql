CREATE TABLE "app"."worker_runs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app"."worker_runs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"previous_seen_at" timestamp with time zone,
	"gap_seconds" integer,
	"recovery" text DEFAULT 'none' NOT NULL,
	"drained_revisions" integer DEFAULT 0 NOT NULL,
	"recovered_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "app"."channex_mappings" ADD COLUMN "auto_close" boolean;--> statement-breakpoint
ALTER TABLE "app"."channex_mappings" ADD COLUMN "auto_close_checked_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "worker_runs_started_idx" ON "app"."worker_runs" USING btree ("started_at");--> statement-breakpoint
-- Only the worker writes its own runs. Row-level security is on with one policy for it, so the
-- coverage test's rule (every table has it) holds; the API reads through the console function.
ALTER TABLE app.worker_runs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY worker_runs_worker ON app.worker_runs TO app_worker USING (true) WITH CHECK (true);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON app.worker_runs TO app_worker;
--> statement-breakpoint
-- The console's view of the worker: when it was last seen, and the last recovery.
CREATE OR REPLACE FUNCTION app.console_worker_status()
RETURNS TABLE (
  last_seen_at timestamptz,
  started_at timestamptz,
  recovery text,
  gap_seconds integer,
  drained_revisions integer,
  recovered_at timestamptz,
  last_recovery_at timestamptz,
  last_recovery_gap_seconds integer,
  last_recovery_drained integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, pg_temp
AS $$
#variable_conflict use_column
BEGIN
  PERFORM app.require_platform_role(ARRAY['owner', 'support', 'viewer']::app.platform_role[]);
  RETURN QUERY
  SELECT r.last_seen_at, r.started_at, r.recovery, r.gap_seconds, r.drained_revisions, r.recovered_at,
         lr.recovered_at, lr.gap_seconds, lr.drained_revisions
    FROM app.worker_runs r
    LEFT JOIN LATERAL (
      SELECT x.recovered_at, x.gap_seconds, x.drained_revisions
        FROM app.worker_runs x WHERE x.recovery = 'done' ORDER BY x.recovered_at DESC LIMIT 1
    ) lr ON true
   ORDER BY r.started_at DESC
   LIMIT 1;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.console_worker_status() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.console_worker_status() TO app_api;
