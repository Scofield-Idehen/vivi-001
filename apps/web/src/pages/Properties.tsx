import { can, formatMoney, type Property, type PropertyCreate, parseMajorToMinor } from '@v01/shared';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Badge, Button, EmptyState, Field, Notice, PageHeader } from '../components/ui.tsx';
import { ApiError, useAddProperty, useProperties, useWorkspace } from '../lib/api.ts';
import { useCurrentWorkspace } from '../lib/workspace.tsx';

function priceLimits(p: Property, currency: string, locale: string): string {
  const fmt = (minor: number) => formatMoney({ amountMinor: minor, currency }, locale);
  if (p.minPriceMinor && p.maxPriceMinor) return `${fmt(p.minPriceMinor)} to ${fmt(p.maxPriceMinor)}`;
  if (p.minPriceMinor) return `From ${fmt(p.minPriceMinor)}`;
  if (p.maxPriceMinor) return `Up to ${fmt(p.maxPriceMinor)}`;
  return 'Not set';
}

export function Properties() {
  const { orgId, membership } = useCurrentWorkspace();
  const workspace = useWorkspace(orgId);
  const list = useProperties(orgId);
  const [adding, setAdding] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const canAdd = can(membership.role, 'properties.write');
  const currency = workspace.data?.settings.currency ?? 'GBP';
  const locale = workspace.data?.settings.locale ?? 'en-GB';

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const properties = list.data?.properties ?? [];
  const addButton = canAdd ? (
    <Button variant="primary" onClick={() => setAdding(true)}>
      Add property
    </Button>
  ) : undefined;

  return (
    <>
      <PageHeader
        title="Properties"
        description={
          list.data
            ? `${properties.length} ${properties.length === 1 ? 'property' : 'properties'} in ${membership.organisationName}.`
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

      {properties.length > 0 ? (
        <div className="overflow-x-auto">
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
                <tr key={p.id} className="h-12 hover:bg-linen/60">
                  <td className="py-2 pr-4">
                    <div className="font-serif text-[16px]">{p.name}</div>
                    {p.area || p.city ? (
                      <div className="text-[12.5px] text-mist">
                        {[p.area, p.city].filter(Boolean).join(', ')}
                      </div>
                    ) : null}
                  </td>
                  <td className="py-2 pr-4 font-mono text-[12.5px] text-slate">{p.internalCode ?? ''}</td>
                  <td className="tnum py-2 pr-10 text-right">{p.maxGuests}</td>
                  <td className="tnum py-2 pr-10 text-right">{p.bedrooms ?? ''}</td>
                  <td className="tnum py-2 pr-4 text-slate">{priceLimits(p, currency, locale)}</td>
                  <td className="py-2">
                    <Badge>{p.managedBy === 'guesty' ? 'Still on Guesty' : 'Moved here'}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {adding ? (
        <AddPropertySheet
          orgId={orgId}
          currency={currency}
          countryCode={workspace.data?.settings.countryCode ?? 'GB'}
          onClose={() => setAdding(false)}
          onAdded={(name) => {
            setAdding(false);
            setToast(`${name} added`);
          }}
        />
      ) : null}

      <div
        role="status"
        aria-live="polite"
        className="fixed bottom-[calc(1.5rem+env(safe-area-inset-bottom,0px))] left-1/2 -translate-x-1/2 md:left-auto md:right-[calc(2rem+env(safe-area-inset-right,0px))] md:translate-x-0"
      >
        {toast ? <p className="rounded-md bg-ink px-4 py-2.5 text-[13.5px] text-paper">{toast}</p> : null}
      </div>
    </>
  );
}

function AddPropertySheet(props: {
  orgId: string;
  currency: string;
  countryCode: string;
  onClose(): void;
  onAdded(name: string): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const add = useAddProperty(props.orgId);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (key: string) => String(form.get(key) ?? '').trim();
    const nextErrors: Record<string, string> = {};
    const price = (key: string): number | undefined => {
      const value = text(key);
      if (!value) return undefined;
      try {
        return parseMajorToMinor(value, props.currency);
      } catch {
        nextErrors[key] = 'Enter an amount such as 120 or 120.50';
        return undefined;
      }
    };
    const input: PropertyCreate = {
      name: text('name'),
      countryCode: props.countryCode,
      maxGuests: Number(text('maxGuests')),
      ...(text('internalCode') ? { internalCode: text('internalCode') } : {}),
      ...(text('area') ? { area: text('area') } : {}),
      ...(text('city') ? { city: text('city') } : {}),
      ...(text('postcode') ? { postcode: text('postcode') } : {}),
      ...(text('bedrooms') ? { bedrooms: Number(text('bedrooms')) } : {}),
      ...(text('checkInTime') ? { checkInTime: text('checkInTime') } : {}),
      ...(text('checkOutTime') ? { checkOutTime: text('checkOutTime') } : {}),
    };
    const minPriceMinor = price('minPrice');
    const maxPriceMinor = price('maxPrice');
    if (minPriceMinor !== undefined) input.minPriceMinor = minPriceMinor;
    if (maxPriceMinor !== undefined) input.maxPriceMinor = maxPriceMinor;
    if (!input.name) nextErrors.name = 'Give the property a name';
    if (!Number.isInteger(input.maxGuests) || input.maxGuests < 1)
      nextErrors.maxGuests = 'Enter how many guests it sleeps';
    if (minPriceMinor && maxPriceMinor && minPriceMinor > maxPriceMinor)
      nextErrors.minPrice = 'Minimum is above maximum';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    try {
      const created = await add.mutateAsync(input);
      props.onAdded(created.name);
    } catch (error) {
      setErrors({ form: error instanceof ApiError ? error.message : 'Could not add the property.' });
    }
  }

  return (
    <dialog
      ref={dialog}
      onClose={props.onClose}
      aria-labelledby="add-property-title"
      className="fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-dvh w-full max-w-[460px] border-l border-hairline bg-paper p-0 pr-[env(safe-area-inset-right,0px)] pb-[env(safe-area-inset-bottom,0px)] text-ink"
    >
      <form onSubmit={submit} className="flex h-full flex-col" noValidate>
        <div className="flex items-start justify-between gap-4 border-b border-hairline px-6 py-5">
          <h2 id="add-property-title" className="font-serif text-[24px] font-normal">
            Add a property
          </h2>
          <Button variant="quiet" onClick={() => dialog.current?.close()}>
            Close
          </Button>
        </div>
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-6 py-6">
          {errors.form ? <Notice tone="urgent">{errors.form}</Notice> : null}
          <Field label="Name" name="name" required autoFocus error={errors.name} />
          <div className="grid grid-cols-2 gap-4">
            <Field label="Code" name="internalCode" hint="Short reference, e.g. HVL" />
            <Field label="Area" name="area" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Town or city" name="city" />
            <Field label="Postcode" name="postcode" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field
              label="Sleeps"
              name="maxGuests"
              type="number"
              min={1}
              max={50}
              required
              error={errors.maxGuests}
            />
            <Field label="Bedrooms" name="bedrooms" type="number" min={0} max={50} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Check-in from" name="checkInTime" type="time" defaultValue="15:00" />
            <Field label="Check-out by" name="checkOutTime" type="time" defaultValue="10:00" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field
              label={`Lowest nightly price (${props.currency})`}
              name="minPrice"
              inputMode="decimal"
              error={errors.minPrice}
            />
            <Field
              label={`Highest nightly price (${props.currency})`}
              name="maxPrice"
              inputMode="decimal"
              error={errors.maxPrice}
            />
          </div>
          <p className="text-[12.5px] leading-relaxed text-mist">
            Price limits stop a wrong price reaching the channels, including prices from PriceLabs.
          </p>
        </div>
        <div className="flex justify-end gap-3 border-t border-hairline px-6 py-4">
          <Button onClick={() => dialog.current?.close()}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={add.isPending}>
            {add.isPending ? 'Adding' : 'Add property'}
          </Button>
        </div>
      </form>
    </dialog>
  );
}
