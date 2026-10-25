import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { BaseEntity } from './base.model';
import { DeliveryMode, EnrollmentStatus, LessonType, SubmissionStatus } from '../utils/enums';
import { User } from './user.model';

const decimal = { to: (v: number) => v, from: (v: string | null) => (v === null ? null : Number(v)) };

@Entity('categories')
export class Category extends BaseEntity {
  @Index({ unique: true })
  @Column()
  slug: string;

  @Column()
  name: string;

  @Column({ type: 'varchar', nullable: true })
  icon: string | null;

  @Column({ type: 'varchar', nullable: true })
  description: string | null;
}

@Entity('courses')
export class Course extends BaseEntity {
  @Index({ unique: true })
  @Column()
  slug: string;

  @Column()
  title: string;

  @Column({ type: 'varchar', default: '' })
  subtitle: string;

  @Column({ type: 'text', default: '' })
  description: string;

  @Column({ type: 'varchar', nullable: true })
  thumbnailUrl: string | null;

  @Column({ type: 'varchar', nullable: true })
  previewVideoUrl: string | null;

  @ManyToOne(() => Category, { nullable: true, onDelete: 'SET NULL', eager: true })
  category: Category | null;

  @Column({ type: 'uuid', nullable: true })
  categoryId: string | null;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  instructor: User;

  @Column()
  instructorId: string;

  /** Difficulty level 1–3 ("level" icon on course cards). */
  @Column({ default: 1 })
  level: number;

  @Column({ type: 'numeric', precision: 10, scale: 2, default: 0, transformer: decimal })
  price: number;

  @Column({ default: 'NGN' })
  currency: string;

  @Column({ default: 8 })
  durationWeeks: number;

  @Column({ type: 'enum', enum: DeliveryMode, default: DeliveryMode.ONLINE })
  mode: DeliveryMode;

  @Column({ type: 'text', array: true, default: '{}' })
  tags: string[];

  @Column({ type: 'text', array: true, default: '{}' })
  outcomes: string[];

  @Column({ default: false })
  isPublished: boolean;

  @Column({ type: 'numeric', precision: 3, scale: 2, default: 0, transformer: decimal })
  rating: number;

  @Column({ default: 0 })
  ratingCount: number;

  @Column({ default: 0 })
  enrolledCount: number;

  @Column({ default: 0 })
  lessonCount: number;

  @Column({ default: 0 })
  videoCount: number;

  @OneToMany(() => CourseModule, (m) => m.course, { cascade: true })
  modules: CourseModule[];
}

/** A week / section of a course. */
@Entity('course_modules')
export class CourseModule extends BaseEntity {
  @ManyToOne(() => Course, (c) => c.modules, { onDelete: 'CASCADE' })
  course: Course;

  @Column()
  courseId: string;

  @Column()
  title: string;

  @Column({ default: 0 })
  position: number;

  @OneToMany(() => Lesson, (l) => l.module, { cascade: true })
  lessons: Lesson[];
}

@Entity('lessons')
export class Lesson extends BaseEntity {
  @ManyToOne(() => CourseModule, (m) => m.lessons, { onDelete: 'CASCADE' })
  module: CourseModule;

  @Column()
  moduleId: string;

  @Column()
  courseId: string;

  @Column()
  title: string;

  @Column({ default: 0 })
  position: number;

  @Column({ type: 'enum', enum: LessonType, default: LessonType.TEXT })
  type: LessonType;

  /** Markdown body for text lessons. */
  @Column({ type: 'text', default: '' })
  content: string;

  @Column({ type: 'varchar', nullable: true })
  videoUrl: string | null;

  @Column({ type: 'varchar', nullable: true })
  documentUrl: string | null;

  @Column({ default: 10 })
  durationMinutes: number;

  @Column({ default: false })
  isPreview: boolean;
}

@Entity('enrollments')
@Index(['userId', 'courseId'], { unique: true })
export class Enrollment extends BaseEntity {
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user: User;

  @Column()
  userId: string;

  @ManyToOne(() => Course, { onDelete: 'CASCADE' })
  course: Course;

  @Column()
  courseId: string;

  @Column({ type: 'enum', enum: EnrollmentStatus, default: EnrollmentStatus.ONGOING })
  status: EnrollmentStatus;

  @Column({ default: 0 })
  progressPercent: number;

  @Column({ type: 'uuid', nullable: true })
  lastLessonId: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  lastAccessedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @Column({ type: 'varchar', nullable: true })
  certificateCode: string | null;

  @Column({ default: 0 })
  pointsEarned: number;
}

@Entity('lesson_progress')
@Index(['enrollmentId', 'lessonId'], { unique: true })
export class LessonProgress extends BaseEntity {
  @ManyToOne(() => Enrollment, { onDelete: 'CASCADE' })
  @JoinColumn()
  enrollment: Enrollment;

  @Column()
  enrollmentId: string;

  @Column()
  lessonId: string;

  @Column({ type: 'timestamptz' })
  completedAt: Date;
}

@Entity('reviews')
@Index(['userId', 'courseId'], { unique: true })
export class Review extends BaseEntity {
  @ManyToOne(() => User, { onDelete: 'CASCADE', eager: true })
  user: User;

  @Column()
  userId: string;

  @ManyToOne(() => Course, { onDelete: 'CASCADE' })
  course: Course;

  @Column()
  courseId: string;

  @Column()
  rating: number;

  @Column({ type: 'text', default: '' })
  comment: string;
}

@Entity('assignments')
export class Assignment extends BaseEntity {
  @ManyToOne(() => Course, { onDelete: 'CASCADE', eager: true })
  course: Course;

  @Column()
  courseId: string;

  @Column()
  title: string;

  @Column({ type: 'text', default: '' })
  description: string;

  @Column({ type: 'timestamptz' })
  dueDate: Date;

  @Column({ default: 100 })
  maxScore: number;

  @Column()
  createdById: string;
}

@Entity('submissions')
@Index(['assignmentId', 'studentId'], { unique: true })
export class Submission extends BaseEntity {
  @ManyToOne(() => Assignment, { onDelete: 'CASCADE', eager: true })
  assignment: Assignment;

  @Column()
  assignmentId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  student: User;

  @Column()
  studentId: string;

  @Column({ type: 'enum', enum: SubmissionStatus, default: SubmissionStatus.IN_PROGRESS })
  status: SubmissionStatus;

  @Column({ type: 'text', default: '' })
  content: string;

  @Column({ type: 'varchar', nullable: true })
  attachmentUrl: string | null;

  @Column({ type: 'int', nullable: true })
  score: number | null;

  @Column({ type: 'text', nullable: true })
  feedback: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  submittedAt: Date | null;
}

@Entity('bookmarks')
@Index(['userId', 'courseId'], { unique: true })
export class Bookmark extends BaseEntity {
  @Column()
  userId: string;

  @ManyToOne(() => Course, { onDelete: 'CASCADE', eager: true })
  course: Course;

  @Column()
  courseId: string;
}
