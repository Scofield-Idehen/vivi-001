import { createRemoteJWKSet, decodeProtectedHeader, type JWTPayload, jwtVerify } from 'jose';
import { HttpError } from './errors.ts';

export interface AuthUser {
  id: string;
  email: string;
}

export type TokenVerifier = (token: string) => Promise<AuthUser>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Verifies Supabase Auth access tokens. New Supabase projects sign tokens with
 * asymmetric keys published at /auth/v1/.well-known/jwks.json; older projects use a
 * shared secret. Each path accepts only its own algorithms, so one cannot be used
 * to forge the other.
 */
export function createTokenVerifier(options: { supabaseUrl?: string; jwtSecret?: string }): TokenVerifier {
  const issuer = options.supabaseUrl ? `${options.supabaseUrl.replace(/\/$/, '')}/auth/v1` : undefined;
  const jwks = issuer ? createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`)) : null;
  const secret = options.jwtSecret ? new TextEncoder().encode(options.jwtSecret) : null;

  return async (token) => {
    let payload: JWTPayload;
    try {
      const { alg } = decodeProtectedHeader(token);
      if (alg === 'HS256') {
        if (!secret) throw new Error('Shared-secret tokens are not enabled');
        ({ payload } = await jwtVerify(token, secret, {
          algorithms: ['HS256'],
          audience: 'authenticated',
          ...(issuer ? { issuer } : {}),
        }));
      } else {
        if (!jwks || !issuer) throw new Error('Signing keys are not configured');
        ({ payload } = await jwtVerify(token, jwks, {
          algorithms: ['ES256', 'RS256'],
          audience: 'authenticated',
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
    return { id, email };
  };
}

export function bearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && value ? value : null;
}
