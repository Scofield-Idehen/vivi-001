CREATE TABLE "app"."task_nudges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"sent_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_nudges_once" UNIQUE("task_id","user_id","kind"),
	CONSTRAINT "task_nudges_kind" CHECK ("app"."task_nudges"."kind" in ('assigned', 'reminder', 'overdue'))
);
--> statement-breakpoint
ALTER TABLE "app"."task_nudges" ADD CONSTRAINT "task_nudges_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "app"."organisations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."task_nudges" ADD CONSTRAINT "task_nudges_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "app"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."task_nudges" ADD CONSTRAINT "task_nudges_user_id_app_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."app_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_nudges_org_idx" ON "app"."task_nudges" USING btree ("organisation_id");