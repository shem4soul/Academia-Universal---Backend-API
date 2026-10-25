import { Brackets } from 'typeorm';
import { repo } from '../config/database';
import {
  Category,
  Enrollment,
  Faq,
  NewsletterSubscriber,
  ParentChild,
  Payment,
  Resource,
  SupportTicket,
  TeacherVerification,
  User,
  WaitlistEntry,
} from '../models';
import { ApiError } from '../utils/ApiError';
import { AccountStatus, DeliveryMode, NotificationType, PaymentStatus, ResourceType, Role, TicketStatus, VerificationStatus } from '../utils/enums';
import { offset, paginate, PageQuery } from '../utils/pagination';
import { publicUser, selfUser, slugify, UUID_RE } from '../utils/serialize';
import { auditService } from './audit.service';
import { billingService } from './billing.service';
import { notificationService } from './notification.service';

// ---------------- Resources ----------------
export const resourceService = {
  async list(q: PageQuery & { type?: ResourceType; mode?: DeliveryMode; category?: string }) {
    const qb = repo(Resource).createQueryBuilder('r');
    if (q.type) qb.andWhere('r.type = :type', { type: q.type });
    if (q.mode) qb.andWhere('r.mode = :mode', { mode: q.mode });
    if (q.category) {
      if (UUID_RE.test(q.category)) qb.andWhere('r.categoryId = :c', { c: q.category });
      else qb.andWhere('r.categoryId IN (SELECT id FROM categories WHERE slug = :c)', { c: q.category });
    }
    if (q.q) {
      qb.andWhere(new Brackets((w) => w.where('r.title ILIKE :q', { q: `%${q.q}%` }).orWhere('r.authorName ILIKE :q', { q: `%${q.q}%` })));
    }
    const [items, total] = await qb.orderBy('r.createdAt', 'DESC').skip(offset(q)).take(q.limit).getManyAndCount();
    return paginate(items, total, q);
  },

  async get(id: string) {
    const r = await repo(Resource).findOneBy({ id });
    if (!r) throw ApiError.notFound('Resource not found');
    await repo(Resource).increment({ id }, 'views', 1);
    return r;
  },

  async download(id: string) {
    const r = await repo(Resource).findOneBy({ id });
    if (!r) throw ApiError.notFound('Resource not found');
    if (!r.downloadable) throw ApiError.forbidden('This resource cannot be downloaded');
    await repo(Resource).increment({ id }, 'downloads', 1);
    return { url: r.url };
  },

  async create(userId: string, dto: Partial<Resource>) {
    return repo(Resource).save(repo(Resource).create({ ...dto, uploadedById: userId }));
  },

  async update(id: string, user: Express.AuthUser, dto: Partial<Resource>) {
    const r = await repo(Resource).findOneBy({ id });
    if (!r) throw ApiError.notFound('Resource not found');
    if (user.role !== Role.ADMIN && r.uploadedById !== user.id) throw ApiError.forbidden();
    await repo(Resource).update(id, dto);
    return repo(Resource).findOneByOrFail({ id });
  },

  async remove(id: string, user: Express.AuthUser) {
    const r = await repo(Resource).findOneBy({ id });
    if (!r) throw ApiError.notFound('Resource not found');
    if (user.role !== Role.ADMIN && r.uploadedById !== user.id) throw ApiError.forbidden();
    await repo(Resource).delete(id);
    return { ok: true };
  },
};

// ---------------- Support ----------------
export const supportService = {
  async faqs(q?: string) {
    const qb = repo(Faq).createQueryBuilder('f').orderBy('f.position', 'ASC');
    if (q) qb.where('f.question ILIKE :q OR f.answer ILIKE :q', { q: `%${q}%` });
    return qb.getMany();
  },

  async createTicket(user: Express.AuthUser | undefined, dto: { subject: string; message: string; email?: string }) {
    if (!user && !dto.email) throw ApiError.badRequest('Add your email so we can reply');
    const t = await repo(SupportTicket).save(
      repo(SupportTicket).create({ ...dto, userId: user?.id ?? null, email: dto.email ?? user?.email ?? null }),
    );
    const admins = await repo(User).find({ where: { role: Role.ADMIN }, select: ['id'] });
    await notificationService.notifyMany(admins.map((a) => a.id), {
      title: 'New support request',
      body: dto.subject,
      type: NotificationType.SYSTEM,
      link: '/admin/support',
    });
    return t;
  },

  myTickets(userId: string) {
    return repo(SupportTicket).find({ where: { userId }, order: { createdAt: 'DESC' } });
  },

  async listTickets(q: PageQuery & { status?: TicketStatus }) {
    const [items, total] = await repo(SupportTicket).findAndCount({
      where: q.status ? { status: q.status } : {},
      order: { createdAt: 'DESC' },
      skip: offset(q),
      take: q.limit,
    });
    return paginate(items.map((t) => ({ ...t, user: publicUser(t.user) })), total, q);
  },

  async respond(id: string, dto: { status: TicketStatus; response?: string }) {
    const t = await repo(SupportTicket).findOneBy({ id });
    if (!t) throw ApiError.notFound('Ticket not found');
    await repo(SupportTicket).update(id, { status: dto.status, response: dto.response ?? t.response });
    if (t.userId) {
      await notificationService.notify(t.userId, {
        title: `Support: ${t.subject}`,
        body: dto.response ?? `Status changed to ${dto.status.replace('_', ' ')}`,
        type: NotificationType.SYSTEM,
        link: '/support',
      });
    }
    return repo(SupportTicket).findOneByOrFail({ id });
  },

  createFaq: (dto: Partial<Faq>) => repo(Faq).save(repo(Faq).create(dto)),
  async updateFaq(id: string, dto: Partial<Faq>) {
    if (!(await repo(Faq).existsBy({ id }))) throw ApiError.notFound('FAQ not found');
    await repo(Faq).update(id, dto);
    return repo(Faq).findOneByOrFail({ id });
  },
  async removeFaq(id: string) {
    await repo(Faq).delete(id);
    return { ok: true };
  },
};

// ---------------- Parents ----------------
export const parentService = {
  async children(parentId: string) {
    const rows = await repo(ParentChild).find({ where: { parentId }, relations: { child: true }, order: { createdAt: 'ASC' } });
    return rows.map((r) => ({
      id: r.id,
      childFullName: r.childFullName,
      childEmail: r.childEmail,
      relationship: r.relationship,
      linked: !!r.childId,
      student: publicUser(r.child),
    }));
  },

  async addChild(parentId: string, dto: { childFullName: string; childEmail?: string; relationship?: string }) {
    const email = dto.childEmail?.toLowerCase() || null;
    const child = email ? await repo(User).findOneBy({ email, role: Role.STUDENT }) : null;
    if (child && (await repo(ParentChild).existsBy({ parentId, childId: child.id }))) {
      throw ApiError.conflict('This child is already linked');
    }
    const link = await repo(ParentChild).save(
      repo(ParentChild).create({
        parentId,
        childId: child?.id ?? null,
        childFullName: dto.childFullName,
        childEmail: email,
        relationship: dto.relationship || 'Parent',
      }),
    );
    if (child) {
      const parent = await repo(User).findOneByOrFail({ id: parentId });
      await notificationService.notify(child.id, {
        title: 'A parent linked your account',
        body: `${parent.firstName} ${parent.lastName} can now follow your progress.`,
        type: NotificationType.SYSTEM,
        link: '/settings/privacy',
      });
    }
    return { ...link, linked: !!child };
  },

  async removeChild(parentId: string, linkId: string) {
    const res = await repo(ParentChild).delete({ id: linkId, parentId });
    if (!res.affected) throw ApiError.notFound('Link not found');
    return { ok: true };
  },
};

// ---------------- Admin ----------------
export const adminService = {
  async users(q: PageQuery & { role?: Role; status?: AccountStatus }) {
    const qb = repo(User).createQueryBuilder('u');
    if (q.role) qb.andWhere('u.role = :role', { role: q.role });
    if (q.status) qb.andWhere('u.status = :status', { status: q.status });
    if (q.q) {
      qb.andWhere(
        new Brackets((w) =>
          w
            .where("(u.firstName || ' ' || u.lastName) ILIKE :q", { q: `%${q.q}%` })
            .orWhere('u.email ILIKE :q', { q: `%${q.q}%` })
            .orWhere('u.phone ILIKE :q', { q: `%${q.q}%` }),
        ),
      );
    }
    const [items, total] = await qb.orderBy('u.createdAt', 'DESC').skip(offset(q)).take(q.limit).getManyAndCount();
    return paginate(items.map(selfUser), total, q);
  },

  /** "Admin account management_info": full account record. */
  async user(id: string) {
    const u = await repo(User).findOneBy({ id });
    if (!u) throw ApiError.notFound('User not found');
    const [enrollments, payments, verification, children] = await Promise.all([
      repo(Enrollment).find({ where: { userId: id }, relations: { course: true }, order: { createdAt: 'DESC' } }),
      repo(Payment).find({ where: { userId: id }, order: { createdAt: 'DESC' }, take: 20 }),
      repo(TeacherVerification).findOneBy({ userId: id }),
      repo(ParentChild).find({ where: { parentId: id }, relations: { child: true } }),
    ]);
    return {
      ...selfUser(u),
      enrollments: enrollments.map((e) => ({ id: e.id, course: { id: e.course.id, title: e.course.title }, status: e.status, progressPercent: e.progressPercent })),
      payments,
      verification,
      children: children.map((c) => ({ childFullName: c.childFullName, student: publicUser(c.child) })),
    };
  },

  async updateUser(adminId: string, id: string, dto: { status?: AccountStatus; role?: Role; plan?: User['plan'] }) {
    if (id === adminId && (dto.role || dto.status)) throw ApiError.badRequest("You can't change your own role or status");
    const u = await repo(User).findOneBy({ id });
    if (!u) throw ApiError.notFound('User not found');
    const patch: Partial<User> = { ...dto };
    if (dto.status === AccountStatus.SUSPENDED) patch.tokenVersion = u.tokenVersion + 1; // sign them out everywhere
    await repo(User).update(id, patch);
    await auditService.record('admin.user.update', {
      userId: adminId,
      entityType: 'user',
      entityId: id,
      severity: dto.status === AccountStatus.SUSPENDED || dto.role ? 'critical' : 'info',
      metadata: { before: { status: u.status, role: u.role, plan: u.plan }, after: dto },
    });
    if (dto.status && dto.status !== u.status) {
      await notificationService.notify(id, {
        title: dto.status === AccountStatus.ACTIVE ? 'Your account is active' : `Your account is ${dto.status}`,
        type: NotificationType.SYSTEM,
      });
    }
    return this.user(id);
  },

  async deleteUser(adminId: string, id: string) {
    if (id === adminId) throw ApiError.badRequest("You can't delete your own account here");
    const u = await repo(User).findOneBy({ id });
    if (!u) throw ApiError.notFound('User not found');
    await repo(User).delete(id);
    await auditService.record('admin.user.delete', {
      userId: adminId,
      entityType: 'user',
      entityId: id,
      severity: 'critical',
      metadata: { email: u.email, role: u.role },
    });
    return { ok: true };
  },

  async verifications(status?: VerificationStatus) {
    const rows = await repo(TeacherVerification).find({
      where: status ? { status } : {},
      relations: { user: true },
      order: { createdAt: 'DESC' },
    });
    return rows.map((v) => ({ ...v, user: selfUser(v.user) }));
  },

  async reviewVerification(id: string, dto: { status: VerificationStatus; note?: string }, adminId?: string) {
    const v = await repo(TeacherVerification).findOneBy({ id });
    if (!v) throw ApiError.notFound('Verification not found');
    await repo(TeacherVerification).update(id, { status: dto.status, reviewNote: dto.note ?? null });
    await auditService.record(`admin.verification.${dto.status}`, { userId: adminId, entityType: 'teacher_verification', entityId: id, metadata: { teacherId: v.userId, note: dto.note } });
    await repo(User).update(v.userId, {
      status: dto.status === VerificationStatus.APPROVED ? AccountStatus.ACTIVE : AccountStatus.PENDING,
    });
    await notificationService.notify(v.userId, {
      title: dto.status === VerificationStatus.APPROVED ? 'You are verified 🎉' : 'Verification needs attention',
      body: dto.status === VerificationStatus.APPROVED ? 'You can now publish courses.' : (dto.note ?? 'Please upload a clearer document.'),
      type: NotificationType.SYSTEM,
      link: dto.status === VerificationStatus.APPROVED ? '/teacher' : '/onboarding/teacher-document',
    });
    return { ok: true };
  },

  async payments(q: PageQuery & { status?: PaymentStatus }) {
    const [items, total] = await repo(Payment).findAndCount({
      where: q.status ? { status: q.status } : {},
      relations: { user: true },
      order: { createdAt: 'DESC' },
      skip: offset(q),
      take: q.limit,
    });
    return paginate(items.map((p) => ({ ...p, user: publicUser(p.user) })), total, q);
  },

  /** Refunds through Paystack; access is revoked once Paystack confirms (refund.processed webhook). */
  refund(adminId: string, id: string, reason?: string) {
    return billingService.refund(id, { by: adminId, reason });
  },

  async createCategory(dto: { name: string; icon?: string; description?: string }) {
    const slug = slugify(dto.name);
    if (await repo(Category).existsBy({ slug })) throw ApiError.conflict('That category exists');
    return repo(Category).save(repo(Category).create({ ...dto, slug }));
  },
  async updateCategory(id: string, dto: { name?: string; icon?: string; description?: string }) {
    if (!(await repo(Category).existsBy({ id }))) throw ApiError.notFound('Category not found');
    await repo(Category).update(id, { ...dto, ...(dto.name ? { slug: slugify(dto.name) } : {}) });
    return repo(Category).findOneByOrFail({ id });
  },
  async removeCategory(id: string) {
    await repo(Category).delete(id);
    return { ok: true };
  },

  async broadcast(dto: { title: string; body?: string; role?: Role }) {
    const ids = (await repo(User).find({ where: dto.role ? { role: dto.role } : {}, select: ['id'] })).map((u) => u.id);
    await notificationService.notifyMany(ids, { title: dto.title, body: dto.body, type: NotificationType.SYSTEM });
    await auditService.record('admin.broadcast', { metadata: { title: dto.title, role: dto.role ?? 'all', recipients: ids.length } });
    return { sent: ids.length };
  },

  newsletter: () => repo(NewsletterSubscriber).find({ where: { active: true }, order: { createdAt: 'DESC' } }),
  waitlist: () => repo(WaitlistEntry).find({ order: { createdAt: 'DESC' } }),
};

// ---------------- Marketing (public) ----------------
export const marketingService = {
  async subscribe(email: string) {
    const e = email.toLowerCase();
    await repo(NewsletterSubscriber).upsert({ email: e, active: true }, ['email']);
    return { ok: true, message: "You're subscribed." };
  },
  async unsubscribe(email: string) {
    await repo(NewsletterSubscriber).update({ email: email.toLowerCase() }, { active: false });
    return { ok: true };
  },
  async joinWaitlist(dto: { email: string; fullName?: string; role?: string }) {
    const email = dto.email.toLowerCase();
    if (await repo(WaitlistEntry).existsBy({ email })) return { ok: true, message: "You're already on the list." };
    await repo(WaitlistEntry).save(repo(WaitlistEntry).create({ ...dto, email }));
    return { ok: true, message: "You're on the waitlist. We'll be in touch." };
  },
  /** Landing page counters ("100+ resources", "50+ tutors"). */
  async stats() {
    const [resources, tutors, students, courses] = await Promise.all([
      repo(Resource).count(),
      repo(User).countBy({ role: Role.TEACHER, status: AccountStatus.ACTIVE }),
      repo(User).countBy({ role: Role.STUDENT }),
      repo(Enrollment).count(),
    ]);
    return { resources, tutors, students, enrollments: courses };
  },
};

