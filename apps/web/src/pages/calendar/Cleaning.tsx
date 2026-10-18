import { CleaningToggle, cleaningStory } from '../../components/CleaningToggle.tsx';
import { useSetCleaning } from '../../lib/api.ts';
import { arrivesToday, type CalendarRow, guestWhoLeft } from './model.ts';

const ISO_DAY = (timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone });

/**
 * Under each property's name: a small switch, clean or dirty. A guest's check-out makes it dirty by
 * itself; one tap marks it clean. Dirty is amber, and red on a day a guest arrives.
 */
export function CleaningBadge({
  row,
  orgId,
  today,
  timeZone,
  canChange,
  short = false,
}: {
  row: CalendarRow;
  orgId: string;
  today: string;
  timeZone: string;
  /** The role can mark properties clean or dirty. */
  canChange: boolean;
  /** The names column is a phone's narrow one: fewer words fit. */
  short?: boolean;
}) {
  const set = useSetCleaning(orgId);
  const state = row.property.cleaning;
  const guest =
    state.changedAt && !state.changedBy
      ? guestWhoLeft(row, ISO_DAY(timeZone).format(new Date(state.changedAt)))
      : null;
  return (
    <CleaningToggle
      state={state}
      name={row.property.name}
      urgent={state.status === 'dirty' && arrivesToday(row, today)}
      short={short}
      canChange={canChange}
      pending={set.isPending}
      story={cleaningStory(state, guest)}
      onChange={(status) => set.mutate({ propertyId: row.property.id, status })}
    />
  );
}
