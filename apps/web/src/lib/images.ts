/**
 * Photos are resized in the browser before they upload: big enough for every channel (Airbnb
 * wants at least 1024 pixels wide), small enough to upload quickly from a phone.
 */

export interface PreparedPhoto {
  blob: Blob;
  width: number;
  height: number;
  contentType: 'image/jpeg';
}

export class PhotoError extends Error {}

export const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];
export const PHOTO_ACCEPT = ACCEPTED.join(',');
/** Below this, channels show a photo blurred or refuse it. */
export const MIN_EDGE = 800;

export async function preparePhoto(file: File, maxEdge = 2560): Promise<PreparedPhoto> {
  if (!ACCEPTED.includes(file.type)) {
    throw new PhotoError(`${file.name} isn't a JPEG, PNG or WebP photo.`);
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new PhotoError(`${file.name} couldn't be opened as a photo.`);
  }
  try {
    if (Math.max(bitmap.width, bitmap.height) < MIN_EDGE) {
      throw new PhotoError(`${file.name} is too small. Use photos at least ${MIN_EDGE} pixels wide.`);
    }
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new PhotoError('This browser cannot prepare photos.');
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86));
    if (!blob) throw new PhotoError(`${file.name} couldn't be prepared for upload.`);
    return { blob, width, height, contentType: 'image/jpeg' };
  } finally {
    bitmap.close();
  }
}

/**
 * A field-team photo with the facts burned into it, the way site-photo apps do, so a picture
 * stands on its own later: when it was taken, where, by whom, and the place's position when the
 * phone allows it. The same words go to the API as the photo's stamp.
 */
export interface PhotoStamp {
  /** "Tue 20 Oct 2026, 14:32". */
  when: string;
  /** The property, and its address when known. */
  where: string;
  who: string;
  /** "55.9533, -3.1883 (±12 m)", when the phone gave it. */
  position?: string | null;
}

export function stampLines(s: PhotoStamp): string[] {
  return [s.when, s.where, [s.who, s.position].filter(Boolean).join(' · ')].filter((l) => l.length > 0);
}

/** The stamp as one line, for the record beside the photo. */
export function stampText(s: PhotoStamp): string {
  return stampLines(s).join(' · ');
}

export async function stampPhoto(photo: PreparedPhoto, stamp: PhotoStamp): Promise<PreparedPhoto> {
  const bitmap = await createImageBitmap(photo.blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = photo.width;
    canvas.height = photo.height;
    const context = canvas.getContext('2d');
    if (!context) throw new PhotoError('This browser cannot prepare photos.');
    context.drawImage(bitmap, 0, 0, photo.width, photo.height);
    const lines = stampLines(stamp);
    const size = Math.max(16, Math.round(Math.min(photo.width, photo.height) / 30));
    const pad = Math.round(size * 0.8);
    const lineHeight = Math.round(size * 1.35);
    const bandHeight = pad * 2 + lineHeight * lines.length;
    context.fillStyle = 'rgba(0, 0, 0, 0.55)';
    context.fillRect(0, photo.height - bandHeight, photo.width, bandHeight);
    context.fillStyle = '#ffffff';
    context.font = `${size}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
    context.textBaseline = 'top';
    lines.forEach((line, i) => {
      context.fillText(line, pad, photo.height - bandHeight + pad + i * lineHeight, photo.width - pad * 2);
    });
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86));
    if (!blob) throw new PhotoError('The photo couldn’t be stamped.');
    return { ...photo, blob };
  } finally {
    bitmap.close();
  }
}

/** Where the phone is, in a few seconds or not at all; never a reason to hold the photo up. */
export function currentPosition(timeoutMs = 4000): Promise<string | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(null);
    const timer = window.setTimeout(() => resolve(null), timeoutMs);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        window.clearTimeout(timer);
        resolve(
          `${p.coords.latitude.toFixed(5)}, ${p.coords.longitude.toFixed(5)} (±${Math.round(p.coords.accuracy)} m)`,
        );
      },
      () => {
        window.clearTimeout(timer);
        resolve(null);
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 },
    );
  });
}

/**
 * When the camera says it took the photo: the EXIF DateTimeOriginal inside a JPEG, read as local
 * time on the phone. Null for photos without one (screenshots, edited or stripped images).
 */
export async function takenAt(file: Blob): Promise<Date | null> {
  if (file.type !== 'image/jpeg') return null;
  const buffer = await file.slice(0, 256 * 1024).arrayBuffer();
  const view = new DataView(buffer);
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null;
  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    const marker = view.getUint16(offset);
    const size = view.getUint16(offset + 2);
    if (marker === 0xffe1 && offset + 10 <= view.byteLength && view.getUint32(offset + 4) === 0x45786966) {
      return readExifDate(view, offset + 10);
    }
    if ((marker & 0xff00) !== 0xff00 || size < 2) return null;
    offset += 2 + size;
  }
  return null;
}

function readExifDate(view: DataView, tiff: number): Date | null {
  if (tiff + 8 > view.byteLength) return null;
  const little = view.getUint16(tiff) === 0x4949;
  const u16 = (o: number) => view.getUint16(o, little);
  const u32 = (o: number) => view.getUint32(o, little);
  const entries = (ifd: number): { tag: number; at: number }[] => {
    if (ifd + 2 > view.byteLength) return [];
    const n = u16(ifd);
    const out: { tag: number; at: number }[] = [];
    for (let i = 0; i < n; i++) {
      const at = ifd + 2 + i * 12;
      if (at + 12 > view.byteLength) break;
      out.push({ tag: u16(at), at });
    }
    return out;
  };
  const text = (entryAt: number): string | null => {
    const count = u32(entryAt + 4);
    const start = count > 4 ? tiff + u32(entryAt + 8) : entryAt + 8;
    if (start + count > view.byteLength) return null;
    let s = '';
    for (let i = 0; i < count - 1; i++) s += String.fromCharCode(view.getUint8(start + i));
    return s;
  };
  const ifd0 = tiff + u32(tiff + 4);
  const exifPointer = entries(ifd0).find((e) => e.tag === 0x8769);
  const fromIfd = (ifd: number, tag: number) => {
    const e = entries(ifd).find((x) => x.tag === tag);
    return e ? text(e.at) : null;
  };
  const raw = (exifPointer ? fromIfd(tiff + u32(exifPointer.at + 8), 0x9003) : null) ?? fromIfd(ifd0, 0x0132);
  const m = raw ? /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(raw) : null;
  if (!m) return null;
  const [, y, mo, d, h, mi, se] = m.map(Number) as number[];
  const date = new Date(y as number, (mo as number) - 1, d, h, mi, se);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** How long before adding a photo still counts as "just taken". */
export const FRESH_PHOTO_MINUTES = 60;

const STAMP_DAY = new Intl.DateTimeFormat('en-GB', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const STAMP_TIME = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });

/** "Tue 20 Oct 2026, 14:32". */
export function stampTime(d: Date): string {
  return `${STAMP_DAY.format(d)}, ${STAMP_TIME.format(d)}`;
}

/**
 * The time line of a stamp: when the camera took it, and when it was added if that was over an
 * hour later; a photo without a camera time says it was added, not taken.
 */
export function stampWhen(taken: Date | null, added: Date): string {
  if (!taken) return `Added ${stampTime(added)} (no camera time)`;
  if (added.getTime() - taken.getTime() > FRESH_PHOTO_MINUTES * 60_000) {
    return `Taken ${stampTime(taken)} · added ${stampTime(added)}`;
  }
  return stampTime(taken);
}
