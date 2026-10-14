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

const ACCEPTED = ['image/jpeg', 'image/png', 'image/webp'];
export const PHOTO_ACCEPT = ACCEPTED.join(',');
/** Below this, channels show a photo blurred or refuse it. */
const MIN_EDGE = 800;

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
