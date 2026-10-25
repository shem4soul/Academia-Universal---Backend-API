import type { NextFunction, Request, Response } from 'express';
import { MulterError } from 'multer';
import { QueryFailedError } from 'typeorm';
import { env } from '../config/env';
import { ApiError } from '../utils/ApiError';
import { scoped } from '../utils/logger';

const log = scoped('error');

export function notFoundHandler(req: Request, _res: Response, next: NextFunction) {
  next(ApiError.notFound(`Route ${req.method} ${req.path} not found`));
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ApiError) {
    if (err.status >= 500) log.error(err.message, { err, path: req.originalUrl });
    return res.status(err.status).json({ statusCode: err.status, message: err.message, details: err.details, requestId: req.id });
  }
  if (err instanceof MulterError) {
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'File is too large' : err.message;
    return res.status(400).json({ statusCode: 400, message });
  }
  if (err instanceof SyntaxError && 'body' in err) {
    return res.status(400).json({ statusCode: 400, message: 'Malformed JSON body' });
  }
  if (err instanceof QueryFailedError) {
    const code = (err as QueryFailedError & { driverError?: { code?: string } }).driverError?.code;
    if (code === '23505') return res.status(409).json({ statusCode: 409, message: 'That record already exists' });
    if (code === '22P02') return res.status(400).json({ statusCode: 400, message: 'Invalid identifier' });
    if (code === '23503') return res.status(400).json({ statusCode: 400, message: 'Referenced record does not exist' });
  }
  log.error(err instanceof Error ? err.message : 'Unhandled error', {
    err,
    method: req.method,
    path: req.originalUrl.split('?')[0],
  });
  res.status(500).json({
    statusCode: 500,
    message: 'Something went wrong on our side',
    requestId: req.id,
    ...(env.isProd ? {} : { error: err instanceof Error ? err.message : String(err) }),
  });
}
