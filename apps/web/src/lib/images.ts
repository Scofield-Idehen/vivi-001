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
