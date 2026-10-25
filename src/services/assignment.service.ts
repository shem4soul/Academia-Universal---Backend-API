import { In } from 'typeorm';
import { repo } from '../config/database';
import { Assignment, Course, Enrollment, Submission } from '../models';
import { ApiError } from '../utils/ApiError';
import { NotificationType, Role, SubmissionStatus } from '../utils/enums';
import { pageOf, paginate } from '../utils/pagination';
import { publicUser } from '../utils/serialize';
import { notificationService } from './notification.service';
import { userService } from './user.service';

type Q = { page: number; limit: number; courseId?: string; status?: SubmissionStatus };

const assignments = () => repo(Assignment);
const submissions = () => repo(Submission);

/** Status labels in the Figma tables: Completed / In Progress / Late. */
function statusFor(a: Assignment, s?: Submission | null): SubmissionStatus {
  if (s?.status === SubmissionStatus.COMPLETED) {
    return s.submittedAt && s.submittedAt > a.dueDate ? SubmissionStatus.LATE : SubmissionStatus.COMPLETED;
  }
  if (a.dueDate < new Date()) return SubmissionStatus.LATE;
  return s ? SubmissionStatus.IN_PROGRESS : SubmissionStatus.NOT_STARTED;
}

function view(a: Assignment, s?: Submission | null) {
  return {
    id: a.id,
    title: a.title,
    description: a.description,
    dueDate: a.dueDate,
    maxScore: a.maxScore,
    course: { id: a.course.id, title: a.course.title, slug: a.course.slug },
    status: statusFor(a, s),
    submission: s
      ? { id: s.id, content: s.content, attachmentUrl: s.attachmentUrl, score: s.score, feedback: s.feedback, submittedAt: s.submittedAt }
      : null,
  };
}

async function assertOwner(courseId: string, user: Express.AuthUser) {
  const c = await repo(Course).findOneBy({ id: courseId });
  if (!c) throw ApiError.notFound('Course not found');
  if (user.role !== Role.ADMIN && c.instructorId !== user.id) throw ApiError.forbidden('This is not your course');
  return c;
}

export const assignmentService = {
  async forStudent(userId: string, q: Q) {
    const courseIds = (await repo(Enrollment).find({ where: { userId }, select: ['courseId'] })).map((e) => e.courseId);
    if (!courseIds.length) return paginate([], 0, q);
    const all = await assignments().find({
      where: { courseId: q.courseId && courseIds.includes(q.courseId) ? q.courseId : In(courseIds) },
      order: { dueDate: 'ASC' },
    });
    if (!all.length) return paginate([], 0, q);
    const subs = await submissions().findBy({ studentId: userId, assignmentId: In(all.map((a) => a.id)) });
    let rows = all.map((a) => view(a, subs.find((s) => s.assignmentId === a.id)));
    if (q.status) rows = rows.filter((r) => r.status === q.status);
    return pageOf(rows, q);
  },

  /** Teacher "Assessments" table — one row per student submission. */
  async forTeacher(user: Express.AuthUser, q: Q) {
    const where = user.role === Role.ADMIN ? {} : { instructorId: user.id };
    const courseIds = (await repo(Course).find({ where, select: ['id'] })).map((c) => c.id);
    if (!courseIds.length) return { assignments: [], rows: paginate([], 0, q) };
    const list = await assignments().find({
      where: { courseId: q.courseId && courseIds.includes(q.courseId) ? q.courseId : In(courseIds) },
      order: { dueDate: 'DESC' },
    });
    const subs = list.length
      ? await submissions().find({ where: { assignmentId: In(list.map((a) => a.id)) }, relations: { student: true } })
      : [];
    let rows = subs.map((s) => ({ ...view(s.assignment, s), student: publicUser(s.student) }));
    if (q.status) rows = rows.filter((r) => r.status === q.status);
    rows.sort((a, b) => +new Date(b.dueDate) - +new Date(a.dueDate));
    return {
      assignments: list.map((a) => ({ ...view(a), submissions: subs.filter((s) => s.assignmentId === a.id).length })),
      rows: pageOf(rows, q),
    };
  },

  async get(id: string, user: Express.AuthUser) {
    const a = await assignments().findOneBy({ id });
    if (!a) throw ApiError.notFound('Assignment not found');
    if (user.role === Role.STUDENT) {
      if (!(await repo(Enrollment).existsBy({ userId: user.id, courseId: a.courseId }))) throw ApiError.forbidden();
      return view(a, await submissions().findOneBy({ assignmentId: id, studentId: user.id }));
    }
    await assertOwner(a.courseId, user);
    return view(a);
  },

  async create(user: Express.AuthUser, dto: { courseId: string; title: string; description?: string; dueDate: Date; maxScore?: number }) {
    const course = await assertOwner(dto.courseId, user);
    const a = await assignments().save(assignments().create({ ...dto, createdById: user.id }));
    const learners = await repo(Enrollment).find({ where: { courseId: course.id }, select: ['userId'] });
    await notificationService.notifyMany(
      learners.map((e) => e.userId),
      {
        title: `New assignment: ${a.title}`,
        body: `${course.title} · due ${a.dueDate.toDateString()}`,
        type: NotificationType.ASSIGNMENT,
        link: `/assignments/${a.id}`,
      },
    );
    return this.get(a.id, user);
  },

  async update(id: string, user: Express.AuthUser, dto: Partial<Assignment>) {
    const a = await assignments().findOneBy({ id });
    if (!a) throw ApiError.notFound('Assignment not found');
    await assertOwner(a.courseId, user);
    if (dto.courseId && dto.courseId !== a.courseId) await assertOwner(dto.courseId, user);
    await assignments().update(id, dto);
    return this.get(id, user);
  },

  async remove(id: string, user: Express.AuthUser) {
    const a = await assignments().findOneBy({ id });
    if (!a) throw ApiError.notFound('Assignment not found');
    await assertOwner(a.courseId, user);
    await assignments().delete(id);
    return { ok: true };
  },

  async submit(id: string, userId: string, dto: { content?: string; attachmentUrl?: string; status: SubmissionStatus }) {
    const a = await assignments().findOneBy({ id });
    if (!a) throw ApiError.notFound('Assignment not found');
    if (!(await repo(Enrollment).existsBy({ userId, courseId: a.courseId }))) throw ApiError.forbidden('Enrol in the course first');
    const prev = await submissions().findOneBy({ assignmentId: id, studentId: userId });
    if (prev?.status === SubmissionStatus.COMPLETED && prev.score !== null) {
      throw ApiError.conflict('This assignment has already been graded');
    }
    const completing = dto.status === SubmissionStatus.COMPLETED;
    const s = await submissions().save(
      submissions().create({
        ...(prev ?? { assignmentId: id, studentId: userId }),
        content: dto.content ?? prev?.content ?? '',
        attachmentUrl: dto.attachmentUrl ?? prev?.attachmentUrl ?? null,
        status: completing ? SubmissionStatus.COMPLETED : SubmissionStatus.IN_PROGRESS,
        submittedAt: completing ? new Date() : (prev?.submittedAt ?? null),
      }),
    );
    if (completing && prev?.status !== SubmissionStatus.COMPLETED) {
      await userService.addPoints(userId, a.dueDate >= new Date() ? 20 : 5);
      await userService.logActivity(userId, 0, a.courseId, 1);
      const course = await repo(Course).findOneByOrFail({ id: a.courseId });
      await notificationService.notify(course.instructorId, {
        title: 'New submission',
        body: `${a.title} — ${course.title}`,
        type: NotificationType.ASSIGNMENT,
        link: '/teacher/assignments',
      });
    }
    return view(a, s);
  },

  async grade(submissionId: string, user: Express.AuthUser, score: number, feedback?: string) {
    const s = await submissions().findOneBy({ id: submissionId });
    if (!s) throw ApiError.notFound('Submission not found');
    await assertOwner(s.assignment.courseId, user);
    if (score > s.assignment.maxScore) throw ApiError.badRequest(`Score can't exceed ${s.assignment.maxScore}`);
    await submissions().update(s.id, { score, feedback: feedback ?? null });
    await notificationService.notify(s.studentId, {
      title: `Graded: ${s.assignment.title}`,
      body: `You scored ${score}/${s.assignment.maxScore}`,
      type: NotificationType.ASSIGNMENT,
      link: `/assignments/${s.assignmentId}`,
    });
    return { ok: true };
  },
};
