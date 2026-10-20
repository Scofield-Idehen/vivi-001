import type { Session } from '@supabase/supabase-js';
import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';
import { config } from './config.ts';
import { DEMO_SESSION } from './demo.ts';
import { supabase } from './supabase.ts';

interface SessionState {
  session: Session | null;
  loading: boolean;
}

const SessionContext = createContext<SessionState>({ session: null, loading: true });

// Demo mode signs in and out without Supabase.
let setDemoSession: ((session: Session | null) => void) | null = null;

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>(
    config.demo ? { session: DEMO_SESSION, loading: false } : { session: null, loading: Boolean(supabase) },
  );

  useEffect(() => {
    if (config.demo) {
      setDemoSession = (session) => setState({ session, loading: false });
      return () => {
        setDemoSession = null;
      };
    }
    if (!supabase) return;
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active) setState({ session: data.session, loading: false });
    });
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      // A line in the browser's console for each change, so a surprise sign-out can be traced.
      console.info(
        `[sign-in] ${event}`,
        session ? `until ${new Date((session.expires_at ?? 0) * 1000).toLocaleTimeString()}` : 'no session',
      );
      setState({ session, loading: false });
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  return <SessionContext.Provider value={state}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  return useContext(SessionContext);
}

export async function signOut(): Promise<void> {
  if (config.demo) {
    setDemoSession?.(null);
    return;
  }
  await supabase?.auth.signOut();
}

/**
 * A fresh access token when the one in hand was refused: Supabase refreshes it with the refresh
 * token it keeps. Null when it can't (the refresh token is gone or revoked), which is a real sign-out.
 */
export async function refreshedToken(): Promise<string | null> {
  if (config.demo || !supabase) return null;
  const { data, error } = await supabase.auth.refreshSession();
  if (error) console.warn('[sign-in] refresh failed', error.message);
  return data.session?.access_token ?? null;
}

export function signInToDemo(): void {
  setDemoSession?.(DEMO_SESSION);
}
