import { Link } from 'react-router';
import { BrandMark } from '../components/BrandMark.tsx';
import { Button, PageHeader, StatusDot } from '../components/ui.tsx';
import type { ModuleEntry } from '../lib/modules.ts';
import { signOut, useSession } from '../lib/session.tsx';

/** A module from the roadmap that isn't built yet: says what it will do and when it arrives. */
export function ModuleToCome({ module }: { module: ModuleEntry }) {
  return (
    <>
      <PageHeader title={module.label} description={module.summary} />
      <p className="text-[14px]">
        <StatusDot status="pending">
          Designed in {module.design}, built in {module.phase}.
        </StatusDot>
      </p>
      <p className="mt-6 text-[14px]">
        <Link to="/today" className="text-accent underline-offset-4 hover:underline">
          Back to Today
        </Link>
      </p>
    </>
  );
}

export function NotFound() {
  return (
    <>
      <PageHeader title="Page not found" description="This page doesn't exist or has moved." />
      <Link to="/today" className="text-[14px] text-accent underline-offset-4 hover:underline">
        Go to Today
      </Link>
    </>
  );
}

/** V-01 is named here and in the terms only; the rest of the app wears the operator's look. */
export function About() {
  return (
    <>
      <PageHeader title="About" />
      <div className="max-w-[60ch] space-y-4 text-[14px] leading-relaxed text-slate">
        <p>This workspace runs on V-01, a property management platform for short-stay operators.</p>
        <p>
          Your company's data is kept separate from every other company on the platform, and stays in the UK.
        </p>
        <p className="text-mist">Version 0.1, the base build.</p>
      </div>
    </>
  );
}

export function NoWorkspace() {
  const { session } = useSession();
  return (
    <div className="grid min-h-dvh grid-rows-[auto_1fr] px-6 py-6 md:px-10">
      <BrandMark />
      <main className="flex items-center">
        <div className="max-w-[440px] md:ml-[12vw]">
          <h1 className="font-serif text-[34px] leading-[1.1] font-normal">You're not in a workspace yet</h1>
          <p className="mt-4 text-[15px] leading-relaxed text-slate">
            You're signed in as <span className="font-medium text-ink">{session?.user.email}</span>. Ask your
            operator admin to invite this email address, then sign in again.
          </p>
          <Button className="mt-6" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </main>
    </div>
  );
}
