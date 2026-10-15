import { IconHome } from '@tabler/icons-react';
import { PROPERTY_TYPE_LABELS } from '@v01/shared';
import {
  amenitiesText,
  limitsText,
  type PropertyDraft,
  priceOwnerText,
  roomsText,
  usualPriceText,
} from './draft.ts';
import { PROPERTY_TYPE_ICONS } from './icons.ts';

/**
 * The property as guests will meet it, filling in as people answer: the cover photo, the title
 * (or the name until there is one), the place, the rooms and the standout features.
 */
export function ListingPreview({
  draft,
  currency,
  locale,
  coverUrl,
  compact = false,
}: {
  draft: PropertyDraft;
  currency: string;
  locale: string;
  /** The first photo chosen, shown before it has uploaded. */
  coverUrl?: string;
  /** Just the picture, name and place, for narrow screens where the full card would push the rest down. */
  compact?: boolean;
}) {
  const Icon = draft.propertyType ? PROPERTY_TYPE_ICONS[draft.propertyType] : IconHome;
  const where = draft.area.trim() || draft.city.trim();
  const kind = draft.propertyType ? PROPERTY_TYPE_LABELS[draft.propertyType] : null;
  const kindLine = kind && where ? `${kind} in ${where}` : (kind ?? where ?? '');
  const heading = draft.title.trim() || draft.name.trim();
  const limits = limitsText(draft, currency, locale);
  const usual = usualPriceText(draft, currency, locale);
  const features = amenitiesText(draft.amenities, 3);
  const code = draft.internalCode.trim().toUpperCase();

  if (compact) {
    return (
      <figure
        aria-label="Preview"
        className="flex items-center gap-4 rounded-2xl border border-hairline bg-canvas p-3 pr-5"
      >
        {coverUrl ? (
          <img src={coverUrl} alt="" className="size-[72px] shrink-0 rounded-xl object-cover" />
        ) : (
          <div className="grid size-[72px] shrink-0 place-items-center rounded-xl bg-paper">
            <Icon size={30} stroke={1.2} aria-hidden className="text-edge" />
          </div>
        )}
        <figcaption className="min-w-0">
          <p className="truncate font-serif text-[19px] leading-tight text-ink">
            {heading || 'Your new property'}
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
        {coverUrl ? (
          <img src={coverUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <Icon size={52} stroke={1.1} aria-hidden className="text-edge" />
        )}
        {code ? (
          <span className="absolute top-3 left-3 rounded-md bg-canvas px-2 py-0.5 font-mono text-[12px] text-slate">
            {code}
          </span>
        ) : null}
      </div>
      <figcaption className="p-5">
        <p
          className={
            heading
              ? 'font-serif text-[21px] leading-tight text-ink'
              : 'font-serif text-[21px] leading-tight text-mist'
          }
        >
          {heading || 'Your new property'}
        </p>
        {kindLine ? <p className="mt-1 text-[13.5px] text-slate">{kindLine}</p> : null}
        <p className="mt-4 text-[13.5px] leading-relaxed text-ink">{roomsText(draft)}</p>
        <p className="text-[13px] leading-relaxed text-mist">
          Check-in from {draft.checkInTime}, check-out by {draft.checkOutTime}
        </p>
        {features ? <p className="mt-3 text-[13.5px] leading-relaxed text-ink">{features}</p> : null}
        <p className="mt-4 border-t border-hairline pt-4 text-[13.5px] leading-relaxed text-slate">
          {priceOwnerText(draft)}
          {usual ? (
            <>
              <br />
              <span className="text-ink">{usual}</span>
            </>
          ) : null}
          {limits ? (
            <>
              <br />
              <span className="text-slate">Limits {limits.charAt(0).toLowerCase() + limits.slice(1)}</span>
            </>
          ) : null}
        </p>
      </figcaption>
    </figure>
  );
}
