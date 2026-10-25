import { Column, Entity, Index, ManyToOne } from 'typeorm';
import { BaseEntity } from './base.model';
import { CommunityType, NotificationType, PlannerItemType } from '../utils/enums';
import { User } from './user.model';

@Entity('communities')
export class Community extends BaseEntity {
  @Column()
  name: string;

  @Column({ type: 'text', default: '' })
  description: string;

  @Column({ type: 'varchar', nullable: true })
  avatarUrl: string | null;

  @Column({ type: 'enum', enum: CommunityType, default: CommunityType.COMMUNITY })
  type: CommunityType;

  @Column({ default: false })
  isRecommended: boolean;

  @Column({ default: true })
  isPublic: boolean;

  /** Optional course this group studies. */
  @Column({ type: 'uuid', nullable: true })
  courseId: string | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  createdBy: User | null;

  @Column({ type: 'uuid', nullable: true })
  createdById: string | null;

  @Column({ default: 0 })
  memberCount: number;

  /** Set when a live session is running / scheduled. */
  @Column({ type: 'timestamptz', nullable: true })
  liveSessionAt: Date | null;
}

@Entity('community_members')
@Index(['communityId', 'userId'], { unique: true })
export class CommunityMember extends BaseEntity {
  @ManyToOne(() => Community, { onDelete: 'CASCADE' })
  community: Community;

  @Column()
  communityId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE', eager: true })
  user: User;

  @Column()
  userId: string;

  /** Display role in the chat, e.g. "Team Lead", "Backend". */
  @Column({ type: 'varchar', nullable: true })
  title: string | null;

  @Column({ default: 'member' })
  role: 'owner' | 'admin' | 'member';

  @Column({ type: 'timestamptz', default: () => 'now()' })
  lastReadAt: Date;
}

@Entity('messages')
@Index(['communityId', 'createdAt'])
export class Message extends BaseEntity {
  @ManyToOne(() => Community, { onDelete: 'CASCADE' })
  community: Community;

  @Column()
  communityId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE', eager: true })
  sender: User;

  @Column()
  senderId: string;

  @Column({ type: 'text' })
  body: string;

  @Column({ type: 'varchar', nullable: true })
  attachmentUrl: string | null;

  @Column({ type: 'varchar', nullable: true })
  attachmentType: string | null;
}

/** One-to-one chat (parent ↔ teacher, student ↔ instructor). */
@Entity('direct_messages')
@Index(['senderId', 'recipientId', 'createdAt'])
export class DirectMessage extends BaseEntity {
  @ManyToOne(() => User, { onDelete: 'CASCADE', eager: true })
  sender: User;

  @Column()
  senderId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE', eager: true })
  recipient: User;

  @Column()
  recipientId: string;

  @Column({ type: 'text' })
  body: string;

  @Column({ type: 'timestamptz', nullable: true })
  readAt: Date | null;
}

@Entity('posts')
export class Post extends BaseEntity {
  @ManyToOne(() => User, { onDelete: 'CASCADE', eager: true })
  author: User;

  @Column()
  authorId: string;

  @Column({ type: 'uuid', nullable: true })
  communityId: string | null;

  @Column({ type: 'text' })
  body: string;

  @Column({ type: 'varchar', nullable: true })
  imageUrl: string | null;

  @Column({ default: 0 })
  likeCount: number;

  @Column({ default: 0 })
  commentCount: number;
}

@Entity('post_likes')
@Index(['postId', 'userId'], { unique: true })
export class PostLike extends BaseEntity {
  @Column()
  postId: string;

  @Column()
  userId: string;
}

@Entity('comments')
export class Comment extends BaseEntity {
  @ManyToOne(() => Post, { onDelete: 'CASCADE' })
  post: Post;

  @Column()
  postId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE', eager: true })
  author: User;

  @Column()
  authorId: string;

  @Column({ type: 'text' })
  body: string;
}

@Entity('planner_items')
@Index(['userId', 'startAt'])
export class PlannerItem extends BaseEntity {
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user: User;

  @Column()
  userId: string;

  @Column({ type: 'enum', enum: PlannerItemType })
  type: PlannerItemType;

  @Column()
  title: string;

  @Column({ type: 'text', default: '' })
  notes: string;

  @Column({ type: 'timestamptz', nullable: true })
  startAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  endAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  dueAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  remindAt: Date | null;

  @Column({ default: false })
  completed: boolean;

  @Column({ default: 'medium' })
  priority: 'low' | 'medium' | 'high';

  @Column({ type: 'varchar', nullable: true })
  category: string | null;

  @Column({ type: 'varchar', default: '#004AC3' })
  color: string;

  @Column({ type: 'uuid', nullable: true })
  courseId: string | null;
}

@Entity('notifications')
@Index(['userId', 'createdAt'])
export class Notification extends BaseEntity {
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user: User;

  @Column()
  userId: string;

  @Column({ type: 'enum', enum: NotificationType, default: NotificationType.SYSTEM })
  type: NotificationType;

  @Column()
  title: string;

  @Column({ type: 'text', default: '' })
  body: string;

  /** App route to open when tapped, e.g. /courses/abc. */
  @Column({ type: 'varchar', nullable: true })
  link: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  readAt: Date | null;
}

@Entity('announcements')
export class Announcement extends BaseEntity {
  @ManyToOne(() => User, { onDelete: 'CASCADE', eager: true })
  author: User;

  @Column()
  authorId: string;

  @Column({ type: 'uuid', nullable: true })
  courseId: string | null;

  @Column()
  title: string;

  @Column({ type: 'text', default: '' })
  body: string;
}
