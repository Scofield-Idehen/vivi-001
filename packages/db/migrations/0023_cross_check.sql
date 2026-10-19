ALTER TABLE "app"."channex_mappings" ADD COLUMN "cross_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."channex_mappings" ADD COLUMN "cross_check_differences" integer;--> statement-breakpoint
ALTER TABLE "app"."channex_mappings" ADD COLUMN "cross_check_error" text;--> statement-breakpoint
-- When the worker was last seen, for the Today page's "Needs attention": an operator should know
-- when nothing has reached the channels for a while, not only V-01's own console.
CREATE OR REPLACE FUNCTION app.worker_last_seen()
RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp
AS $$
  SELECT max(last_seen_at) FROM app.worker_runs;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.worker_last_seen() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.worker_last_seen() TO app_api;
