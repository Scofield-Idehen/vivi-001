import { ChannelError } from '../provider.ts';

/** Staging is Channex's free sandbox with test Airbnb and Booking.com accounts. */
export const CHANNEX_STAGING_URL = 'https://staging.channex.io/api/v1';
/** Production access comes after certification. Confirm this host with Channex at that point. */
export const CHANNEX_PRODUCTION_URL = 'https://app.channex.io/api/v1';

export interface ChannexConfig {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export interface ChannexEnvelope<T = unknown> {
  data?: T;
  meta?: { message?: string; warnings?: unknown[]; page?: number; limit?: number; total?: number };
  errors?: { code?: string; title?: string; details?: unknown };
}

/**
 * Thin HTTP client. Sends the API key in the `user-api-key` header, parses Channex's
 * JSON envelope and turns failures into ChannelError so the worker can decide whether to retry.
 */
export class ChannexClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: ChannexConfig) {
    if (!config.apiKey) throw new Error('Channex API key is missing');
    this.fetchImpl = config.fetch ?? fetch;
  }

  async request<T = unknown>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<ChannexEnvelope<T>> {
    const url = `${this.config.baseUrl.replace(/\/$/, '')}${path}`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers: {
          'user-api-key': this.config.apiKey,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 30_000),
      });
    } catch (error) {
      throw new ChannelError(`Channex request failed: ${String(error)}`, 'network');
    }

    const text = await response.text();
    let parsed: ChannexEnvelope<T> = {};
    if (text) {
      try {
        parsed = JSON.parse(text) as ChannexEnvelope<T>;
      } catch {
        parsed = {};
      }
    }

    if (response.ok) return parsed;

    const title = parsed.errors?.title ?? response.statusText ?? 'Channex error';
    const detail = parsed.errors?.details ? ` ${JSON.stringify(parsed.errors.details)}` : '';
    const message = `Channex ${method} ${path} returned ${response.status}: ${title}${detail}`;
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get('retry-after'));
      throw new ChannelError(
        message,
        'rate_limited',
        429,
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 60_000,
      );
    }
    if (response.status === 401 || response.status === 403)
      throw new ChannelError(message, 'auth', response.status);
    if (response.status >= 500) throw new ChannelError(message, 'server', response.status);
    throw new ChannelError(message, 'validation', response.status);
  }
}
