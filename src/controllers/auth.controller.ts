import type { Request } from 'express';
import { me } from '../middlewares/auth.middleware';
import { adminAuthService } from '../services/adminAuth.service';
import { authService } from '../services/auth.service';

export const authController = {
  register: (req: Request) => authService.register(req.body),
  login: (req: Request) => authService.login(req.body.identifier, req.body.password, req.body.rememberMe),
  loginWithPin: (req: Request) => authService.loginWithPin(req.body.identifier, req.body.pin),
  refresh: (req: Request) => authService.refresh(req.body.refreshToken),
  logoutAll: (req: Request) => authService.logoutEverywhere(me(req).id),
  me: (req: Request) => authService.me(me(req).id),
  setPin: (req: Request) => authService.setPin(me(req).id, req.body.pin),
  onboardingProfile: (req: Request) => authService.completeProfile(me(req).id, req.body),
  teacherDocument: (req: Request) => authService.submitTeacherDocument(me(req).id, req.body.documentType, req.body.documentUrl),
  requestOtp: (req: Request) => authService.requestOtp(req.body.identifier, req.body.purpose),
  verifyOtp: (req: Request) => authService.verifyOtp(req.body.identifier, req.body.purpose, req.body.code),
  resetPassword: (req: Request) => authService.resetPassword(req.body.resetToken, req.body.password),
  adminLogin: (req: Request) => adminAuthService.login(req.body.identifier, req.body.password, req.header('origin')),
  adminVerify: (req: Request) => adminAuthService.verify(req.body.challengeToken, req.body.code, req.header('origin')),
  changePassword: (req: Request) => authService.changePassword(me(req).id, req.body.currentPassword, req.body.newPassword),
};
