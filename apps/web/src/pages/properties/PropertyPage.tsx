import { IconArrowLeft, IconCheck, IconLayoutGrid } from '@tabler/icons-react';
import {
  can,
  type ListingCheck,
  type ListingSection,
  listingChecklist,
  MANAGED_BY_LABELS,
  PROPERTY_TYPE_LABELS,
  type PropertyDetail,
  type PropertyUpdate,
} from '@v01/shared';
import { Link, useParams } from 'react-router';
import { PageLoading } from '../../components/Spinner.tsx';
import { Badge, EmptyState } from '../../components/ui.tsx';
import { ApiError, useProperty, useUpdateProperty, useWorkspace } from '../../lib/api.ts';
import { useCurrentWorkspace } from '../../lib/workspace.tsx';
import { AmenitiesSection } from './AmenitiesSection.tsx';
import { ChannelsSection } from './ChannelsSection.tsx';
import { FieldsSection } from './FieldsSection.tsx';
import {
  AddressSection,
  ArrivalSection,
  BookingSection,
  DescriptionSection,
  LicenceSection,
  PlaceSection,
  PricingSection,
  RulesSection,
} from './ListingSections.tsx';
import { PhotosSection } from './PhotosSection.tsx';
import { RoomsSection } from './RoomsSection.tsx';
import { SECTION_TITLES, sectionAnchor } from './Section.tsx';
import { SettingsSection } from './SettingsSection.tsx';
import { Summary } from './Summary.tsx';
import { Tags } from './Tags.tsx';

function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

const ORDER: ListingSection[] = [
  'photos',
  'place',
  'rooms',
  'amenities',
  'description',
  'address',
  'arrival',
  'rules',
  'booking',
  'pricing',
  'licence',
  'fields',
  'channels',
  'settings',
];

function goTo(id: ListingSection) {
  const section = document.getElementById(sectionAnchor(id));
  section?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  section?.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
}

/** A section is done when everything the channels need from it is there. */
function sectionDone(checks: ListingCheck[], id: ListingSection): boolean | null {
  const own = checks.filter((c) => c.section === id);
  return own.length ? own.every((c) => c.done) : null;
}

function PhotoMosaic({ d }: { d: PropertyDetail }) {
  const [cover, ...rest] = d.photos;
  // No photos yet: the Photos section just below has the place to add them.
  if (!cover) return null;
  const side = rest.slice(0, 4);
  return (
    <div className="relative">
      <div
        className={cx(
          'grid h-[clamp(220px,42vw,440px)] gap-2 overflow-hidden rounded-2xl',
          side.length ? 'md:grid-cols-4 md:grid-rows-2' : 'grid-cols-1',
        )}
      >
        <img
          src={cover.url}
          alt={cover.caption ?? 'Cover photo'}
          className={cx('h-full w-full object-cover', side.length > 0 && 'md:col-span-2 md:row-span-2')}
        />
        {side.map((photo, index) => (
          <img
            key={photo.id}
            src={photo.url}
            alt={photo.caption ?? `Photo ${index + 2}`}
            loading="lazy"
            className={cx(
              'hidden h-full w-full object-cover md:block',
              side.length === 1 && 'md:col-span-2 md:row-span-2',
              side.length === 2 && 'md:col-span-2',
              side.length === 3 && index === 2 && 'md:col-span-2',
            )}
          />
        ))}
      </div>
      <button
        type="button"
        onClick={() => goTo('photos')}
        className="absolute right-3 bottom-3 inline-flex h-8 items-center gap-1.5 rounded-lg border border-ink/10 bg-canvas/95 px-3 text-[13px] font-medium text-ink shadow-[0_2px_8px_rgb(21_24_27/0.12)] hover:bg-canvas"
      >
        <IconLayoutGrid size={15} stroke={1.75} aria-hidden />
        {d.photos.length === 1 ? '1 photo' : `All ${d.photos.length} photos`}
      </button>
    </div>
  );
}

function Readiness({ checks }: { checks: ListingCheck[] }) {
  const done = checks.filter((c) => c.done).length;
  const missing = checks.filter((c) => !c.done);
  return (
    <div className="rounded-2xl bg-paper p-5">
      <p className="text-[14.5px] font-medium text-ink">Ready for the channels</p>
      <div className="mt-3 flex gap-1" aria-hidden>
        {checks.map((check) => (
          <span
            key={check.label}
            className={cx('h-1.5 flex-1 rounded-full', check.done ? 'bg-accent' : 'bg-hairline')}
          />
        ))}
      </div>
      <p className="tnum mt-2 text-[13px] text-slate">
        {missing.length ? `${done} of ${checks.length} done` : 'Everything the channels ask for is here.'}
      </p>
      {/* Wide screens list the parts beside the page instead, each marked done or to do. */}
      {missing.length ? (
        <ul className="mt-3 flex flex-col gap-1.5 lg:hidden">
          {missing.map((check) => (
            <li key={check.label} className="text-[13.5px]">
              <button
                type="button"
                onClick={() => goTo(check.section)}
                className="text-left text-ink underline decoration-hairline underline-offset-4 hover:decoration-ink"
              >
                {check.label}
              </button>
              <span className="text-mist">: {check.note.charAt(0).toLowerCase() + check.note.slice(1)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function SectionNav({ checks }: { checks: ListingCheck[] }) {
  return (
    <nav aria-label="Parts of the listing" className="hidden lg:block">
      <ol className="flex flex-col gap-0.5">
        {ORDER.map((id) => {
          const done = sectionDone(checks, id);
          return (
            <li key={id}>
              <button
                type="button"
                onClick={() => goTo(id)}
                className="flex h-8 w-full items-center justify-between gap-3 rounded-md px-2.5 text-left text-[13.5px] text-slate transition-colors hover:bg-linen hover:text-ink"
              >
                {SECTION_TITLES[id]}
                {done === true ? (
                  <>
                    <IconCheck size={15} stroke={2} aria-hidden className="shrink-0 text-accent" />
                    <span className="sr-only">, done</span>
                  </>
                ) : done === false ? (
                  <>
                    <span aria-hidden className="size-2 shrink-0 rounded-full border border-edge" />
                    <span className="sr-only">, to do</span>
                  </>
                ) : null}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function PropertyPage() {
  const { id = '' } = useParams();
  const { orgId, entry } = useCurrentWorkspace();
  const property = useProperty(orgId, id);
  const workspace = useWorkspace(orgId);
  const update = useUpdateProperty(orgId, id);
  const canEdit = can(entry.role, 'properties.write');
  const currency = workspace.data?.settings.currency ?? 'GBP';
  const locale = workspace.data?.settings.locale ?? 'en-GB';

  if (property.isPending) return <PageLoading>Loading the property</PageLoading>;
  if (property.error || !property.data) {
    const gone = property.error instanceof ApiError && property.error.status === 404;
    return (
      <EmptyState
        title={gone ? 'This property isn’t here' : 'The property could not be loaded'}
        action={
          <Link to="/properties" className="text-[14px] text-accent underline-offset-4 hover:underline">
            Back to properties
          </Link>
        }
      >
        {gone
          ? `It may have been removed, or it belongs to another workspace than ${entry.organisationName}.`
          : 'Check your connection and try again.'}
      </EmptyState>
    );
  }

  const d = property.data;
  const checks = listingChecklist(d);
  const save = (changes: PropertyUpdate) => update.mutateAsync(changes);
  const sectionProps = { d, canEdit, save, currency, locale };
  const where = d.area ?? d.city;
  const kind = d.propertyType ? PROPERTY_TYPE_LABELS[d.propertyType] : null;
  const placeLine = [
    kind && where ? `${kind} in ${where}` : (kind ?? where),
    d.internalCode ? `short code ${d.internalCode}` : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <div>
      <Link
        to="/properties"
        className="inline-flex items-center gap-1.5 text-[13px] text-accent underline-offset-4 hover:underline"
      >
        <IconArrowLeft size={15} stroke={1.75} aria-hidden />
        Properties
      </Link>
      <header className="mt-4 mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="font-serif text-[32px] leading-[1.1] font-light tracking-[-0.01em] text-ink md:text-[40px]">
            {d.name}
          </h1>
          {placeLine ? (
            <p className="mt-2 text-[14.5px] text-slate">
              {placeLine.charAt(0).toUpperCase() + placeLine.slice(1)}
            </p>
          ) : null}
          <Tags orgId={orgId} tags={d.tags} canEdit={canEdit} save={(tags) => save({ tags })} />
        </div>
        <Badge>{MANAGED_BY_LABELS[d.managedBy]}</Badge>
      </header>

      <PhotoMosaic d={d} />
      <Summary d={d} orgId={orgId} canClean={can(entry.role, 'cleaning.write')} />

      <div className="mt-10 grid gap-10 lg:grid-cols-[210px_minmax(0,1fr)]">
        <aside className="flex flex-col gap-6 lg:sticky lg:top-8 lg:self-start">
          <Readiness checks={checks} />
          <SectionNav checks={checks} />
        </aside>
        <div className="min-w-0 max-w-[820px]">
          <PhotosSection d={d} canEdit={canEdit} orgId={orgId} />
          <PlaceSection {...sectionProps} />
          <RoomsSection d={d} canEdit={canEdit} orgId={orgId} />
          <AmenitiesSection d={d} canEdit={canEdit} orgId={orgId} />
          <DescriptionSection {...sectionProps} />
          <AddressSection {...sectionProps} />
          <ArrivalSection {...sectionProps} />
          <RulesSection {...sectionProps} />
          <BookingSection {...sectionProps} />
          <PricingSection {...sectionProps} />
          <LicenceSection {...sectionProps} />
          <FieldsSection d={d} orgId={orgId} canEdit={canEdit} canManage={can(entry.role, 'fields.manage')} />
          <ChannelsSection
            d={d}
            orgId={orgId}
            canManage={can(entry.role, 'channels.manage')}
            refresh={() => void property.refetch()}
          />
          <SettingsSection d={d} orgId={orgId} canEdit={canEdit} />
        </div>
      </div>
    </div>
  );
}
