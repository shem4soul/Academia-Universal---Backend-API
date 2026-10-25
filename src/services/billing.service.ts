import { randomBytes } from 'crypto';
import { IsNull, LessThan } from 'typeorm';
import { AppDataSource, repo } from '../config/database';
import { env } from '../config/env';
import { Course, Enrollment, ParentChild, Payment, PaymentCard, User } from '../models';
import { ApiError } from '../utils/ApiError';
import { NotificationType, PaymentPurpose, PaymentStatus, Plan } from '../utils/enums';
import { scoped } from '../utils/logger';
import { offset, paginate, PageQuery } from '../utils/pagination';
import { auditService } from './audit.service';
import { courseService } from './course.service';
import { notificationService } from './notification.service';
import { fromMinor, paystack, paystackEnabled, PaystackTransaction, toMinor } from './paystack.client';

const log = scoped('billing');

/** Subscription plans shown on "Upgrade to Pro" and Billing & Payments. */
export const PLANS = [
  {
    id: Plan.FREE,
    name: 'Free',
    price: 0,
    currency: 'NGN',
    interval: 'month',
    features: ['Free courses', 'Community access', 'Study planner', 'Leaderboard'],
  },
  {
    id: Plan.PRO,
    name: 'Pro',
    price: Number(process.env.PRO_PRICE ?? 5000),
    currency: 'NGN',
    interval: 'month',
    features: ['Everything in Free', 'Smart Search', 'Live sessions', 'Offline resources', 'Certificates', 'Priority support'],
  },
];

const PRO_DAYS = 30;
const cards = () => repo(PaymentCard);
const payments = () => repo(Payment);

export interface PurchaseInput {
  purpose: PaymentPurpose;
  courseId?: string;
  beneficiaryId?: string;
}

/** Public view of a payment (never exposes access codes). */
function view(p: Payment) {
  return {
    id: p.id,
    reference: p.reference,
    purpose: p.purpose,
    description: p.description,
    amount: p.amount,
    currency: p.currency,
    status: p.status,
    channel: p.channel,
    gatewayResponse: p.gatewayResponse,
    paidAt: p.paidAt,
    courseId: p.courseId,
    beneficiaryId: p.beneficiaryId,
    refundedAt: p.refundedAt,
    createdAt: p.createdAt,
  };
}

const newReference = (purpose: PaymentPurpose) => `AU-${purpose.toUpperCase()}-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`.toUpperCase();

/** Works out what is being bought, for whom, and the price. */
async function quote(userId: string, input: PurchaseInput) {
  let beneficiaryId: string | null = null;
  if (input.beneficiaryId && input.beneficiaryId !== userId) {
    const linked = await repo(ParentChild).existsBy({ parentId: userId, childId: input.beneficiaryId });
    if (!linked) throw ApiError.forbidden('You can only pay for children linked to your account');
    beneficiaryId = input.beneficiaryId;
  }
  const learnerId = beneficiaryId ?? userId;

  if (input.purpose === PaymentPurpose.COURSE) {
    if (!input.courseId) throw ApiError.badRequest('Choose a course');
    const course = await courseService.findCourse(input.courseId);
    if (!course.isPublished) throw ApiError.badRequest('This course is not open for enrolment yet');
    if (course.price <= 0) throw ApiError.badRequest('This course is free — just enrol');
    if (await repo(Enrollment).existsBy({ userId: learnerId, courseId: course.id })) {
      throw ApiError.conflict(beneficiaryId ? 'Your child is already enrolled in this course' : 'You are already enrolled in this course');
    }
    return { amount: course.price, currency: course.currency, description: `Course: ${course.title}`, courseId: course.id, beneficiaryId };
  }
  if (input.purpose === PaymentPurpose.PRO) {
    const pro = PLANS.find((p) => p.id === Plan.PRO)!;
    return { amount: pro.price, currency: pro.currency, description: `Academia Universal Pro (${PRO_DAYS} days)`, courseId: null, beneficiaryId };
  }
  return {
    amount: env.paystack.cardVerificationAmount,
    currency: env.paystack.currency,
    description: 'Card verification (refunded)',
    courseId: null,
    beneficiaryId: null,
  };
}

async function payer(userId: string) {
  const user = await repo(User).findOneBy({ id: userId });
  if (!user) throw ApiError.notFound('Account not found');
  if (!user.email) throw ApiError.badRequest('Add an email address in Account settings before paying — Paystack sends your receipt there.');
  return user;
}

/** Map a Paystack transaction status onto ours. */
function statusFrom(tx: PaystackTransaction): PaymentStatus {
  switch (tx.status) {
    case 'success':
      return PaymentStatus.SUCCESS;
    case 'failed':
    case 'reversed':
      return PaymentStatus.FAILED;
    case 'abandoned':
      return PaymentStatus.ABANDONED;
    default:
      return PaymentStatus.PENDING;
  }
}

export const billingService = {
  plans: () => PLANS,

  /** What the clients need to open Paystack checkout. The public key is safe to expose. */
  config() {
    return {
      enabled: paystackEnabled(),
      provider: 'paystack',
      publicKey: env.paystack.publicKey || null,
      currency: env.paystack.currency,
      cardVerificationAmount: env.paystack.cardVerificationAmount,
    };
  },

  // ---------------- Saved cards ----------------

  listCards(userId: string) {
    return cards().find({ where: { userId }, order: { isDefault: 'DESC', createdAt: 'DESC' } });
  },

  async setDefault(userId: string, id: string) {
    const card = await cards().findOneBy({ id, userId });
    if (!card) throw ApiError.notFound('Card not found');
    await cards().update({ userId }, { isDefault: false });
    await cards().update(id, { isDefault: true });
    return { ok: true };
  },

  async removeCard(userId: string, id: string) {
    const card = await cards().findOneBy({ id, userId });
    if (!card) throw ApiError.notFound('Card not found');
    await cards().delete(id);
    if (card.isDefault) {
      const next = await cards().findOne({ where: { userId }, order: { createdAt: 'DESC' } });
      if (next) await cards().update(next.id, { isDefault: true });
    }
    await auditService.record('card.removed', { userId, entityType: 'payment_card', entityId: id, metadata: { brand: card.brand, last4: card.last4 } });
    return { ok: true };
  },

  // ---------------- Checkout ----------------

  /**
   * Step 1 of a Paystack checkout. Creates a pending payment and a Paystack transaction.
   * Web opens the popup with `accessCode`; mobile opens `authorizationUrl` / the Paystack webview.
   * Purpose `card` charges a small amount to save a new card and refunds it automatically.
   */
  async initialize(userId: string, input: PurchaseInput & { saveCard?: boolean; platform?: 'web' | 'mobile' }) {
    const user = await payer(userId);
    const q = await quote(userId, input);
    const reference = newReference(input.purpose);
    const isCard = input.purpose === PaymentPurpose.CARD;
    const payment = await payments().save(
      payments().create({
        userId,
        purpose: input.purpose,
        amount: q.amount,
        currency: q.currency,
        description: q.description,
        reference,
        courseId: q.courseId,
        beneficiaryId: q.beneficiaryId,
        saveCard: isCard || !!input.saveCard,
      }),
    );
    try {
      const init = await paystack.initialize({
        email: user.email!,
        amount: toMinor(q.amount),
        currency: q.currency,
        reference,
        callback_url: input.platform === 'mobile' ? env.mobileCallbackUrl : `${env.frontendUrl}/payment/callback`,
        channels: isCard ? ['card'] : undefined,
        metadata: {
          paymentId: payment.id,
          userId,
          purpose: input.purpose,
          courseId: q.courseId,
          beneficiaryId: q.beneficiaryId,
          cancel_action: input.platform === 'mobile' ? env.mobileCallbackUrl : `${env.frontendUrl}/payment/callback?cancelled=1`,
        },
      });
      await payments().update(payment.id, { accessCode: init.access_code, authorizationUrl: init.authorization_url });
      await auditService.record('payment.initialized', {
        userId,
        entityType: 'payment',
        entityId: payment.id,
        metadata: { reference, purpose: input.purpose, amount: q.amount, currency: q.currency, courseId: q.courseId, beneficiaryId: q.beneficiaryId },
      });
      return {
        paymentId: payment.id,
        reference,
        accessCode: init.access_code,
        authorizationUrl: init.authorization_url,
        amount: q.amount,
        currency: q.currency,
        email: user.email,
        publicKey: env.paystack.publicKey || null,
        description: q.description,
      };
    } catch (err) {
      await payments().update(payment.id, { status: PaymentStatus.FAILED, gatewayResponse: 'Could not start checkout' });
      throw err;
    }
  },

  /**
   * Step 2: after the popup / redirect / webview closes, the client asks us to verify.
   * We always confirm with Paystack's API — the client's word is never trusted.
   */
  async verify(userId: string, reference: string) {
    const payment = await payments().findOneBy({ reference, userId });
    if (!payment) throw ApiError.notFound('Payment not found');
    if (payment.status === PaymentStatus.SUCCESS || payment.status === PaymentStatus.REFUNDED || payment.status === PaymentStatus.REFUND_PENDING) {
      return { payment: view(payment), enrolled: payment.purpose === PaymentPurpose.COURSE && !!payment.fulfilledAt };
    }
    const tx = await paystack.verify(reference);
    return this.applyTransaction(tx);
  },

  /**
   * One-tap payment with a saved card (Paystack charge_authorization).
   * Some banks ask for extra authentication; then the result is `pending` and the webhook completes it.
   */
  async payWithSavedCard(userId: string, input: PurchaseInput & { cardId?: string }) {
    if (input.purpose === PaymentPurpose.CARD) throw ApiError.badRequest('Choose a course or the Pro plan');
    const q = await quote(userId, input);
    const qb = cards()
      .createQueryBuilder('c')
      .addSelect(['c.authorizationCode', 'c.customerEmail'])
      .where('c.userId = :userId', { userId });
    if (input.cardId) qb.andWhere('c.id = :id', { id: input.cardId });
    else qb.andWhere('c.isDefault = true');
    const card = await qb.getOne();
    if (!card) throw ApiError.badRequest('Add a payment card first, or pay with a new card');

    const reference = newReference(input.purpose);
    const payment = await payments().save(
      payments().create({
        userId,
        purpose: input.purpose,
        amount: q.amount,
        currency: q.currency,
        description: q.description,
        reference,
        cardId: card.id,
        courseId: q.courseId,
        beneficiaryId: q.beneficiaryId,
      }),
    );
    await auditService.record('payment.initialized', {
      userId,
      entityType: 'payment',
      entityId: payment.id,
      metadata: { reference, purpose: input.purpose, amount: q.amount, method: 'saved_card', card: `${card.brand} •••• ${card.last4}` },
    });
    let tx: PaystackTransaction;
    try {
      tx = await paystack.chargeAuthorization({
        email: card.customerEmail,
        amount: toMinor(q.amount),
        authorization_code: card.authorizationCode,
        currency: q.currency,
        reference,
        metadata: { paymentId: payment.id, userId, purpose: input.purpose, courseId: q.courseId, beneficiaryId: q.beneficiaryId },
      });
    } catch (err) {
      await payments().update(payment.id, { status: PaymentStatus.FAILED, gatewayResponse: err instanceof Error ? err.message : 'Charge failed' });
      await auditService.record('payment.failed', { userId, entityType: 'payment', entityId: payment.id, severity: 'warning', metadata: { reference } });
      throw err;
    }
    const result = await this.applyTransaction(tx);
    if (result.payment.status === PaymentStatus.FAILED) {
      throw ApiError.paymentRequired(`The payment was declined${tx.gateway_response ? `: ${tx.gateway_response}` : ''}. Try another card.`, { reference });
    }
    return result;
  },

  /**
   * Records what Paystack says happened to a transaction and, on success, grants access exactly once.
   * Called by verify, saved-card charges and the webhook — any of them may arrive first.
   */
  async applyTransaction(tx: PaystackTransaction) {
    const payment = await payments().findOneBy({ reference: tx.reference });
    if (!payment) {
      log.warn('Paystack transaction for an unknown reference', { reference: tx.reference });
      throw ApiError.notFound('Payment not found');
    }
    let status = statusFrom(tx);

    // Never trust amounts from the client: the paid amount and currency must match what we charged.
    if (status === PaymentStatus.SUCCESS && (tx.amount !== toMinor(payment.amount) || tx.currency !== payment.currency)) {
      status = PaymentStatus.FAILED;
      await auditService.record('payment.amount_mismatch', {
        userId: payment.userId,
        entityType: 'payment',
        entityId: payment.id,
        severity: 'critical',
        metadata: { reference: tx.reference, expected: toMinor(payment.amount), paid: tx.amount, currency: tx.currency },
      });
    }

    // Don't move a refunded payment back to success when an old event is replayed.
    const final = [PaymentStatus.REFUNDED, PaymentStatus.REFUND_PENDING].includes(payment.status);
    if (!final) {
      await payments().update(payment.id, {
        status,
        channel: tx.channel ?? null,
        gatewayResponse: tx.gateway_response ?? null,
        providerTransactionId: tx.id ? String(tx.id) : payment.providerTransactionId,
        paidAt: tx.paid_at ? new Date(tx.paid_at) : payment.paidAt,
        fees: tx.fees != null ? fromMinor(tx.fees) : payment.fees,
      });
    }
    if (tx.customer?.customer_code) {
      await repo(User).update({ id: payment.userId, paystackCustomerCode: IsNull() }, { paystackCustomerCode: tx.customer.customer_code });
    }

    if (status === PaymentStatus.SUCCESS && !final) {
      await this.fulfil(payment.id, tx);
    } else if (status === PaymentStatus.FAILED && payment.status !== PaymentStatus.FAILED) {
      await auditService.record('payment.failed', {
        userId: payment.userId,
        entityType: 'payment',
        entityId: payment.id,
        severity: 'warning',
        metadata: { reference: tx.reference, gatewayResponse: tx.gateway_response },
      });
    }
    const fresh = await payments().findOneByOrFail({ id: payment.id });
    return { payment: view(fresh), enrolled: fresh.purpose === PaymentPurpose.COURSE && !!fresh.fulfilledAt };
  },

  /** Grants what was paid for. The conditional update makes it safe when verify and webhook race. */
  async fulfil(paymentId: string, tx: PaystackTransaction) {
    const claim = await payments()
      .createQueryBuilder()
      .update()
      .set({ fulfilledAt: () => 'now()' })
      .where('id = :id AND "fulfilledAt" IS NULL', { id: paymentId })
      .execute();
    if (!claim.affected) return; // already granted
    const payment = await payments().findOneByOrFail({ id: paymentId });
    const learnerId = payment.beneficiaryId ?? payment.userId;
    try {
      if (payment.saveCard && tx.authorization?.reusable && tx.authorization.channel === 'card') {
        await this.saveAuthorization(payment.userId, tx);
      }
      if (payment.purpose === PaymentPurpose.COURSE && payment.courseId) {
        const course = await repo(Course).findOneByOrFail({ id: payment.courseId });
        await courseService.createEnrollment(learnerId, course);
      } else if (payment.purpose === PaymentPurpose.PRO) {
        const target = await repo(User).findOneByOrFail({ id: learnerId });
        const from = target.proExpiresAt && target.proExpiresAt > new Date() ? target.proExpiresAt : new Date();
        await repo(User).update(learnerId, { plan: Plan.PRO, proExpiresAt: new Date(from.getTime() + PRO_DAYS * 86_400_000) });
      } else if (payment.purpose === PaymentPurpose.CARD) {
        // The ₦50 verification charge goes straight back to the customer.
        await this.refund(payment.id, { reason: 'Card verification', silent: true });
      }
    } catch (err) {
      // Release the claim so the webhook or a retry can grant access later.
      await payments().update(paymentId, { fulfilledAt: null });
      log.error('Fulfilment failed; will retry on next verify/webhook', { reference: payment.reference, err });
      throw err;
    }

    await auditService.record('payment.success', {
      userId: payment.userId,
      entityType: 'payment',
      entityId: payment.id,
      metadata: { reference: payment.reference, purpose: payment.purpose, amount: payment.amount, currency: payment.currency, channel: tx.channel },
    });
    if (payment.purpose !== PaymentPurpose.CARD) {
      await notificationService.notify(payment.userId, {
        title: 'Payment successful',
        body: `${payment.description} — ${payment.currency} ${payment.amount.toLocaleString()}`,
        type: NotificationType.BILLING,
        link: '/settings/billing',
      });
      if (payment.beneficiaryId) {
        await notificationService.notify(payment.beneficiaryId, {
          title: payment.purpose === PaymentPurpose.PRO ? 'You now have Pro 🎉' : 'A course was bought for you 🎉',
          body: payment.description,
          type: NotificationType.BILLING,
        });
      }
    } else {
      await notificationService.notify(payment.userId, {
        title: 'Card saved',
        body: `Your card was verified. The ${payment.currency} ${payment.amount} check is being refunded.`,
        type: NotificationType.BILLING,
        link: '/settings/billing',
      });
    }
  },

  async saveAuthorization(userId: string, tx: PaystackTransaction) {
    const a = tx.authorization!;
    const existing = await cards().findOneBy({ userId, signature: a.signature });
    const isFirst = (await cards().countBy({ userId })) === 0;
    const data = {
      userId,
      authorizationCode: a.authorization_code,
      signature: a.signature,
      customerEmail: tx.customer.email,
      brand: (a.card_type || a.brand || 'card').trim().replace(/^\w/, (c) => c.toUpperCase()),
      last4: a.last4,
      bin: a.bin?.slice(0, 6) ?? null,
      expMonth: Number(a.exp_month),
      expYear: Number(a.exp_year),
      bank: a.bank,
      holderName: a.account_name,
    };
    if (existing) await cards().update(existing.id, data);
    else await cards().save(cards().create({ ...data, isDefault: isFirst }));
    await auditService.record('card.saved', { userId, entityType: 'payment_card', metadata: { brand: data.brand, last4: data.last4, updated: !!existing } });
  },

  // ---------------- Webhook ----------------

  /**
   * Paystack webhook. The signature is checked against the raw body before anything is trusted,
   * and charge events are re-verified with the API.
   */
  async handleWebhook(rawBody: Buffer | undefined, signature: string | undefined) {
    if (!paystack.verifySignature(rawBody, signature)) {
      await auditService.record('payment.webhook_rejected', { userId: null, severity: 'critical', metadata: { reason: 'bad signature' } });
      throw ApiError.unauthorized('Invalid signature');
    }
    const event = JSON.parse(rawBody!.toString('utf8')) as { event: string; data: Record<string, unknown> };
    log.info(`Webhook ${event.event}`, { reference: (event.data as { reference?: string }).reference });

    switch (event.event) {
      case 'charge.success': {
        const reference = String(event.data.reference);
        if (!(await payments().existsBy({ reference }))) {
          log.warn('Webhook for a reference we did not create — ignored', { reference });
          return { received: true };
        }
        const tx = await paystack.verify(reference);
        await this.applyTransaction(tx);
        break;
      }
      case 'refund.processed':
      case 'refund.failed':
      case 'refund.pending': {
        const data = event.data as { transaction_reference?: string; transaction?: { reference?: string } };
        const reference = data.transaction_reference ?? data.transaction?.reference;
        if (reference) await this.onRefundEvent(String(reference), event.event);
        break;
      }
      default:
        log.debug(`Webhook ${event.event} not handled`);
    }
    return { received: true };
  },

  // ---------------- Refunds ----------------

  /** Starts a full refund on Paystack. Access is removed when Paystack confirms (refund.processed). */
  async refund(paymentId: string, opts: { by?: string; reason?: string; silent?: boolean } = {}) {
    const p = await payments().findOneBy({ id: paymentId });
    if (!p) throw ApiError.notFound('Payment not found');
    if (p.status !== PaymentStatus.SUCCESS) throw ApiError.badRequest('Only successful payments can be refunded');
    await paystack.refund({
      transaction: p.providerTransactionId ?? p.reference,
      merchant_note: opts.reason ?? 'Refund',
      customer_note: opts.reason === 'Card verification' ? 'Card verification charge returned' : undefined,
    });
    await payments().update(p.id, { status: PaymentStatus.REFUND_PENDING, refundReason: opts.reason ?? null });
    await auditService.record(opts.by ? 'admin.payment.refund' : 'payment.refund_requested', {
      userId: opts.by ?? p.userId,
      entityType: 'payment',
      entityId: p.id,
      severity: opts.by ? 'critical' : 'info',
      metadata: { reference: p.reference, amount: p.amount, reason: opts.reason, payerId: p.userId },
    });
    if (!opts.silent) {
      await notificationService.notify(p.userId, { title: 'Refund started', body: `${p.description} — usually 5–10 working days`, type: NotificationType.BILLING });
    }
    return { ok: true, payment: view(await payments().findOneByOrFail({ id: p.id })) };
  },

  async onRefundEvent(reference: string, event: string) {
    const p = await payments().findOneBy({ reference });
    if (!p) return;
    if (event === 'refund.failed') {
      await payments().update(p.id, { status: PaymentStatus.SUCCESS });
      await auditService.record('payment.refund_failed', { userId: p.userId, entityType: 'payment', entityId: p.id, severity: 'critical', metadata: { reference } });
      return;
    }
    if (event !== 'refund.processed' || p.status === PaymentStatus.REFUNDED) return;
    await payments().update(p.id, { status: PaymentStatus.REFUNDED, refundedAt: new Date() });
    const learnerId = p.beneficiaryId ?? p.userId;
    // Take back what the refund paid for.
    if (p.purpose === PaymentPurpose.COURSE && p.courseId) {
      const res = await repo(Enrollment).delete({ userId: learnerId, courseId: p.courseId });
      if (res.affected) await repo(Course).decrement({ id: p.courseId }, 'enrolledCount', 1);
    } else if (p.purpose === PaymentPurpose.PRO) {
      await repo(User).update(learnerId, { plan: Plan.FREE, proExpiresAt: null });
    }
    await auditService.record('payment.refunded', { userId: p.userId, entityType: 'payment', entityId: p.id, metadata: { reference, purpose: p.purpose } });
    if (p.purpose !== PaymentPurpose.CARD) {
      await notificationService.notify(p.userId, { title: 'Refund completed', body: p.description, type: NotificationType.BILLING });
    }
  },

  // ---------------- History, plan ----------------

  async history(userId: string, q: PageQuery) {
    const [items, total] = await payments().findAndCount({
      where: [{ userId }, { beneficiaryId: userId }],
      order: { createdAt: 'DESC' },
      skip: offset(q),
      take: q.limit,
    });
    return paginate(items.map(view), total, q);
  },

  async cancelPro(userId: string) {
    await repo(User).update(userId, { plan: Plan.FREE, proExpiresAt: null });
    await auditService.record('billing.pro_cancelled', { userId });
    return { ok: true, plan: Plan.FREE };
  },

  /** Background housekeeping (runs every 15 minutes from server.ts). */
  async housekeeping() {
    const expired = await AppDataSource.createQueryBuilder()
      .update(User)
      .set({ plan: Plan.FREE })
      .where('plan = :pro AND "proExpiresAt" IS NOT NULL AND "proExpiresAt" < now()', { pro: Plan.PRO })
      .execute();
    // Checkouts nobody completed within a day are abandoned.
    const stale = await payments().update(
      { status: PaymentStatus.PENDING, createdAt: LessThan(new Date(Date.now() - 86_400_000)) },
      { status: PaymentStatus.ABANDONED },
    );
    if (expired.affected || stale.affected) {
      log.info('Billing housekeeping', { proExpired: expired.affected ?? 0, abandonedPayments: stale.affected ?? 0 });
    }
  },
};
