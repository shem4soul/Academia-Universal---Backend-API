import bcrypt from 'bcryptjs';
import { In, MoreThan } from 'typeorm';
import { repo } from '../config/database';
import { env } from '../config/env';
import { AuditLog, User } from '../models';
import { ApiError } from '../utils/ApiError';
import { encrypt, decrypt } from '../utils/crypto';
import { AccountStatus, Role } from '../utils/enums';
import { ipAllowed, normaliseIp } from '../utils/ip';
import { requestContext } from '../utils/logger';
import { signToken, verifyToken } from '../utils/tokens';
import { generateSecret, otpauthUrl, verifyCode } from '../utils/totp';
import { auditService } from './audit.service';
import { issueTokens, parseIdentifier } from './auth.service';

/**
 * Admin console sign-in:
 *   1. POST /auth/admin/login   { identifier, password }
 *        → { stage: 'totp', challengeToken }                      (2FA already set up)
 *        → { stage: 'setup', challengeToken, secret, otpauthUrl }  (first sign-in: scan the QR code)
 *   2. POST /auth/admin/verify  { challengeToken, code }  → admin tokens (10 min access, 8 h refresh, 12 h max)
 * Failed passwords and codes count towards a lockout. Optional IP allowlist and origin check.
 */

const FAILED = ['admin.login_failed', 'admin.2fa_failed'];
/** An operator action that wipes earlier failures (reset-2fa, set-password, unlock from the CLI). */
const CLEARED = ['admin.2fa_reset', 'admin.unlocked', 'admin.password_set'];
const GENERIC = 'Email or password is incorrect';

function assertNetworkAllowed(origin?: string) {
  const ip = requestContext.getStore()?.ip;
  if (!ipAllowed(ip, env.admin.ipAllowlist)) {
    auditService.record('admin.ip_blocked', { userId: null, severity: 'critical', metadata: { ip: normaliseIp(ip) } });
    throw ApiError.forbidden('Admin access is not allowed from this network.');
  }
  if (env.admin.origins.length && origin && !env.admin.origins.includes(origin.replace(/\/+$/, ''))) {
    auditService.record('admin.origin_blocked', { userId: null, severity: 'critical', metadata: { origin } });
    throw ApiError.forbidden('Sign in from the admin console.');
  }
}

async function assertNotLocked(userId: string) {
  let since = new Date(Date.now() - env.admin.lockoutMinutes * 60_000);
  const cleared = await repo(AuditLog).findOne({ where: { userId, action: In(CLEARED) }, order: { createdAt: 'DESC' } });
  if (cleared && cleared.createdAt > since) since = cleared.createdAt;
  const failures = await repo(AuditLog).count({ where: { userId, action: In(FAILED), createdAt: MoreThan(since) } });
  if (failures >= env.admin.lockoutAttempts) {
    await auditService.record('admin.locked_out', { userId, severity: 'critical', metadata: { failures } });
    throw ApiError.tooMany(`Too many failed attempts. Try again in ${env.admin.lockoutMinutes} minutes.`);
  }
}

async function loadAdmin(where: { email?: string; phone?: string; id?: string }) {
  const qb = repo(User)
    .createQueryBuilder('u')
    .addSelect(['u.passwordHash', 'u.totpSecret', 'u.totpPendingSecret', 'u.totpLastStep']);
  if (where.id) qb.where('u.id = :id', { id: where.id });
  else if (where.email) qb.where('u.email = :email', { email: where.email });
  else qb.where('u.phone = :phone', { phone: where.phone });
  return qb.getOne();
}

const challenge = (user: User, stage: 'setup' | 'totp') =>
  signToken({ sub: user.id, role: user.role, ver: user.tokenVersion, typ: 'challenge', aud: 'admin', stage }, '5m');

export const adminAuthService = {
  async login(identifier: string, password: string, origin?: string) {
    assertNetworkAllowed(origin);
    const user = await loadAdmin(parseIdentifier(identifier));
    // Same message whether the account is missing, not an admin, or the password is wrong.
    if (!user || user.role !== Role.ADMIN) {
      await auditService.record('admin.login_failed', { userId: user?.id ?? null, severity: 'warning', metadata: { reason: user ? 'not_admin' : 'unknown_account' } });
      throw ApiError.unauthorized(GENERIC);
    }
    await assertNotLocked(user.id);
    if (!(await bcrypt.compare(password, user.passwordHash))) {
      await auditService.record('admin.login_failed', { userId: user.id, severity: 'warning', metadata: { reason: 'wrong_password' } });
      throw ApiError.unauthorized(GENERIC);
    }
    if (user.status === AccountStatus.SUSPENDED) throw ApiError.forbidden('This account has been suspended.');

    if (!env.admin.twoFactorRequired && !user.totpSecret) {
      await auditService.record('admin.login', { userId: user.id, severity: 'warning', metadata: { twoFactor: false } });
      return { stage: 'done' as const, ...issueTokens(user, true) };
    }
    if (user.totpSecret) return { stage: 'totp' as const, challengeToken: challenge(user, 'totp') };

    // First admin sign-in: create a secret for the authenticator app. It only becomes active after a correct code.
    const secret = generateSecret();
    await repo(User).update(user.id, { totpPendingSecret: encrypt(secret) });
    return {
      stage: 'setup' as const,
      challengeToken: challenge(user, 'setup'),
      secret,
      otpauthUrl: otpauthUrl(secret, user.email ?? user.phone ?? user.id, env.admin.totpIssuer),
    };
  },

  async verify(challengeToken: string, code: string, origin?: string) {
    assertNetworkAllowed(origin);
    const payload = verifyToken(challengeToken, 'challenge');
    if (!payload || payload.aud !== 'admin') throw ApiError.unauthorized('This sign-in has expired. Start again.');
    const user = await loadAdmin({ id: payload.sub });
    if (!user || user.role !== Role.ADMIN || user.tokenVersion !== payload.ver) throw ApiError.unauthorized('This sign-in has expired. Start again.');
    await assertNotLocked(user.id);

    const encrypted = payload.stage === 'setup' ? user.totpPendingSecret : user.totpSecret;
    if (!encrypted) throw ApiError.unauthorized('This sign-in has expired. Start again.');
    const step = verifyCode(decrypt(encrypted), code.trim());
    // Refuse a code that was already used (e.g. replayed from a shoulder-surf or a proxy log).
    if (step === null || (user.totpLastStep !== null && step <= Number(user.totpLastStep))) {
      await auditService.record('admin.2fa_failed', { userId: user.id, severity: 'warning', metadata: { stage: payload.stage } });
      throw ApiError.unauthorized('That code is not correct. Check the time on your phone and try again.');
    }

    if (payload.stage === 'setup') {
      await repo(User).update(user.id, { totpSecret: encrypted, totpPendingSecret: null, totpEnabledAt: new Date(), totpLastStep: String(step) });
      await auditService.record('admin.2fa_enabled', { userId: user.id, severity: 'warning' });
    } else {
      await repo(User).update(user.id, { totpLastStep: String(step) });
    }
    await auditService.record('admin.login', { userId: user.id, metadata: { twoFactor: true } });
    const fresh = await repo(User).findOneByOrFail({ id: user.id });
    return issueTokens(fresh, true);
  },

  /** CLI: lift a lockout early (after confirming who is asking). */
  async unlock(userId: string) {
    await auditService.record('admin.unlocked', { userId, severity: 'warning', metadata: { via: 'cli' } });
  },

  /** Used by the CLI when an admin loses their phone. Signs them out everywhere too. */
  async reset2fa(userId: string) {
    const user = await repo(User).findOneByOrFail({ id: userId });
    await repo(User).update(userId, {
      totpSecret: null,
      totpPendingSecret: null,
      totpEnabledAt: null,
      totpLastStep: null,
      tokenVersion: user.tokenVersion + 1,
    });
    await auditService.record('admin.2fa_reset', { userId, severity: 'critical', metadata: { via: 'cli' } });
  },
};
