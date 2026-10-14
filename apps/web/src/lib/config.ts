export const config = {
  apiUrl: (import.meta.env.VITE_API_URL ?? 'http://localhost:3001').replace(/\/$/, ''),
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
  supabaseKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
};
