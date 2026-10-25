/**
 * End-to-end tests. Needs PostgreSQL with the demo data loaded (`npm run seed`).
 * `npm test` starts its own API instance on :4100 wired to a mock Paystack server on :4546,
 * so it never touches real Paystack and can run next to `npm run dev`.
 */
import assert from 'node:assert/strict';
import { ChildProcess, spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { spawnSync } from 'node:child_process';
import { codeAt, currentStep } from '../src/utils/totp';
import { MOCK_SECRET, MockPaystack, startMockPaystack } from './mock-paystack';

const API_PORT = Number(process.env.TEST_API_PORT ?? 4100);
const MOCK_PORT = Number(process.env.TEST_MOCK_PORT ?? 4546); // 4545 is left free for `npm run mock:paystack`
const BASE = `http://localhost:${API_PORT}`;
const PASSWORD = 'Password123!';

let api: ChildProcess;
let mock: MockPaystack;
let apiOutput = '';

async function call(method: string, path: string, token?: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
}

async function login(email: string) {
  const r = await call('POST', '/auth/login', undefined, { identifier: email, password: PASSWORD });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.accessToken as string;
}

async function newStudent(prefix: string) {
  const email = `${prefix}.${Date.now()}.${Math.floor(Math.random() * 1e4)}@test.com`;
  const reg = await call('POST', '/auth/register', undefined, { identifier: email, password: PASSWORD, confirmPassword: PASSWORD, role: 'student' });
  assert.equal(reg.status, 201, JSON.stringify(reg.body));
  const t = reg.body.accessToken as string;
  await call('POST', '/auth/onboarding/profile', t, { firstName: 'Tolu', lastName: 'Ade' });
  return { token: t, email, id: reg.body.user.id as string };
}

/** Runs the admin CLI (npm run admin -- …) against the test database. */
function adminCli(...args: string[]) {
  const r = spawnSync(process.execPath, ['-r', 'ts-node/register/transpile-only', 'src/scripts/admin.ts', ...args], {
    env: { ...process.env, LOG_SILENT: 'true', LOG_TO_FILE: 'false', ADMIN_PASSWORD: process.env.ADMIN_PASSWORD },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  return r.stdout;
}

const adminSecrets: Record<string, string> = {};
const lastStepUsed: Record<string, number> = {};

/** Signs an admin in through the admin console: password, then (first time) 2FA setup with the authenticator secret. */
async function adminLogin(email: string, password = PASSWORD) {
  const first = await call('POST', '/auth/admin/login', undefined, { identifier: email, password });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  if (first.body.stage === 'setup') adminSecrets[email] = first.body.secret;
  const secret = adminSecrets[email];
  // Codes are single-use: if this 30-second window's codes were already used, wait for the next one (like a real user).
  let step = currentStep() + 1;
  while (lastStepUsed[email] !== undefined && step <= lastStepUsed[email]) {
    await new Promise((r) => setTimeout(r, 1000));
    step = currentStep() + 1;
  }
  lastStepUsed[email] = step;
  const code = codeAt(secret, step);
  const done = await call('POST', '/auth/admin/verify', undefined, { challengeToken: first.body.challengeToken, code });
  assert.equal(done.status, 200, JSON.stringify(done.body));
  return { ...(done.body as { accessToken: string; refreshToken: string }), code };
}

/** Sends a webhook signed the way Paystack signs it (HMAC-SHA512 of the raw body). */
function webhook(event: unknown, secret = MOCK_SECRET) {
  const raw = JSON.stringify(event);
  const sig = createHmac('sha512', secret).update(raw).digest('hex');
  return call('POST', '/webhooks/paystack', undefined, raw, { 'x-paystack-signature': sig });
}

before(async () => {
  mock = await startMockPaystack(MOCK_PORT);
  api = spawn(process.execPath, ['-r', 'ts-node/register/transpile-only', 'src/server.ts'], {
    env: {
      ...process.env,
      PORT: String(API_PORT),
      PAYSTACK_SECRET_KEY: MOCK_SECRET,
      PAYSTACK_PUBLIC_KEY: 'pk_test_mock',
      PAYSTACK_BASE_URL: mock.url,
      LOG_LEVEL: 'warn',
      LOG_TO_FILE: 'false',
      EXPOSE_OTP_IN_RESPONSE: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  api.stdout!.on('data', (d) => (apiOutput += d));
  api.stderr!.on('data', (d) => (apiOutput += d));
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/health`)).ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`API did not start:\n${apiOutput}`);
});

after(async () => {
  api?.kill('SIGTERM');
  await mock?.close();
});

const tokens: Record<string, string> = {};

describe('Academia Universal API', () => {
  before(async () => {
    tokens.student = await login('sam@academiauniversal.com');
    tokens.teacher = await login('anthony@academiauniversal.com');
    tokens.parent = await login('parent@academiauniversal.com');
    adminCli('reset-2fa', 'admin@academiauniversal.com'); // so the run starts from a known 2FA state
    tokens.admin = (await adminLogin('admin@academiauniversal.com')).accessToken;
  });

  it('rejects bad credentials and validates input', async () => {
    assert.equal((await call('POST', '/auth/login', undefined, { identifier: 'sam@academiauniversal.com', password: 'nope' })).status, 401);
    const bad = await call('POST', '/auth/register', undefined, { identifier: 'x@y.com', password: 'short', confirmPassword: 'short' });
    assert.equal(bad.status, 400);
    assert.match(bad.body.message, /at least 8/);
    assert.equal((await call('GET', '/dashboard')).status, 401);
  });

  it('registers a student, onboards, sets a PIN and signs in with it', async () => {
    const email = `new.${Date.now()}@test.com`;
    const reg = await call('POST', '/auth/register', undefined, { identifier: email, password: PASSWORD, confirmPassword: PASSWORD, role: 'student' });
    assert.equal(reg.status, 201);
    const t = reg.body.accessToken;
    const prof = await call('POST', '/auth/onboarding/profile', t, { firstName: 'Ngozi', lastName: 'Okafor' });
    assert.equal(prof.body.onboardingComplete, true);
    assert.equal((await call('POST', '/auth/pin', t, { pin: '2468', confirmPin: '2468' })).status, 200);
    assert.equal((await call('POST', '/auth/login/pin', undefined, { identifier: email, pin: '2468' })).status, 200);
    const dash = await call('GET', '/dashboard', t);
    assert.equal(dash.body.isNewStudent, true);
  });

  it('runs the password reset flow with a one-time code', async () => {
    const req = await call('POST', '/auth/otp/request', undefined, { identifier: 'parent@academiauniversal.com' });
    assert.ok(req.body.devCode, 'devCode is exposed in development');
    const ver = await call('POST', '/auth/otp/verify', undefined, { identifier: 'parent@academiauniversal.com', code: req.body.devCode });
    assert.ok(ver.body.resetToken);
    const reset = await call('POST', '/auth/password/reset', undefined, { resetToken: ver.body.resetToken, password: PASSWORD, confirmPassword: PASSWORD });
    assert.equal(reset.status, 200);
    tokens.parent = await login('parent@academiauniversal.com');
  });

  it('serves the student dashboard with the Figma sections', async () => {
    const d = (await call('GET', '/dashboard', tokens.student)).body;
    assert.equal(d.user.firstName, 'Samuel');
    const enrolled = (await call('GET', '/courses/me/enrolled?limit=100', tokens.student)).body;
    assert.ok(d.overview.enrolled >= 6);
    assert.equal(d.overview.enrolled, enrolled.total);
    assert.equal(d.activity.series.length, 7);
    assert.ok(d.progress.length >= 4);
    assert.ok(d.assignments.length > 0);
    assert.ok(d.communities.length > 0);
  });

  it('browses, filters and opens courses', async () => {
    const list = (await call('GET', '/courses?category=development&sort=rating')).body;
    assert.ok(list.items.length > 0);
    assert.ok(list.items.every((c: { category: { slug: string } }) => c.category.slug === 'development'));
    const detail = (await call('GET', '/courses/a-z-of-product-design-masterclass', tokens.student)).body;
    assert.ok(detail.enrollment);
    assert.equal(detail.modules.length, 6);
    const lessonId = detail.modules[1].lessons[0].id;
    const lesson = (await call('GET', `/lessons/${lessonId}`, tokens.student)).body;
    assert.equal(lesson.title, 'Design Thinking');
  });

  it('requires payment for paid courses and enrols after a verified Paystack checkout', async () => {
    const buyer = await newStudent('buyer');
    assert.equal((await call('POST', '/courses/backend-prodev/enroll', buyer.token)).status, 402);

    const cfg = (await call('GET', '/billing/config')).body;
    assert.equal(cfg.enabled, true);
    assert.equal(cfg.publicKey, 'pk_test_mock');

    const init = await call('POST', '/billing/paystack/initialize', buyer.token, { purpose: 'course', courseId: 'backend-prodev', saveCard: true });
    assert.equal(init.status, 201, JSON.stringify(init.body));
    assert.ok(init.body.accessCode && init.body.authorizationUrl);
    // We send kobo with a JSON content type and our own reference.
    const sent = mock.requests.find((r) => r.path === '/transaction/initialize' && r.body.reference === init.body.reference)!;
    assert.equal(sent.body.amount, init.body.amount * 100);
    assert.match(sent.contentType ?? '', /application\/json/);
    assert.equal(sent.body.callback_url, 'http://localhost:5173/payment/callback');

    // Before the customer pays, verify reports pending and grants nothing.
    const early = (await call('GET', `/billing/paystack/verify/${init.body.reference}`, buyer.token)).body;
    assert.equal(early.payment.status, 'pending');
    assert.equal(early.enrolled, false);

    await fetch(`${mock.url}/__test/complete/${init.body.reference}`, { method: 'POST', body: JSON.stringify({ status: 'success' }) });
    const done = (await call('GET', `/billing/paystack/verify/${init.body.reference}`, buyer.token)).body;
    assert.equal(done.payment.status, 'success');
    assert.equal(done.enrolled, true);
    const again = await call('POST', '/courses/backend-prodev/enroll', buyer.token);
    assert.equal(again.body.alreadyEnrolled, true);

    // The card was saved (no card numbers stored — just Paystack's authorization).
    const cards = (await call('GET', '/billing/cards', buyer.token)).body;
    assert.equal(cards.length, 1);
    assert.equal(cards[0].last4, '4081');
    assert.equal(cards[0].authorizationCode, undefined);

    // Another user can't verify someone else's payment.
    const other = await newStudent('other');
    assert.equal((await call('GET', `/billing/paystack/verify/${init.body.reference}`, other.token)).status, 404);
  });

  it('accepts only correctly signed Paystack webhooks and grants access once', async () => {
    const buyer = await newStudent('hook');
    const init = (await call('POST', '/billing/paystack/initialize', buyer.token, { purpose: 'pro' })).body;
    await fetch(`${mock.url}/__test/complete/${init.reference}`, { method: 'POST', body: JSON.stringify({ status: 'success' }) });

    const forged = await webhook({ event: 'charge.success', data: { reference: init.reference } }, 'wrong-secret');
    assert.equal(forged.status, 401);
    assert.equal((await call('GET', '/users/me', buyer.token)).body.plan, 'free');

    const ok = await webhook({ event: 'charge.success', data: { reference: init.reference } });
    assert.equal(ok.status, 200);
    const me = (await call('GET', '/users/me', buyer.token)).body;
    assert.equal(me.plan, 'pro');
    const firstExpiry = me.proExpiresAt;
    assert.ok(new Date(firstExpiry) > new Date(Date.now() + 29 * 86400000));

    // Replays (Paystack retries) and a later verify don't extend Pro twice.
    await webhook({ event: 'charge.success', data: { reference: init.reference } });
    await call('GET', `/billing/paystack/verify/${init.reference}`, buyer.token);
    assert.equal((await call('GET', '/users/me', buyer.token)).body.proExpiresAt, firstExpiry);
  });

  it('rejects a payment whose paid amount does not match', async () => {
    const buyer = await newStudent('tamper');
    const init = (await call('POST', '/billing/paystack/initialize', buyer.token, { purpose: 'course', courseId: 'backend-prodev' })).body;
    await fetch(`${mock.url}/__test/complete/${init.reference}`, { method: 'POST', body: JSON.stringify({ status: 'success', amount: 100 }) });
    const r = (await call('GET', `/billing/paystack/verify/${init.reference}`, buyer.token)).body;
    assert.equal(r.payment.status, 'failed');
    assert.equal(r.enrolled, false);
  });

  it('saves a card with a refunded ₦50 check, then pays in one tap', async () => {
    const buyer = await newStudent('onetap');
    const add = await call('POST', '/billing/cards', buyer.token, {});
    assert.equal(add.status, 201);
    assert.equal(add.body.amount, 50);
    const sent = mock.requests.find((r) => r.body.reference === add.body.reference)!;
    assert.deepEqual(sent.body.channels, ['card']);
    await fetch(`${mock.url}/__test/complete/${add.body.reference}`, { method: 'POST', body: JSON.stringify({ status: 'success' }) });
    const v = (await call('GET', `/billing/paystack/verify/${add.body.reference}`, buyer.token)).body;
    assert.equal(v.payment.status, 'refund_pending');
    assert.ok(mock.refunds.length > 0);

    const cards = (await call('GET', '/billing/cards', buyer.token)).body;
    assert.equal(cards.length, 1);
    assert.equal(cards[0].isDefault, true);

    const pay = await call('POST', '/billing/checkout', buyer.token, { purpose: 'course', courseId: 'backend-prodev' });
    assert.equal(pay.status, 201, JSON.stringify(pay.body));
    assert.equal(pay.body.payment.status, 'success');
    assert.equal(pay.body.enrolled, true);
    const charge = mock.requests.filter((r) => r.path === '/transaction/charge_authorization').pop()!;
    assert.equal(charge.body.authorization_code, 'AUTH_mock_visa_4081');
  });

  it('lets admins refund through Paystack and removes access when the refund completes', async () => {
    const buyer = await newStudent('refund');
    const init = (await call('POST', '/billing/paystack/initialize', buyer.token, { purpose: 'course', courseId: 'backend-prodev' })).body;
    await fetch(`${mock.url}/__test/complete/${init.reference}`, { method: 'POST', body: JSON.stringify({ status: 'success' }) });
    const v = (await call('GET', `/billing/paystack/verify/${init.reference}`, buyer.token)).body;
    assert.equal(v.enrolled, true);

    assert.equal((await call('POST', `/admin/payments/${v.payment.id}/refund`, tokens.student, {})).status, 403);
    const r = await call('POST', `/admin/payments/${v.payment.id}/refund`, tokens.admin, { reason: 'Requested by learner' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.payment.status, 'refund_pending');

    await webhook({ event: 'refund.processed', data: { transaction_reference: init.reference, status: 'processed' } });
    const enrolled = (await call('GET', '/courses/me/enrolled?limit=100', buyer.token)).body;
    assert.ok(!enrolled.items.some((c: { slug: string }) => c.slug === 'backend-prodev'));
    const history = (await call('GET', '/billing/payments', buyer.token)).body;
    assert.equal(history.items.find((p: { reference: string }) => p.reference === init.reference).status, 'refunded');
  });

  it('completes a lesson and awards points', async () => {
    const detail = (await call('GET', '/courses/frontend-development-a-z', tokens.student)).body;
    const lesson = detail.modules.flatMap((m: { lessons: { id: string; completed: boolean }[] }) => m.lessons).find((l: { completed: boolean }) => !l.completed);
    const r = (await call('POST', `/lessons/${lesson.id}/complete`, tokens.student, { minutesSpent: 12 })).body;
    assert.equal(r.pointsAwarded, 10);
    assert.ok(r.progressPercent > 20);
  });

  it('handles planner items', async () => {
    const created = await call('POST', '/planner', tokens.student, { type: 'task', title: 'Revise for quiz', dueAt: new Date(Date.now() + 86400000).toISOString() });
    assert.equal(created.status, 201);
    const done = await call('PATCH', `/planner/${created.body.id}`, tokens.student, { completed: true });
    assert.equal(done.body.completed, true);
    const list = (await call('GET', '/planner', tokens.student)).body;
    assert.ok(list.events.length > 0 && list.deadlines.length > 0);
  });

  it('chats in a community and lists unread counts', async () => {
    const mine = (await call('GET', '/communities?scope=mine&type=community', tokens.student)).body;
    const au = mine.items.find((c: { name: string }) => c.name === 'Academia Universal');
    assert.ok(au);
    const msgs = (await call('GET', `/communities/${au.id}/messages`, tokens.student)).body;
    assert.ok(msgs.items.length >= 7);
    const sent = await call('POST', `/communities/${au.id}/messages`, tokens.student, { body: 'Testing from the API suite' });
    assert.equal(sent.status, 201);
    const rec = (await call('GET', '/communities?scope=recommended', tokens.student)).body;
    assert.ok(rec.items.every((c: { isMember: boolean }) => !c.isMember));
  });

  it('shows the leaderboard with my rank', async () => {
    const lb = (await call('GET', '/leaderboard', tokens.student)).body;
    assert.equal(lb.items[0].rank, 1);
    assert.ok(lb.me && lb.me.firstName === 'Samuel');
  });

  it('gives teachers their dashboard, analytics and assignment tools', async () => {
    const d = (await call('GET', '/dashboard', tokens.teacher)).body;
    assert.ok(d.overview.registeredStudents > 0);
    assert.ok(d.rating);
    const a = await call('POST', '/assignments', tokens.teacher, {
      courseId: (await call('GET', '/courses/a-z-of-product-design-masterclass')).body.id,
      title: 'Moodboard',
      dueDate: new Date(Date.now() + 5 * 86400000).toISOString(),
    });
    assert.equal(a.status, 201);
    assert.equal((await call('POST', '/assignments', tokens.student, { courseId: a.body.course.id, title: 'x', dueDate: new Date().toISOString() })).status, 403);
    const analytics = (await call('GET', '/analytics/students', tokens.teacher)).body;
    assert.ok(analytics.items.length > 0);
  });

  it('lets teachers build and publish a course', async () => {
    const c = (await call('POST', '/courses', tokens.teacher, { title: `Motion design ${Date.now()}`, price: 0 })).body;
    assert.equal((await call('PATCH', `/courses/${c.id}`, tokens.teacher, { isPublished: true })).status, 400);
    const m = (await call('POST', `/courses/${c.id}/modules`, tokens.teacher, { title: 'Week 1' })).body;
    await call('POST', `/modules/${m.id}/lessons`, tokens.teacher, { title: 'Easing curves', type: 'text', content: 'Hello' });
    const pub = await call('PATCH', `/courses/${c.id}`, tokens.teacher, { isPublished: true });
    assert.equal(pub.body.isPublished, true);
  });

  it("shows parents their child's progress", async () => {
    const d = (await call('GET', '/dashboard', tokens.parent)).body;
    assert.equal(d.children[0].linked, true);
    const sid = d.children[0].student.id;
    const p = (await call('GET', `/parents/children/${sid}/progress`, tokens.parent)).body;
    assert.ok(p.courses.length > 0);
  });

  it('gives admins the overview and account management', async () => {
    const d = (await call('GET', '/dashboard', tokens.admin)).body;
    assert.ok(d.overview.students > 0 && d.overview.revenue > 0);
    const pending = (await call('GET', '/admin/verifications?status=pending', tokens.admin)).body;
    assert.equal(pending.length, 1);
    assert.equal((await call('GET', '/admin/users', tokens.student)).status, 403);
  });

  it('serves public marketing and support endpoints', async () => {
    assert.equal((await call('POST', '/public/newsletter', undefined, { email: 'reader@test.com' })).status, 201);
    assert.equal((await call('POST', '/public/waitlist', undefined, { email: 'early@test.com', role: 'student' })).status, 201);
    const faqs = (await call('GET', '/support/faqs')).body;
    assert.equal(faqs.length, 6);
  });

  it('records audit logs, exposes them to admins, and returns request ids', async () => {
    const bad = await call('POST', '/auth/login', undefined, { identifier: 'sam@academiauniversal.com', password: 'wrong-password' });
    assert.equal(bad.status, 401);
    assert.match(bad.headers.get('x-request-id') ?? '', /^[\w-]{8,}$/);

    const logs = (await call('GET', '/admin/audit-logs?action=auth.login_failed&limit=5', tokens.admin)).body;
    assert.ok(logs.items.length > 0);
    assert.ok(logs.items[0].ip);
    assert.equal(JSON.stringify(logs.items[0]).includes('wrong-password'), false);

    const pay = (await call('GET', '/admin/audit-logs?action=payment.*', tokens.admin)).body;
    assert.ok(pay.items.some((a: { action: string }) => a.action === 'payment.success'));
    assert.equal((await call('GET', '/admin/audit-logs', tokens.student)).status, 403);

    const mine = (await call('GET', '/logs/me/security', tokens.student)).body;
    assert.ok(mine.items.some((a: { action: string }) => a.action === 'auth.login'));

    const sent = await call('POST', '/logs/client', tokens.student, { level: 'error', message: 'TypeError: x is undefined', platform: 'web', url: '/app' });
    assert.equal(sent.status, 202);
  });

  it('keeps admins out of the public sign-in and requires 2FA on the admin console', async () => {
    const pub = await call('POST', '/auth/login', undefined, { identifier: 'admin@academiauniversal.com', password: PASSWORD });
    assert.equal(pub.status, 403);
    assert.match(pub.body.message, /admin console/);

    // Students can't use the admin sign-in, and the message doesn't reveal why.
    const student = await call('POST', '/auth/admin/login', undefined, { identifier: 'sam@academiauniversal.com', password: PASSWORD });
    assert.equal(student.status, 401);
    assert.equal(student.body.message, 'Email or password is incorrect');

    // Password alone is not enough: a wrong code is refused, a challenge token is not a session.
    const step1 = await call('POST', '/auth/admin/login', undefined, { identifier: 'admin@academiauniversal.com', password: PASSWORD });
    assert.equal(step1.body.stage, 'totp');
    assert.equal(step1.body.accessToken, undefined);
    assert.equal((await call('GET', '/admin/users', step1.body.challengeToken)).status, 401);
    const wrong = await call('POST', '/auth/admin/verify', undefined, { challengeToken: step1.body.challengeToken, code: '000000' });
    assert.equal(wrong.status, 401);

    // Admin sessions are short, marked as admin, and refresh as admin sessions.
    const session = await adminLogin('admin@academiauniversal.com');
    // A code can't be replayed: try the very same code again on a new challenge.
    const again = await call('POST', '/auth/admin/login', undefined, { identifier: 'admin@academiauniversal.com', password: PASSWORD });
    const replay = await call('POST', '/auth/admin/verify', undefined, { challengeToken: again.body.challengeToken, code: session.code });
    assert.equal(replay.status, 401);
    const claims = JSON.parse(Buffer.from(session.accessToken.split('.')[1], 'base64url').toString());
    assert.equal(claims.aud, 'admin');
    assert.ok(claims.exp - claims.iat <= 15 * 60);
    assert.equal((await call('GET', '/admin/users?limit=1', session.accessToken)).status, 200);
    const refreshed = await call('POST', '/auth/refresh', undefined, { refreshToken: session.refreshToken });
    assert.equal(refreshed.status, 200);
    assert.equal(JSON.parse(Buffer.from(refreshed.body.accessToken.split('.')[1], 'base64url').toString()).aud, 'admin');
    assert.equal(refreshed.body.user.twoFactorEnabled, true);

    const audit = (await call('GET', '/admin/audit-logs?action=admin.*&limit=50', session.accessToken)).body;
    const actions = audit.items.map((a: { action: string }) => a.action);
    assert.ok(actions.includes('admin.2fa_failed') && actions.includes('admin.login') && actions.includes('admin.2fa_reset'));
  });

  it('locks an admin account after repeated failures (CLI-created admin)', async () => {
    const email = `ops.${Date.now()}@academiauniversal.com`;
    process.env.ADMIN_PASSWORD = 'Str0ng-Admin-Passw0rd!';
    try {
      assert.match(adminCli('create', email, 'Ops', 'Admin'), /Admin created/);
    } finally {
      delete process.env.ADMIN_PASSWORD;
    }
    for (let i = 0; i < 5; i++) {
      assert.equal((await call('POST', '/auth/admin/login', undefined, { identifier: email, password: `wrong-${i}` })).status, 401);
    }
    const locked = await call('POST', '/auth/admin/login', undefined, { identifier: email, password: 'Str0ng-Admin-Passw0rd!' });
    assert.equal(locked.status, 429);
    assert.match(adminCli('unlock', email), /can sign in again/);
    const unlocked = await call('POST', '/auth/admin/login', undefined, { identifier: email, password: 'Str0ng-Admin-Passw0rd!' });
    assert.equal(unlocked.body.stage, 'setup'); // new admin: 2FA setup comes next
    assert.match(adminCli('list'), new RegExp(email.replace(/\./g, '\\.')));
  });
});
