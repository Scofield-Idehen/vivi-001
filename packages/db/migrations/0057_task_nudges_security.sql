-- Slack messages about jobs (2 Nov 2026): the operator's own rows; the API and the scheduled run write them.
SELECT app.enable_tenant_rls('app.task_nudges', 'SELECT, INSERT, UPDATE');
