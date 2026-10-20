import { createRemoteJWKSet, decodeProtectedHeader, type JWTPayload, jwtVerify } from 'jose';
import { HttpError } from './errors.ts';

export interface AuthUser {
  id: string;
  email: string;
}

export type TokenVerifier = (token: string) => Promise<AuthUser>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A laptop's clock a minute out must not sign anyone out. */
const CLOCK_TOLERANCE_SECONDS = 60;

/** How long one sign-in lasts before a person has to sign in again, whatever the token refreshes. */
export const DEFAULT_SESSION_MAX_HOURS = 48;

/**
 * When the person last proved who they were: Supabase puts the time of each sign-in method in
 * the token's `amr` claim, and a refreshed token keeps it. Null when the token doesn't say.
 */
export function signedInAt(payload: JWTPayload): number | null {
  const amr = payload.amr;
  if (!Array.isArray(amr)) return null;
  let latest: number | null = null;
  for (const entry of amr) {
    const at = (entry as { timestamp?: unknown })?.timestamp;
    if (typeof at === 'number' && (latest === null || at > latest)) latest = at;
  }
  return latest;
}

/**
 * Verifies Supabase Auth access tokens. New Supabase projects sign tokens with
 * asymmetric keys published at /auth/v1/.well-known/jwks.json; older projects use a
 * shared secret. Each path accepts only its own algorithms, so one cannot be used
 * to forge the other.
 *
 * A token is refreshed silently for as long as the app is open, so the sign-in itself is what
 * expires: after `sessionMaxHours` (48 by default; 0 for never) the person signs in again.
 */
export function createTokenVerifier(options: {
  supabaseUrl?: string;
  jwtSecret?: string;
  sessionMaxHours?: number;
  now?: () => number;
}): TokenVerifier {
  const issuer = options.supabaseUrl ? `${options.supabaseUrl.replace(/\/$/, '')}/auth/v1` : undefined;
  const jwks = issuer ? createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`)) : null;
  const secret = options.jwtSecret ? new TextEncoder().encode(options.jwtSecret) : null;
  const maxHours = options.sessionMaxHours ?? DEFAULT_SESSION_MAX_HOURS;
  const now = options.now ?? Date.now;

  return async (token) => {
    let payload: JWTPayload;
    try {
      const { alg } = decodeProtectedHeader(token);
      if (alg === 'HS256') {
        if (!secret) throw new Error('Shared-secret tokens are not enabled');
        ({ payload } = await jwtVerify(token, secret, {
          algorithms: ['HS256'],
          audience: 'authenticated',
          clockTolerance: CLOCK_TOLERANCE_SECONDS,
          ...(issuer ? { issuer } : {}),
        }));
      } else {
        if (!jwks || !issuer) throw new Error('Signing keys are not configured');
        ({ payload } = await jwtVerify(token, jwks, {
          algorithms: ['ES256', 'RS256'],
          audience: 'authenticated',
          clockTolerance: CLOCK_TOLERANCE_SECONDS,
          issuer,
        }));
      }
    } catch {
      throw new HttpError(401, 'invalid_token', 'Your sign-in has expired. Please sign in again.');
    }
    const id = payload.sub;
    const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
    if (!id || !UUID.test(id) || !email) {
      throw new HttpError(401, 'invalid_token', 'Your sign-in is missing details. Please sign in again.');
    }
    const since = signedInAt(payload);
    if (maxHours > 0 && since !== null && now() / 1000 - since > maxHours * 3600) {
      const days =
        maxHours % 24 === 0 ? `${maxHours / 24} ${maxHours === 24 ? 'day' : 'days'}` : `${maxHours} hours`;
      throw new HttpError(
        401,
        'session_expired',
        `You've been signed in for more than ${days}. Sign in again to carry on.`,
      );
    }
    return { id, email };
  };
}

export function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && value ? value : null;
}
