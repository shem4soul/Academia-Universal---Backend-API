import { AsyncLocalStorage } from 'async_hooks';
import path from 'path';
import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';

/**
 * Application logger (winston).
 *  - Console: colourised one-liners in development, JSON in production (for Docker / log shippers).
 *  - Files (LOG_TO_FILE=true): logs/app-YYYY-MM-DD.log (everything) and logs/error-YYYY-MM-DD.log,
 *    rotated daily, gzipped, kept for LOG_RETENTION_DAYS.
 *  - Every line carries the current requestId / userId when logged inside a request.
 *  - Secrets (passwords, PINs, tokens, card authorisations) are redacted.
 */

export interface LogContext {
  requestId?: string;
  userId?: string;
  ip?: string;
  userAgent?: string;
}

/** Per-request context, so any log line or audit entry can find the current request id, user and IP. */
export const requestContext = new AsyncLocalStorage<LogContext>();

const isProd = process.env.NODE_ENV === 'production';
const level = process.env.LOG_LEVEL ?? (isProd ? 'info' : 'debug');
export const LOG_DIR = path.resolve(process.env.LOG_DIR ?? 'logs');
const toFile = (process.env.LOG_TO_FILE ?? 'true') === 'true' && process.env.NODE_ENV !== 'test';
const retention = `${process.env.LOG_RETENTION_DAYS ?? 14}d`;

const SECRET_KEYS = /pass(word)?|pin|secret|token|authorization|authorization_?code|cvv|card_?number|otp|code$/i;

/** Errors don't JSON-serialise (message/stack are non-enumerable), so turn them into plain objects. */
export function serializeError(e: Error): Record<string, unknown> {
  const extra = e as Error & { code?: unknown; status?: unknown; detail?: unknown; query?: unknown; cause?: unknown };
  return {
    name: e.name,
    message: e.message,
    ...(extra.code !== undefined ? { code: extra.code } : {}),
    ...(extra.status !== undefined ? { status: extra.status } : {}),
    ...(extra.detail !== undefined ? { detail: extra.detail } : {}),
    ...(typeof extra.query === 'string' ? { query: extra.query.slice(0, 500) } : {}),
    stack: e.stack,
    ...(extra.cause instanceof Error ? { cause: serializeError(extra.cause) } : {}),
  };
}

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value instanceof Error) return serializeError(value);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEYS.test(k) && typeof v !== 'object' ? '[redacted]' : redact(v, depth + 1);
  }
  return out;
}

const withContext = winston.format((info) => {
  const ctx = requestContext.getStore();
  if (ctx?.requestId && !info.requestId) info.requestId = ctx.requestId;
  if (ctx?.userId && !info.userId) info.userId = ctx.userId;
  // Redact in place: winston keeps its own state under Symbol keys, so the object must not be replaced.
  for (const key of Object.keys(info)) {
    if (key === 'level' || key === 'message') continue;
    const v = info[key];
    info[key] = SECRET_KEYS.test(key) && (typeof v !== 'object' || v === null) ? '[redacted]' : redact(v);
  }
  return info;
});

const base = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  withContext(),
);

const json = winston.format.combine(base, winston.format.json());

const pretty = winston.format.combine(
  base,
  winston.format.colorize(),
  winston.format.printf(({ timestamp, level: lvl, message, scope, requestId, stack, ...rest }) => {
    const meta = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : '';
    const rid = requestId ? ` (${String(requestId).slice(0, 8)})` : '';
    return `${String(timestamp).slice(11, 23)} ${lvl} [${scope ?? 'app'}]${rid} ${message}${meta}${stack ? `\n${stack}` : ''}`;
  }),
);

const transports: winston.transport[] = [
  new winston.transports.Console({ format: isProd ? json : pretty, silent: process.env.LOG_SILENT === 'true' }),
];

if (toFile) {
  transports.push(
    new DailyRotateFile({
      dirname: LOG_DIR,
      filename: 'app-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: retention,
      format: json,
    }),
    new DailyRotateFile({
      dirname: LOG_DIR,
      filename: 'error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: '20m',
      maxFiles: retention,
      level: 'error',
      format: json,
    }),
  );
}

export const logger = winston.createLogger({
  level,
  levels: winston.config.npm.levels,
  defaultMeta: { service: 'academia-universal-api' },
  transports,
  exitOnError: false,
});

/** Child logger tagged with a scope, e.g. logger for 'paystack' or 'auth'. */
export const scoped = (scope: string) => logger.child({ scope });
