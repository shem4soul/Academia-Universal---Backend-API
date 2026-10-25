import { Brackets } from 'typeorm';
import { repo } from '../config/database';
import { ActivityLog, CommunityMember, DirectMessage, Follow, User } from '../models';
import { ApiError } from '../utils/ApiError';
import { CommunityType, Role } from '../utils/enums';
import { offset, paginate, PageQuery } from '../utils/pagination';
import { isoDate, publicUser, selfUser } from '../utils/serialize';
import { UpdateProfileInput, UpdateSettingsInput } from '../validators/user.validator';

const users = () => repo(User);

async function get(id: string) {
  const u = await users().findOneBy({ id });
  if (!u) throw ApiError.notFound('User not found');
  return u;
}

export const userService = {
  get,

  async updateProfile(id: string, dto: UpdateProfileInput) {
    const u = await get(id);
    const { email, phone, ...rest } = dto;
    if (rest.username && rest.username !== u.username && (await users().existsBy({ username: rest.username }))) {
      throw ApiError.conflict('That username is taken');
    }
    if (email && email.toLowerCase() !== u.email) {
      if (await users().existsBy({ email: email.toLowerCase() })) throw ApiError.conflict('That email is already in use');
      u.email = email.toLowerCase();
      u.emailVerified = false;
    }
    if (phone && phone !== u.phone) {
      if (await users().existsBy({ phone })) throw ApiError.conflict('That phone number is already in use');
      u.phone = phone;
      u.phoneVerified = false;
    }
    Object.assign(u, rest);
    await users().save(u);
    return selfUser(u);
  },

  async updateSettings(id: string, dto: UpdateSettingsInput) {
    const u = await get(id);
    u.settings = {
      ...u.settings,
      ...dto,
      notifications: { ...u.settings.notifications, ...(dto.notifications ?? {}) },
      privacy: { ...u.settings.privacy, ...(dto.privacy ?? {}) },
    };
    await users().save(u);
    return u.settings;
  },

  async deleteAccount(id: string) {
    await users().delete(id);
    return { ok: true };
  },

  /** Profile card used in the community sidebar and the student profile screen. */
  async profile(id: string, viewerId: string) {
    const u = await get(id);
    const memberCount = (type: CommunityType) =>
      repo(CommunityMember)
        .createQueryBuilder('m')
        .innerJoin('m.community', 'c')
        .where('m.userId = :id', { id })
        .andWhere('c.type = :type', { type })
        .getCount();
    const [followers, following, communities, groups, chats, isFollowing] = await Promise.all([
      repo(Follow).countBy({ followingId: id }),
      repo(Follow).countBy({ followerId: id }),
      memberCount(CommunityType.COMMUNITY),
      memberCount(CommunityType.STUDY_GROUP),
      repo(DirectMessage)
        .createQueryBuilder('d')
        .select('COUNT(DISTINCT CASE WHEN d.senderId = :id THEN d.recipientId ELSE d.senderId END)', 'n')
        .where('d.senderId = :id OR d.recipientId = :id', { id })
        .getRawOne<{ n: string }>(),
      repo(Follow).existsBy({ followerId: viewerId, followingId: id }),
    ]);
    return {
      ...publicUser(u),
      bio: u.bio,
      coverUrl: u.coverUrl,
      streakDays: u.streakDays,
      stats: { followers, following, communities, groups, chats: Number(chats?.n ?? 0) },
      isFollowing,
    };
  },

  async search(q: PageQuery & { role?: Role }, excludeId?: string) {
    const qb = users().createQueryBuilder('u').where('u.status != :s', { s: 'suspended' });
    if (excludeId) qb.andWhere('u.id != :excludeId', { excludeId });
    if (q.role) qb.andWhere('u.role = :role', { role: q.role });
    if (q.q) {
      qb.andWhere(
        new Brackets((w) =>
          w
            .where("(u.firstName || ' ' || u.lastName) ILIKE :q", { q: `%${q.q}%` })
            .orWhere('u.username ILIKE :q', { q: `%${q.q}%` }),
        ),
      );
    }
    const [items, total] = await qb.orderBy('u.firstName', 'ASC').skip(offset(q)).take(q.limit).getManyAndCount();
    return paginate(items.map(publicUser), total, q);
  },

  async follow(followerId: string, followingId: string) {
    if (followerId === followingId) throw ApiError.badRequest("You can't follow yourself");
    await get(followingId);
    await repo(Follow).upsert({ followerId, followingId }, ['followerId', 'followingId']);
    return { following: true };
  },

  async unfollow(followerId: string, followingId: string) {
    await repo(Follow).delete({ followerId, followingId });
    return { following: false };
  },

  // ---------- Gamification helpers used by other services ----------

  async addPoints(userId: string, points: number) {
    if (points) await users().increment({ id: userId }, 'points', points);
  },

  /** Records study time for the activity charts and keeps the daily streak current. */
  async logActivity(userId: string, minutes: number, courseId: string | null = null, testsDone = 0) {
    const logs = repo(ActivityLog);
    const date = isoDate();
    const qb = logs.createQueryBuilder('a').where('a.userId = :userId AND a.date = :date', { userId, date });
    courseId ? qb.andWhere('a.courseId = :courseId', { courseId }) : qb.andWhere('a.courseId IS NULL');
    const existing = await qb.getOne();
    if (existing) {
      existing.minutes += minutes;
      existing.testsDone += testsDone;
      await logs.save(existing);
    } else {
      await logs.save(logs.create({ userId, date, minutes, courseId, testsDone }));
    }
    await this.touchStreak(userId);
  },

  async touchStreak(userId: string) {
    const u = await get(userId);
    const today = isoDate();
    if (u.lastActiveDate === today) return;
    const yesterday = isoDate(new Date(Date.now() - 86_400_000));
    await users().update(userId, {
      streakDays: u.lastActiveDate === yesterday ? u.streakDays + 1 : 1,
      lastActiveDate: today,
    });
  },
};
