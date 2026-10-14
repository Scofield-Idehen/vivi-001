import { IconBed, IconSofa, IconTrash } from '@tabler/icons-react';
import {
  BED_TYPE_LABELS,
  BED_TYPES,
  type BedType,
  countSleeps,
  type PropertyDetail,
  ROOM_KIND_LABELS,
  ROOM_KINDS,
  type RoomInput,
  type RoomKind,
} from '@v01/shared';
import { Stepper } from '../../components/choices.tsx';
import { SelectField, TextField, Toggle } from '../../components/fields.tsx';
import { Button, Notice } from '../../components/ui.tsx';
import { useSetRooms } from '../../lib/api.ts';
import { plural } from '../../lib/format.ts';
import { Missing, Section, SectionForm, useEditor } from './Section.tsx';

interface DraftRoom {
  key: string;
  id?: string;
  kind: RoomKind;
  name: string;
  beds: Partial<Record<BedType, number>>;
  privateBathroom: boolean;
}

const bedsText = (beds: { type: BedType; count: number }[]) =>
  beds.length
    ? beds
        .map((b) => `${b.count} ${BED_TYPE_LABELS[b.type].toLowerCase()} ${b.count === 1 ? 'bed' : 'beds'}`)
        .join(', ')
    : 'No beds';

/** "Bedroom 2", or the room's own name. */
function roomLabels(rooms: { kind: RoomKind; name: string | null }[]): string[] {
  const seen: Partial<Record<RoomKind, number>> = {};
  const totals: Partial<Record<RoomKind, number>> = {};
  for (const room of rooms) totals[room.kind] = (totals[room.kind] ?? 0) + 1;
  return rooms.map((room) => {
    seen[room.kind] = (seen[room.kind] ?? 0) + 1;
    if (room.name?.trim()) return room.name.trim();
    const base = ROOM_KIND_LABELS[room.kind];
    return (totals[room.kind] ?? 0) > 1 ? `${base} ${seen[room.kind]}` : base;
  });
}

let nextKey = 0;
const newRoom = (kind: RoomKind): DraftRoom => ({
  key: `new-${nextKey++}`,
  kind,
  name: '',
  beds: kind === 'bedroom' ? { double: 1 } : kind === 'living_room' ? { sofa_bed: 1 } : {},
  privateBathroom: false,
});

function toInput(rooms: DraftRoom[]): RoomInput[] {
  return rooms.map((room) => ({
    ...(room.id ? { id: room.id } : {}),
    kind: room.kind,
    name: room.name.trim() || null,
    beds: BED_TYPES.filter((type) => (room.beds[type] ?? 0) > 0).map((type) => ({
      type,
      count: room.beds[type] ?? 0,
    })),
    privateBathroom: room.kind === 'bedroom' && room.privateBathroom,
  }));
}

export function RoomsSection({ d, canEdit, orgId }: { d: PropertyDetail; canEdit: boolean; orgId: string }) {
  const setRooms = useSetRooms(orgId, d.id);
  const editor = useEditor<{ rooms: DraftRoom[] }>(
    () => ({
      rooms: d.rooms.length
        ? d.rooms.map((room) => ({
            key: room.id,
            id: room.id,
            kind: room.kind,
            name: room.name ?? '',
            beds: Object.fromEntries(room.beds.map((b) => [b.type, b.count])),
            privateBathroom: room.privateBathroom,
          }))
        : // A head start: one double per bedroom already counted.
          Array.from({ length: Math.max(1, d.bedrooms ?? 1) }, () => newRoom('bedroom')),
    }),
    (draft) => setRooms.mutateAsync(toInput(draft.rooms)),
  );
  const draft = editor.draft;

  const updateRoom = (key: string, patch: Partial<DraftRoom>) =>
    draft && editor.set({ rooms: draft.rooms.map((r) => (r.key === key ? { ...r, ...patch } : r)) });

  const sleeps = draft ? countSleeps(toInput(draft.rooms)) : countSleeps(d.rooms);
  const labels = roomLabels(d.rooms);

  return (
    <Section
      id="rooms"
      canEdit={canEdit}
      editor={editor}
      description="Where everyone sleeps. Channels show each room with its beds, and count bedrooms and beds from here."
    >
      {draft ? (
        <SectionForm editor={editor}>
          <ol className="flex flex-col gap-4">
            {draft.rooms.map((room, index) => {
              const shown = BED_TYPES.filter((type) => room.beds[type] !== undefined);
              const more = BED_TYPES.filter((type) => room.beds[type] === undefined);
              return (
                <li key={room.key} className="rounded-xl border border-hairline bg-canvas p-4">
                  <div className="grid gap-3 sm:grid-cols-[170px_minmax(0,1fr)_auto] sm:items-end">
                    <SelectField<RoomKind>
                      label="Room"
                      value={room.kind}
                      onChange={(kind) => updateRoom(room.key, { kind })}
                      options={ROOM_KINDS.map((k) => ({ value: k, label: ROOM_KIND_LABELS[k] }))}
                    />
                    <TextField
                      label="Name (optional)"
                      value={room.name}
                      onChange={(name) => updateRoom(room.key, { name })}
                      placeholder={roomLabels(draft.rooms.map((r) => ({ kind: r.kind, name: null })))[index]}
                    />
                    <Button
                      variant="quiet"
                      className="h-9"
                      onClick={() => editor.set({ rooms: draft.rooms.filter((r) => r.key !== room.key) })}
                    >
                      <IconTrash size={15} stroke={1.75} aria-hidden />
                      Remove<span className="sr-only"> this room</span>
                    </Button>
                  </div>
                  <div className="mt-2 divide-y divide-hairline">
                    {shown.map((type) => (
                      <Stepper
                        key={type}
                        label={`${BED_TYPE_LABELS[type]} beds`}
                        value={room.beds[type] ?? 0}
                        min={0}
                        max={20}
                        onChange={(count) => updateRoom(room.key, { beds: { ...room.beds, [type]: count } })}
                      />
                    ))}
                  </div>
                  <div className="mt-2 flex flex-wrap items-end gap-4">
                    {more.length ? (
                      <div className="w-[220px]">
                        <SelectField<string>
                          label="Add a bed"
                          value=""
                          onChange={(type) =>
                            type && updateRoom(room.key, { beds: { ...room.beds, [type as BedType]: 1 } })
                          }
                          options={[
                            { value: '', label: 'Choose a bed type' },
                            ...more.map((type) => ({ value: type, label: BED_TYPE_LABELS[type] })),
                          ]}
                        />
                      </div>
                    ) : null}
                  </div>
                  {room.kind === 'bedroom' ? (
                    <Toggle
                      label="Its own bathroom"
                      description="An en-suite, or a bathroom only this room uses."
                      checked={room.privateBathroom}
                      onChange={(privateBathroom) => updateRoom(room.key, { privateBathroom })}
                    />
                  ) : null}
                </li>
              );
            })}
          </ol>
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => editor.set({ rooms: [...draft.rooms, newRoom('bedroom')] })}>
              Add a bedroom
            </Button>
            <Button onClick={() => editor.set({ rooms: [...draft.rooms, newRoom('living_room')] })}>
              Add a living room
            </Button>
            <Button onClick={() => editor.set({ rooms: [...draft.rooms, newRoom('other')] })}>
              Add another space
            </Button>
          </div>
          {sleeps < d.maxGuests ? (
            <Notice>
              These beds sleep {sleeps}, but up to {plural(d.maxGuests, 'guest')} can stay. Add beds, or lower
              the guest count under The place.
            </Notice>
          ) : (
            <p className="text-[13px] text-mist">
              These beds sleep {sleeps}. Up to {plural(d.maxGuests, 'guest')} can stay.
            </p>
          )}
        </SectionForm>
      ) : d.rooms.length ? (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {d.rooms.map((room, index) => {
            const Icon = room.kind === 'living_room' ? IconSofa : IconBed;
            return (
              <li key={room.id} className="rounded-xl border border-hairline p-4">
                <Icon size={26} stroke={1.3} aria-hidden className="text-slate" />
                <p className="mt-3 text-[14.5px] font-medium text-ink">{labels[index]}</p>
                <p className="mt-0.5 text-[13.5px] leading-snug text-slate">
                  {bedsText(room.beds)}
                  {room.privateBathroom ? ', own bathroom' : ''}
                </p>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-[14.5px]">
          <Missing>Not set out yet. Add each bedroom and its beds.</Missing>
        </p>
      )}
    </Section>
  );
}
