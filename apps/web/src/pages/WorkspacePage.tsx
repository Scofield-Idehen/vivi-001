import { ROLE_LABELS } from '@v01/shared';
import type { ReactNode } from 'react';
import { Notice, PageHeader, SectionHeading, StatusDot } from '../components/ui.tsx';
import { ApiError, useSupportVisits, useWorkspace } from '../lib/api.ts';
import { dateTime, duration, useNow } from '../lib/format.ts';
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
  const { orgId, entry } = useCurrentWorkspace();
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
              <Row label="Your role">{ROLE_LABELS[entry.role]}</Row>
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
      <SupportVisits orgId={orgId} />
    </>
  );
}

/**
 * Every time V-01 staff opened this workspace. They need a reason, they can only read, and the
 * access closes by itself; this list is how the company checks that.
 */
function SupportVisits({ orgId }: { orgId: string }) {
  const visits = useSupportVisits(orgId);
  const now = useNow();
  const list = visits.data?.visits ?? [];

  return (
    <section aria-labelledby="support-visits" className="mt-12 max-w-[880px]">
      <SectionHeading id="support-visits">V-01 support visits</SectionHeading>
      <p className="mb-3 text-[13.5px] leading-relaxed text-slate">
        V-01 staff can open this workspace only with a reason, read-only, and for up to four hours. Every
        visit is listed here.
      </p>
      {visits.error ? (
        <Notice tone="urgent">
          {visits.error instanceof ApiError ? visits.error.message : 'Could not load support visits.'}
        </Notice>
      ) : null}
      {visits.data && list.length === 0 ? (
        <p className="border-y border-hairline py-3 text-[14px]">
          <StatusDot status="neutral">No visits yet</StatusDot>
        </p>
      ) : null}
      {list.length > 0 ? (
        <ul className="divide-y divide-hairline border-y border-hairline">
          {list.map((v) => {
            const open = v.endedAt === null && Date.parse(v.expiresAt) > now;
            return (
              <li key={v.id} className="flex flex-col gap-1 py-3 text-[13.5px] sm:flex-row sm:gap-6">
                <span className="shrink-0 text-slate sm:w-[150px]">
                  {dateTime(v.startedAt)}
                  <span className="block text-[12.5px] text-mist">
                    {open ? 'Open now' : duration(v.startedAt, v.endedAt ?? v.expiresAt)}
                  </span>
                </span>
                <span className="min-w-0">
                  <span className="block text-ink">{v.reason}</span>
                  <span className="block text-[12.5px] text-mist">{v.staffEmail}</span>
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
