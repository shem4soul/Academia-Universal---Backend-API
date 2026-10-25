/**
 * Demo data that mirrors the content in the Figma design.
 * Run: npm run seed   (drops and recreates all tables!)
 *
 * Every demo account uses the password  Password123!  and PIN 1234.
 */
import 'reflect-metadata';
import bcrypt from 'bcryptjs';
import { AppDataSource, repo } from '../config/database';
import {
  ActivityLog,
  Announcement,
  Assignment,
  Category,
  Community,
  CommunityMember,
  Course,
  CourseModule,
  DEFAULT_SETTINGS,
  DirectMessage,
  Enrollment,
  Faq,
  Follow,
  Lesson,
  LessonProgress,
  Message,
  Notification,
  ParentChild,
  Payment,
  PlannerItem,
  Post,
  Resource,
  Review,
  Submission,
  TeacherVerification,
  User,
} from '../models';
import {
  AccountStatus,
  CommunityType,
  DeliveryMode,
  EnrollmentStatus,
  LessonType,
  NotificationType,
  PaymentPurpose,
  PaymentStatus,
  Plan,
  PlannerItemType,
  ResourceType,
  Role,
  SubmissionStatus,
  VerificationStatus,
} from '../utils/enums';
import { isoDate, slugify } from '../utils/serialize';

const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);
const daysAhead = (n: number) => new Date(Date.now() + n * DAY);
const at = (d: Date, h: number, m = 0) => {
  const x = new Date(d);
  x.setHours(h, m, 0, 0);
  return x;
};

const DESIGN_THINKING = `Today, we're diving into **Design Thinking** — a powerful, user-centred approach to product design that helps teams create innovative and effective solutions. Whether you're designing a tech product, a fashion piece, or a new service, Design Thinking helps ensure what you build is both useful and meaningful.

### What is Design Thinking?
Design Thinking is a problem-solving process that places empathy at the centre. It encourages designers to deeply understand the people they're designing for, define the real problems, brainstorm creatively, prototype quickly, and test often. The goal? Design *with* the user, not just *for* the user.

### The 5 Stages of Design Thinking
1. **Empathise** — understand the user through research and observation. Ask: who are they, what do they think, do, feel? Tools: interviews, surveys, user shadowing.
2. **Define** — pinpoint the problem based on user insights and write a clear problem statement. Example: "Busy moms need a quicker way to prepare healthy meals."
3. **Ideate** — brainstorm a wide range of ideas. No judgement — quantity over quality at this stage. Use mind mapping or "How might we" questions.
4. **Prototype** — build simple, low-cost versions of your ideas: a sketch, mockup, or model. The goal is to test the concept, not perfect it.
5. **Test** — get feedback from real users, observe how they interact with your prototype, and use what you learn to improve the design.

### Why Design Thinking matters in product design
- Reduces the risk of building the wrong product.
- Encourages innovation and collaboration.
- Keeps users at the heart of the process.
- Leads to better functionality, usability, and emotional connection.

### Real-world examples
- **Airbnb** solved trust issues between hosts and guests by prototyping features like better profiles and reviews.
- **Apple** obsesses over user experience — clean design, intuitive navigation, and emotional impact.

### Conclusion
Design Thinking transforms how we approach problems. It's not just for designers — it's a mindset. When we understand deeply, ideate freely, and test quickly, we create products that people don't just use — they love.`;

const lorem = (topic: string) =>
  `In this lesson we cover **${topic}**.\n\n### Key ideas\n- Why ${topic.toLowerCase()} matters\n- The core vocabulary you need\n- A worked example you can follow along with\n\n### Practice\nTry the exercise at the end of the lesson, then mark it as complete to earn points.`;

async function main() {
  // Connect without auto-sync so an old schema can't block the reset, then drop and recreate everything.
  AppDataSource.setOptions({ synchronize: false });
  await AppDataSource.initialize();
  console.log('[seed] resetting schema…');
  await AppDataSource.synchronize(true);

  const hash = await bcrypt.hash('Password123!', 10);
  const pin = await bcrypt.hash('1234', 10);
  const users = repo(User);
  const mk = (data: Partial<User>) =>
    users.create({
      passwordHash: hash,
      pinHash: pin,
      settings: DEFAULT_SETTINGS,
      onboardingComplete: true,
      emailVerified: true,
      country: 'Nigeria',
      ...data,
    });

  // ---------- People ----------
  const admin = await users.save(mk({ email: 'admin@academiauniversal.com', firstName: 'Ada', lastName: 'Admin', username: 'admin', role: Role.ADMIN, headline: 'Platform Admin' }));
  const sam = await users.save(
    mk({
      email: 'sam@academiauniversal.com',
      phone: '+233548826689',
      phoneVerified: true,
      firstName: 'Samuel',
      middleName: 'Chinaemelum',
      lastName: 'Praise',
      username: 'thelastguru6',
      role: Role.STUDENT,
      headline: 'AWS Student',
      dateOfBirth: '2005-04-01',
      points: 10000,
      streakDays: 7,
      lastActiveDate: isoDate(),
      plan: Plan.FREE,
    }),
  );
  const teacherNames: [string, string, string][] = [
    ['Anthony', 'Edwards', 'Product Design'],
    ['Zari', 'Zayne', 'Frontend Engineering'],
    ['Frank', 'Liama', 'Python'],
    ['Mark', 'Spencer', 'Data Science'],
    ['Favour', 'Ihuoma', 'Digital Marketing'],
  ];
  const teachers = await users.save(
    teacherNames.map(([f, l, spec]) =>
      mk({
        email: `${f.toLowerCase()}@academiauniversal.com`,
        firstName: f,
        lastName: l,
        username: `${f}${l}`.toLowerCase(),
        role: Role.TEACHER,
        headline: `${spec} Instructor`,
        bio: `${f} has taught ${spec.toLowerCase()} to thousands of learners across Africa.`,
      }),
    ),
  );
  const [anthony, zari, frank, mark, favour] = teachers;
  await repo(TeacherVerification).save(
    teachers.map((t, i) =>
      repo(TeacherVerification).create({
        userId: t.id,
        documentType: 'Teaching certificate',
        documentUrl: 'https://example.com/docs/certificate.pdf',
        qualification: 'B.Sc',
        specialization: teacherNames[i][2],
        status: VerificationStatus.APPROVED,
      }),
    ),
  );
  const pendingTeacher = await users.save(
    mk({ email: 'pending.tutor@academiauniversal.com', firstName: 'Kemi', lastName: 'Adebayo', role: Role.TEACHER, status: AccountStatus.PENDING, headline: 'Chemistry Instructor', points: 0 }),
  );
  await repo(TeacherVerification).save(
    repo(TeacherVerification).create({ userId: pendingTeacher.id, documentType: 'NCE certificate', documentUrl: 'https://example.com/docs/nce.pdf', specialization: 'Chemistry' }),
  );

  // Leaderboard students (from the Figma leaderboard)
  const board: [string, string, number][] = [
    ['Damilare', 'Okuwa', 20000],
    ['Chioma', 'Nwosu', 15000],
    ['Tunde', 'Bakare', 15000],
    ['Bimpe', 'Ojo', 10000],
    ['Ifeanyi', 'Eze', 10000],
    ['Halima', 'Bello', 10000],
    ['Kofi', 'Mensah', 10000],
    ['Bamidele', 'Seun', 8000],
    ['Maxim', 'Obi', 8000],
    ['Damilola', 'Ade', 5000],
    ['Akinola', 'Femi', 5000],
    ['Favour', 'Inuoma', 2000],
  ];
  const students = await users.save(
    board.map(([f, l, p], i) =>
      mk({
        email: `${f.toLowerCase()}.${l.toLowerCase()}@academiauniversal.com`,
        firstName: f,
        lastName: l,
        username: `${f}${l}${i}`.toLowerCase(),
        role: Role.STUDENT,
        headline: 'Student',
        points: p,
        streakDays: (i % 5) + 1,
        lastActiveDate: isoDate(daysAgo(i % 3)),
      }),
    ),
  );
  const parent = await users.save(
    mk({ email: 'parent@academiauniversal.com', firstName: 'Grace', lastName: 'Praise', username: 'gracepraise', role: Role.PARENT, headline: 'Parent', phone: '+2348012345678' }),
  );
  await repo(ParentChild).save(
    repo(ParentChild).create({ parentId: parent.id, childId: sam.id, childFullName: 'Samuel Praise', childEmail: sam.email, relationship: 'Mother' }),
  );
  await repo(Follow).save([
    { followerId: sam.id, followingId: anthony.id },
    { followerId: sam.id, followingId: mark.id },
    { followerId: students[0].id, followingId: sam.id },
    { followerId: students[1].id, followingId: sam.id },
  ]);

  // ---------- Catalogue ----------
  const catDefs: [string, string][] = [
    ['Design', 'palette'],
    ['Development', 'code'],
    ['Data Science', 'chart'],
    ['Marketing', 'megaphone'],
    ['Business', 'briefcase'],
    ['Science', 'flask'],
    ['Mathematics', 'sigma'],
    ['Content Creation', 'video'],
  ];
  const cats = await repo(Category).save(catDefs.map(([name, icon]) => repo(Category).create({ name, slug: slugify(name), icon })));
  const cat = (n: string) => cats.find((c) => c.name === n)!;

  type CourseDef = {
    title: string;
    instructor: User;
    category: string;
    level: number;
    price: number;
    weeks: number;
    rating: number;
    subtitle: string;
    weeksOutline?: [string, [string, LessonType, string?][]][];
  };
  const defaultOutline = (topic: string): CourseDef['weeksOutline'] =>
    [1, 2, 3, 4, 5, 6].map((w) => [
      `Week ${w}`,
      [
        [`${topic}: part ${w}.1`, LessonType.TEXT],
        [`${topic}: part ${w}.2`, LessonType.VIDEO],
        ...(w % 2 === 0 ? ([[`Test your understanding ${w}`, LessonType.QUIZ]] as [string, LessonType][]) : []),
      ],
    ]);
  const courseDefs: CourseDef[] = [
    {
      title: 'A-Z of Product Design (Masterclass)',
      instructor: anthony,
      category: 'Design',
      level: 2,
      price: 0,
      weeks: 6,
      rating: 4.8,
      subtitle: 'From research to high-fidelity prototypes',
      weeksOutline: [
        ['Week 1', [['What is Design?', LessonType.TEXT], ['Basics of Design', LessonType.VIDEO], ['What to know about Design', LessonType.TEXT]]],
        [
          'Week 2 — Concepts in Design',
          [
            ['Design Thinking', LessonType.TEXT, DESIGN_THINKING],
            ['Design Process', LessonType.TEXT],
            ['User Research', LessonType.VIDEO],
            ['UI vs UX', LessonType.TEXT],
            ['Who is a Product Designer?', LessonType.TEXT],
            ['Test your understanding', LessonType.QUIZ],
          ],
        ],
        ['Week 3', [['Wireframing', LessonType.VIDEO], ['Information architecture', LessonType.TEXT]]],
        ['Week 4', [['Visual design', LessonType.VIDEO], ['Typography & colour', LessonType.TEXT]]],
        ['Week 5', [['Prototyping in Figma', LessonType.VIDEO], ['Usability testing', LessonType.TEXT]]],
        ['Week 6', [['Building your portfolio', LessonType.TEXT], ['Final project', LessonType.QUIZ]]],
      ],
    },
    { title: 'Frontend Development (A-Z)', instructor: zari, category: 'Development', level: 2, price: 0, weeks: 8, rating: 4.7, subtitle: 'HTML, CSS, JavaScript and React' },
    { title: 'Python for beginners (Masterclass)', instructor: frank, category: 'Development', level: 1, price: 0, weeks: 8, rating: 4.7, subtitle: 'Write your first real programs' },
    { title: 'Data Science for Beginners', instructor: mark, category: 'Data Science', level: 1, price: 0, weeks: 8, rating: 4.6, subtitle: 'Data clean-up, analysis and visualisation' },
    { title: 'Figma for beginners', instructor: anthony, category: 'Design', level: 1, price: 0, weeks: 8, rating: 4.7, subtitle: 'Design interfaces with Figma' },
    { title: 'Internet Skills', instructor: favour, category: 'Business', level: 1, price: 0, weeks: 4, rating: 4.7, subtitle: 'Work and learn safely online' },
    { title: 'Facebook Advertising', instructor: favour, category: 'Marketing', level: 2, price: 15000, weeks: 6, rating: 4.7, subtitle: 'Run campaigns that convert' },
    { title: 'Content Creation', instructor: favour, category: 'Content Creation', level: 1, price: 0, weeks: 6, rating: 4.7, subtitle: 'Plan, shoot and edit content' },
    { title: 'Frontend ProDev', instructor: zari, category: 'Development', level: 3, price: 25000, weeks: 12, rating: 4.7, subtitle: 'Professional frontend engineering' },
    { title: 'Backend ProDev', instructor: zari, category: 'Development', level: 3, price: 25000, weeks: 12, rating: 4.7, subtitle: 'APIs, databases and deployment' },
    { title: 'Software Development', instructor: frank, category: 'Development', level: 2, price: 0, weeks: 10, rating: 4.7, subtitle: 'Engineering fundamentals' },
    { title: 'Digital Marketing', instructor: favour, category: 'Marketing', level: 1, price: 0, weeks: 6, rating: 4.5, subtitle: 'Explore the world of digital marketing and all it has to entail' },
  ];

  const courses: Course[] = [];
  for (const d of courseDefs) {
    const course = await repo(Course).save(
      repo(Course).create({
        title: d.title,
        slug: slugify(d.title),
        subtitle: d.subtitle,
        description: `${d.subtitle}. This course takes you step by step from the fundamentals to confident, practical skills, with weekly lessons, quizzes and assignments.`,
        instructorId: d.instructor.id,
        categoryId: cat(d.category).id,
        level: d.level,
        price: d.price,
        durationWeeks: d.weeks,
        mode: DeliveryMode.ONLINE,
        isPublished: true,
        rating: d.rating,
        tags: d.title.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3),
        outcomes: ['Understand the core concepts', 'Complete a real-world project', 'Earn a shareable certificate'],
      }),
    );
    const outline = d.weeksOutline ?? defaultOutline(d.title.replace(/\s*\(.*\)/, ''));
    let lessonCount = 0;
    let videoCount = 0;
    for (const [mi, [mTitle, lessons]] of outline!.entries()) {
      const mod = await repo(CourseModule).save(repo(CourseModule).create({ courseId: course.id, title: mTitle, position: mi }));
      await repo(Lesson).save(
        lessons.map(([title, type, content], li) =>
          repo(Lesson).create({
            moduleId: mod.id,
            courseId: course.id,
            title,
            type,
            position: li,
            content: content ?? lorem(title),
            videoUrl: type === LessonType.VIDEO ? 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4' : null,
            durationMinutes: type === LessonType.VIDEO ? 15 : 10,
            isPreview: mi === 0 && li === 0,
          }),
        ),
      );
      lessonCount += lessons.length;
      videoCount += lessons.filter((l) => l[1] === LessonType.VIDEO).length;
    }
    course.lessonCount = lessonCount;
    course.videoCount = videoCount;
    await repo(Course).save(course);
    courses.push(course);
  }
  const byTitle = (t: string) => courses.find((c) => c.title === t)!;

  // ---------- Enrolments & progress (Sam's progress tracker: 80 / 20 / 50 / 45) ----------
  const enrol = async (u: User, c: Course, pct: number, accessed: number) => {
    const lessons = await repo(Lesson).find({ where: { courseId: c.id }, relations: { module: true } });
    lessons.sort((a, b) => a.module.position - b.module.position || a.position - b.position);
    const doneCount = Math.round((lessons.length * pct) / 100);
    const done = lessons.slice(0, doneCount);
    const completed = pct >= 100;
    const e = await repo(Enrollment).save(
      repo(Enrollment).create({
        userId: u.id,
        courseId: c.id,
        status: completed ? EnrollmentStatus.COMPLETED : EnrollmentStatus.ONGOING,
        progressPercent: lessons.length ? Math.round((doneCount / lessons.length) * 100) : 0,
        lastLessonId: done.at(-1)?.id ?? lessons[0]?.id ?? null,
        lastAccessedAt: daysAgo(accessed),
        completedAt: completed ? daysAgo(accessed) : null,
        certificateCode: completed ? `AU-${Math.random().toString(16).slice(2, 10).toUpperCase()}` : null,
        pointsEarned: doneCount * 10 + (completed ? 100 : 0),
        createdAt: daysAgo(30 + accessed),
      }),
    );
    if (done.length) await repo(LessonProgress).save(done.map((l, i) => repo(LessonProgress).create({ enrollmentId: e.id, lessonId: l.id, completedAt: daysAgo(accessed + done.length - i) })));
    await repo(Course).increment({ id: c.id }, 'enrolledCount', 1);
  };
  await enrol(sam, byTitle('A-Z of Product Design (Masterclass)'), 80, 0);
  await enrol(sam, byTitle('Frontend Development (A-Z)'), 20, 1);
  await enrol(sam, byTitle('Python for beginners (Masterclass)'), 50, 2);
  await enrol(sam, byTitle('Data Science for Beginners'), 45, 3);
  await enrol(sam, byTitle('Internet Skills'), 100, 20);
  await enrol(sam, byTitle('Content Creation'), 100, 40);
  for (const [i, s] of students.entries()) {
    await enrol(s, courses[i % 4], 10 + ((i * 17) % 90), i % 5);
    await enrol(s, courses[(i + 2) % courses.length], (i * 23) % 100, (i + 1) % 6);
    if (i < 6) await enrol(s, courses[4 + (i % 3)], 100, 10 + i);
  }

  // Reviews
  const reviewTexts = ['Clear and practical. Loved the projects.', 'Great pacing and examples.', 'The instructor explains things really well.', 'Exactly what I needed to get started.'];
  for (const [i, s] of students.slice(0, 8).entries()) {
    const e = await repo(Enrollment).findOneByOrFail({ userId: s.id, courseId: courses[i % 4].id });
    await repo(Review).save(repo(Review).create({ userId: s.id, courseId: e.courseId, rating: i % 3 === 0 ? 4 : 5, comment: reviewTexts[i % reviewTexts.length] }));
  }
  for (const c of courses) {
    const r = await repo(Review).createQueryBuilder('r').select('AVG(r.rating)', 'a').addSelect('COUNT(*)', 'n').where('r.courseId = :id', { id: c.id }).getRawOne();
    if (Number(r.n) > 0) await repo(Course).update(c.id, { rating: Math.round(Number(r.a) * 10) / 10, ratingCount: Number(r.n) });
  }

  // ---------- Assignments (Completed / Late / In Progress / Late / Late) ----------
  const ds = byTitle('Data Science for Beginners');
  const asg = await repo(Assignment).save(
    [
      ['Data clean up', -12],
      ['Exploratory analysis', -8],
      ['Visualising sales data', 5],
      ['Regression basics', -3],
      ['Final data report', -1],
    ].map(([title, d]) =>
      repo(Assignment).create({ courseId: ds.id, title: title as string, description: `Complete the "${title}" exercise and upload your notebook.`, dueDate: daysAhead(d as number), createdById: mark.id }),
    ),
  );
  await repo(Submission).save([
    repo(Submission).create({ assignmentId: asg[0].id, studentId: sam.id, status: SubmissionStatus.COMPLETED, content: 'Notebook attached', submittedAt: daysAgo(13), score: 88, feedback: 'Great work on handling missing values.' }),
    repo(Submission).create({ assignmentId: asg[2].id, studentId: sam.id, status: SubmissionStatus.IN_PROGRESS, content: 'Draft' }),
  ]);
  for (const [i, s] of students.slice(0, 6).entries()) {
    if (!(await repo(Enrollment).existsBy({ userId: s.id, courseId: ds.id }))) continue;
    await repo(Submission).save(
      repo(Submission).create({ assignmentId: asg[i % 2].id, studentId: s.id, status: SubmissionStatus.COMPLETED, submittedAt: daysAgo(14 - i), score: 60 + i * 6 }),
    );
  }
  const pd = byTitle('A-Z of Product Design (Masterclass)');
  await repo(Assignment).save(repo(Assignment).create({ courseId: pd.id, title: 'Persona & problem statement', description: 'Interview two users and write a problem statement.', dueDate: daysAhead(3), createdById: anthony.id }));

  // ---------- Activity (Activity Hours chart) ----------
  const minutesPattern = [150, 270, 300, 450, 370, 490, 260];
  for (let i = 0; i < 7; i++) {
    await repo(ActivityLog).save(repo(ActivityLog).create({ userId: sam.id, date: isoDate(daysAgo(6 - i)), minutes: minutesPattern[i], courseId: courses[i % 4].id, testsDone: i === 3 || i === 5 ? 1 : 0 }));
    await repo(ActivityLog).save(repo(ActivityLog).create({ userId: anthony.id, date: isoDate(daysAgo(6 - i)), minutes: minutesPattern[(i + 2) % 7] }));
    for (const s of students.slice(0, 6)) {
      await repo(ActivityLog).save(repo(ActivityLog).create({ userId: s.id, date: isoDate(daysAgo(6 - i)), minutes: 30 + ((i * 41 + s.points) % 200), courseId: courses[i % 4].id }));
    }
  }

  // ---------- Communities, study groups & chat ----------
  const communityDefs: [string, number, boolean][] = [
    ['Product Design Hub', 20, false],
    ['Maths 101', 45, false],
    ['Gen Z Programmers', 40, false],
    ['Academia Universal', 11, false],
    ['Coders (30)', 50, false],
    ['DevOps', 10, false],
    ['Data science freaks', 400, false],
    ['UI/UX Africa Hub', 20, false],
    ['Backend project', 10, false],
    ['Biology Nerds', 200, false],
    ['Videographers PH', 50, false],
    ['Chem 101', 45, true],
    ['Physics Lab', 38, true],
    ['Economics Circle', 52, true],
  ];
  const everyone = [sam, ...students];
  const comms: Community[] = [];
  for (const [i, [name, , rec]] of communityDefs.entries()) {
    const c = await repo(Community).save(
      repo(Community).create({ name, description: `A space for ${name} learners to share, ask and build together.`, type: CommunityType.COMMUNITY, isRecommended: rec, createdById: teachers[i % teachers.length].id }),
    );
    const memberSet = rec ? students.slice(0, 4 + (i % 4)) : everyone.slice(0, 5 + (i % 7));
    const all = [teachers[i % teachers.length], ...memberSet];
    await repo(CommunityMember).save(
      all.map((u, j) =>
        repo(CommunityMember).create({ communityId: c.id, userId: u.id, role: j === 0 ? 'owner' : 'member', lastReadAt: daysAgo(j % 2 ? 2 : 0) }),
      ),
    );
    await repo(Community).update(c.id, { memberCount: all.length });
    comms.push(c);
  }
  const au = comms.find((c) => c.name === 'Academia Universal')!;
  await repo(CommunityMember).update({ communityId: au.id, userId: students[7].id }, { title: 'Team Lead' });
  await repo(CommunityMember).update({ communityId: au.id, userId: students[8].id }, { title: 'Backend' });
  await repo(CommunityMember).update({ communityId: au.id, userId: students[9].id }, { title: 'Product manager' });
  const chat: [User, string, number][] = [
    [students[7], 'Hey guys, what’s up? How is the project going on your ends?', 60],
    [students[8], 'I’m fine on my end. The work has been very engaging.', 55],
    [students[9], 'Where is the designer? How far has he gone on the work?', 50],
    [sam, 'I’m here oh. Work progress has been a bit slow oh. Creative block. But we move… 🙂', 45],
    [students[10], 'Hello everyone. Good to be here', 30],
    [students[11], 'What are we working on so far? It’s been fun working on this project with everyone here…', 20],
    [sam, 'Hello Favour. How are you? How is it going on the marketing end?', 10],
  ];
  for (const [u, body, minsAgo] of chat) {
    await repo(Message).save(repo(Message).create({ communityId: au.id, senderId: u.id, body, createdAt: new Date(Date.now() - minsAgo * 60_000) }));
  }
  for (const c of comms.slice(0, 6)) {
    for (let k = 0; k < 3; k++) {
      await repo(Message).save(repo(Message).create({ communityId: c.id, senderId: students[(k + 2) % students.length].id, body: ['Has anyone finished this week’s task?', 'Sharing my notes in a bit 📚', 'Live session at 6pm today!'][k], createdAt: new Date(Date.now() - (k + 1) * 3600_000) }));
    }
  }
  for (let g = 0; g < 7; g++) {
    const grp = await repo(Community).save(
      repo(Community).create({ name: g === 0 ? 'The Elites' : `Study Squad ${g}`, description: 'Small study group for weekly accountability.', type: CommunityType.STUDY_GROUP, isPublic: g % 2 === 0, createdById: sam.id, courseId: courses[g % 4].id, liveSessionAt: g === 0 ? daysAhead(1) : null }),
    );
    const mem = [sam, ...students.slice(g, g + 3)];
    await repo(CommunityMember).save(mem.map((u, j) => repo(CommunityMember).create({ communityId: grp.id, userId: u.id, role: j === 0 ? 'owner' : 'member' })));
    await repo(Community).update(grp.id, { memberCount: mem.length });
  }

  // Posts
  const postBodies = [
    'Just finished Week 2 of the Product Design masterclass. Design thinking finally clicked for me! 🎉',
    'Anyone up for a study session on pandas this weekend?',
    'Here is my first landing page built with React. Feedback welcome!',
    'Tip: use the planner to block 30 minutes a day. My streak is at 12 days now 🔥',
  ];
  for (const [i, body] of postBodies.entries()) {
    await repo(Post).save(repo(Post).create({ authorId: [sam, students[0], students[1], students[2]][i].id, body, likeCount: 12 + i * 7, commentCount: i + 1, createdAt: daysAgo(i) }));
  }

  // Direct messages (parent ↔ teacher, student ↔ instructor)
  await repo(DirectMessage).save([
    repo(DirectMessage).create({ senderId: parent.id, recipientId: mark.id, body: 'Good afternoon. How is Samuel doing in Data Science?', createdAt: daysAgo(1) }),
    repo(DirectMessage).create({ senderId: mark.id, recipientId: parent.id, body: 'He is doing well — 45% through and his first assignment scored 88.', createdAt: daysAgo(1) }),
    repo(DirectMessage).create({ senderId: sam.id, recipientId: anthony.id, body: 'Thanks for the Design Thinking lesson!', createdAt: daysAgo(2) }),
  ]);

  // Announcements
  await repo(Announcement).save([
    repo(Announcement).create({ authorId: anthony.id, courseId: pd.id, title: 'Live critique this Friday', body: 'Bring your wireframes — we will review them together.' }),
    repo(Announcement).create({ authorId: mark.id, courseId: ds.id, title: 'New dataset uploaded', body: 'Use the sales dataset in Resources for this week’s task.' }),
    repo(Announcement).create({ authorId: admin.id, courseId: null, title: 'Welcome to Academia Universal', body: 'Explore courses, join communities and track your progress.' }),
  ]);

  // ---------- Planner ----------
  const today = new Date();
  await repo(PlannerItem).save([
    repo(PlannerItem).create({ userId: sam.id, type: PlannerItemType.EVENT, title: 'Product Design live class', startAt: at(today, 10), endAt: at(today, 11, 30), color: '#004AC3', category: 'Class', courseId: pd.id }),
    repo(PlannerItem).create({ userId: sam.id, type: PlannerItemType.EVENT, title: 'Study group: The Elites', startAt: at(daysAhead(1), 16), endAt: at(daysAhead(1), 17), color: '#DB3E3E', category: 'Study group' }),
    repo(PlannerItem).create({ userId: sam.id, type: PlannerItemType.TASK, title: 'Finish Python week 4 exercises', dueAt: at(daysAhead(2), 18), priority: 'high', category: 'Coursework' }),
    repo(PlannerItem).create({ userId: sam.id, type: PlannerItemType.TASK, title: 'Read: UI vs UX', dueAt: at(daysAhead(3), 12), priority: 'medium', category: 'Reading' }),
    repo(PlannerItem).create({ userId: sam.id, type: PlannerItemType.REMINDER, title: 'Submit data report', remindAt: at(daysAhead(1), 9), category: 'Deadline' }),
  ]);

  // ---------- Resources ----------
  await repo(Resource).save(
    [
      ...['Data Science for Beginners', 'Intro to React Hooks', 'Design Systems 101', 'Python Data Types'].map((t, i) =>
        repo(Resource).create({ title: t, type: ResourceType.VIDEO, url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4', authorName: ['Mark Spencer', 'Zari Zayne', 'Anthony Edwards', 'Frank Liama'][i], categoryId: cats[[2, 1, 0, 1][i]].id, mode: DeliveryMode.ONLINE }),
      ),
      ...['Data Science for Beginners', 'Statistics cheat sheet', 'Figma shortcuts', 'Marketing funnel guide', 'Algebra workbook', 'Chemistry notes', 'Content calendar template', 'Interview prep pack'].map((t, i) =>
        repo(Resource).create({ title: t, type: ResourceType.DOCUMENT, url: 'https://example.com/resources/sample.pdf', authorName: 'Favour Ihuoma', categoryId: cats[i % cats.length].id, mode: i % 3 === 0 ? DeliveryMode.OFFLINE : DeliveryMode.ONLINE }),
      ),
    ],
  );

  // ---------- Support FAQs (from the Support screen) ----------
  await repo(Faq).save(
    [
      ['What is Academia Universal?', 'Academia Universal is an all-in-one educational app designed to support students, parents, tutors, institutions, and EdTech enthusiasts through mentorship, live sessions, curated resources, and more.', []],
      ['Who can use Academia Universal?', 'The app is designed for students of all levels, parents seeking guidance, tutors looking to connect, educational institutions, and anyone passionate about educational technology.', []],
      ['What features does the app offer?', 'Key features include:', ['One-on-one mentorship', 'Interactive live sessions', 'Educational tools and resources', 'Personalized learning support', 'Community engagement']],
      ['Is Academia Universal free to use?', 'We offer both free and premium subscription plans. The free plan provides limited access to features, while the premium plan unlocks full access to all features and content.', []],
      ['How do I sign up for Academia Universal?', 'Simply download the app, create an account, and follow the registration process. You can sign up using your email address or social media accounts.', []],
      ['What kind of support does Academia Universal offer?', 'We provide customer support through our in-app support center, email, and social media channels. Our team is available to assist you with any questions or issues.', []],
    ].map(([question, answer, bullets], position) => repo(Faq).create({ question: question as string, answer: answer as string, bullets: bullets as string[], position })),
  );

  // ---------- Billing ----------
  // No saved cards are seeded: Paystack only charges real authorizations, so add one through
  // "Add new card" with a Paystack test card (e.g. 4084 0840 8408 4081, any future expiry, CVV 408).
  const paid = (p: Partial<Payment>) =>
    repo(Payment).create({ currency: 'NGN', provider: 'paystack', channel: 'card', gatewayResponse: 'Approved', status: PaymentStatus.SUCCESS, ...p, paidAt: p.createdAt, fulfilledAt: p.createdAt });
  await repo(Payment).save([
    paid({ userId: parent.id, purpose: PaymentPurpose.PRO, amount: 5000, description: 'Academia Universal Pro (30 days)', reference: 'AU-PRO-SEED-0001', beneficiaryId: sam.id, createdAt: daysAgo(40) }),
    paid({ userId: parent.id, purpose: PaymentPurpose.PRO, amount: 5000, description: 'Academia Universal Pro (30 days)', reference: 'AU-PRO-SEED-0002', beneficiaryId: sam.id, createdAt: daysAgo(10) }),
    paid({ userId: students[0].id, purpose: PaymentPurpose.COURSE, amount: 25000, description: 'Course: Frontend ProDev', reference: 'AU-COURSE-SEED-0003', courseId: byTitle('Frontend ProDev').id, createdAt: daysAgo(25) }),
    paid({ userId: students[1].id, purpose: PaymentPurpose.COURSE, amount: 15000, description: 'Course: Facebook Advertising', reference: 'AU-COURSE-SEED-0004', courseId: byTitle('Facebook Advertising').id, createdAt: daysAgo(70), channel: 'bank_transfer' }),
  ]);

  // ---------- Notifications ----------
  await repo(Notification).save([
    repo(Notification).create({ userId: sam.id, type: NotificationType.ASSIGNMENT, title: 'New assignment: Persona & problem statement', body: 'A-Z of Product Design · due in 3 days', link: '/assignments' }),
    repo(Notification).create({ userId: sam.id, type: NotificationType.COMMUNITY, title: 'You have new messages in Academia Universal', body: '7 unread messages', link: `/community/${au.id}` }),
    repo(Notification).create({ userId: sam.id, type: NotificationType.COURSE, title: 'You are on a 7-day streak 🚀', body: 'Keep it going!', readAt: daysAgo(1) }),
    repo(Notification).create({ userId: parent.id, type: NotificationType.COURSE, title: 'Samuel completed Internet Skills', body: 'A certificate was issued.' }),
    repo(Notification).create({ userId: anthony.id, type: NotificationType.COURSE, title: '3 new students enrolled this week' }),
    repo(Notification).create({ userId: admin.id, type: NotificationType.SYSTEM, title: '1 instructor waiting for verification', link: '/admin/verifications' }),
  ]);

  console.log('[seed] done.');
  console.log('  Payments: set PAYSTACK_SECRET_KEY / PAYSTACK_PUBLIC_KEY (test keys) and add a card with Paystack test card 4084 0840 8408 4081.');
  console.log('  Demo logins (password Password123!, PIN 1234):');
  console.log('   student  sam@academiauniversal.com');
  console.log('   teacher  anthony@academiauniversal.com');
  console.log('   parent   parent@academiauniversal.com');
  console.log('   admin    admin@academiauniversal.com');
  await AppDataSource.destroy();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
