import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../config/env';
import { authController as c } from '../controllers/auth.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { validate } from '../middlewares/validate.middleware';
import { handle } from '../utils/asyncHandler';
import * as v from '../validators/auth.validator';

// Per-IP limits on sensitive endpoints. Strict in production, relaxed in development so tests can run.
const limiter = (prodLimit: number) =>
  rateLimit({
    windowMs: 60_000,
    limit: env.isProd ? prodLimit : 1000,
    standardHeaders: true,
    legacyHeaders: false,
    message: { statusCode: 429, message: 'Too many attempts. Please wait a minute and try again.' },
  });
const strict = limiter(10);
const otpLimit = limiter(5);

const r = Router();

r.post('/register', strict, validate({ body: v.registerSchema }), handle(c.register, 201));
r.post('/login', strict, validate({ body: v.loginSchema }), handle(c.login));
r.post('/login/pin', strict, validate({ body: v.pinLoginSchema }), handle(c.loginWithPin));
r.post('/refresh', validate({ body: v.refreshSchema }), handle(c.refresh));
r.post('/otp/request', otpLimit, validate({ body: v.requestOtpSchema }), handle(c.requestOtp));
r.post('/otp/verify', strict, validate({ body: v.verifyOtpSchema }), handle(c.verifyOtp));
r.post('/password/reset', strict, validate({ body: v.resetPasswordSchema }), handle(c.resetPassword));

// Admin console sign-in (password, then authenticator code). Tighter per-IP limit on top of the per-account lockout.
const adminLimit = limiter(6);
r.post('/admin/login', adminLimit, validate({ body: v.adminLoginSchema }), handle(c.adminLogin));
r.post('/admin/verify', adminLimit, validate({ body: v.adminVerifySchema }), handle(c.adminVerify));

r.use(authenticate);
r.get('/me', handle(c.me));
r.post('/logout-all', handle(c.logoutAll));
r.post('/pin', validate({ body: v.setPinSchema }), handle(c.setPin));
r.post('/password/change', validate({ body: v.changePasswordSchema }), handle(c.changePassword));
r.post('/onboarding/profile', validate({ body: v.onboardingSchema }), handle(c.onboardingProfile));
r.post('/onboarding/teacher-document', validate({ body: v.teacherDocumentSchema }), handle(c.teacherDocument));

export default r;
