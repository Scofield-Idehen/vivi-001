import {
  IconArrowLeft,
  IconArrowRight,
  IconPencil,
  IconPhotoPlus,
  IconStar,
  IconTrash,
} from '@tabler/icons-react';
import { PHOTO_MAX_COUNT, PHOTO_MIN_TO_LIST, type Photo, type PropertyDetail } from '@v01/shared';
import { type DragEvent, useId, useRef, useState } from 'react';
import { SelectField, TextField } from '../../components/fields.tsx';
import { Button, Notice } from '../../components/ui.tsx';
import { ApiError, useAddPhotos, useOrderPhotos, useRemovePhoto, useUpdatePhoto } from '../../lib/api.ts';
import { plural } from '../../lib/format.ts';
import { PHOTO_ACCEPT } from '../../lib/images.ts';
import { Section } from './Section.tsx';

function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

function move<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
}

function roomName(d: PropertyDetail, roomId: string | null): string | null {
  const index = d.rooms.findIndex((r) => r.id === roomId);
  if (index < 0) return null;
  const room = d.rooms[index];
  if (!room) return null;
  if (room.name) return room.name;
  const sameKind = d.rooms.filter((r) => r.kind === room.kind);
  const label = { bedroom: 'Bedroom', living_room: 'Living room', other: 'Other space' }[room.kind];
  return sameKind.length > 1 ? `${label} ${sameKind.indexOf(room) + 1}` : label;
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick(): void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="grid size-8 place-items-center rounded-md text-slate transition-colors hover:bg-linen hover:text-ink disabled:cursor-default disabled:text-hairline disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

function CaptionEditor({
  d,
  photo,
  orgId,
  onDone,
}: {
  d: PropertyDetail;
  photo: Photo;
  orgId: string;
  onDone(): void;
}) {
  const update = useUpdatePhoto(orgId, d.id);
  const [caption, setCaption] = useState(photo.caption ?? '');
  const [roomId, setRoomId] = useState(photo.roomId ?? '');
  return (
    <form
      className="mt-2 flex flex-col gap-3 rounded-xl bg-paper p-3"
      onSubmit={(e) => {
        e.preventDefault();
        update.mutate(
          { photoId: photo.id, caption: caption.trim() || null, roomId: roomId || null },
          { onSuccess: onDone },
        );
      }}
    >
      <TextField
        label="Caption"
        value={caption}
        onChange={setCaption}
        max={200}
        placeholder="The garden in June"
      />
      {d.rooms.length ? (
        <SelectField
          label="Room"
          value={roomId}
          onChange={setRoomId}
          options={[
            { value: '', label: 'Not a room' },
            ...d.rooms.map((r) => ({ value: r.id, label: roomName(d, r.id) ?? 'Room' })),
          ]}
        />
      ) : null}
      <div className="flex items-center gap-3">
        <Button variant="primary" type="submit" disabled={update.isPending || caption.length > 200}>
          {update.isPending ? 'Saving' : 'Save'}
        </Button>
        <Button variant="quiet" onClick={onDone}>
          Cancel
        </Button>
      </div>
      {update.error ? (
        <p role="alert" className="text-[12.5px] text-urgent">
          {update.error instanceof ApiError ? update.error.message : 'That could not be saved.'}
        </p>
      ) : null}
    </form>
  );
}

/** Photos save as you go: each upload, move or removal is kept straight away. */
export function PhotosSection({ d, canEdit, orgId }: { d: PropertyDetail; canEdit: boolean; orgId: string }) {
  const add = useAddPhotos(orgId, d.id);
  const order = useOrderPhotos(orgId, d.id);
  const remove = useRemovePhoto(orgId, d.id);
  const input = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);
  const [dragged, setDragged] = useState<string | null>(null);

  const photos = d.photos;
  const room = PHOTO_MAX_COUNT - photos.length;
  const busy = add.isPending || order.isPending || remove.isPending;

  function upload(files: File[]) {
    if (!files.length) return;
    const chosen = files.slice(0, room);
    const skipped = files.length - chosen.length;
    setProblems(
      skipped > 0
        ? [`Only ${PHOTO_MAX_COUNT} photos fit, so ${plural(skipped, 'photo')} weren't added.`]
        : [],
    );
    setProgress({ done: 0, total: chosen.length });
    add.mutate(
      { files: chosen, onProgress: (done, total) => setProgress({ done, total }) },
      {
        // The same reason for several photos is said once.
        onSuccess: (result) => setProblems((p) => [...new Set([...p, ...result.problems])]),
        onError: (error) =>
          setProblems((p) => [
            ...p,
            error instanceof ApiError ? error.message : 'The photos could not be added.',
          ]),
        onSettled: () => setProgress(null),
      },
    );
  }

  function reorder(ids: string[]) {
    order.mutate(ids);
  }

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDropping(false);
    if (!canEdit) return;
    const files = [...event.dataTransfer.files].filter((f) => f.type.startsWith('image/'));
    if (files.length) upload(files);
  };

  const status =
    photos.length >= PHOTO_MIN_TO_LIST
      ? `${plural(photos.length, 'photo')}. The first is the cover.`
      : `${plural(photos.length, 'photo')}. Airbnb needs at least ${PHOTO_MIN_TO_LIST}, so add ${PHOTO_MIN_TO_LIST - photos.length} more.`;

  return (
    <Section
      id="photos"
      canEdit={canEdit}
      description="Lead with the best room in daylight. Guests decide from the first few photos."
      action={
        canEdit && photos.length > 0 ? (
          <Button onClick={() => input.current?.click()} disabled={busy || room <= 0}>
            <IconPhotoPlus size={16} stroke={1.75} aria-hidden />
            Add photos
          </Button>
        ) : null
      }
    >
      <input
        ref={input}
        id={inputId}
        type="file"
        accept={PHOTO_ACCEPT}
        multiple
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          upload([...(e.target.files ?? [])]);
          e.target.value = '';
        }}
      />
      {/* biome-ignore lint/a11y/noStaticElementInteractions: dropping files is a shortcut; the Add photos button does the same */}
      <div
        onDragOver={(e) => {
          if (!canEdit || dragged) return;
          e.preventDefault();
          setDropping(true);
        }}
        onDragLeave={() => setDropping(false)}
        onDrop={onDrop}
        className={cx('rounded-2xl transition-shadow', dropping && 'shadow-[0_0_0_2px_var(--color-accent)]')}
      >
        {photos.length === 0 ? (
          <div className="grid place-items-center gap-3 rounded-2xl border border-dashed border-edge bg-paper px-6 py-14 text-center">
            <IconPhotoPlus size={36} stroke={1.2} aria-hidden className="text-edge" />
            <p className="max-w-[40ch] text-[14.5px] text-ink">
              {canEdit ? 'Drop photos here, or choose them from your device.' : 'No photos yet.'}
            </p>
            <p className="text-[13px] text-mist">
              JPEG, PNG or WebP. Airbnb needs at least {PHOTO_MIN_TO_LIST}.
            </p>
            {canEdit ? (
              <Button variant="primary" onClick={() => input.current?.click()} disabled={busy}>
                Choose photos
              </Button>
            ) : null}
          </div>
        ) : (
          <ol className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 xl:grid-cols-4">
            {photos.map((photo, index) => (
              <li
                key={photo.id}
                draggable={canEdit && !busy}
                onDragStart={(e) => {
                  setDragged(photo.id);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragEnd={() => setDragged(null)}
                onDragOver={(e) => {
                  if (dragged) e.preventDefault();
                }}
                onDrop={(e) => {
                  if (!dragged || dragged === photo.id) return;
                  e.preventDefault();
                  e.stopPropagation();
                  const ids = photos.map((p) => p.id);
                  reorder(move(ids, ids.indexOf(dragged), index));
                  setDragged(null);
                }}
                className={cx('min-w-0', dragged === photo.id && 'opacity-40')}
              >
                <figure>
                  <div className="relative overflow-hidden rounded-xl bg-paper">
                    <img
                      src={photo.url}
                      alt={photo.caption ?? `Photo ${index + 1}`}
                      loading="lazy"
                      className="aspect-[4/3] w-full object-cover"
                    />
                    {index === 0 ? (
                      <span className="absolute top-2 left-2 rounded-md bg-canvas/95 px-2 py-0.5 text-[12px] font-medium text-ink">
                        Cover
                      </span>
                    ) : null}
                  </div>
                  <figcaption
                    className="mt-1.5 min-h-5 truncate text-[12.5px] text-slate"
                    title={photo.caption ?? undefined}
                  >
                    {photo.caption ?? roomName(d, photo.roomId)}
                  </figcaption>
                </figure>
                {canEdit ? (
                  confirming === photo.id ? (
                    <div className="mt-1 flex items-center gap-3 text-[13px]">
                      <span className="text-ink">Remove it?</span>
                      <button
                        type="button"
                        className="font-medium text-urgent underline-offset-4 hover:underline"
                        onClick={() => {
                          remove.mutate(photo.id);
                          setConfirming(null);
                        }}
                      >
                        Remove
                      </button>
                      <button
                        type="button"
                        className="text-accent underline-offset-4 hover:underline"
                        onClick={() => setConfirming(null)}
                      >
                        Keep
                      </button>
                    </div>
                  ) : (
                    <div className="mt-0.5 -ml-1.5 flex items-center">
                      <IconButton
                        label="Move earlier"
                        disabled={index === 0 || busy}
                        onClick={() =>
                          reorder(
                            move(
                              photos.map((p) => p.id),
                              index,
                              index - 1,
                            ),
                          )
                        }
                      >
                        <IconArrowLeft size={16} stroke={1.75} aria-hidden />
                      </IconButton>
                      <IconButton
                        label="Move later"
                        disabled={index === photos.length - 1 || busy}
                        onClick={() =>
                          reorder(
                            move(
                              photos.map((p) => p.id),
                              index,
                              index + 1,
                            ),
                          )
                        }
                      >
                        <IconArrowRight size={16} stroke={1.75} aria-hidden />
                      </IconButton>
                      <IconButton
                        label="Make it the cover"
                        disabled={index === 0 || busy}
                        onClick={() =>
                          reorder(
                            move(
                              photos.map((p) => p.id),
                              index,
                              0,
                            ),
                          )
                        }
                      >
                        <IconStar size={16} stroke={1.75} aria-hidden />
                      </IconButton>
                      <IconButton
                        label="Caption and room"
                        onClick={() => setEditing(editing === photo.id ? null : photo.id)}
                      >
                        <IconPencil size={16} stroke={1.75} aria-hidden />
                      </IconButton>
                      <IconButton label="Remove" disabled={busy} onClick={() => setConfirming(photo.id)}>
                        <IconTrash size={16} stroke={1.75} aria-hidden />
                      </IconButton>
                    </div>
                  )
                ) : null}
                {editing === photo.id ? (
                  <CaptionEditor d={d} photo={photo} orgId={orgId} onDone={() => setEditing(null)} />
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="mt-4 flex flex-col gap-2" aria-live="polite">
        {progress ? (
          <p className="text-[13.5px] text-ink">
            Adding photos: {progress.done} of {progress.total} done
          </p>
        ) : photos.length > 0 ? (
          <p className="text-[13px] text-mist">
            {status}
            {canEdit ? ' Drag to reorder, or use the arrows.' : ''}
          </p>
        ) : null}
        {problems.length ? (
          <Notice tone="urgent">
            <ul className="flex flex-col gap-1">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          </Notice>
        ) : null}
        {order.error || remove.error ? (
          <Notice tone="urgent">
            {(order.error ?? remove.error) instanceof ApiError
              ? (order.error ?? remove.error)?.message
              : 'That change could not be saved. Try again.'}
          </Notice>
        ) : null}
      </div>
    </Section>
  );
}
