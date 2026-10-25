import { createHmac, timingSafeEqual } from 'crypto';
import { env } from '../config/env';
import { ApiError } from '../utils/ApiError';
import { scoped } from '../utils/logger';

/**
 * Thin, typed client for the Paystack REST API (https://paystack.com/docs/api).
 * Uses fetch with a timeout, JSON headers and structured logs (secret key and authorization codes are never logged).
 * PAYSTACK_BASE_URL can point at a mock server for local testing.
 */

const log = scoped('paystack');

export interface PaystackAuthorization {
  authorization_code: string;
  bin: string;
  last4: string;
  exp_month: string;
  exp_year: string;
  channel: string;
  card_type: string;
  bank: string | null;
  country_code: string;
  brand: string;
  reusable: boolean;
  signature: string;
  account_name: string | null;
}

export interface PaystackTransaction {
  id: number;
  status: 'success' | 'failed' | 'abandoned' | 'ongoing' | 'pending' | 'processing' | 'queued' | 'reversed' | 'send_otp' | 'send_pin';
  reference: string;
  amount: number; // kobo
  currency: string;
  channel: string;
  gateway_response: string;
  paid_at: string | null;
  fees: number | null;
  metadata: Record<string, unknown> | string | null;
  customer: { id: number; email: string; customer_code: string };
  authorization: PaystackAuthorization | null;
}

export interface InitializeResult {
  authorization_url: string;
  access_code: string;
  reference: string;
}

export interface PaystackRefund {
  id: number;
  status: string;
  amount: number;
  currency: string;
  transaction: { id: number; reference: string } | number;
}

interface Envelope<T> {
  status: boolean;
  message: string;
  data: T;
}

/** Major units (₦) → minor units (kobo). Paystack works in the smallest currency unit. */
export const toMinor = (amount: number) => Math.round(amount * 100);
export const fromMinor = (minor: number) => Math.round(minor) / 100;

export const paystackEnabled = () => !!env.paystack.secretKey;

async function call<T>(method: 'GET' | 'POST', path: string, body?: Record<string, unknown>): Promise<T> {
  if (!paystackEnabled()) throw ApiError.unavailable('Payments are not configured. Set PAYSTACK_SECRET_KEY on the server.');
  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(`${env.paystack.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${env.paystack.secretKey}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(env.paystack.timeoutMs),
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'TimeoutError';
    log.error(`${method} ${path} ${timedOut ? 'timed out' : 'failed'}`, { durationMs: Date.now() - started, err });
    throw ApiError.badGateway(timedOut ? 'Paystack took too long to respond. Please try again.' : undefined);
  }
  const text = await res.text();
  let json: Envelope<T> | null = null;
  try {
    json = text ? (JSON.parse(text) as Envelope<T>) : null;
  } catch {
    /* non-JSON error page */
  }
  const durationMs = Date.now() - started;
  if (!res.ok || !json?.status) {
    log.warn(`${method} ${path} → ${res.status}`, { durationMs, message: json?.message });
    // 4xx from Paystack usually means the request itself was rejected (bad card, invalid reference…)
    if (res.status >= 400 && res.status < 500) throw ApiError.badRequest(json?.message ?? 'Paystack rejected the request');
    throw ApiError.badGateway(undefined, { paystack: json?.message });
  }
  log.info(`${method} ${path} → ${res.status}`, { durationMs });
  return json.data;
}

export const paystack = {
  /** POST /transaction/initialize — starts a checkout (popup, redirect or mobile webview). */
  initialize(input: {
    email: string;
    amount: number; // kobo
    reference: string;
    currency: string;
    callback_url?: string;
    channels?: string[];
    metadata?: Record<string, unknown>;
  }) {
    return call<InitializeResult>('POST', '/transaction/initialize', { ...input, metadata: input.metadata ? JSON.stringify(input.metadata) : undefined });
  },

  /** GET /transaction/verify/:reference — the source of truth for a payment's outcome. */
  verify(reference: string) {
    return call<PaystackTransaction>('GET', `/transaction/verify/${encodeURIComponent(reference)}`);
  },

  /** POST /transaction/charge_authorization — charge a saved card without the customer re-entering it. */
  chargeAuthorization(input: {
    email: string;
    amount: number; // kobo
    authorization_code: string;
    reference: string;
    currency: string;
    metadata?: Record<string, unknown>;
  }) {
    return call<PaystackTransaction>('POST', '/transaction/charge_authorization', {
      ...input,
      metadata: input.metadata ? JSON.stringify(input.metadata) : undefined,
    });
  },

  /** POST /refund — full refund when amount is omitted. */
  refund(input: { transaction: string | number; amount?: number; merchant_note?: string; customer_note?: string }) {
    return call<PaystackRefund>('POST', '/refund', input);
  },

  /**
   * Checks the x-paystack-signature header: HMAC-SHA512 of the raw request body, keyed with the secret key.
   * Must be computed over the exact bytes Paystack sent, so the webhook route keeps the raw body.
   */
  verifySignature(rawBody: Buffer | undefined, signature: string | undefined) {
    if (!rawBody || !signature || !env.paystack.secretKey) return false;
    const expected = createHmac('sha512', env.paystack.secretKey).update(rawBody).digest('hex');
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(signature, 'utf8');
    return a.length === b.length && timingSafeEqual(a, b);
  },
};
