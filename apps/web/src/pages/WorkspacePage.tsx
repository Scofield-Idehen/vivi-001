import { ROLE_LABELS } from '@v01/shared';
import type { ReactNode } from 'react';
import { Notice, PageHeader } from '../components/ui.tsx';
import { ApiError, useWorkspace } from '../lib/api.ts';
import { useCurrentWorkspace } from '../lib/workspace.tsx';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[180px_1fr] gap-4 py-3 text-[14px]">
      <dt className="text-slate">{label}</dt>
      <dd>{children ?? <span className="text-mist">Not set</span>}</dd>
    </div>
  );
}

export function WorkspacePage() {
  const { orgId, membership } = useCurrentWorkspace();
  const workspace = useWorkspace(orgId);
  const data = workspace.data;

  return (
    <>
      <PageHeader
        title="Workspace"
        description="How your company appears to guests, owners and contractors, and how dates and money are shown."
      />
      {workspace.error ? (
        <Notice tone="urgent">
          {workspace.error instanceof ApiError ? workspace.error.message : 'Could not load the workspace.'}
        </Notice>
      ) : null}
      {data ? (
        <div className="grid max-w-[880px] gap-10 lg:grid-cols-2">
          <section aria-labelledby="company">
            <h2 id="company" className="mb-1 text-[15px] font-medium">
              Company
            </h2>
            <dl className="divide-y divide-hairline border-y border-hairline">
              <Row label="Name">{data.organisation.name}</Row>
              <Row label="Legal name">{data.organisation.legalName}</Row>
              <Row label="Currency">{data.settings.currency}</Row>
              <Row label="Time zone">{data.settings.timeZone}</Row>
              <Row label="Country">{data.settings.countryCode}</Row>
              <Row label="Your role">{ROLE_LABELS[membership.role]}</Row>
            </dl>
          </section>
          <section aria-labelledby="brand">
            <h2 id="brand" className="mb-1 text-[15px] font-medium">
              What guests see
            </h2>
            <dl className="divide-y divide-hairline border-y border-hairline">
              <Row label="Shown as">{data.brand.displayName}</Row>
              <Row label="Accent colour">
                {data.brand.accentHex ? (
                  <span className="inline-flex items-center gap-2">
                    <span
                      aria-hidden
                      className="size-4 rounded-sm border border-hairline"
                      style={{ background: data.brand.accentHex }}
                    />
                    <span className="font-mono text-[12.5px]">{data.brand.accentHex}</span>
                  </span>
                ) : null}
              </Row>
              <Row label="Emails come from">{data.brand.senderName}</Row>
              <Row label="Email domain">{data.brand.emailDomain}</Row>
              <Row label="Logo">{data.brand.logoLightUrl ? 'Uploaded' : null}</Row>
            </dl>
          </section>
          <p className="text-[13px] leading-relaxed text-mist lg:col-span-2">
            Editing these arrives with the workspace settings screens (design phase D2). Until then, contact
            support to change them.
          </p>
        </div>
      ) : null}
    </>
  );
}
