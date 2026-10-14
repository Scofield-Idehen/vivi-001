import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from './config.ts';

/**
 * Supabase is used for sign-in only. The app never reads or writes database tables
 * directly: every request goes to the V-01 API with the sign-in token.
 */
export const supabase: SupabaseClient | null =
  config.supabaseUrl && config.supabaseKey
    ? createClient(config.supabaseUrl, config.supabaseKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      })
    : null;
