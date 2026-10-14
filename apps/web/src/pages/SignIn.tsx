import { type FormEvent, useState } from 'react';
import { Navigate } from 'react-router';
import { BrandMark } from '../components/BrandMark.tsx';
import { Button, Field, Notice } from '../components/ui.tsx';
import { appBrand } from '../lib/brand.ts';
import { config } from '../lib/config.ts';
import { signInToDemo, useSession } from '../lib/session.tsx';
import { supabase } from '../lib/supabase.ts';

export function SignIn() {
  const { session } = useSession();
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);

  if (session) return <Navigate to="/today" replace />;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    setState('sending');
    setError(null);
    const { error: sendError } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/today` },
    });
    if (sendError) {
      setError(sendError.message);
      setState('idle');
      return;
    }
    setState('sent');
  }

  return (
    <div className="gutter md:gutter-wide grid min-h-dvh grid-rows-[auto_1fr] py-6">
      <BrandMark />
      <main className="flex items-center">
        <div className="w-full max-w-[380px] md:ml-[12vw]">
          {state === 'sent' ? (
            <div aria-live="polite">
              <h1 className="font-serif text-[38px] leading-[1.05] font-normal tracking-[-0.015em]">
                Check your email
              </h1>
              <p className="mt-4 text-[15px] leading-relaxed text-slate">
                We sent a sign-in link to <span className="font-medium text-ink">{email.trim()}</span>. Open
                it on this device to sign in.
              </p>
              <Button variant="quiet" className="mt-6" onClick={() => setState('idle')}>
                Use a different email
              </Button>
            </div>
          ) : (
            <>
              <h1 className="font-serif text-[38px] leading-[1.05] font-normal tracking-[-0.015em]">
                Sign in to {appBrand.name}
              </h1>
              <p className="mt-4 text-[15px] leading-relaxed text-slate">
                {config.demo
                  ? 'This is a demo with sample data. No email or password needed.'
                  : "We'll email you a link. There's no password to remember."}
              </p>
              {config.demo ? (
                <Button variant="primary" className="mt-8 w-full" onClick={signInToDemo}>
                  Open the demo
                </Button>
              ) : supabase ? (
                <form onSubmit={submit} className="mt-8 flex flex-col gap-4">
                  <Field
                    label="Work email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    error={error ?? undefined}
                  />
                  <Button type="submit" variant="primary" disabled={state === 'sending'}>
                    {state === 'sending' ? 'Sending link' : 'Email me a sign-in link'}
                  </Button>
                </form>
              ) : (
                <div className="mt-8">
                  <Notice>
                    Sign-in isn't configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in
                    apps/web/.env.local, then restart the app.
                  </Notice>
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
