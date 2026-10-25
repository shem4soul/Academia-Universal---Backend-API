import "dotenv/config";

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "")
    throw new Error(`Missing environment variable ${name}`);
  return v;
}

const isProd = process.env.NODE_ENV === "production";

if (isProd && !process.env.PAYSTACK_SECRET_KEY) {
  // Not fatal: the rest of the platform works, payment endpoints answer 503 until keys are set.
  console.warn("[env] PAYSTACK_SECRET_KEY is not set — payments are disabled");
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  isProd,
  port: Number(process.env.PORT ?? 4000),
  publicUrl:
    process.env.PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 4000}`,
  corsOrigins: [
    ...(process.env.CORS_ORIGINS ?? "http://localhost:5173").split(","),
    ...(process.env.ADMIN_ORIGINS ?? "").split(","),
  ]
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean),

  db: {
    url: process.env.DATABASE_URL,
    host: process.env.DB_HOST ?? "localhost",
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USER ?? "academia",
    password: process.env.DB_PASSWORD ?? "academia",
    name: process.env.DB_NAME ?? "academia_universal",
    sync: (process.env.DB_SYNC ?? (isProd ? "false" : "true")) === "true",
    logging: process.env.DB_LOGGING === "true",
    ssl: process.env.DB_SSL === "true" || !!process.env.DATABASE_URL,
    slowQueryMs: Number(process.env.DB_SLOW_QUERY_MS ?? 500),
  },
  /** Where web checkouts return to after Paystack (the frontend handles /payment/callback). */
  frontendUrl: (process.env.FRONTEND_URL ?? "http://localhost:5173").replace(
    /\/+$/,
    "",
  ),
  /** Deep link the mobile app handles after Paystack checkout. */
  mobileCallbackUrl:
    process.env.MOBILE_CALLBACK_URL ?? "academiauniversal://payment/callback",
  paystack: {
    secretKey: process.env.PAYSTACK_SECRET_KEY ?? "",
    publicKey: process.env.PAYSTACK_PUBLIC_KEY ?? "",
    baseUrl: (
      process.env.PAYSTACK_BASE_URL ?? "https://api.paystack.co"
    ).replace(/\/+$/, ""),
    currency: process.env.PAYSTACK_CURRENCY ?? "NGN",
    timeoutMs: Number(process.env.PAYSTACK_TIMEOUT_MS ?? 15000),
    /** Amount (major units) charged to verify a new card; refunded automatically. Paystack minimum is ₦50. */
    cardVerificationAmount: Number(
      process.env.PAYSTACK_CARD_VERIFICATION_AMOUNT ?? 50,
    ),
  },
  jwt: {
    accessSecret: required(
      "JWT_ACCESS_SECRET",
      isProd ? undefined : "dev-access-secret",
    ),
    refreshSecret: required(
      "JWT_REFRESH_SECRET",
      isProd ? undefined : "dev-refresh-secret",
    ),
    accessTtl: process.env.JWT_ACCESS_TTL ?? "15m",
    refreshTtl: process.env.JWT_REFRESH_TTL ?? "30d",
  },
  /** Admin console security. Admins sign in only through /auth/admin/* (the separate admin app). */
  admin: {
    /** Require an authenticator-app code (TOTP) at every admin sign-in. Keep true in production. */
    twoFactorRequired: (process.env.ADMIN_2FA_REQUIRED ?? "true") === "true",
    accessTtl: process.env.ADMIN_ACCESS_TTL ?? "10m",
    refreshTtl: process.env.ADMIN_REFRESH_TTL ?? "8h",
    /** Hard limit on an admin session, however often it is refreshed. */
    maxSessionHours: Number(process.env.ADMIN_SESSION_MAX_HOURS ?? 12),
    /** Comma-separated IPs/CIDRs allowed to use admin accounts (empty = any). e.g. 102.89.0.0/16,41.58.10.4 */
    ipAllowlist: (process.env.ADMIN_IP_ALLOWLIST ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    /** Browser origins allowed to call the admin sign-in endpoints (empty = not enforced). e.g. https://admin.academiauniversal.com */
    origins: (process.env.ADMIN_ORIGINS ?? "")
      .split(",")
      .map((s) => s.trim().replace(/\/+$/, ""))
      .filter(Boolean),
    lockoutAttempts: Number(process.env.ADMIN_LOCKOUT_ATTEMPTS ?? 5),
    lockoutMinutes: Number(process.env.ADMIN_LOCKOUT_MINUTES ?? 15),
    totpIssuer: process.env.ADMIN_TOTP_ISSUER ?? "Academia Universal Admin",
  },
  /** Key for encrypting stored 2FA secrets. Falls back to a key derived from JWT_REFRESH_SECRET. */
  encryptionKey: process.env.TOTP_ENCRYPTION_KEY ?? "",
  otpTtlMinutes: Number(process.env.OTP_TTL_MINUTES ?? 10),
  exposeOtp: !isProd && process.env.EXPOSE_OTP_IN_RESPONSE === "true",
};
