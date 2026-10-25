import { createHash } from 'node:crypto';

/**
 * TTLock's cloud API (euopen.ttlock.com, "Open platform API"): enough for V-01 to run door codes
 * the way Guesty's Locks Manager does. One developer application for all of V-01 (client id and
 * secret in the API's and the worker's settings); each operator signs in once with the TTLock
 * *app* account that owns its locks, and V-01 keeps the token that sign-in returns, never the
 * password.
 *
 * TTLock's quirks, which shape this client:
 * - every call carries clientId, accessToken and `date` (now, in milliseconds), form-encoded;
 * - failure comes back as HTTP 200 with `errcode` and `errmsg`, so the status alone means nothing;
 * - codes are sent through the lock's gateway (addType/changeType/deleteType 2), and a gateway
 *   takes one command at a time, so callers send them one after another, never in parallel.
 */

export const TTLOCK_API_URL = 'https://euapi.ttlock.com';

export interface LockToken {
  accessToken: string;
  refreshToken: string;
  /** ISO time. */
  expiresAt: string;
  uid: string;
}

export interface ProviderLock {
  lockId: string;
  name: string;
  battery: number | null;
  hasGateway: boolean;
}

export interface ProviderGateway {
  gatewayId: string;
  name: string;
  online: boolean;
}

export interface CodeWindow {
  lockId: string;
  /** What shows against the code in the TTLock app: "V-01 · Claire Dubois". */
  name: string;
  code: string;
  startsAt: Date;
  endsAt: Date;
}

/** What V-01 needs from a lock maker; TTLock now, others behind the same shape later. */
export interface LockProvider {
  readonly name: string;
  signIn(username: string, password: string): Promise<LockToken>;
  refresh(token: LockToken): Promise<LockToken>;
  listLocks(token: LockToken): Promise<ProviderLock[]>;
  listGateways(token: LockToken): Promise<ProviderGateway[]>;
  addCode(token: LockToken, code: CodeWindow): Promise<{ codeId: string }>;
  changeCode(token: LockToken, codeId: string, code: CodeWindow): Promise<void>;
  deleteCode(token: LockToken, lockId: string, codeId: string): Promise<void>;
}

export class LockError extends Error {
  constructor(
    message: string,
    /** `auth`: the sign-in or token was refused; `lock`: the lock or gateway refused or couldn't be reached. */
    readonly kind: 'auth' | 'lock' | 'network' | 'response',
    readonly errcode?: number,
  ) {
    super(message);
    this.name = 'LockError';
  }
}

export interface TTLockConfig {
  clientId: string;
  clientSecret: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  now?: () => Date;
  timeoutMs?: number;
}

/** TTLock's answers for a token it no longer accepts. */
const TOKEN_ERRORS = new Set([10003, 10004, 10007, 10011]);

export const md5 = (text: string) => createHash('md5').update(text, 'utf8').digest('hex');

export class TTLockProvider implements LockProvider {
  readonly name = 'ttlock';
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;

  constructor(private readonly config: TTLockConfig) {
    if (!config.clientId || !config.clientSecret) throw new Error('TTLock client id and secret are missing');
    this.fetchImpl = config.fetch ?? fetch;
    this.baseUrl = (config.baseUrl ?? TTLOCK_API_URL).replace(/\/$/, '');
  }

  private now(): number {
    return (this.config.now?.() ?? new Date()).getTime();
  }

  private async call(
    method: 'GET' | 'POST',
    path: string,
    params: Record<string, string | number>,
  ): Promise<Record<string, unknown>> {
    const form = new URLSearchParams(
      Object.entries({ ...params, date: this.now() }).map(([k, v]): [string, string] => [k, String(v)]),
    );
    const url = `${this.baseUrl}${path}`;
    let response: Response;
    try {
      response = await this.fetchImpl(method === 'GET' ? `${url}?${form}` : url, {
        method,
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        ...(method === 'POST' ? { body: form } : {}),
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 30_000),
      });
    } catch (error) {
      throw new LockError(
        `TTLock couldn't be reached: ${error instanceof Error ? error.message : error}`,
        'network',
      );
    }
    const text = await response.text();
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new LockError(`TTLock answered ${response.status} with something that is not JSON`, 'response');
    }
    const errcode = typeof body.errcode === 'number' ? body.errcode : 0;
    if (!response.ok || errcode !== 0) {
      const message = String(body.errmsg ?? body.description ?? `TTLock answered ${response.status}`);
      const auth = TOKEN_ERRORS.has(errcode) || response.status === 401 || path === '/oauth2/token';
      throw new LockError(message, auth ? 'auth' : 'lock', errcode || undefined);
    }
    return body;
  }

  private tokenFrom(body: Record<string, unknown>, previous?: LockToken): LockToken {
    if (typeof body.access_token !== 'string') throw new LockError('TTLock sent no access token', 'response');
    return {
      accessToken: body.access_token,
      refreshToken:
        typeof body.refresh_token === 'string' ? body.refresh_token : (previous?.refreshToken ?? ''),
      expiresAt: new Date(this.now() + Number(body.expires_in ?? 7_776_000) * 1000).toISOString(),
      uid: body.uid !== undefined ? String(body.uid) : (previous?.uid ?? ''),
    };
  }

  async signIn(username: string, password: string): Promise<LockToken> {
    const body = await this.call('POST', '/oauth2/token', {
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      username,
      password: md5(password),
    });
    return this.tokenFrom(body);
  }

  async refresh(token: LockToken): Promise<LockToken> {
    const body = await this.call('POST', '/oauth2/token', {
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
      grant_type: 'refresh_token',
      refresh_token: token.refreshToken,
    });
    return this.tokenFrom(body, token);
  }

  private auth(token: LockToken) {
    return { clientId: this.config.clientId, accessToken: token.accessToken };
  }

  async listLocks(token: LockToken): Promise<ProviderLock[]> {
    const out: ProviderLock[] = [];
    for (let page = 1; page <= 20; page++) {
      const body = await this.call('GET', '/v3/lock/list', {
        ...this.auth(token),
        pageNo: page,
        pageSize: 100,
      });
      const list = (body.list ?? []) as Record<string, unknown>[];
      for (const l of list) {
        out.push({
          lockId: String(l.lockId),
          name: String(l.lockAlias || l.lockName || `Lock ${l.lockId}`),
          battery: typeof l.electricQuantity === 'number' ? l.electricQuantity : null,
          hasGateway: Number(l.hasGateway ?? 0) === 1,
        });
      }
      if (list.length < 100 || page >= Number(body.pages ?? page)) break;
    }
    return out;
  }

  async listGateways(token: LockToken): Promise<ProviderGateway[]> {
    const body = await this.call('GET', '/v3/gateway/list', {
      ...this.auth(token),
      pageNo: 1,
      pageSize: 100,
    });
    return ((body.list ?? []) as Record<string, unknown>[]).map((g) => ({
      gatewayId: String(g.gatewayId),
      name: String(g.gatewayName || g.networkName || `Gateway ${g.gatewayId}`),
      online: Number(g.isOnline ?? 0) === 1,
    }));
  }

  async addCode(token: LockToken, code: CodeWindow): Promise<{ codeId: string }> {
    const body = await this.call('POST', '/v3/keyboardPwd/add', {
      ...this.auth(token),
      lockId: code.lockId,
      keyboardPwd: code.code,
      keyboardPwdName: code.name,
      keyboardPwdType: 3,
      startDate: code.startsAt.getTime(),
      endDate: code.endsAt.getTime(),
      addType: 2,
    });
    if (body.keyboardPwdId === undefined)
      throw new LockError('TTLock sent no id for the new code', 'response');
    return { codeId: String(body.keyboardPwdId) };
  }

  async changeCode(token: LockToken, codeId: string, code: CodeWindow): Promise<void> {
    await this.call('POST', '/v3/keyboardPwd/change', {
      ...this.auth(token),
      lockId: code.lockId,
      keyboardPwdId: codeId,
      keyboardPwdName: code.name,
      startDate: code.startsAt.getTime(),
      endDate: code.endsAt.getTime(),
      changeType: 2,
    });
  }

  async deleteCode(token: LockToken, lockId: string, codeId: string): Promise<void> {
    await this.call('POST', '/v3/keyboardPwd/delete', {
      ...this.auth(token),
      lockId,
      keyboardPwdId: codeId,
      deleteType: 2,
    });
  }
}

/**
 * A pretend lock maker, kept in memory: for tests, the demo and a laptop without TTLock
 * credentials. Signs in anyone whose password is "ttlock"; `fail` makes the next calls refuse.
 */
export class MemoryLockProvider implements LockProvider {
  readonly name = 'memory';
  locks: ProviderLock[] = [
    { lockId: '1001', name: 'Front door', battery: 82, hasGateway: true },
    { lockId: '1002', name: 'Back door', battery: 18, hasGateway: true },
  ];
  gateways: ProviderGateway[] = [{ gatewayId: '501', name: 'Hallway gateway', online: true }];
  codes = new Map<string, CodeWindow>();
  calls: string[] = [];
  /** The next call refuses with this message, once. */
  fail: string | null = null;
  private next = 1;

  private check(call: string) {
    this.calls.push(call);
    if (this.fail) {
      const message = this.fail;
      this.fail = null;
      throw new LockError(message, 'lock', -3003);
    }
  }

  async signIn(username: string, password: string): Promise<LockToken> {
    this.calls.push('signIn');
    if (password !== 'ttlock') throw new LockError('Wrong username or password', 'auth', 10007);
    return {
      accessToken: `access-${username}`,
      refreshToken: 'refresh',
      expiresAt: '2099-01-01T00:00:00Z',
      uid: '1',
    };
  }
  async refresh(token: LockToken): Promise<LockToken> {
    this.calls.push('refresh');
    return { ...token, accessToken: `${token.accessToken}+`, expiresAt: '2099-01-01T00:00:00Z' };
  }
  async listLocks(): Promise<ProviderLock[]> {
    this.check('listLocks');
    return this.locks.map((l) => ({ ...l }));
  }
  async listGateways(): Promise<ProviderGateway[]> {
    this.check('listGateways');
    return this.gateways.map((g) => ({ ...g }));
  }
  async addCode(_token: LockToken, code: CodeWindow): Promise<{ codeId: string }> {
    this.check(`add ${code.lockId} ${code.code}`);
    const codeId = String(this.next++);
    this.codes.set(codeId, { ...code });
    return { codeId };
  }
  async changeCode(_token: LockToken, codeId: string, code: CodeWindow): Promise<void> {
    this.check(`change ${codeId}`);
    const was = this.codes.get(codeId);
    if (!was) throw new LockError('No such passcode', 'lock', -1);
    this.codes.set(codeId, { ...was, startsAt: code.startsAt, endsAt: code.endsAt, name: code.name });
  }
  async deleteCode(_token: LockToken, _lockId: string, codeId: string): Promise<void> {
    this.check(`delete ${codeId}`);
    this.codes.delete(codeId);
  }
}
