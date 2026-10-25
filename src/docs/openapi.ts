// import { routeTable } from "../routes";

// interface Layer {
//   route?: {
//     path: string;
//     methods: Record<string, boolean>;
//     stack: { name: string }[];
//   };
//   name: string;
//   handle: { stack?: Layer[] };
// }

// const PUBLIC_HINTS = [
//   "/auth/register",
//   "/auth/login",
//   "/auth/refresh",
//   "/auth/otp",
//   "/auth/password/reset",
//   "/categories",
//   "/certificates",
//   "/public",
//   "/support/faqs",
//   "/billing/plans",
// ];

// function requestSchemaFor(path: string): Record<string, unknown> {
//   const schemas: Record<string, Record<string, unknown>> = {
//     "/api/auth/register": {
//       type: "object",
//       required: ["identifier", "password", "confirmPassword"],
//       properties: {
//         identifier: {
//           type: "string",
//           minLength: 3,
//           description: "Email address or mobile number",
//         },
//         password: {
//           type: "string",
//           minLength: 8,
//           maxLength: 128,
//         },
//         confirmPassword: { type: "string" },
//         role: {
//           type: "string",
//           enum: ["STUDENT", "TEACHER", "PARENT"],
//           default: "STUDENT",
//         },
//         firstName: { type: "string", maxLength: 60 },
//         lastName: { type: "string", maxLength: 60 },
//       },
//     },
//     "/api/auth/login": {
//       type: "object",
//       required: ["identifier", "password"],
//       properties: {
//         identifier: { type: "string", minLength: 3 },
//         password: { type: "string" },
//         rememberMe: { type: "boolean" },
//       },
//     },
//     "/api/auth/login/pin": {
//       type: "object",
//       required: ["identifier", "pin"],
//       properties: {
//         identifier: { type: "string", minLength: 3 },
//         pin: { type: "string", pattern: "^[0-9]{4,6}$" },
//       },
//     },
//     "/api/auth/refresh": {
//       type: "object",
//       required: ["refreshToken"],
//       properties: {
//         refreshToken: { type: "string", minLength: 1 },
//       },
//     },
//   };

//   return schemas[path] ?? { type: "object" };
// }

// /**
//  * Builds an OpenAPI 3 document by walking the Express routers, so the docs never drift from the code.
//  * Request bodies are documented by the zod validators in src/validators.
//  */
// export function buildOpenApi() {
//   const paths: Record<string, Record<string, unknown>> = {};
//   for (const [prefix, router] of routeTable) {
//     for (const layer of (router as unknown as { stack: Layer[] }).stack) {
//       if (!layer.route) continue;
//       const full =
//         `/api${prefix}${layer.route.path}`.replace(/\/$/, "") || "/api";
//       const openapiPath = full.replace(/:(\w+)/g, "{$1}");
//       const tag = (prefix || full.replace("/api", "")).split("/")[1] ?? "api";
//       const params = [...full.matchAll(/:(\w+)/g)].map((m) => ({
//         name: m[1],
//         in: "path",
//         required: true,
//         schema: { type: "string" },
//       }));
//       const names = layer.route.stack.map((s) => s.name);
//       const secured =
//         names.includes("authenticate") ||
//         (!PUBLIC_HINTS.some((h) => full.startsWith(`/api${h}`)) &&
//           !names.includes("optionalAuth"));
//       for (const method of Object.keys(layer.route.methods)) {
//         paths[openapiPath] ??= {};
//         paths[openapiPath][method] = {
//           tags: [tag.charAt(0).toUpperCase() + tag.slice(1)],
//           summary: `${method.toUpperCase()} ${full}`,
//           parameters: params,
//           ...(secured ? { security: [{ bearer: [] }] } : {}),

//           ...(["post", "patch", "put"].includes(method)
//             ? {
//                 requestBody: {
//                   required: true,
//                   content: {
//                     "application/json": {
//                       schema: requestSchemaFor(full),
//                     },
//                   },
//                 },
//               }
//             : {}),

//           responses: {
//             200: { description: "OK" },
//             400: { description: "Validation error" },
//             401: { description: "Not signed in" },
//           },
//         };
//       }
//     }
//   }
//   return {
//     openapi: "3.0.3",
//     info: {
//       title: "Academia Universal API",
//       version: "1.0.0",
//       description:
//         "REST API for the Academia Universal web and mobile apps. Realtime events: Socket.IO namespace /realtime.",
//     },
//     servers: [{ url: "/" }],
//     components: {
//       securitySchemes: {
//         bearer: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
//       },
//     },
//     paths,
//   };
// }

import { zodToJsonSchema } from "zod-to-json-schema";
import { routeTable } from "../routes";
import type { ValidationSchemas } from "../middlewares/validate.middleware";

interface RouteHandlerLayer {
  name: string;
  handle?: {
    validationSchemas?: ValidationSchemas;
  };
}

interface RouteLayer {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: RouteHandlerLayer[];
  };
  name: string;
  handle: {
    stack?: RouteLayer[];
  };
}

type JsonSchema = Record<string, any>;

const PUBLIC_HINTS = [
  "/auth/register",
  "/auth/login",
  "/auth/refresh",
  "/auth/otp",
  "/auth/password/reset",
  "/categories",
  "/certificates",
  "/public",
  "/support/faqs",
  "/billing/plans",
];

/**
 * Converts Zod schemas to OpenAPI-compatible JSON schemas.
 */

function toOpenApiSchema(
  schema: NonNullable<ValidationSchemas["body"]>,
): JsonSchema {
  // Isolate the converter's complex generic types from TypeScript inference.
  const convert: (input: any, options: any) => unknown =
    zodToJsonSchema as unknown as (input: any, options: any) => unknown;

  return convert(schema, {
    target: "openApi3",
    $refStrategy: "none",
  }) as JsonSchema;
}

/**
 * Converts Zod object properties into individual query or path parameters.
 */
function toParameters(
  schema: NonNullable<ValidationSchemas["query"]>,
  location: "query" | "path",
) {
  const jsonSchema = toOpenApiSchema(schema);
  const properties = jsonSchema.properties ?? {};
  const requiredFields: string[] = jsonSchema.required ?? [];

  return Object.entries(properties).map(([name, propertySchema]) => ({
    name,
    in: location,
    required: location === "path" || requiredFields.includes(name),
    schema: propertySchema,
  }));
}

/**
 * Builds the OpenAPI document from registered Express routes
 * and the Zod schemas attached to validate() middleware.
 */
export function buildOpenApi() {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const [prefix, router] of routeTable) {
    const routerStack = (router as unknown as { stack: RouteLayer[] }).stack;

    for (const layer of routerStack) {
      if (!layer.route) continue;

      const full =
        `/api${prefix}${layer.route.path}`.replace(/\/$/, "") || "/api";

      const openapiPath = full.replace(/:(\w+)/g, "{$1}");

      const tag = (prefix || full.replace("/api", "")).split("/")[1] ?? "api";

      // Collect schemas from validate() middleware on this route.
      const schemas = layer.route.stack.reduce<ValidationSchemas>(
        (combined, routeHandler) => ({
          ...combined,
          ...(routeHandler.handle?.validationSchemas ?? {}),
        }),
        {},
      );

      // Add path parameters even when no Zod params schema exists.
      const fallbackPathParameters = [...full.matchAll(/:(\w+)/g)].map(
        (match) => ({
          name: match[1],
          in: "path",
          required: true,
          schema: { type: "string" },
        }),
      );

      const validatedPathParameters = schemas.params
        ? toParameters(schemas.params, "path")
        : [];

      const queryParameters = schemas.query
        ? toParameters(schemas.query, "query")
        : [];

      // Prefer validated parameter schemas over generic path parameters.
      const parameters = [
        ...fallbackPathParameters,
        ...validatedPathParameters,
        ...queryParameters,
      ].filter(
        (parameter, index, all) =>
          all.findIndex(
            (candidate) =>
              candidate.name === parameter.name &&
              candidate.in === parameter.in,
          ) === index,
      );

      const names = layer.route.stack.map((routeHandler) => routeHandler.name);

      const secured =
        names.includes("authenticate") ||
        (!PUBLIC_HINTS.some((hint) => full.startsWith(`/api${hint}`)) &&
          !names.includes("optionalAuth"));

      for (const method of Object.keys(layer.route.methods)) {
        paths[openapiPath] ??= {};

        const bodySchema = schemas.body
          ? toOpenApiSchema(schemas.body)
          : undefined;

        paths[openapiPath][method] = {
          tags: [tag.charAt(0).toUpperCase() + tag.slice(1)],
          summary: `${method.toUpperCase()} ${full}`,

          ...(parameters.length > 0 ? { parameters } : {}),

          ...(secured ? { security: [{ bearer: [] }] } : {}),

          ...(["post", "patch", "put"].includes(method)
            ? {
                requestBody: {
                  ...(bodySchema ? { required: true } : {}),
                  content: {
                    "application/json": {
                      schema: bodySchema ?? { type: "object" },
                    },
                  },
                },
              }
            : {}),

          responses: {
            200: { description: "OK" },
            400: { description: "Validation error" },
            401: { description: "Not signed in" },
          },
        };
      }
    }
  }

  return {
    openapi: "3.0.3",

    info: {
      title: "Academia Universal API",
      version: "1.0.0",
      description:
        "REST API for the Academia Universal web and mobile apps. Realtime events: Socket.IO namespace /realtime.",
    },

    servers: [{ url: "/" }],

    components: {
      securitySchemes: {
        bearer: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
    },

    paths,
  };
}
