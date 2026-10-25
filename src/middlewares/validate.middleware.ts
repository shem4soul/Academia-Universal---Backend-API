// import type { NextFunction, Request, Response } from 'express';
// import { z, ZodError, ZodTypeAny } from 'zod';
// import { ApiError } from '../utils/ApiError';

// interface Schemas {
//   body?: ZodTypeAny;
//   query?: ZodTypeAny;
//   params?: ZodTypeAny;
// }

// export function formatZod(err: ZodError) {
//   return err.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
// }

// /** Validates and coerces req.body / req.query / req.params with zod; replaces them with the parsed values. */
// export const validate =
//   (schemas: Schemas) =>
//   (req: Request, _res: Response, next: NextFunction) => {
//     try {
//       if (schemas.params) req.params = schemas.params.parse(req.params);
//       if (schemas.query) req.query = schemas.query.parse(req.query);
//       if (schemas.body) req.body = schemas.body.parse(req.body ?? {});
//       next();
//     } catch (e) {
//       if (e instanceof ZodError) {
//         const issues = formatZod(e);
//         return next(ApiError.badRequest(issues[0]?.message ?? 'Invalid input', issues));
//       }
//       next(e);
//     }
//   };

// export const idParam = z.object({ id: z.string().uuid('Invalid id') });
// /** Course routes accept an id or a slug. */
// export const idOrSlugParam = z.object({ id: z.string().min(1) });

import type { Request, RequestHandler } from "express";
import { z, ZodError, type ZodTypeAny } from "zod";
import { ApiError } from "../utils/ApiError";

export interface ValidationSchemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

type ValidationMiddleware = RequestHandler & {
  validationSchemas?: ValidationSchemas;
};

export function formatZod(err: ZodError) {
  return err.issues.map((issue) => ({
    field: issue.path.join("."),
    message: issue.message,
  }));
}

/**
 * Validates request body, query, and path parameters using Zod.
 * Exposes schemas for automatic OpenAPI documentation.
 */
export const validate = (schemas: ValidationSchemas): ValidationMiddleware => {
  const middleware: ValidationMiddleware = (req, _res, next) => {
    try {
      if (schemas.params) {
        req.params = schemas.params.parse(req.params);
      }

      if (schemas.query) {
        req.query = schemas.query.parse(req.query);
      }

      if (schemas.body) {
        req.body = schemas.body.parse(req.body ?? {});
      }

      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const issues = formatZod(error);

        return next(
          ApiError.badRequest(issues[0]?.message ?? "Invalid input", issues),
        );
      }

      next(error);
    }
  };

  // Allow the OpenAPI generator to access the original Zod schemas.
  middleware.validationSchemas = schemas;

  return middleware;
};

export const idParam = z.object({
  id: z.string().uuid("Invalid id"),
});

/** Course routes accept an id or a slug. */
export const idOrSlugParam = z.object({
  id: z.string().min(1),
});
