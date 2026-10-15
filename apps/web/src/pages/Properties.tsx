import { IconChevronRight, IconHome } from '@tabler/icons-react';
import { can, formatMoney, MANAGED_BY_LABELS, PROPERTY_TYPE_LABELS, type Property } from '@v01/shared';
import { Link, Outlet, useNavigate } from 'react-router';
import { Badge, Button, EmptyState, Notice, PageHeader } from '../components/ui.tsx';
import { ApiError, useProperties, useWorkspace } from '../lib/api.ts';
import { useCurrentWorkspace } from '../lib/workspace.tsx';
import { PROPERTY_TYPE_ICONS } from './properties/icons.ts';

function priceLimits(p: Property, currency: string, locale: string): string {
  // Whole amounts drop the pennies, as they do in the new-property panel: "£120 to £340".
  const fmt = (minor: number) => formatMoney({ amountMinor: minor, currency }, locale).replace(/\.00$/, '');
  if (p.minPriceMinor && p.maxPriceMinor) return `${fmt(p.minPriceMinor)} to ${fmt(p.maxPriceMinor)}`;
  if (p.minPriceMinor) return `From ${fmt(p.minPriceMinor)}`;
  if (p.maxPriceMinor) return `Up to ${fmt(p.maxPriceMinor)}`;
  return 'Not set';
}

/** The cover photo, or the kind of place as a picture until there is one. */
function Thumbnail({ property, large = false }: { property: Property; large?: boolean }) {
  const Icon = property.propertyType ? PROPERTY_TYPE_ICONS[property.propertyType] : IconHome;
  const size = large ? 'h-[60px] w-[80px] rounded-lg' : 'h-[42px] w-[56px] rounded-md';
  return property.coverPhotoUrl ? (
    <img src={property.coverPhotoUrl} alt="" loading="lazy" className={`${size} shrink-0 object-cover`} />
  ) : (
    <span aria-hidden className={`${size} grid shrink-0 place-items-center bg-paper`}>
      <Icon size={large ? 24 : 20} stroke={1.3} className="text-edge" />
    </span>
  );
}

/** "Cottage in Riverside", "Cottage" or "Riverside". */
function placeLine(p: Property): string | null {
  const kind = p.propertyType ? PROPERTY_TYPE_LABELS[p.propertyType] : null;
  const where = p.area ?? p.city;
  if (kind && where) return `${kind} in ${where}`;
  return kind ?? where;
}

export function Properties() {
  const { orgId, entry } = useCurrentWorkspace();
  const workspace = useWorkspace(orgId);
  const list = useProperties(orgId);
  const navigate = useNavigate();
  const canAdd = can(entry.role, 'properties.write');
  const currency = workspace.data?.settings.currency ?? 'GBP';
  const locale = workspace.data?.settings.locale ?? 'en-GB';

  const properties = list.data?.properties ?? [];
  const addButton = canAdd ? (
    <Button variant="primary" onClick={() => navigate('/properties/new')}>
      Add property
    </Button>
  ) : undefined;

  return (
    <>
      <PageHeader
        title="Properties"
        description={
          list.data && properties.length > 0
            ? `${properties.length} ${properties.length === 1 ? 'property' : 'properties'} in ${entry.organisationName}.`
            : undefined
        }
        action={properties.length > 0 ? addButton : undefined}
      />

      {list.isPending ? <p className="text-[14px] text-mist">Loading properties</p> : null}
      {list.error ? (
        <Notice tone="urgent">
          {list.error instanceof ApiError ? list.error.message : 'Could not load properties.'}
        </Notice>
      ) : null}

      {list.data && properties.length === 0 ? (
        <EmptyState title="No properties yet" action={addButton}>
          Add a property here to try things out. In Phase 1 every property comes across from the Guesty
          export, with its channel listings.
        </EmptyState>
      ) : null}

      {/* Narrow screens get one row per property, so nothing is cut off at the side. */}
      {properties.length > 0 ? (
        <ul className="divide-y divide-hairline border-y border-hairline md:hidden">
          {properties.map((p) => (
            <li key={p.id}>
              <Link to={`/properties/${p.id}`} className="flex items-center gap-3.5 py-3">
                <Thumbnail property={p} large />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-serif text-[16px] text-ink">{p.name}</span>
                  <span className="block truncate text-[12.5px] text-mist">
                    {[placeLine(p), `sleeps ${p.maxGuests}`].filter(Boolean).join(', ')}
                  </span>
                  <span className="mt-1.5 block">
                    <Badge>{MANAGED_BY_LABELS[p.managedBy]}</Badge>
                  </span>
                </span>
                <IconChevronRight size={17} stroke={1.75} aria-hidden className="shrink-0 text-mist" />
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      {properties.length > 0 ? (
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[720px] border-collapse text-left text-[13.5px]">
            <thead>
              <tr className="border-b border-hairline text-[12.5px] text-mist">
                <th scope="col" className="py-2.5 pr-4 font-normal">
                  Property
                </th>
                <th scope="col" className="py-2.5 pr-4 font-normal">
                  Code
                </th>
                <th scope="col" className="py-2.5 pr-10 text-right font-normal">
                  Sleeps
                </th>
                <th scope="col" className="py-2.5 pr-10 text-right font-normal">
                  Bedrooms
                </th>
                <th scope="col" className="py-2.5 pr-4 font-normal">
                  Price limits
                </th>
                <th scope="col" className="py-2.5 font-normal">
                  Sync
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {properties.map((p) => (
                <tr
                  key={p.id}
                  // The name is the link for keyboards and screen readers; the whole row works for a mouse.
                  onClick={() => navigate(`/properties/${p.id}`)}
                  className="h-16 cursor-pointer hover:bg-linen/60"
                >
                  <td className="py-2 pr-4">
                    <div className="flex items-center gap-3.5">
                      <Thumbnail property={p} />
                      <div className="min-w-0">
                        <Link
                          to={`/properties/${p.id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="font-serif text-[16px] text-ink underline-offset-4 hover:underline"
                        >
                          {p.name}
                        </Link>
                        {placeLine(p) ? <div className="text-[12.5px] text-mist">{placeLine(p)}</div> : null}
                      </div>
                    </div>
                  </td>
                  <td className="py-2 pr-4 font-mono text-[12.5px] text-slate">{p.internalCode ?? ''}</td>
                  <td className="tnum py-2 pr-10 text-right">{p.maxGuests}</td>
                  <td className="tnum py-2 pr-10 text-right">{p.bedrooms ?? ''}</td>
                  <td className="tnum py-2 pr-4 text-slate">{priceLimits(p, currency, locale)}</td>
                  <td className="py-2">
                    <Badge>{MANAGED_BY_LABELS[p.managedBy]}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <Outlet />
    </>
  );
}
