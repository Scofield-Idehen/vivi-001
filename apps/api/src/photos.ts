import { randomUUID } from 'node:crypto';
import type { PhotoUploadTicket } from '@v01/shared';

/**
 * Where listing photos are kept. The browser sends each file straight to storage with a
 * short-lived upload ticket, then registers it with the API, so files never pass through the API.
 * Listing photos are public, like the listings they appear on: the bucket must never hold
 * anything private.
 */
export interface PhotoStore {
  /** False until storage is set up; uploads then answer 503 with a plain message. */
  readonly ready: boolean;
  ticket(path: string, contentType: string): Promise<PhotoUploadTicket>;
  /** True once a file has arrived at `path`. */
  exists(path: string): Promise<boolean>;
  publicUrl(path: string): string;
  remove(path: string): Promise<void>;
}

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** `{organisation}/{property}/{random}.jpg`: the API only registers paths under its own prefix. */
export function newPhotoPath(orgId: string, propertyId: string, contentType: string): string {
  return `${orgId}/${propertyId}/${randomUUID()}.${EXTENSIONS[contentType] ?? 'jpg'}`;
}

export function photoPathBelongsTo(path: string, orgId: string, propertyId: string): boolean {
  return (
    /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(path) &&
    path.startsWith(`${orgId}/${propertyId}/`)
  );
}

/** Supabase Storage, called over its REST API with the service key (server side only). */
export class SupabasePhotoStore implements PhotoStore {
  readonly ready = true;

  constructor(
    private readonly options: {
      supabaseUrl: string;
      serviceKey: string;
      bucket: string;
      fetch?: typeof fetch;
    },
  ) {}

  private get base(): string {
    return `${this.options.supabaseUrl.replace(/\/$/, '')}/storage/v1`;
  }

  private request(path: string, init: RequestInit): Promise<Response> {
    const doFetch = this.options.fetch ?? fetch;
    return doFetch(`${this.base}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.options.serviceKey}`,
        apikey: this.options.serviceKey,
        ...(init.headers ?? {}),
      },
    });
  }

  async ticket(path: string, contentType: string): Promise<PhotoUploadTicket> {
    const response = await this.request(`/object/upload/sign/${this.options.bucket}/${path}`, {
      method: 'POST',
    });
    if (!response.ok) throw new Error(`Storage refused an upload ticket (${response.status})`);
    const body = (await response.json()) as { url?: string };
    if (!body.url) throw new Error('Storage returned no upload address');
    return {
      path,
      uploadUrl: `${this.base}${body.url}`,
      method: 'PUT',
      headers: { 'content-type': contentType, 'x-upsert': 'false' },
    };
  }

  async exists(path: string): Promise<boolean> {
    const doFetch = this.options.fetch ?? fetch;
    const response = await doFetch(this.publicUrl(path), { method: 'HEAD' });
    return response.ok;
  }

  publicUrl(path: string): string {
    return `${this.base}/object/public/${this.options.bucket}/${path}`;
  }

  async remove(path: string): Promise<void> {
    await this.request(`/object/${this.options.bucket}/${path}`, { method: 'DELETE' });
  }
}

/** For tests and local development: files "arrive" when a test says so. */
export class MemoryPhotoStore implements PhotoStore {
  readonly ready = true;
  readonly files = new Set<string>();

  async ticket(path: string, contentType: string): Promise<PhotoUploadTicket> {
    return {
      path,
      uploadUrl: `memory://upload/${path}`,
      method: 'PUT',
      headers: { 'content-type': contentType },
    };
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  publicUrl(path: string): string {
    return `https://photos.test/${path}`;
  }

  async remove(path: string): Promise<void> {
    this.files.delete(path);
  }
}

/** Until storage is configured, photo uploads say so instead of failing obscurely. */
export const NO_PHOTO_STORE: PhotoStore = {
  ready: false,
  ticket: () => Promise.reject(new Error('Photo storage is not set up')),
  exists: async () => false,
  publicUrl: (path) => path,
  remove: async () => {},
};
