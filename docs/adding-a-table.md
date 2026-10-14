# Adding a table

Every table that holds an operator's data follows the same five steps. The security tests fail
if any is missed.

1. Define it in `packages/db/src/schema/` with `organisationId` (not null, references `organisations`).
2. Run `pnpm db:generate` to create the migration.
3. Create a custom migration (`pnpm --filter @v01/db exec drizzle-kit generate --custom --name=<name>`) that calls
   `select app.enable_tenant_rls('app.<table>', '<privileges>');`
   Grant only what the app needs: append-only tables get `SELECT, INSERT`.
4. If people edit it, add the audit trigger:
   `create trigger <table>_audit after insert or update or delete on app.<table> for each row execute function app.audit_row();`
5. Add a test that a second operator cannot see or change its rows.

New functions in schema `app` must be revoked from PUBLIC and granted to a specific role.

A table that is not tied to one operator (like `platform_staff` or `platform_audit`) still turns on
row-level security, gets no grants at all, and is reached only through narrow functions. List it in
`NOT_OPERATOR_TABLES` in `packages/db/test/security-coverage.test.ts`, with the reason.
