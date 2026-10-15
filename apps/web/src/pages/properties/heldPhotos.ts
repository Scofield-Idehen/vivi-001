import { PHOTO_MAX_COUNT } from '@v01/shared';
import { useSyncExternalStore } from 'react';
import { plural } from '../../lib/format.ts';
import { ACCEPTED, MIN_EDGE } from '../../lib/images.ts';

/** A photo chosen in the add-property panel, waiting to upload once the property exists. */
export interface HeldPhoto {
  id: string;
  file: File;
  /** A local address for showing it before it uploads. */
  url: string;
}

// Kept per operator while the page is open, so closing and reopening the panel keeps them. Files
// can't go in the saved draft, so reloading the page loses them, and the panel says so.
const store = new Map<string, HeldPhoto[]>();
const listeners = new Set<() => void>();
const NONE: HeldPhoto[] = [];

function emit() {
  for (const listener of listeners) listener();
}

export function useHeldPhotos(orgId: string): HeldPhoto[] {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => store.get(orgId) ?? NONE,
    () => NONE,
  );
}

export function setHeldPhotos(orgId: string, photos: HeldPhoto[]): void {
  const kept = new Set(photos.map((p) => p.id));
  for (const photo of store.get(orgId) ?? []) {
    if (!kept.has(photo.id)) URL.revokeObjectURL(photo.url);
  }
  if (photos.length) store.set(orgId, photos);
  else store.delete(orgId);
  emit();
}

export function clearHeldPhotos(orgId: string): void {
  setHeldPhotos(orgId, []);
}

/**
 * Checks each file the way the upload will, so a photo that can't be used is turned away when it is
 * chosen rather than after the property is added. Returns what was wrong with any it left out.
 */
export async function holdPhotos(orgId: string, files: File[]): Promise<string[]> {
  const problems: string[] = [];
  const current = store.get(orgId) ?? NONE;
  const room = PHOTO_MAX_COUNT - current.length;
  const added: HeldPhoto[] = [];
  for (const [index, file] of files.entries()) {
    if (added.length >= room) {
      const left = files.length - index;
      problems.push(`Only ${PHOTO_MAX_COUNT} photos fit, so ${plural(left, 'photo')} weren't added.`);
      break;
    }
    if (!ACCEPTED.includes(file.type)) {
      problems.push(`${file.name} isn't a JPEG, PNG or WebP photo.`);
      continue;
    }
    try {
      const bitmap = await createImageBitmap(file);
      const longest = Math.max(bitmap.width, bitmap.height);
      bitmap.close();
      if (longest < MIN_EDGE) {
        problems.push(`${file.name} is too small. Use photos at least ${MIN_EDGE} pixels wide.`);
        continue;
      }
    } catch {
      problems.push(`${file.name} couldn't be opened as a photo.`);
      continue;
    }
    added.push({ id: crypto.randomUUID(), file, url: URL.createObjectURL(file) });
  }
  if (added.length) setHeldPhotos(orgId, [...(store.get(orgId) ?? NONE), ...added]);
  return problems;
}
