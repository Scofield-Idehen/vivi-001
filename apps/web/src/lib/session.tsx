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
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
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

export function signInToDemo(): void {
  setDemoSession?.(DEMO_SESSION);
}
