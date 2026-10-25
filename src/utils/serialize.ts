import { levelFor } from './enums';
import type { User } from '../models/user.model';

/** Public view of a user — safe to show to other users. */
export function publicUser(u: User | null | undefined) {
  if (!u) return null;
  return {
    id: u.id,
    firstName: u.firstName,
    lastName: u.lastName,
    fullName: [u.firstName, u.lastName].filter(Boolean).join(' '),
    username: u.username,
    avatarUrl: u.avatarUrl,
    headline: u.headline,
    role: u.role,
    country: u.country,
    points: u.points,
    level: levelFor(u.points),
  };
}

/** The signed-in user's own account. */
export function selfUser(u: User) {
  return {
    ...publicUser(u)!,
    email: u.email,
    phone: u.phone,
    middleName: u.middleName,
    bio: u.bio,
    coverUrl: u.coverUrl,
    dateOfBirth: u.dateOfBirth,
    emailVerified: u.emailVerified,
    phoneVerified: u.phoneVerified,
    onboardingComplete: u.onboardingComplete,
    status: u.status,
    plan: u.plan,
    proExpiresAt: u.proExpiresAt,
    twoFactorEnabled: !!u.totpEnabledAt,
    streakDays: u.streakDays,
    settings: u.settings,
    createdAt: u.createdAt,
  };
}

export const isoDate = (d = new Date()) => d.toISOString().slice(0, 10);

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
