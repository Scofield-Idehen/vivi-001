import { IconHome } from '@tabler/icons-react';
import { PROPERTY_TYPE_LABELS } from '@v01/shared';
import { limitsText, type PropertyDraft, priceOwnerText, roomsText } from './draft.ts';
import { PROPERTY_TYPE_ICONS } from './icons.ts';

/** The property as it is being described, so people see what they are making as they answer. */
export function ListingPreview({
  draft,
  currency,
  locale,
  compact = false,
}: {
  draft: PropertyDraft;
  currency: string;
  locale: string;
  /** Just the picture, name and place, for narrow screens where the full card would push the rest down. */
  compact?: boolean;
}) {
  const Icon = draft.propertyType ? PROPERTY_TYPE_ICONS[draft.propertyType] : IconHome;
  const where = draft.area.trim() || draft.city.trim();
  const kind = draft.propertyType ? PROPERTY_TYPE_LABELS[draft.propertyType] : null;
  const kindLine = kind && where ? `${kind} in ${where}` : (kind ?? where ?? '');
  const limits = limitsText(draft, currency, locale);
  const code = draft.internalCode.trim().toUpperCase();

  if (compact) {
    return (
      <figure
        aria-label="Preview"
        className="flex items-center gap-4 rounded-2xl border border-hairline bg-canvas p-3 pr-5"
      >
        <div className="grid size-[72px] shrink-0 place-items-center rounded-xl bg-paper">
          <Icon size={30} stroke={1.2} aria-hidden className="text-edge" />
        </div>
        <figcaption className="min-w-0">
          <p className="truncate font-serif text-[19px] leading-tight text-ink">
            {draft.name.trim() || 'Your new property'}
          </p>
          {kindLine ? <p className="mt-0.5 truncate text-[13px] text-slate">{kindLine}</p> : null}
          {code ? <p className="mt-1 font-mono text-[12px] text-mist">{code}</p> : null}
        </figcaption>
      </figure>
    );
  }

  return (
    <figure aria-label="Preview" className="overflow-hidden rounded-2xl border border-hairline bg-canvas">
      <div className="relative grid aspect-[4/3] place-items-center bg-paper">
        <Icon size={52} stroke={1.1} aria-hidden className="text-edge" />
        {code ? (
          <span className="absolute top-3 left-3 rounded-md bg-canvas px-2 py-0.5 font-mono text-[12px] text-slate">
            {code}
          </span>
        ) : null}
      </div>
      <figcaption className="p-5">
        <p
          className={
            draft.name.trim()
              ? 'font-serif text-[21px] leading-tight text-ink'
              : 'font-serif text-[21px] leading-tight text-mist'
          }
        >
          {draft.name.trim() || 'Your new property'}
        </p>
        {kindLine ? <p className="mt-1 text-[13.5px] text-slate">{kindLine}</p> : null}
        <p className="mt-4 text-[13.5px] leading-relaxed text-ink">{roomsText(draft)}</p>
        <p className="text-[13px] leading-relaxed text-mist">
          Check-in from {draft.checkInTime}, check-out by {draft.checkOutTime}
        </p>
        <p className="mt-4 border-t border-hairline pt-4 text-[13.5px] leading-relaxed text-slate">
          {priceOwnerText(draft)}
          {limits ? (
            <>
              <br />
              <span className="text-ink">{limits}</span>
            </>
          ) : null}
        </p>
      </figcaption>
    </figure>
  );
}
