/**
 * Admin account tools (production has no seed data — create admins here).
 *
 *   npm run admin -- create admin@yourdomain.com "Ada" "Okafor"
 *        Password comes from ADMIN_PASSWORD, or a strong one is generated and printed once.
 *        2FA is set up on first sign-in to the admin console (scan the QR code).
 *   npm run admin -- reset-2fa admin@yourdomain.com     lost phone: next sign-in shows a new QR code
 *   npm run admin -- set-password admin@yourdomain.com  new password (ADMIN_PASSWORD or generated)
 *   npm run admin -- unlock admin@yourdomain.com        lift a lockout after too many failed sign-ins
 *   npm run admin -- list
 *
 * In Docker:  docker compose exec backend npm run admin:prod -- create …
 */
import 'reflect-metadata';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { AppDataSource, repo } from '../config/database';
import { DEFAULT_SETTINGS, User } from '../models';
import { adminAuthService } from '../services/adminAuth.service';
import { auditService } from '../services/audit.service';
import { AccountStatus, Role } from '../utils/enums';

const strongPassword = () => `${randomBytes(12).toString('base64url')}#${Math.floor(Math.random() * 90 + 10)}`;

async function main() {
  const [cmd, email, firstName = 'Admin', lastName = ''] = process.argv.slice(2);
  AppDataSource.setOptions({ synchronize: false, logging: false });
  await AppDataSource.initialize();
  const users = repo(User);

  switch (cmd) {
    case 'create': {
      if (!email?.includes('@')) throw new Error('Usage: create <email> [first] [last]');
      const lower = email.toLowerCase();
      if (await users.existsBy({ email: lower })) throw new Error(`${lower} already exists`);
      const password = process.env.ADMIN_PASSWORD ?? strongPassword();
      if (password.length < 12) throw new Error('ADMIN_PASSWORD must be at least 12 characters');
      await users.save(
        users.create({
          email: lower,
          emailVerified: true,
          passwordHash: await bcrypt.hash(password, 12),
          role: Role.ADMIN,
          status: AccountStatus.ACTIVE,
          firstName,
          lastName,
          headline: 'Administrator',
          onboardingComplete: true,
          settings: DEFAULT_SETTINGS,
        }),
      );
      console.log(`Admin created: ${lower}`);
      if (!process.env.ADMIN_PASSWORD) console.log(`Temporary password (shown once): ${password}`);
      console.log('Sign in at the admin console and scan the QR code with an authenticator app.');
      break;
    }
    case 'reset-2fa': {
      const u = await users.findOneBy({ email: email?.toLowerCase(), role: Role.ADMIN });
      if (!u) throw new Error(`No admin with email ${email}`);
      await adminAuthService.reset2fa(u.id);
      console.log(`2FA reset for ${u.email}. They will scan a new QR code at next sign-in. All sessions were signed out.`);
      break;
    }
    case 'set-password': {
      const u = await users.findOneBy({ email: email?.toLowerCase(), role: Role.ADMIN });
      if (!u) throw new Error(`No admin with email ${email}`);
      const password = process.env.ADMIN_PASSWORD ?? strongPassword();
      await users.update(u.id, { passwordHash: await bcrypt.hash(password, 12), tokenVersion: u.tokenVersion + 1 });
      await auditService.record('admin.password_set', { userId: u.id, severity: 'critical', metadata: { via: 'cli' } });
      console.log(`Password updated for ${u.email}. All sessions were signed out.`);
      if (!process.env.ADMIN_PASSWORD) console.log(`Temporary password (shown once): ${password}`);
      break;
    }
    case 'unlock': {
      const u = await users.findOneBy({ email: email?.toLowerCase(), role: Role.ADMIN });
      if (!u) throw new Error(`No admin with email ${email}`);
      await adminAuthService.unlock(u.id);
      console.log(`${u.email} can sign in again.`);
      break;
    }
    case 'list': {
      const admins = await users.find({ where: { role: Role.ADMIN }, order: { createdAt: 'ASC' } });
      for (const a of admins) console.log(`${a.email}\t${a.status}\t2FA: ${a.totpEnabledAt ? 'on' : 'not set up'}`);
      if (!admins.length) console.log('No admins yet.');
      break;
    }
    default:
      console.log('Commands: create <email> [first] [last] | reset-2fa <email> | set-password <email> | unlock <email> | list');
  }
  await AppDataSource.destroy();
}

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await AppDataSource.destroy().catch(() => undefined);
  process.exit(1);
});
