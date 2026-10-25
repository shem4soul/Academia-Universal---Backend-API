import bcrypt from 'bcryptjs';
import { randomInt } from 'crypto';
import { IsNull } from 'typeorm';
import { repo } from '../config/database';
import { env } from '../config/env';
import { OtpCode } from '../models';
import { ApiError } from '../utils/ApiError';
import { OtpPurpose } from '../utils/enums';
import { scoped } from '../utils/logger';

const log = scoped('otp');

/** sam@example.com → s**@example.com, +2348012345678 → +234*****5678 */
export function maskTarget(t: string) {
  if (t.includes('@')) {
    const [u, d] = t.split('@');
    return `${u.slice(0, 1)}**@${d}`;
  }
  return `${t.slice(0, 4)}*****${t.slice(-4)}`;
}

const MAX_ATTEMPTS = 5;

/**
 * Delivery hook. In development the code is logged to the console.
 * For production, send it with your email/SMS provider (e.g. SendGrid, Termii, Twilio) here.
 */
async function deliver(target: string, purpose: OtpPurpose, code: string) {
  // The code itself is only written to the console log outside production, never to log files.
  if (!env.isProd) console.log(`[otp] ${purpose} code for ${target}: ${code}`);
  log.info('One-time code issued', { purpose, target: maskTarget(target) });
}

export const otpService = {
  async issue(target: string, purpose: OtpPurpose): Promise<string> {
    const otps = repo(OtpCode);
    await otps.update({ target, purpose, usedAt: IsNull() }, { usedAt: new Date() });
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await otps.save(
      otps.create({
        target,
        purpose,
        codeHash: await bcrypt.hash(code, 8),
        expiresAt: new Date(Date.now() + env.otpTtlMinutes * 60_000),
      }),
    );
    await deliver(target, purpose, code);
    return code;
  },

  async verify(target: string, purpose: OtpPurpose, code: string) {
    const otps = repo(OtpCode);
    const otp = await otps.findOne({ where: { target, purpose, usedAt: IsNull() }, order: { createdAt: 'DESC' } });
    if (!otp || otp.expiresAt < new Date()) throw ApiError.badRequest('The code has expired. Request a new one.');
    if (otp.attempts >= MAX_ATTEMPTS) throw ApiError.badRequest('Too many attempts. Request a new code.');
    if (!(await bcrypt.compare(code, otp.codeHash))) {
      await otps.increment({ id: otp.id }, 'attempts', 1);
      throw ApiError.badRequest('That code is not correct');
    }
    otp.usedAt = new Date();
    await otps.save(otp);
  },
};
