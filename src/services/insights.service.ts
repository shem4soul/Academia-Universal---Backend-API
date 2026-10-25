import { In, MoreThanOrEqual } from 'typeorm';
import { repo } from '../config/database';
import {
  ActivityLog,
  Announcement,
  Course,
  Enrollment,
  ParentChild,
  Payment,
  Submission,
  TeacherVerification,
  User,
} from '../models';
import { ApiError } from '../utils/ApiError';
import { AccountStatus, EnrollmentStatus, levelFor, PaymentStatus, Role, VerificationStatus } from '../utils/enums';
import { pageOf } from '../utils/pagination';
import { isoDate, publicUser } from '../utils/serialize';
import { assignmentService } from './assignment.service';
import { communityService } from './community.service';
import { courseCard } from './course.service';
import { plannerService } from './planner.service';

const DAY = 86_400_000;

/** Minutes per day for the last `days` days, oldest first (Activity Hours / Working hours chart). */
async function activitySeries(userIds: string[], days = 7) {
  if (!userIds.length) return [];
  const start = new Date(Date.now() - (days - 1) * DAY);
  const rows = await repo(ActivityLog)
    .createQueryBuilder('a')
    .select(`to_char(a.date, 'YYYY-MM-DD')`, 'date')
    .addSelect('SUM(a.minutes)', 'minutes')
    .addSelect('SUM(a.testsDone)', 'tests')
    .addSelect('COUNT(DISTINCT a.courseId)', 'courses')
    .where('a.userId IN (:...ids)', { ids: userIds })
    .andWhere('a.date >= :start', { start: isoDate(start) })
    .groupBy('1')
    .getRawMany<{ date: string; minutes: string; tests: string; courses: string }>();
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(start.getTime() + i * DAY);
    const key = isoDate(d);
    const r = rows.find((x) => x.date === key);
    return {
      date: key,
      day: d.toLocaleDateString('en-US', { weekday: 'short' }),
      minutes: Number(r?.minutes ?? 0),
      hours: Math.round((Number(r?.minutes ?? 0) / 60) * 10) / 10,
      testsDone: Number(r?.tests ?? 0),
    };
  });
}

async function activitySummary(userId: string, days = 7) {
  const series = await activitySeries([userId], days);
  const courses = await repo(ActivityLog)
    .createQueryBuilder('a')
    .select('COUNT(DISTINCT a.courseId)', 'n')
    .where('a.userId = :userId AND a.date >= :start AND a.courseId IS NOT NULL', {
      userId,
      start: series[0]?.date ?? isoDate(),
    })
    .getRawOne<{ n: string }>();
  return {
    series,
    timeSpentHours: Math.round((series.reduce((s, d) => s + d.minutes, 0) / 60) * 10) / 10,
    courses: Number(courses?.n ?? 0),
    testsDone: series.reduce((s, d) => s + d.testsDone, 0),
  };
}

async function rankOf(points: number) {
  return (
    (await repo(User)
      .createQueryBuilder('u')
      .where('u.role = :role AND u.points > :points', { role: Role.STUDENT, points })
      .andWhere(`(u.settings->'privacy'->>'showOnLeaderboard')::boolean IS NOT FALSE`)
      .getCount()) + 1
  );
}

async function courseCounts(userId: string) {
  const [enrolled, ongoing, completed] = await Promise.all([
    repo(Enrollment).countBy({ userId }),
    repo(Enrollment).countBy({ userId, status: EnrollmentStatus.ONGOING }),
    repo(Enrollment).countBy({ userId, status: EnrollmentStatus.COMPLETED }),
  ]);
  return { enrolled, ongoing, completed };
}

/** Progress tracker cards: ongoing courses with instructor, classmates and points. */
async function progressCards(userId: string, limit?: number, status?: EnrollmentStatus) {
  const rows = await repo(Enrollment).find({
    where: { userId, ...(status ? { status } : {}) },
    relations: { course: { instructor: true, category: true } },
    // Postgres orders enums by declaration (ongoing, completed), so ASC lists ongoing courses first.
    order: { status: 'ASC', lastAccessedAt: { direction: 'DESC', nulls: 'LAST' } },
    take: limit,
  });
  const ids = rows.map((r) => r.courseId);
  const classmates = ids.length
    ? await repo(Enrollment)
        .createQueryBuilder('e')
        .leftJoin('e.user', 'u')
        .select('e.courseId', 'courseId')
        .addSelect('COUNT(*)', 'n')
        .addSelect('(ARRAY_AGG(u."avatarUrl" ORDER BY u.points DESC))[1:3]', 'avatars')
        .where('e.courseId IN (:...ids)', { ids })
        .groupBy('e.courseId')
        .getRawMany<{ courseId: string; n: string; avatars: (string | null)[] }>()
    : [];
  return rows.map((e) => {
    const c = classmates.find((x) => x.courseId === e.courseId);
    return {
      ...courseCard(e.course),
      enrollment: {
        id: e.id,
        status: e.status,
        progressPercent: e.progressPercent,
        lastAccessedAt: e.lastAccessedAt,
        lastLessonId: e.lastLessonId,
        pointsEarned: e.pointsEarned,
        certificateCode: e.certificateCode,
      },
      classmates: Math.max(0, Number(c?.n ?? 1) - 1),
      classmateAvatars: (c?.avatars ?? []).filter(Boolean),
    };
  });
}

export const insightsService = {
  activitySeries,
  progressCards,

  async studentDashboard(userId: string) {
    const user = await repo(User).findOneByOrFail({ id: userId });
    const [counts, activity, rank, progress, communities, assignments, upcoming] = await Promise.all([
      courseCounts(userId),
      activitySummary(userId, 7),
      rankOf(user.points),
      progressCards(userId, 4, EnrollmentStatus.ONGOING),
      communityService.list(userId, { page: 1, limit: 6, scope: 'mine' }),
      assignmentService.forStudent(userId, { page: 1, limit: 5 }),
      plannerService.upcoming(userId, 3),
    ]);
    return {
      user: { ...publicUser(user), streakDays: user.streakDays, dailyTargetHours: user.settings.dailyTargetHours },
      isNewStudent: counts.enrolled === 0,
      overview: counts,
      activity,
      points: { total: user.points, level: levelFor(user.points), rank },
      progress,
      communities: communities.items,
      assignments: assignments.items,
      planner: { today: isoDate(), upcoming },
    };
  },

  async progress(userId: string) {
    return progressCards(userId);
  },

  async leaderboard(viewerId: string, q: { page: number; limit: number; courseId?: string }) {
    const qb = repo(User)
      .createQueryBuilder('u')
      .where('u.role = :role', { role: Role.STUDENT })
      .andWhere('u.status = :status', { status: AccountStatus.ACTIVE })
      .andWhere(`(u.settings->'privacy'->>'showOnLeaderboard')::boolean IS NOT FALSE`);
    if (q.courseId) {
      qb.innerJoin(Enrollment, 'e', 'e.userId = u.id AND e.courseId = :cid', { cid: q.courseId });
    }
    const all = await qb.orderBy('u.points', 'DESC').addOrderBy('u.createdAt', 'ASC').getMany();
    const ranked = all.map((u, i) => ({ rank: i + 1, ...publicUser(u)!, isMe: u.id === viewerId }));
    const me = ranked.find((r) => r.isMe) ?? null;
    return { ...pageOf(ranked, q), me };
  },

  // ---------- Teacher ----------

  async teacherDashboard(user: Express.AuthUser) {
    const courses = await repo(Course).find({ where: user.role === Role.ADMIN ? {} : { instructorId: user.id } });
    const ids = courses.map((c) => c.id);
    const enrollments = ids.length ? await repo(Enrollment).find({ where: { courseId: In(ids) }, relations: { user: true } }) : [];
    const studentIds = [...new Set(enrollments.map((e) => e.userId))];
    const rated = courses.filter((c) => c.ratingCount > 0);
    const rating = rated.length ? rated.reduce((s, c) => s + c.rating, 0) / rated.length : 0;
    const [working, assessments, announcements, analytics] = await Promise.all([
      activitySummary(user.id, 7),
      assignmentService.forTeacher(user, { page: 1, limit: 5 }),
      repo(Announcement).find({ where: { authorId: user.id }, order: { createdAt: 'DESC' }, take: 6 }),
      this.studentAnalytics(user, { page: 1, limit: 6 }),
    ]);
    return {
      overview: {
        registeredStudents: studentIds.length,
        uploadedCourses: courses.length,
        publishedCourses: courses.filter((c) => c.isPublished).length,
        completedCourses: enrollments.filter((e) => e.status === EnrollmentStatus.COMPLETED).length,
      },
      workingHours: { ...working, students: studentIds.length },
      rating: {
        average: Math.round(rating * 100) / 100,
        label: rating >= 4.5 ? 'Expert' : rating >= 4 ? 'Proficient' : rating >= 3 ? 'Intermediate' : rating > 0 ? 'Developing' : 'Not rated yet',
        reviews: courses.reduce((s, c) => s + c.ratingCount, 0),
      },
      announcements,
      studentAnalytics: analytics.items,
      assessments: assessments.rows.items,
    };
  },

  /** Teacher "Student Analytics": every learner across my courses, with progress and average score. */
  async studentAnalytics(user: Express.AuthUser, q: { page: number; limit: number; q?: string }) {
    const courseIds = (await repo(Course).find({ where: user.role === Role.ADMIN ? {} : { instructorId: user.id }, select: ['id'] })).map((c) => c.id);
    if (!courseIds.length) return pageOf([], q);
    const enrollments = await repo(Enrollment).find({ where: { courseId: In(courseIds) }, relations: { user: true, course: true } });
    const scores = await repo(Submission)
      .createQueryBuilder('s')
      .innerJoin('s.assignment', 'a')
      .select('s.studentId', 'studentId')
      .addSelect('AVG(s.score::float / a.maxScore * 5)', 'avg')
      .where('a.courseId IN (:...ids) AND s.score IS NOT NULL', { ids: courseIds })
      .groupBy('s.studentId')
      .getRawMany<{ studentId: string; avg: string }>();
    const byStudent = new Map<string, { user: User; courses: { id: string; title: string; progressPercent: number; status: string }[] }>();
    for (const e of enrollments) {
      const entry = byStudent.get(e.userId) ?? { user: e.user, courses: [] };
      entry.courses.push({ id: e.courseId, title: e.course.title, progressPercent: e.progressPercent, status: e.status });
      byStudent.set(e.userId, entry);
    }
    let rows = [...byStudent.values()].map(({ user: u, courses }) => {
      const avg = scores.find((s) => s.studentId === u.id)?.avg;
      return {
        ...publicUser(u)!,
        averageScore: avg ? Math.round(Number(avg) * 10) / 10 : null,
        averageProgress: Math.round(courses.reduce((s, c) => s + c.progressPercent, 0) / courses.length),
        courses,
      };
    });
    if (q.q) rows = rows.filter((r) => r.fullName.toLowerCase().includes(q.q!.toLowerCase()));
    rows.sort((a, b) => (b.averageScore ?? 0) - (a.averageScore ?? 0) || b.averageProgress - a.averageProgress);
    return pageOf(rows, q);
  },

  /** "student analytics_personal": one learner, limited to the viewer's courses for teachers. */
  async studentDetail(viewer: Express.AuthUser, studentId: string) {
    const student = await repo(User).findOneBy({ id: studentId });
    if (!student || student.role !== Role.STUDENT) throw ApiError.notFound('Student not found');
    let courseFilter: string[] | null = null;
    if (viewer.role === Role.TEACHER) {
      courseFilter = (await repo(Course).find({ where: { instructorId: viewer.id }, select: ['id'] })).map((c) => c.id);
      const shared = courseFilter.length ? await repo(Enrollment).existsBy({ userId: studentId, courseId: In(courseFilter) }) : false;
      if (!shared) throw ApiError.forbidden('This learner is not in any of your courses');
    } else if (viewer.role === Role.PARENT) {
      const linked = await repo(ParentChild).existsBy({ parentId: viewer.id, childId: studentId });
      if (!linked) throw ApiError.forbidden('This learner is not linked to your account');
    } else if (viewer.role === Role.STUDENT && viewer.id !== studentId) {
      throw ApiError.forbidden();
    }
    let cards = await progressCards(studentId);
    if (courseFilter) cards = cards.filter((c) => courseFilter!.includes(c.id));
    const [counts, activity, rank, assignments] = await Promise.all([
      courseCounts(studentId),
      activitySummary(studentId, 7),
      rankOf(student.points),
      assignmentService.forStudent(studentId, { page: 1, limit: 20 }),
    ]);
    const visibleAssignments = courseFilter
      ? assignments.items.filter((a) => courseFilter!.includes(a.course.id))
      : assignments.items;
    return {
      student: { ...publicUser(student), streakDays: student.streakDays, lastActiveDate: student.lastActiveDate },
      overview: counts,
      activity,
      points: { total: student.points, level: levelFor(student.points), rank },
      courses: cards,
      assignments: visibleAssignments,
    };
  },

  // ---------- Parent ----------

  async parentDashboard(parentId: string) {
    const links = await repo(ParentChild).find({ where: { parentId }, relations: { child: true }, order: { createdAt: 'ASC' } });
    const children = [];
    for (const l of links) {
      if (!l.childId || !l.child) {
        children.push({ linkId: l.id, childFullName: l.childFullName, relationship: l.relationship, linked: false });
        continue;
      }
      const [counts, activity, cards, assignments] = await Promise.all([
        courseCounts(l.childId),
        activitySummary(l.childId, 7),
        progressCards(l.childId, 4, EnrollmentStatus.ONGOING),
        assignmentService.forStudent(l.childId, { page: 1, limit: 5 }),
      ]);
      children.push({
        linkId: l.id,
        childFullName: l.childFullName,
        relationship: l.relationship,
        linked: true,
        student: { ...publicUser(l.child), streakDays: l.child.streakDays },
        overview: counts,
        activity,
        points: { total: l.child.points, level: levelFor(l.child.points), rank: await rankOf(l.child.points) },
        progress: cards,
        assignments: assignments.items,
      });
    }
    const spent = await repo(Payment)
      .createQueryBuilder('p')
      .select('COALESCE(SUM(p.amount),0)', 'total')
      .where('p.userId = :parentId AND p.status = :s', { parentId, s: PaymentStatus.SUCCESS })
      .getRawOne<{ total: string }>();
    return { children, billing: { totalSpent: Number(spent?.total ?? 0) } };
  },

  // ---------- Admin ----------

  async adminDashboard() {
    const users = repo(User);
    const since = new Date(Date.now() - 180 * DAY);
    const [byRole, totalCourses, published, enrollments, completions, pendingTeachers, revenue, signups, monthlyRevenue, recentPayments, topCourses] =
      await Promise.all([
        users.createQueryBuilder('u').select('u.role', 'role').addSelect('COUNT(*)', 'n').groupBy('u.role').getRawMany<{ role: Role; n: string }>(),
        repo(Course).count(),
        repo(Course).countBy({ isPublished: true }),
        repo(Enrollment).count(),
        repo(Enrollment).countBy({ status: EnrollmentStatus.COMPLETED }),
        repo(TeacherVerification).countBy({ status: VerificationStatus.PENDING }),
        repo(Payment).createQueryBuilder('p').select('COALESCE(SUM(p.amount),0)', 't').where('p.status = :s', { s: PaymentStatus.SUCCESS }).getRawOne<{ t: string }>(),
        users
          .createQueryBuilder('u')
          .select(`to_char(date_trunc('month', u."createdAt"), 'YYYY-MM')`, 'month')
          .addSelect('u.role', 'role')
          .addSelect('COUNT(*)', 'n')
          .where('u.createdAt >= :since', { since })
          .groupBy('1, 2')
          .orderBy('1')
          .getRawMany<{ month: string; role: Role; n: string }>(),
        repo(Payment)
          .createQueryBuilder('p')
          .select(`to_char(date_trunc('month', p."createdAt"), 'YYYY-MM')`, 'month')
          .addSelect('SUM(p.amount)', 'amount')
          .where('p.status = :s AND p.createdAt >= :since', { s: PaymentStatus.SUCCESS, since })
          .groupBy('1')
          .orderBy('1')
          .getRawMany<{ month: string; amount: string }>(),
        repo(Payment).find({ relations: { user: true }, order: { createdAt: 'DESC' }, take: 6 }),
        repo(Course).find({ relations: { instructor: true, category: true }, order: { enrolledCount: 'DESC' }, take: 5 }),
      ]);
    const count = (r: Role) => Number(byRole.find((x) => x.role === r)?.n ?? 0);
    const activeToday = await users.countBy({ lastActiveDate: isoDate() });
    const activeWeek = await users.countBy({ lastActiveDate: MoreThanOrEqual(isoDate(new Date(Date.now() - 6 * DAY))) });
    return {
      overview: {
        students: count(Role.STUDENT),
        teachers: count(Role.TEACHER),
        parents: count(Role.PARENT),
        admins: count(Role.ADMIN),
        courses: totalCourses,
        publishedCourses: published,
        enrollments,
        completions,
        pendingTeachers,
        revenue: Number(revenue?.t ?? 0),
        activeToday,
        activeWeek,
      },
      signups,
      monthlyRevenue: monthlyRevenue.map((m) => ({ month: m.month, amount: Number(m.amount) })),
      recentPayments: recentPayments.map((p) => ({ ...p, user: publicUser(p.user) })),
      topCourses: topCourses.map((c) => courseCard(c)),
    };
  },
};
