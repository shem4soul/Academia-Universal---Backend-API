import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { requestContext, scoped } from '../utils/logger';

const log = scoped('http');
const SKIP = new Set(['/health', '/health/ready', '/favicon.ico']);

/**
 * Gives every request an id (honours an incoming X-Request-Id), returns it in the X-Request-Id header,
 * runs the rest of the request inside a logging context, and writes one access-log line when it finishes.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const incoming = req.header('x-request-id');
  const requestId = incoming && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
  req.id = requestId;
  res.setHeader('X-Request-Id', requestId);

  const ctx = { requestId, ip: req.ip, userAgent: req.header('user-agent') ?? undefined } as {
    requestId: string;
    ip?: string;
    userAgent?: string;
    userId?: string;
  };
  const started = process.hrtime.bigint();

  res.on('finish', () => {
    if (SKIP.has(req.path)) return;
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    const status = res.statusCode;
    const lvl = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
    log.log(lvl, `${req.method} ${req.originalUrl.split('?')[0]} ${status} ${ms.toFixed(1)}ms`, {
      requestId,
      userId: req.user?.id ?? ctx.userId,
      method: req.method,
      path: req.originalUrl.split('?')[0],
      status,
      durationMs: Math.round(ms * 10) / 10,
      ip: req.ip,
      bytes: Number(res.getHeader('content-length') ?? 0),
    });
  });

  requestContext.run(ctx, () => next());
}

/** Called by the auth middleware once the user is known, so later log lines include the user id. */
export function setContextUser(userId: string) {
  const store = requestContext.getStore();
  if (store) store.userId = userId;
}
