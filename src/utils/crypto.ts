import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { env } from '../config/env';

/** AES-256-GCM for secrets we must read back later (e.g. 2FA seeds). Format: v1.<iv>.<tag>.<ciphertext> (base64url). */
const key = () => createHash('sha256').update(env.encryptionKey || `${env.jwt.refreshSecret}:totp-encryption`).digest();

export function encrypt(plain: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}

export function decrypt(payload: string) {
  const [v, iv, tag, data] = payload.split('.');
  if (v !== 'v1') throw new Error('Unknown encryption format');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}
