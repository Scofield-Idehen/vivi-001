import { type FormEvent, useState } from 'react';
import { Navigate } from 'react-router';
import lodgeAtDusk from '../assets/sign-in.jpg';
import { BrandMark } from '../components/BrandMark.tsx';
import { Button, Field, Notice } from '../components/ui.tsx';
import { appBrand } from '../lib/brand.ts';
import { config } from '../lib/config.ts';
import { signInToDemo, useSession } from '../lib/session.tsx';
import { supabase } from '../lib/supabase.ts';

/**
 * The picture beside the form: one of Vivistays' lodges at dusk. Another operator's photo goes in
 * apps/web/public/sign-in.jpg and is used when present, with no code change.
 */
function Picture() {
  const [src, setSrc] = useState('/sign-in.jpg');
  return (
    <div className="relative h-[34vh] min-h-[220px] overflow-hidden lg:h-auto lg:min-h-dvh">
      <img
        src={src}
        alt=""
        onError={() => {
          if (src !== lodgeAtDusk) setSrc(lodgeAtDusk);
        }}
        className="absolute inset-0 size-full object-cover object-[55%_60%]"
      />
      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-black/35 to-transparent" />
      <p className="absolute bottom-6 left-6 text-[12px] tracking-[0.18em] text-white/85 uppercase">
        {appBrand.name}
      </p>
    </div>
  );
}

export function SignIn() {
  const { session } = useSession();
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState<string | null>(null);

  if (session) return <Navigate to="/" replace />;

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
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <Picture />
      <div className="gutter md:gutter-wide grid grid-rows-[auto_1fr] py-6">
        <BrandMark />
        <main className="flex items-center">
          <div className="w-full max-w-[380px] lg:mx-auto">
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
    </div>
  );
}
