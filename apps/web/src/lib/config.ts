export const config = {
  /**
   * Demo mode (`pnpm demo`) runs the real screens against sample data held in the browser:
   * no API, database or sign-in needed. Never used in production builds.
   */
  demo: import.meta.env.MODE === 'demo',
  apiUrl: (import.meta.env.VITE_API_URL ?? 'http://localhost:3001').replace(/\/$/, ''),
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
  supabaseKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
};
