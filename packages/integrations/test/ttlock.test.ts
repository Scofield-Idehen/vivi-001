import { describe, expect, it } from 'vitest';
import { LockError, md5, TTLockProvider } from '../src/index.ts';

type Seen = { method: string; url: string; params: URLSearchParams };

function stub(answers: Record<string, unknown>) {
  const seen: Seen[] = [];
  const fetchImpl = (async (input: string, init: RequestInit) => {
    const url = new URL(input);
    const params =
      init.method === 'POST' ? new URLSearchParams(String(init.body)) : new URLSearchParams(url.search);
    seen.push({ method: String(init.method), url: url.pathname, params });
    const answer = answers[url.pathname] ?? { errcode: 0 };
    return new Response(JSON.stringify(answer), { status: 200 });
  }) as unknown as typeof fetch;
  const ttlock = new TTLockProvider({
    clientId: 'cid',
    clientSecret: 'secret',
    baseUrl: 'https://euapi.test',
    fetch: fetchImpl,
    now: () => new Date('2026-11-01T10:00:00Z'),
  });
  return { ttlock, seen };
}

const token = { accessToken: 'tok', refreshToken: 'ref', expiresAt: '2027-01-01T00:00:00Z', uid: '7' };

describe('TTLock', () => {
  it('signs in with the app account, sending only the MD5 of the password', async () => {
    const { ttlock, seen } = stub({
      '/oauth2/token': { access_token: 'a1', refresh_token: 'r1', uid: 42, expires_in: 7776000 },
    });
    const t = await ttlock.signIn('alpha@example.test', 'door-pass');
    expect(t).toEqual({
      accessToken: 'a1',
      refreshToken: 'r1',
      uid: '42',
      expiresAt: '2027-01-30T10:00:00.000Z',
    });
    const p = seen[0]?.params;
    expect(p?.get('password')).toBe(md5('door-pass'));
    expect(p?.get('password')).toHaveLength(32);
    expect([...(p?.values() ?? [])]).not.toContain('door-pass');
    expect(p?.get('client_id')).toBe('cid');
  });

  it('treats an errcode in a 200 answer as a refusal', async () => {
    const { ttlock } = stub({ '/oauth2/token': { errcode: 10007, errmsg: 'Invalid account or password' } });
    await expect(ttlock.signIn('x', 'y')).rejects.toMatchObject({
      kind: 'auth',
      message: 'Invalid account or password',
    });
    const { ttlock: busy } = stub({ '/v3/keyboardPwd/add': { errcode: -3003, errmsg: 'Gateway is busy' } });
    const error = await busy
      .addCode(token, { lockId: '1', name: 'x', code: '123987', startsAt: new Date(), endsAt: new Date() })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LockError);
    expect(error).toMatchObject({ kind: 'lock', errcode: -3003 });
  });

  it('adds a timed code through the gateway', async () => {
    const { ttlock, seen } = stub({ '/v3/keyboardPwd/add': { keyboardPwdId: 9001 } });
    const made = await ttlock.addCode(token, {
      lockId: '55',
      name: 'V-01 · Claire',
      code: '481593',
      startsAt: new Date('2026-11-05T15:00:00Z'),
      endsAt: new Date('2026-11-08T10:30:00Z'),
    });
    expect(made).toEqual({ codeId: '9001' });
    const p = seen[0]?.params;
    expect(seen[0]?.method).toBe('POST');
    expect(p?.get('addType')).toBe('2');
    expect(p?.get('keyboardPwdType')).toBe('3');
    expect(p?.get('startDate')).toBe(String(Date.parse('2026-11-05T15:00:00Z')));
    expect(p?.get('accessToken')).toBe('tok');
    expect(p?.get('date')).toBe(String(Date.parse('2026-11-01T10:00:00Z')));
  });

  it('lists locks with battery and gateway, and gateways online or not', async () => {
    const { ttlock } = stub({
      '/v3/lock/list': {
        list: [
          { lockId: 1, lockAlias: 'Front door', electricQuantity: 64, hasGateway: 1 },
          { lockId: 2, lockName: 'S31_abc', hasGateway: 0 },
        ],
        pages: 1,
      },
      '/v3/gateway/list': { list: [{ gatewayId: 9, gatewayName: 'G2 hall', isOnline: 0 }] },
    });
    expect(await ttlock.listLocks(token)).toEqual([
      { lockId: '1', name: 'Front door', battery: 64, hasGateway: true },
      { lockId: '2', name: 'S31_abc', battery: null, hasGateway: false },
    ]);
    expect(await ttlock.listGateways(token)).toEqual([{ gatewayId: '9', name: 'G2 hall', online: false }]);
  });
});
