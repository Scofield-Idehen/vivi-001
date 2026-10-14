import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  schemaFilter: ['app'],
  migrations: { schema: 'drizzle', table: '__migrations' },
  dbCredentials: {
    url: process.env.DATABASE_OWNER_URL ?? 'postgres://postgres:postgres@localhost:5432/v01',
  },
  strict: true,
  verbose: true,
});
