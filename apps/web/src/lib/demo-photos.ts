/**
 * Demo mode keeps uploaded photos in this browser (IndexedDB), since there is no storage
 * server. If IndexedDB is unavailable, photos last until the page closes.
 */

const DB_NAME = 'v01-demo-photos';
const STORE = 'photos';
const memory = new Map<string, Blob>();
const urls = new Map<string, string>();

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | undefined> {
  const db = await openDb();
  if (!db) return undefined;
  return new Promise((resolve) => {
    try {
      const request = run(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

export async function putDemoPhoto(id: string, blob: Blob): Promise<void> {
  memory.set(id, blob);
  await withStore('readwrite', (store) => store.put(blob, id));
}

export async function deleteDemoPhoto(id: string): Promise<void> {
  memory.delete(id);
  const url = urls.get(id);
  if (url) URL.revokeObjectURL(url);
  urls.delete(id);
  await withStore('readwrite', (store) => store.delete(id));
}

export async function clearDemoPhotos(): Promise<void> {
  memory.clear();
  for (const url of urls.values()) URL.revokeObjectURL(url);
  urls.clear();
  await withStore('readwrite', (store) => store.clear());
}

/** A displayable address for a stored photo, or null if this browser no longer has it. */
export async function demoPhotoUrl(id: string): Promise<string | null> {
  const known = urls.get(id);
  if (known) return known;
  const blob = memory.get(id) ?? (await withStore<Blob>('readonly', (store) => store.get(id)));
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  urls.set(id, url);
  return url;
}
