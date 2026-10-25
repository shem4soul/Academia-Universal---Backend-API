import type { Role } from '../utils/enums';

declare global {
  namespace Express {
    interface AuthUser {
      id: string;
      role: Role;
      email: string | null;
    }
    interface Request {
      user?: AuthUser;
      /** Request id (X-Request-Id), set by the request logger. */
      id?: string;
      /** Raw body, kept for webhook signature checks. */
      rawBody?: Buffer;
    }
  }
}

export {};
