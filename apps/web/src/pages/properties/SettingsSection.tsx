import { MANAGED_BY_LABELS, type PropertyDetail } from '@v01/shared';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { SelectField } from '../../components/fields.tsx';
import { Button, Notice } from '../../components/ui.tsx';
import { ApiError, useArchiveProperty, useTeam, useUpdateProperty } from '../../lib/api.ts';
import { V01 } from '../../lib/format.ts';
import { Section } from './Section.tsx';

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-6 border-b border-hairline py-3 text-[14px]">
      <dt className="text-slate">{label}</dt>
      <dd className="m-0 text-right text-ink">{children}</dd>
    </div>
  );
}

/**
 * The property's own settings: how it is known inside the team, who runs its channels and sets its
 * prices, and archiving. The listing's parts have their own sections above.
 */
export function SettingsSection({
  d,
  orgId,
  canEdit,
}: {
  d: PropertyDetail;
  orgId: string;
  canEdit: boolean;
}) {
  const archive = useArchiveProperty(orgId);
  const update = useUpdateProperty(orgId, d.id);
  const team = useTeam(canEdit ? orgId : null);
  const navigate = useNavigate();
  const [asking, setAsking] = useState(false);
  // The field team first, then everyone else: whoever usually does the check-out clean.
  const people = [...(team.data?.members ?? [])].sort((a, b) =>
    a.role === b.role ? a.name.localeCompare(b.name) : a.role === 'field' ? -1 : b.role === 'field' ? 1 : 0,
  );
  return (
    <Section
      id="settings"
      canEdit={false}
      description="How the team knows this property, and what happens to it."
    >
      <dl className="m-0">
        <Fact label="Short code">{d.internalCode ?? <span className="text-mist">None</span>}</Fact>
        <Fact label="Area">{d.area ?? <span className="text-mist">None</span>}</Fact>
        <Fact label="Channels run by">{MANAGED_BY_LABELS[d.managedBy]}</Fact>
        <Fact label="Prices set by">{d.priceOwner === 'pricelabs' ? 'PriceLabs' : V01}</Fact>
        <Fact label="Added">
          {new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium' }).format(new Date(d.createdAt))}
        </Fact>
      </dl>
      <p className="mt-3 max-w-[64ch] text-[13px] leading-relaxed text-mist">
        The short code and area are changed under The place. Who runs the channels changes only in the
        move-over step, once its listings are off Guesty.
      </p>
      <div className="mt-8 max-w-[420px]">
        {canEdit ? (
          <SelectField
            label="Usual cleaner"
            value={d.cleaner?.id ?? ''}
            onChange={(v) => update.mutate({ cleanerUserId: v || null })}
            options={[
              { value: '', label: 'Nobody yet' },
              ...people.map((m) => ({ value: m.id, label: m.name })),
            ]}
            hint="The clean made at every check-out is assigned to them."
          />
        ) : (
          <dl className="m-0">
            <Fact label="Usual cleaner">
              {d.cleaner?.name ?? <span className="text-mist">Nobody yet</span>}
            </Fact>
          </dl>
        )}
        {update.error ? (
          <div className="mt-3">
            <Notice tone="urgent">
              {update.error instanceof ApiError ? update.error.message : 'That didn’t go through. Try again.'}
            </Notice>
          </div>
        ) : null}
      </div>
      {canEdit ? (
        <div className="mt-8 rounded-xl border border-hairline p-4">
          <p className="text-[14.5px] font-medium text-ink">Archive this property</p>
          <p className="mt-1 max-w-[62ch] text-[13.5px] leading-relaxed text-slate">
            It leaves every screen and nothing more is sent for it. Its bookings and history are kept, so
            {` ${V01} `}support can bring it back if this was a mistake.
          </p>
          {archive.error ? (
            <div className="mt-3">
              <Notice tone="urgent">
                {archive.error instanceof ApiError
                  ? archive.error.message
                  : 'That didn’t go through. Try again.'}
              </Notice>
            </div>
          ) : null}
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {asking ? (
              <>
                <Button
                  variant="primary"
                  disabled={archive.isPending}
                  onClick={() => archive.mutate(d.id, { onSuccess: () => navigate('/properties') })}
                >
                  {archive.isPending ? 'Archiving' : `Archive ${d.name}`}
                </Button>
                <Button variant="quiet" onClick={() => setAsking(false)}>
                  Keep it
                </Button>
              </>
            ) : (
              <Button onClick={() => setAsking(true)}>Archive</Button>
            )}
          </div>
        </div>
      ) : null}
    </Section>
  );
}
