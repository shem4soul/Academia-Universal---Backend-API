import type { NextFunction, Request, Response } from 'express';
import { repo } from '../config/database';
import { User } from '../models';
import { ApiError } from '../utils/ApiError';
import { AccountStatus, Role } from '../utils/enums';
import { verifyToken } from '../utils/tokens';
import { env } from '../config/env';
import { ipAllowed } from '../utils/ip';
import { setContextUser } from './requestLogger.middleware';

async function resolveUser(req: Request): Promise<Express.AuthUser | null> {
  const header = req.headers.authorization ?? '';
  if (!header.startsWith('Bearer ')) return null;
  const payload = verifyToken(header.slice(7), 'access');
  if (!payload) return null;
  const user = await repo(User).findOne({
    where: { id: payload.sub },
    select: ['id', 'role', 'email', 'status', 'tokenVersion'],
  });
  if (!user || user.tokenVersion !== payload.ver || user.status === AccountStatus.SUSPENDED) return null;
  if (user.role === Role.ADMIN) {
    // Admin powers only come from an admin-console session (2FA-verified, time-capped, allowed network).
    if (payload.aud !== 'admin' || !payload.at) return null;
    if (Date.now() / 1000 - payload.at > env.admin.maxSessionHours * 3600) return null;
    if (!ipAllowed(req.ip, env.admin.ipAllowlist)) return null;
  }
  setContextUser(user.id);
  return { id: user.id, role: user.role, email: user.email };
}

/** Requires a valid access token. */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const user = await resolveUser(req);
    if (!user) return next(ApiError.unauthorized('Your session has expired. Please sign in again.'));
    req.user = user;
    next();
  } catch (e) {
    next(e);
  }
}

/** Attaches the user when a valid token is present, but never rejects. */
export async function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    req.user = (await resolveUser(req)) ?? undefined;
    next();
  } catch (e) {
    next(e);
  }
}

/** Restricts a route to the given roles. Admins always pass. */
export const authorize =
  (...roles: Role[]) =>
  (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (req.user.role === Role.ADMIN || roles.includes(req.user.role)) return next();
    next(ApiError.forbidden());
  };

/** Non-null user accessor for controllers behind `authenticate`. */
export const me = (req: Request) => req.user!;
