import bcrypt from 'bcryptjs';
import { repo } from '../config/database';
import { env } from '../config/env';
import { DEFAULT_SETTINGS, ParentChild, TeacherVerification, User } from '../models';
import { ApiError } from '../utils/ApiError';
import { AccountStatus, OtpPurpose, Role, VerificationStatus } from '../utils/enums';
import { selfUser } from '../utils/serialize';
import { signToken, verifyToken } from '../utils/tokens';
import { OnboardingInput, PHONE_RE, RegisterInput } from '../validators/auth.validator';
import { auditService } from './audit.service';
import { notificationService } from './notification.service';
import { maskTarget, otpService } from './otp.service';

const users = () => repo(User);

/** Splits "email or mobile number" into a lookup key. */
export function parseIdentifier(raw: string): { email?: string; phone?: string } {
  const v = raw.trim();
  if (v.includes('@')) return { email: v.toLowerCase() };
  const phone = v.replace(/[\s()-]/g, '');
  if (PHONE_RE.test(phone)) return { phone };
  throw ApiError.badRequest('Enter a valid email address or mobile number');
}

/** Masked identifier for logs: s**@mail.com / +234*****5678 */
const maskId = (raw: string) => {
  try {
    return maskTarget(normalise(raw));
  } catch {
    return 'invalid';
  }
};

const normalise = (raw: string) => {
  const id = parseIdentifier(raw);
  return (id.email ?? id.phone)!;
};

async function findByIdentifier(raw: string, withSecrets = false) {
  const id = parseIdentifier(raw);
  const qb = users().createQueryBuilder('u');
  if (withSecrets) qb.addSelect(['u.passwordHash', 'u.pinHash']);
  return id.email ? qb.where('u.email = :email', { email: id.email }).getOne() : qb.where('u.phone = :phone', { phone: id.phone }).getOne();
}

function assertCanSignIn(user: User) {
  if (user.status === AccountStatus.SUSPENDED) throw ApiError.forbidden('This account has been suspended. Contact support.');
}

/**
 * Issues a session. Admin accounts always get admin-console tokens: short-lived, marked aud=admin,
 * carrying the time they authenticated so the whole session can be capped (ADMIN_SESSION_MAX_HOURS).
 */
export function issueTokens(user: User, remember: boolean, authTime?: number) {
  const base = { sub: user.id, role: user.role, ver: user.tokenVersion };
  if (user.role === Role.ADMIN) {
    const at = authTime ?? Math.floor(Date.now() / 1000);
    return {
      accessToken: signToken({ ...base, typ: 'access', aud: 'admin', at }, env.admin.accessTtl),
      refreshToken: signToken({ ...base, typ: 'refresh', aud: 'admin', at }, env.admin.refreshTtl),
      user: selfUser(user),
    };
  }
  return {
    accessToken: signToken({ ...base, typ: 'access' }, env.jwt.accessTtl),
    refreshToken: signToken({ ...base, typ: 'refresh' }, remember ? env.jwt.refreshTtl : '1d'),
    user: selfUser(user),
  };
}

/** Admins must use the admin console (/auth/admin/login with 2FA), never the public sign-in. */
async function refuseAdmin(user: User, method: string) {
  if (user.role !== Role.ADMIN) return;
  await auditService.record('auth.login_blocked', { userId: user.id, severity: 'warning', metadata: { reason: 'admin_on_public_login', method } });
  throw ApiError.forbidden('Admin accounts sign in through the admin console.');
}

async function makeUsername(first: string, last: string) {
  const base = `${first}${last}`.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16) || 'learner';
  for (let i = 0; i < 20; i++) {
    const candidate = i === 0 ? base : `${base}${Math.floor(Math.random() * 9000 + 1000)}`;
    if (!(await users().existsBy({ username: candidate }))) return candidate;
  }
  return `${base}${Date.now()}`;
}

export const authService = {
  async register(dto: RegisterInput) {
    const id = parseIdentifier(dto.identifier);
    if (await findByIdentifier(dto.identifier)) {
      throw ApiError.conflict('An account with this email or mobile number already exists');
    }
    const user = users().create({
      email: id.email ?? null,
      phone: id.phone ?? null,
      passwordHash: await bcrypt.hash(dto.password, 10),
      role: dto.role,
      firstName: dto.firstName ?? '',
      lastName: dto.lastName ?? '',
      // Teachers can sign in but stay "pending" until an admin approves their documents.
      status: dto.role === Role.TEACHER ? AccountStatus.PENDING : AccountStatus.ACTIVE,
      settings: DEFAULT_SETTINGS,
    });
    await users().save(user);
    await auditService.record('auth.register', { userId: user.id, entityType: 'user', entityId: user.id, metadata: { role: user.role, via: id.email ? 'email' : 'phone' } });
    await notificationService.notify(user.id, {
      title: 'Welcome to Academia Universal',
      body: 'Finish setting up your profile to get personalised courses.',
      link: '/onboarding',
    });
    return issueTokens(user, false);
  },

  async login(identifier: string, password: string, rememberMe = false) {
    const user = await findByIdentifier(identifier, true);
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      await auditService.record('auth.login_failed', { userId: user?.id ?? null, severity: 'warning', metadata: { identifier: maskId(identifier), reason: user ? 'wrong_password' : 'unknown_account' } });
      throw ApiError.unauthorized('Email/mobile number or password is incorrect');
    }
    if (user.status === AccountStatus.SUSPENDED) {
      await auditService.record('auth.login_blocked', { userId: user.id, severity: 'warning', metadata: { reason: 'suspended' } });
    }
    assertCanSignIn(user);
    await refuseAdmin(user, 'password');
    await auditService.record('auth.login', { userId: user.id, metadata: { method: 'password', rememberMe } });
    return issueTokens(user, rememberMe);
  },

  async loginWithPin(identifier: string, pin: string) {
    const user = await findByIdentifier(identifier, true);
    if (!user?.pinHash || !(await bcrypt.compare(pin, user.pinHash))) {
      await auditService.record('auth.login_failed', { userId: user?.id ?? null, severity: 'warning', metadata: { identifier: maskId(identifier), method: 'pin' } });
      throw ApiError.unauthorized('PIN is incorrect');
    }
    assertCanSignIn(user);
    await refuseAdmin(user, 'pin');
    await auditService.record('auth.login', { userId: user.id, metadata: { method: 'pin' } });
    return issueTokens(user, true);
  },

  async setPin(userId: string, pin: string) {
    await users().update(userId, { pinHash: await bcrypt.hash(pin, 10) });
    await auditService.record('auth.pin_set', { userId });
    return { ok: true };
  },

  async refresh(refreshToken: string) {
    const payload = verifyToken(refreshToken, 'refresh');
    if (!payload) throw ApiError.unauthorized('Session expired. Please sign in again.');
    const user = await users().findOneBy({ id: payload.sub });
    if (!user || user.tokenVersion !== payload.ver) throw ApiError.unauthorized('Session expired. Please sign in again.');
    assertCanSignIn(user);
    if (user.role === Role.ADMIN) {
      // Admin sessions refresh only from an admin token, and never beyond the maximum session length.
      const maxAge = env.admin.maxSessionHours * 3600;
      if (payload.aud !== 'admin' || !payload.at || Date.now() / 1000 - payload.at > maxAge) {
        throw ApiError.unauthorized('Your admin session has ended. Please sign in again.');
      }
      return issueTokens(user, true, payload.at);
    }
    return issueTokens(user, true);
  },

  async logoutEverywhere(userId: string) {
    await users().increment({ id: userId }, 'tokenVersion', 1);
    await auditService.record('auth.logout_all', { userId });
    return { ok: true };
  },

  async me(userId: string) {
    const user = await users().findOneBy({ id: userId });
    if (!user) throw ApiError.notFound('Account not found');
    return selfUser(user);
  },

  // ---------- Password reset & verification ----------

  async requestOtp(identifier: string, purpose: OtpPurpose) {
    const target = normalise(identifier);
    const user = await findByIdentifier(identifier);
    // Same answer either way, so this endpoint can't be used to discover accounts.
    const code = user ? await otpService.issue(target, purpose) : undefined;
    await auditService.record('auth.otp_requested', { userId: user?.id ?? null, metadata: { purpose, accountFound: !!user } });
    return {
      ok: true,
      message: 'If an account exists, a 6-digit code has been sent.',
      ...(env.exposeOtp && code ? { devCode: code } : {}),
    };
  },

  async verifyOtp(identifier: string, purpose: OtpPurpose, code: string) {
    await otpService.verify(normalise(identifier), purpose, code);
    const user = await findByIdentifier(identifier);
    if (!user) throw ApiError.notFound('Account not found');
    if (purpose === OtpPurpose.VERIFY_EMAIL) {
      await users().update(user.id, { emailVerified: true });
      return { ok: true };
    }
    if (purpose === OtpPurpose.VERIFY_PHONE) {
      await users().update(user.id, { phoneVerified: true });
      return { ok: true };
    }
    const resetToken = signToken({ sub: user.id, role: user.role, ver: user.tokenVersion, typ: 'reset' }, '15m');
    return { ok: true, resetToken };
  },

  async resetPassword(resetToken: string, password: string) {
    const payload = verifyToken(resetToken, 'reset');
    if (!payload) throw ApiError.badRequest('This reset link has expired. Start again.');
    const user = await users().findOneBy({ id: payload.sub });
    if (!user || user.tokenVersion !== payload.ver) throw ApiError.badRequest('This reset link was already used.');
    await users().update(user.id, { passwordHash: await bcrypt.hash(password, 10), tokenVersion: user.tokenVersion + 1 });
    await auditService.record('auth.password_reset', { userId: user.id, severity: 'warning' });
    return { ok: true };
  },

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await users().createQueryBuilder('u').addSelect('u.passwordHash').where('u.id = :id', { id: userId }).getOneOrFail();
    if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
      await auditService.record('auth.password_change_failed', { userId, severity: 'warning' });
      throw ApiError.badRequest('Current password is incorrect');
    }
    await users().update(userId, { passwordHash: await bcrypt.hash(newPassword, 10), tokenVersion: user.tokenVersion + 1 });
    await auditService.record('auth.password_changed', { userId, severity: 'warning' });
    return issueTokens(await users().findOneByOrFail({ id: userId }), true);
  },

  // ---------- Onboarding ----------

  async completeProfile(userId: string, dto: OnboardingInput) {
    const user = await users().findOneByOrFail({ id: userId });
    if (dto.email && dto.email.toLowerCase() !== user.email) {
      const email = dto.email.toLowerCase();
      const clash = await users().findOneBy({ email });
      if (clash && clash.id !== userId) throw ApiError.conflict('That email is already in use');
      user.email = email;
      user.emailVerified = false;
    }
    if (dto.phone && dto.phone !== user.phone) {
      const clash = await users().findOneBy({ phone: dto.phone });
      if (clash && clash.id !== userId) throw ApiError.conflict('That phone number is already in use');
      user.phone = dto.phone;
      user.phoneVerified = false;
    }
    user.firstName = dto.firstName;
    user.lastName = dto.lastName;
    user.middleName = dto.middleName ?? user.middleName;
    user.dateOfBirth = dto.dateOfBirth ?? user.dateOfBirth;
    user.country = dto.country ?? user.country;
    user.headline =
      dto.headline ??
      user.headline ??
      (user.role === Role.TEACHER
        ? `${dto.specialization ? dto.specialization + ' ' : ''}Instructor`
        : user.role === Role.PARENT
          ? 'Parent'
          : 'Student');
    if (!user.username) user.username = await makeUsername(dto.firstName, dto.lastName);

    if (user.role === Role.PARENT && dto.childFullName) {
      const childEmail = dto.childEmail ? dto.childEmail.toLowerCase() : null;
      const child = childEmail ? await users().findOneBy({ email: childEmail, role: Role.STUDENT }) : null;
      await repo(ParentChild).save(
        repo(ParentChild).create({
          parentId: userId,
          childId: child?.id ?? null,
          childFullName: dto.childFullName,
          childEmail,
          relationship: dto.relationship || 'Parent',
        }),
      );
    }

    const verifications = repo(TeacherVerification);
    if (user.role === Role.TEACHER) {
      const v = await verifications.findOneBy({ userId });
      if (v && (dto.qualification || dto.specialization)) {
        v.qualification = dto.qualification ?? v.qualification;
        v.specialization = dto.specialization ?? v.specialization;
        await verifications.save(v);
      }
      // Teachers finish onboarding after uploading their document.
      user.onboardingComplete = !!v;
    } else {
      user.onboardingComplete = true;
    }
    await users().save(user);
    return selfUser(user);
  },

  async submitTeacherDocument(userId: string, documentType: string, documentUrl: string) {
    const user = await users().findOneByOrFail({ id: userId });
    if (user.role !== Role.TEACHER) throw ApiError.forbidden('Only instructors submit verification documents');
    const verifications = repo(TeacherVerification);
    const existing = await verifications.findOneBy({ userId });
    await verifications.save(
      verifications.create({ ...(existing ?? {}), userId, documentType, documentUrl, status: VerificationStatus.PENDING }),
    );
    user.onboardingComplete = !!user.firstName;
    await users().save(user);
    await auditService.record('teacher.document_submitted', { userId, entityType: 'teacher_verification', metadata: { documentType } });
    return { ok: true, status: VerificationStatus.PENDING, user: selfUser(user) };
  },
};
