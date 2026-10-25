import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** Wraps an async controller so rejected promises reach the error middleware. */
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

/** Wraps an async controller that just returns data; sends it as JSON with the given status. */
export const handle =
  (fn: (req: Request, res: Response) => Promise<unknown>, status = 200): RequestHandler =>
  (req, res, next) => {
    fn(req, res)
      .then((data) => {
        if (!res.headersSent) res.status(status).json(data);
      })
      .catch(next);
  };
