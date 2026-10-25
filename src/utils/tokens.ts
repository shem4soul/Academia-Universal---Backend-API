import jwt, { SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';
import { Role } from './enums';

/**
 * access / refresh — normal sessions.
 * reset — password-reset link.
 * challenge — short-lived ticket between "password OK" and "2FA code OK" for admins.
 */
export type TokenType = 'access' | 'refresh' | 'reset' | 'challenge';

export interface TokenPayload {
  sub: string;
  role: Role;
  ver: number;
  typ: TokenType;
  /** 'admin' marks an admin-console session (short-lived, 2FA-verified). */
  aud?: 'admin';
  /** When the admin proved who they are (seconds) — caps the total session length. */
  at?: number;
  /** For challenge tokens: whether the admin is setting up 2FA or entering a code. */
  stage?: 'setup' | 'totp';
}

const secretFor = (typ: TokenType) => (typ === 'access' ? env.jwt.accessSecret : env.jwt.refreshSecret);

export function signToken(payload: TokenPayload, expiresIn: string) {
  return jwt.sign(payload, secretFor(payload.typ), { expiresIn } as SignOptions);
}

/** Verifies the signature and that the token is of the expected type. Returns null if invalid. */
export function verifyToken(token: string, typ: TokenType): TokenPayload | null {
  try {
    const p = jwt.verify(token, secretFor(typ)) as TokenPayload;
    return p.typ === typ ? p : null;
  } catch {
    return null;
  }
}
