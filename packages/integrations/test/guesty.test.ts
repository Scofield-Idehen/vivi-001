import { describe, expect, it } from 'vitest';
import { GuestyClient, GuestyError, MemoryTokenStore } from '../src/index.ts';

/** A stand-in for Guesty's API: counts token requests, pages a list, and can answer 429 once. */
function stubGuesty(options: { rateLimitOnce?: boolean; total?: number } = {}) {
  const calls: string[] = [];
  let tokens = 0;
  let limited = false;
  const total = options.total ?? 7;
  const impl = (async (url: string, init: RequestInit) => {
    calls.push(`${init.method} ${url}`);
    if (url.endsWith('/oauth2/token')) {
      tokens += 1;
      const body = init.body as URLSearchParams;
      if (body.get('client_secret') !== 'secret')
        return new Response('{"error":"invalid_client"}', { status: 401 });
      return new Response(JSON.stringify({ access_token: `tok-${tokens}`, expires_in: 86_400 }), {
        status: 200,
        headers: { 'x-ratelimit-remaining-day': String(5 - tokens) },
      });
    }
    const headers = init.headers as Record<string, string>;
    if (headers.authorization !== `Bearer tok-${tokens}`) return new Response('nope', { status: 401 });
    if (options.rateLimitOnce && !limited) {
      limited = true;
      return new Response('slow down', { status: 429, headers: { 'retry-after': '1' } });
    }
    const u = new URL(url);
    const limit = Number(u.searchParams.get('limit') ?? 25);
    const skip = Number(u.searchParams.get('skip') ?? 0);
    const results = Array.from({ length: Math.max(0, Math.min(limit, total - skip)) }, (_, i) => ({
      _id: `L${skip + i + 1}`,
    }));
    return new Response(JSON.stringify({ results, count: total, limit, skip }), { status: 200 });
  }) as unknown as typeof fetch;
  return { impl, calls, tokenRequests: () => tokens };
}

describe('Guesty client', () => {
  it('asks for one token, keeps it, and pages through a list in order', async () => {
    const guesty = stubGuesty({ total: 7 });
    const store = new MemoryTokenStore();
    const client = new GuestyClient({
      clientId: 'id',
      clientSecret: 'secret',
      fetch: guesty.impl,
      tokens: store,
    });
    const ids: string[] = [];
    for await (const l of client.pages<{ _id: string }>('/v1/listings', {}, 3)) ids.push(l._id);
    expect(ids).toEqual(['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7']);
    expect(guesty.tokenRequests()).toBe(1);
    expect(client.tokensRemainingToday).toBe(4);
    // A second client with the same store (a restart) reuses the token: five a day is the budget.
    const again = new GuestyClient({
      clientId: 'id',
      clientSecret: 'secret',
      fetch: guesty.impl,
      tokens: store,
    });
    await again.get('/v1/listings');
    expect(guesty.tokenRequests()).toBe(1);
  });

  it('waits for Retry-After on a 429 and carries on', async () => {
    const guesty = stubGuesty({ rateLimitOnce: true, total: 1 });
    const waits: number[] = [];
    const client = new GuestyClient({
      clientId: 'id',
      clientSecret: 'secret',
      fetch: guesty.impl,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    const page = await client.get<{ results: unknown[] }>('/v1/listings');
    expect(page.results).toHaveLength(1);
    expect(waits).toEqual([1000]);
  });

  it('says plainly when the credentials are wrong', async () => {
    const guesty = stubGuesty();
    const client = new GuestyClient({ clientId: 'id', clientSecret: 'wrong', fetch: guesty.impl });
    const error = await client.get('/v1/listings').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GuestyError);
    expect((error as GuestyError).kind).toBe('auth');
    expect((error as GuestyError).message).toContain('refused the credentials');
  });
});
