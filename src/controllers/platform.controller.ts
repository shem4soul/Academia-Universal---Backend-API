import type { Request } from 'express';
import { me } from '../middlewares/auth.middleware';
import { auditService } from '../services/audit.service';
import { billingService } from '../services/billing.service';
import { insightsService } from '../services/insights.service';
import { adminService, marketingService, parentService, resourceService, supportService } from '../services/platform.service';
import { PaymentPurpose, Role } from '../utils/enums';
import { scoped } from '../utils/logger';

const q = (req: Request) => req.query as never;

export const insightsController = {
  /** One endpoint per role; the web/mobile app calls /dashboard and gets the right shape. */
  dashboard: (req: Request) => {
    const u = me(req);
    switch (u.role) {
      case Role.TEACHER:
        return insightsService.teacherDashboard(u);
      case Role.PARENT:
        return insightsService.parentDashboard(u.id);
      case Role.ADMIN:
        return insightsService.adminDashboard();
      default:
        return insightsService.studentDashboard(u.id);
    }
  },
  student: (req: Request) => insightsService.studentDashboard(me(req).id),
  teacher: (req: Request) => insightsService.teacherDashboard(me(req)),
  parent: (req: Request) => insightsService.parentDashboard(me(req).id),
  admin: () => insightsService.adminDashboard(),
  progress: (req: Request) => insightsService.progress(me(req).id),
  activity: async (req: Request) => insightsService.activitySeries([me(req).id], Math.min(Number(req.query.days ?? 7) || 7, 90)),
  leaderboard: (req: Request) => insightsService.leaderboard(me(req).id, q(req)),
  studentAnalytics: (req: Request) => insightsService.studentAnalytics(me(req), q(req)),
  studentDetail: (req: Request) => insightsService.studentDetail(me(req), req.params.studentId),
};

export const billingController = {
  plans: async () => billingService.plans(),
  config: async () => billingService.config(),
  cards: (req: Request) => billingService.listCards(me(req).id),
  /** "Add new card": a Paystack checkout for the refunded card-verification charge. */
  addCard: (req: Request) => billingService.initialize(me(req).id, { purpose: PaymentPurpose.CARD, platform: req.body?.platform }),
  initialize: (req: Request) => billingService.initialize(me(req).id, req.body),
  verify: (req: Request) => billingService.verify(me(req).id, req.params.reference),
  setDefault: (req: Request) => billingService.setDefault(me(req).id, req.params.id),
  removeCard: (req: Request) => billingService.removeCard(me(req).id, req.params.id),
  history: (req: Request) => billingService.history(me(req).id, q(req)),
  checkout: (req: Request) => billingService.payWithSavedCard(me(req).id, req.body),
  webhook: (req: Request) => billingService.handleWebhook(req.rawBody, req.header('x-paystack-signature')),
  cancelPro: (req: Request) => billingService.cancelPro(me(req).id),
};

export const resourceController = {
  list: (req: Request) => resourceService.list(q(req)),
  get: (req: Request) => resourceService.get(req.params.id),
  download: (req: Request) => resourceService.download(req.params.id),
  create: (req: Request) => resourceService.create(me(req).id, req.body),
  update: (req: Request) => resourceService.update(req.params.id, me(req), req.body),
  remove: (req: Request) => resourceService.remove(req.params.id, me(req)),
};

export const supportController = {
  faqs: (req: Request) => supportService.faqs(typeof req.query.q === 'string' ? req.query.q : undefined),
  createTicket: (req: Request) => supportService.createTicket(req.user, req.body),
  myTickets: (req: Request) => supportService.myTickets(me(req).id),
};

export const parentController = {
  children: (req: Request) => parentService.children(me(req).id),
  addChild: (req: Request) => parentService.addChild(me(req).id, req.body),
  removeChild: (req: Request) => parentService.removeChild(me(req).id, req.params.id),
  childProgress: (req: Request) => insightsService.studentDetail(me(req), req.params.studentId),
};

export const adminController = {
  users: (req: Request) => adminService.users(q(req)),
  user: (req: Request) => adminService.user(req.params.id),
  updateUser: (req: Request) => adminService.updateUser(me(req).id, req.params.id, req.body),
  deleteUser: (req: Request) => adminService.deleteUser(me(req).id, req.params.id),
  verifications: (req: Request) => adminService.verifications((req.query as { status?: never }).status),
  reviewVerification: (req: Request) => adminService.reviewVerification(req.params.id, req.body, me(req).id),
  payments: (req: Request) => adminService.payments(q(req)),
  refund: (req: Request) => adminService.refund(me(req).id, req.params.id, req.body?.reason),
  auditLogs: (req: Request) => auditService.list(q(req)),
  auditActions: () => auditService.actions(),
  tickets: (req: Request) => supportService.listTickets(q(req)),
  respondTicket: (req: Request) => supportService.respond(req.params.id, req.body),
  createFaq: (req: Request) => supportService.createFaq(req.body),
  updateFaq: (req: Request) => supportService.updateFaq(req.params.id, req.body),
  removeFaq: (req: Request) => supportService.removeFaq(req.params.id),
  createCategory: (req: Request) => adminService.createCategory(req.body),
  updateCategory: (req: Request) => adminService.updateCategory(req.params.id, req.body),
  removeCategory: (req: Request) => adminService.removeCategory(req.params.id),
  broadcast: (req: Request) => adminService.broadcast(req.body),
  newsletter: () => adminService.newsletter(),
  waitlist: () => adminService.waitlist(),
};

export const marketingController = {
  subscribe: (req: Request) => marketingService.subscribe(req.body.email),
  unsubscribe: (req: Request) => marketingService.unsubscribe(req.body.email),
  waitlist: (req: Request) => marketingService.joinWaitlist(req.body),
  stats: () => marketingService.stats(),
};

export const healthController = {
  health: async () => ({ status: 'ok', service: 'academia-universal-api', time: new Date().toISOString() }),
};

const clientLog = scoped('client');

export const logController = {
  /** Errors from the web and mobile apps, written to the server logs with the reporting user and request id. */
  client: async (req: Request) => {
    const b = req.body as { level: 'error' | 'warn' | 'info'; message: string; stack?: string; url?: string; platform: string; appVersion?: string; context?: Record<string, unknown> };
    clientLog.log(b.level, b.message, {
      platform: b.platform,
      appVersion: b.appVersion,
      url: b.url,
      stack: b.stack,
      context: b.context,
      userId: req.user?.id,
      ip: req.ip,
    });
    return { received: true };
  },
  /** The signed-in user's sign-ins, password changes and payments (Privacy & security). */
  mySecurity: (req: Request) => auditService.mine(me(req).id, q(req)),
};
