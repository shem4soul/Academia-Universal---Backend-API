import { randomBytes } from 'crypto';
import { Brackets, In, Not } from 'typeorm';
import { repo } from '../config/database';
import {
  Bookmark,
  Category,
  Course,
  CourseModule,
  Enrollment,
  Follow,
  Lesson,
  LessonProgress,
  Payment,
  Review,
} from '../models';
import { ApiError } from '../utils/ApiError';
import { EnrollmentStatus, LessonType, NotificationType, PaymentStatus, Role } from '../utils/enums';
import { offset, paginate, PageQuery } from '../utils/pagination';
import { publicUser, slugify, UUID_RE } from '../utils/serialize';
import { CourseQuery, CreateCourseInput, LessonInput, UpdateCourseInput } from '../validators/course.validator';
import { notificationService } from './notification.service';
import { userService } from './user.service';

type Viewer = Express.AuthUser | undefined;

const POINTS_PER_LESSON = 10;
const POINTS_PER_COURSE = 100;

const courses = () => repo(Course);
const enrollments = () => repo(Enrollment);
const lessons = () => repo(Lesson);
const modules = () => repo(CourseModule);

/** Course card as used across the web and mobile lists. */
export function courseCard(c: Course, extra: Record<string, unknown> = {}) {
  return {
    id: c.id,
    slug: c.slug,
    title: c.title,
    subtitle: c.subtitle,
    thumbnailUrl: c.thumbnailUrl,
    category: c.category ? { id: c.category.id, name: c.category.name, slug: c.category.slug } : null,
    instructor: publicUser(c.instructor),
    level: c.level,
    price: c.price,
    currency: c.currency,
    durationWeeks: c.durationWeeks,
    mode: c.mode,
    rating: c.rating,
    ratingCount: c.ratingCount,
    enrolledCount: c.enrolledCount,
    lessonCount: c.lessonCount,
    videoCount: c.videoCount,
    isPublished: c.isPublished,
    createdAt: c.createdAt,
    ...extra,
  };
}

async function findCourse(idOrSlug: string) {
  const course = await courses().findOne({
    where: UUID_RE.test(idOrSlug) ? { id: idOrSlug } : { slug: idOrSlug },
    relations: { instructor: true, category: true },
  });
  if (!course) throw ApiError.notFound('Course not found');
  return course;
}

const canManage = (course: Course, user: Viewer) => !!user && (user.role === Role.ADMIN || course.instructorId === user.id);

async function owned(idOrSlug: string, user: Express.AuthUser) {
  const course = await findCourse(idOrSlug);
  if (!canManage(course, user)) throw ApiError.forbidden('You can only edit your own courses');
  return course;
}

async function ownedModule(moduleId: string, user: Express.AuthUser) {
  const m = await modules().findOneBy({ id: moduleId });
  if (!m) throw ApiError.notFound('Section not found');
  await owned(m.courseId, user);
  return m;
}

async function recount(courseId: string) {
  const [lessonCount, videoCount] = await Promise.all([
    lessons().countBy({ courseId }),
    lessons().countBy({ courseId, type: LessonType.VIDEO }),
  ]);
  await courses().update(courseId, { lessonCount, videoCount });
}

async function recalcRating(courseId: string) {
  const r = await repo(Review)
    .createQueryBuilder('r')
    .select('AVG(r.rating)', 'avg')
    .addSelect('COUNT(*)', 'n')
    .where('r.courseId = :courseId', { courseId })
    .getRawOne<{ avg: string | null; n: string }>();
  await courses().update(courseId, {
    rating: r?.avg ? Math.round(Number(r.avg) * 100) / 100 : 0,
    ratingCount: Number(r?.n ?? 0),
  });
}

export const courseService = {
  findCourse,

  listCategories() {
    return repo(Category).find({ order: { name: 'ASC' } });
  },

  async list(q: CourseQuery) {
    const qb = courses()
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.category', 'cat')
      .leftJoinAndSelect('c.instructor', 'i')
      .where('c.isPublished = true');
    if (q.q) {
      const term = q.q;
      qb.andWhere(
        new Brackets((w) =>
          w
            .where('c.title ILIKE :q', { q: `%${term}%` })
            .orWhere('c.subtitle ILIKE :q', { q: `%${term}%` })
            .orWhere(':tag = ANY(c.tags)', { tag: term.toLowerCase() })
            .orWhere("(i.firstName || ' ' || i.lastName) ILIKE :q", { q: `%${term}%` }),
        ),
      );
    }
    if (q.category) qb.andWhere(UUID_RE.test(q.category) ? 'cat.id = :cat' : 'cat.slug = :cat', { cat: q.category });
    if (q.level) qb.andWhere('c.level = :level', { level: q.level });
    if (q.price === 'free') qb.andWhere('c.price = 0');
    if (q.price === 'paid') qb.andWhere('c.price > 0');
    if (q.mode) qb.andWhere('c.mode = :mode', { mode: q.mode });
    if (q.minRating) qb.andWhere('c.rating >= :r', { r: q.minRating });
    if (q.instructorId) qb.andWhere('c.instructorId = :iid', { iid: q.instructorId });
    const order = {
      newest: ['c.createdAt', 'DESC'],
      rating: ['c.rating', 'DESC'],
      price_asc: ['c.price', 'ASC'],
      price_desc: ['c.price', 'DESC'],
      popular: ['c.enrolledCount', 'DESC'],
    } as const;
    const [col, dir] = order[q.sort];
    qb.orderBy(col, dir).addOrderBy('c.rating', 'DESC');
    const [items, total] = await qb.skip(offset(q)).take(q.limit).getManyAndCount();
    return paginate(items.map((c) => courseCard(c)), total, q);
  },

  async detail(idOrSlug: string, user: Viewer) {
    const course = await findCourse(idOrSlug);
    if (!course.isPublished && !canManage(course, user)) throw ApiError.notFound('Course not found');
    const mods = await modules().find({
      where: { courseId: course.id },
      order: { position: 'ASC', lessons: { position: 'ASC' } },
      relations: { lessons: true },
    });
    let enrollment: Enrollment | null = null;
    let completed: string[] = [];
    let bookmarked = false;
    let myReview: Review | null = null;
    if (user) {
      [enrollment, bookmarked, myReview] = await Promise.all([
        enrollments().findOneBy({ userId: user.id, courseId: course.id }),
        repo(Bookmark).existsBy({ userId: user.id, courseId: course.id }),
        repo(Review).findOneBy({ userId: user.id, courseId: course.id }),
      ]);
      if (enrollment) completed = (await repo(LessonProgress).findBy({ enrollmentId: enrollment.id })).map((p) => p.lessonId);
    }
    const breakdown = await repo(Review)
      .createQueryBuilder('r')
      .select('r.rating', 'rating')
      .addSelect('COUNT(*)', 'count')
      .where('r.courseId = :id', { id: course.id })
      .groupBy('r.rating')
      .getRawMany<{ rating: number; count: string }>();
    const unlocked = !!enrollment || canManage(course, user);
    return {
      ...courseCard(course),
      description: course.description,
      previewVideoUrl: course.previewVideoUrl,
      tags: course.tags,
      outcomes: course.outcomes,
      instructor: { ...publicUser(course.instructor), bio: course.instructor.bio },
      modules: mods.map((m) => ({
        id: m.id,
        title: m.title,
        position: m.position,
        lessons: m.lessons.map((l) => ({
          id: l.id,
          title: l.title,
          type: l.type,
          durationMinutes: l.durationMinutes,
          position: l.position,
          isPreview: l.isPreview,
          locked: !unlocked && !l.isPreview,
          completed: completed.includes(l.id),
        })),
      })),
      ratingBreakdown: [5, 4, 3, 2, 1].map((rating) => ({
        rating,
        count: Number(breakdown.find((b) => Number(b.rating) === rating)?.count ?? 0),
      })),
      enrollment: enrollment
        ? {
            id: enrollment.id,
            status: enrollment.status,
            progressPercent: enrollment.progressPercent,
            lastLessonId: enrollment.lastLessonId,
            certificateCode: enrollment.certificateCode,
          }
        : null,
      bookmarked,
      myReview: myReview ? { rating: myReview.rating, comment: myReview.comment } : null,
      canManage: canManage(course, user),
    };
  },

  async related(idOrSlug: string, limit = 8) {
    const course = await findCourse(idOrSlug);
    const items = await courses().find({
      where: { isPublished: true, id: Not(course.id), ...(course.categoryId ? { categoryId: course.categoryId } : {}) },
      relations: { instructor: true, category: true },
      order: { rating: 'DESC' },
      take: limit,
    });
    return items.map((c) => courseCard(c));
  },

  /** Courses in the categories the learner studies, topped up with the most popular. */
  async recommended(userId: string, limit = 8) {
    const mine = await enrollments().find({ where: { userId }, relations: { course: true } });
    const exclude = mine.map((e) => e.courseId);
    const cats = [...new Set(mine.map((e) => e.course.categoryId).filter(Boolean))] as string[];
    const rel = { instructor: true, category: true };
    let items = cats.length
      ? await courses().find({
          where: { isPublished: true, categoryId: In(cats), ...(exclude.length ? { id: Not(In(exclude)) } : {}) },
          relations: rel,
          order: { rating: 'DESC' },
          take: limit,
        })
      : [];
    if (items.length < limit) {
      const skipIds = [...exclude, ...items.map((i) => i.id)];
      items = items.concat(
        await courses().find({
          where: { isPublished: true, ...(skipIds.length ? { id: Not(In(skipIds)) } : {}) },
          relations: rel,
          order: { enrolledCount: 'DESC' },
          take: limit - items.length,
        }),
      );
    }
    return items.map((c) => courseCard(c));
  },

  // ---------- Learner ----------

  async myEnrollments(userId: string, q: PageQuery & { status?: EnrollmentStatus }) {
    const [rows, total] = await enrollments().findAndCount({
      where: { userId, ...(q.status ? { status: q.status } : {}) },
      relations: { course: { instructor: true, category: true } },
      order: { lastAccessedAt: { direction: 'DESC', nulls: 'LAST' }, createdAt: 'DESC' },
      skip: offset(q),
      take: q.limit,
    });
    const ids = rows.map((r) => r.courseId);
    const counts = ids.length
      ? await enrollments()
          .createQueryBuilder('e')
          .select('e.courseId', 'courseId')
          .addSelect('COUNT(*)', 'n')
          .where('e.courseId IN (:...ids)', { ids })
          .groupBy('e.courseId')
          .getRawMany<{ courseId: string; n: string }>()
      : [];
    return paginate(
      rows.map((e) =>
        courseCard(e.course, {
          enrollment: {
            id: e.id,
            status: e.status,
            progressPercent: e.progressPercent,
            lastLessonId: e.lastLessonId,
            lastAccessedAt: e.lastAccessedAt,
            completedAt: e.completedAt,
            certificateCode: e.certificateCode,
            pointsEarned: e.pointsEarned,
          },
          classmates: Math.max(0, Number(counts.find((c) => c.courseId === e.courseId)?.n ?? 1) - 1),
        }),
      ),
      total,
      q,
    );
  },

  async enroll(userId: string, idOrSlug: string) {
    const course = await findCourse(idOrSlug);
    if (!course.isPublished) throw ApiError.badRequest('This course is not open for enrolment yet');
    const existing = await enrollments().findOneBy({ userId, courseId: course.id });
    if (existing) return { enrolled: true, enrollmentId: existing.id, alreadyEnrolled: true };
    if (course.price > 0) {
      // Paid by the learner, or by a parent on the learner's behalf.
      const paid = await repo(Payment).exists({
        where: [
          { userId, courseId: course.id, status: PaymentStatus.SUCCESS },
          { beneficiaryId: userId, courseId: course.id, status: PaymentStatus.SUCCESS },
        ],
      });
      if (!paid) throw ApiError.paymentRequired('Payment required', { price: course.price, currency: course.currency });
    }
    return this.createEnrollment(userId, course);
  },

  /** Also called by the billing service after a successful course payment. */
  async createEnrollment(userId: string, course: Course) {
    const existing = await enrollments().findOneBy({ userId, courseId: course.id });
    if (existing) return { enrolled: true, enrollmentId: existing.id, alreadyEnrolled: true };
    const e = await enrollments().save(enrollments().create({ userId, courseId: course.id, lastAccessedAt: new Date() }));
    await courses().increment({ id: course.id }, 'enrolledCount', 1);
    await notificationService.notify(userId, {
      title: `You're enrolled in ${course.title}`,
      body: 'Jump in whenever you are ready.',
      type: NotificationType.COURSE,
      link: `/courses/${course.slug}/learn`,
    });
    await notificationService.notify(course.instructorId, {
      title: 'New student enrolled',
      body: `A new learner joined ${course.title}.`,
      type: NotificationType.COURSE,
      link: `/teacher/courses/${course.id}`,
    });
    return { enrolled: true, enrollmentId: e.id, alreadyEnrolled: false };
  },

  async unenroll(userId: string, idOrSlug: string) {
    const course = await findCourse(idOrSlug);
    const res = await enrollments().delete({ userId, courseId: course.id });
    if (res.affected) await courses().decrement({ id: course.id }, 'enrolledCount', 1);
    return { ok: true };
  },

  async getLesson(lessonId: string, user: Express.AuthUser) {
    const lesson = await lessons().findOne({ where: { id: lessonId }, relations: { module: true } });
    if (!lesson) throw ApiError.notFound('Lesson not found');
    const course = await courses().findOneByOrFail({ id: lesson.courseId });
    const enrollment = await enrollments().findOneBy({ userId: user.id, courseId: course.id });
    if (!lesson.isPreview && !enrollment && !canManage(course, user)) {
      throw ApiError.forbidden('Enrol in this course to open its lessons');
    }
    if (enrollment) {
      enrollment.lastLessonId = lesson.id;
      enrollment.lastAccessedAt = new Date();
      await enrollments().save(enrollment);
    }
    const ordered = await lessons()
      .createQueryBuilder('l')
      .innerJoin('l.module', 'm')
      .where('l.courseId = :cid', { cid: course.id })
      .orderBy('m.position', 'ASC')
      .addOrderBy('l.position', 'ASC')
      .select(['l.id'])
      .getMany();
    const idx = ordered.findIndex((l) => l.id === lesson.id);
    const completed = enrollment ? await repo(LessonProgress).existsBy({ enrollmentId: enrollment.id, lessonId }) : false;
    return {
      ...lesson,
      module: { id: lesson.module.id, title: lesson.module.title },
      course: { id: course.id, slug: course.slug, title: course.title },
      completed,
      prevLessonId: ordered[idx - 1]?.id ?? null,
      nextLessonId: ordered[idx + 1]?.id ?? null,
    };
  },

  /** "Mark as complete": updates progress, awards points, issues a certificate at 100%. */
  async completeLesson(userId: string, lessonId: string, minutesSpent?: number) {
    const lesson = await lessons().findOneBy({ id: lessonId });
    if (!lesson) throw ApiError.notFound('Lesson not found');
    const enrollment = await enrollments().findOne({ where: { userId, courseId: lesson.courseId }, relations: { course: true } });
    if (!enrollment) throw ApiError.forbidden('Enrol in this course first');

    const progress = repo(LessonProgress);
    let pointsAwarded = 0;
    if (!(await progress.existsBy({ enrollmentId: enrollment.id, lessonId }))) {
      await progress.save(progress.create({ enrollmentId: enrollment.id, lessonId, completedAt: new Date() }));
      pointsAwarded += POINTS_PER_LESSON;
    }
    const [total, done] = await Promise.all([
      lessons().countBy({ courseId: lesson.courseId }),
      progress.countBy({ enrollmentId: enrollment.id }),
    ]);
    enrollment.progressPercent = total ? Math.round((done / total) * 100) : 0;
    enrollment.lastLessonId = lessonId;
    enrollment.lastAccessedAt = new Date();

    let courseCompleted = false;
    if (enrollment.progressPercent >= 100 && enrollment.status !== EnrollmentStatus.COMPLETED) {
      enrollment.status = EnrollmentStatus.COMPLETED;
      enrollment.completedAt = new Date();
      enrollment.certificateCode = `AU-${randomBytes(4).toString('hex').toUpperCase()}`;
      pointsAwarded += POINTS_PER_COURSE;
      courseCompleted = true;
      await notificationService.notify(userId, {
        title: 'Course completed 🎉',
        body: `You finished ${enrollment.course.title}. Your certificate is ready.`,
        type: NotificationType.COURSE,
        link: `/courses/${enrollment.course.slug}/certificate`,
      });
    }
    enrollment.pointsEarned += pointsAwarded;
    await enrollments().save(enrollment);
    await userService.addPoints(userId, pointsAwarded);
    await userService.logActivity(userId, minutesSpent ?? lesson.durationMinutes, lesson.courseId, lesson.type === LessonType.QUIZ ? 1 : 0);
    return {
      progressPercent: enrollment.progressPercent,
      status: enrollment.status,
      pointsAwarded,
      courseCompleted,
      certificateCode: enrollment.certificateCode,
    };
  },

  async heartbeat(userId: string, minutes: number, lessonId?: string) {
    const courseId = lessonId ? ((await lessons().findOneBy({ id: lessonId }))?.courseId ?? null) : null;
    await userService.logActivity(userId, minutes, courseId);
    return { ok: true };
  },

  async certificate(userId: string, idOrSlug: string) {
    const course = await findCourse(idOrSlug);
    const e = await enrollments().findOne({ where: { userId, courseId: course.id }, relations: { user: true } });
    if (!e || e.status !== EnrollmentStatus.COMPLETED) throw ApiError.notFound('Complete the course to get a certificate');
    return {
      code: e.certificateCode,
      issuedAt: e.completedAt,
      learner: [e.user.firstName, e.user.middleName, e.user.lastName].filter(Boolean).join(' '),
      course: { id: course.id, slug: course.slug, title: course.title, durationWeeks: course.durationWeeks },
      instructor: publicUser(course.instructor),
    };
  },

  async verifyCertificate(code: string) {
    const e = await enrollments().findOne({ where: { certificateCode: code }, relations: { user: true, course: true } });
    if (!e) throw ApiError.notFound('Certificate not found');
    return {
      valid: true,
      code,
      issuedAt: e.completedAt,
      learner: [e.user.firstName, e.user.lastName].join(' '),
      course: e.course.title,
    };
  },

  // ---------- Reviews & bookmarks ----------

  async listReviews(idOrSlug: string, q: PageQuery) {
    const course = await findCourse(idOrSlug);
    const [items, total] = await repo(Review).findAndCount({
      where: { courseId: course.id },
      order: { createdAt: 'DESC' },
      skip: offset(q),
      take: q.limit,
    });
    return paginate(
      items.map((r) => ({ id: r.id, rating: r.rating, comment: r.comment, createdAt: r.createdAt, user: publicUser(r.user) })),
      total,
      q,
    );
  },

  async review(userId: string, idOrSlug: string, rating: number, comment = '') {
    const course = await findCourse(idOrSlug);
    if (!(await enrollments().existsBy({ userId, courseId: course.id }))) {
      throw ApiError.forbidden('Only enrolled learners can rate this course');
    }
    await repo(Review).upsert({ userId, courseId: course.id, rating, comment }, ['userId', 'courseId']);
    await recalcRating(course.id);
    return { ok: true };
  },

  async bookmark(userId: string, idOrSlug: string, on: boolean) {
    const course = await findCourse(idOrSlug);
    if (on) await repo(Bookmark).upsert({ userId, courseId: course.id }, ['userId', 'courseId']);
    else await repo(Bookmark).delete({ userId, courseId: course.id });
    return { bookmarked: on };
  },

  async myBookmarks(userId: string) {
    const rows = await repo(Bookmark).find({
      where: { userId },
      relations: { course: { instructor: true, category: true } },
      order: { createdAt: 'DESC' },
    });
    return rows.map((b) => courseCard(b.course));
  },

  // ---------- Instructor ----------

  async teaching(user: Express.AuthUser) {
    const items = await courses().find({
      where: user.role === Role.ADMIN ? {} : { instructorId: user.id },
      relations: { instructor: true, category: true },
      order: { createdAt: 'DESC' },
    });
    return items.map((c) => courseCard(c));
  },

  async create(user: Express.AuthUser, dto: CreateCourseInput) {
    let slug = slugify(dto.title) || 'course';
    if (await courses().existsBy({ slug })) slug = `${slug}-${randomBytes(3).toString('hex')}`;
    const course = await courses().save(courses().create({ ...dto, slug, instructorId: user.id, isPublished: false }));
    return this.detail(course.id, user);
  },

  async update(idOrSlug: string, user: Express.AuthUser, dto: UpdateCourseInput) {
    const course = await owned(idOrSlug, user);
    const wasPublished = course.isPublished;
    if (dto.isPublished && !wasPublished && course.lessonCount === 0) {
      throw ApiError.badRequest('Add at least one lesson before publishing');
    }
    await courses().update(course.id, dto);
    if (dto.isPublished && !wasPublished) {
      const followers = await repo(Follow).find({ where: { followingId: course.instructorId }, select: ['followerId'] });
      await notificationService.notifyMany(
        followers.map((f) => f.followerId),
        { title: 'New course available', body: course.title, type: NotificationType.COURSE, link: `/courses/${course.slug}` },
      );
    }
    return this.detail(course.id, user);
  },

  async remove(idOrSlug: string, user: Express.AuthUser) {
    const course = await owned(idOrSlug, user);
    if (course.enrolledCount > 0 && user.role !== Role.ADMIN) {
      throw ApiError.conflict('This course has learners. Unpublish it instead of deleting it.');
    }
    await courses().delete(course.id);
    return { ok: true };
  },

  async addModule(idOrSlug: string, user: Express.AuthUser, title: string, position?: number) {
    const course = await owned(idOrSlug, user);
    const pos = position ?? (await modules().countBy({ courseId: course.id }));
    return modules().save(modules().create({ courseId: course.id, title, position: pos }));
  },

  async updateModule(moduleId: string, user: Express.AuthUser, data: { title: string; position?: number }) {
    const m = await ownedModule(moduleId, user);
    Object.assign(m, data);
    return modules().save(m);
  },

  async removeModule(moduleId: string, user: Express.AuthUser) {
    const m = await ownedModule(moduleId, user);
    await modules().delete(m.id);
    await recount(m.courseId);
    return { ok: true };
  },

  async addLesson(moduleId: string, user: Express.AuthUser, dto: LessonInput) {
    const m = await ownedModule(moduleId, user);
    const position = dto.position ?? (await lessons().countBy({ moduleId }));
    const lesson = await lessons().save(lessons().create({ ...dto, moduleId, courseId: m.courseId, position }));
    await recount(m.courseId);
    return lesson;
  },

  async updateLesson(lessonId: string, user: Express.AuthUser, dto: Partial<LessonInput>) {
    const lesson = await lessons().findOneBy({ id: lessonId });
    if (!lesson) throw ApiError.notFound('Lesson not found');
    await owned(lesson.courseId, user);
    Object.assign(lesson, dto);
    await lessons().save(lesson);
    await recount(lesson.courseId);
    return lesson;
  },

  async removeLesson(lessonId: string, user: Express.AuthUser) {
    const lesson = await lessons().findOneBy({ id: lessonId });
    if (!lesson) throw ApiError.notFound('Lesson not found');
    await owned(lesson.courseId, user);
    await lessons().delete(lesson.id);
    await recount(lesson.courseId);
    return { ok: true };
  },

  async students(idOrSlug: string, user: Express.AuthUser) {
    const course = await owned(idOrSlug, user);
    const rows = await enrollments().find({ where: { courseId: course.id }, relations: { user: true }, order: { progressPercent: 'DESC' } });
    return rows.map((e) => ({
      ...publicUser(e.user),
      enrollment: {
        status: e.status,
        progressPercent: e.progressPercent,
        lastAccessedAt: e.lastAccessedAt,
        pointsEarned: e.pointsEarned,
        enrolledAt: e.createdAt,
      },
    }));
  },
};

