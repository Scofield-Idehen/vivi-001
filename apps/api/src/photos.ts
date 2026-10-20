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
  /** True when the file can be fetched without a key, as guests and channels will fetch it. */
  isPublic(path: string): Promise<boolean>;
  publicUrl(path: string): string;
  /**
   * Addresses that work for a while without a key, for files in a private bucket (task photos).
   * One per path, in the same order; a path that can't be signed gets its public address.
   */
  viewUrls(paths: string[], expiresSeconds?: number): Promise<string[]>;
  remove(path: string): Promise<void>;
}

/** How long a private photo's address works: long enough to look through a day's jobs. */
export const VIEW_URL_SECONDS = 2 * 3600;

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
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 200);
      throw new Error(`Storage refused an upload ticket (${response.status}${detail ? `: ${detail}` : ''})`);
    }
    const body = (await response.json()) as { url?: string };
    if (!body.url) throw new Error('Storage returned no upload address');
    return {
      path,
      uploadUrl: `${this.base}${body.url}`,
      method: 'PUT',
      headers: { 'content-type': contentType, 'x-upsert': 'false' },
    };
  }

  /**
   * Asks Storage itself, with the API's key, so the answer doesn't depend on the bucket being
   * public yet. (It must be public for guests to see the photo; the page says so if it isn't.)
   */
  async exists(path: string): Promise<boolean> {
    const response = await this.request(`/object/info/authenticated/${this.options.bucket}/${path}`, {
      method: 'GET',
    });
    return response.ok;
  }

  /** Whether the bucket serves files without a key, which listing photos need. */
  async isPublic(path: string): Promise<boolean> {
    const doFetch = this.options.fetch ?? fetch;
    const response = await doFetch(this.publicUrl(path), { method: 'HEAD' });
    return response.ok;
  }

  publicUrl(path: string): string {
    return `${this.base}/object/public/${this.options.bucket}/${path}`;
  }

  async viewUrls(paths: string[], expiresSeconds = VIEW_URL_SECONDS): Promise<string[]> {
    if (paths.length === 0) return [];
    const response = await this.request(`/object/sign/${this.options.bucket}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ expiresIn: expiresSeconds, paths }),
    });
    if (!response.ok) return paths.map((p) => this.publicUrl(p));
    const body = (await response.json()) as { path?: string; signedURL?: string | null }[];
    const byPath = new Map(body.map((b) => [b.path, b.signedURL]));
    return paths.map((p) => {
      const signed = byPath.get(p);
      return signed ? `${this.base}${signed}` : this.publicUrl(p);
    });
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

  async isPublic(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  publicUrl(path: string): string {
    return `https://photos.test/${path}`;
  }

  async viewUrls(paths: string[]): Promise<string[]> {
    return paths.map((p) => `https://photos.test/signed/${p}`);
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
  isPublic: async () => false,
  publicUrl: (path) => path,
  viewUrls: async (paths) => paths,
  remove: async () => {},
};
