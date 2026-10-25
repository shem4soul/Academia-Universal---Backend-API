import { In, LessThan } from 'typeorm';
import { repo } from '../config/database';
import {
  Announcement,
  Comment,
  Community,
  CommunityMember,
  Course,
  DirectMessage,
  Enrollment,
  Follow,
  Message,
  Post,
  PostLike,
  User,
} from '../models';
import { realtime } from '../sockets';
import { ApiError } from '../utils/ApiError';
import { CommunityType, NotificationType, Role } from '../utils/enums';
import { offset, paginate, PageQuery } from '../utils/pagination';
import { publicUser } from '../utils/serialize';
import { notificationService } from './notification.service';

const communities = () => repo(Community);
const members = () => repo(CommunityMember);
const messages = () => repo(Message);

async function getCommunity(id: string) {
  const c = await communities().findOneBy({ id });
  if (!c) throw ApiError.notFound('Community not found');
  return c;
}

async function membership(communityId: string, userId: string) {
  return members().findOneBy({ communityId, userId });
}

async function requireMember(communityId: string, user: Express.AuthUser) {
  const m = await membership(communityId, user.id);
  if (!m && user.role !== Role.ADMIN) throw ApiError.forbidden('Join this community to see its messages');
  return m;
}

/** Unread counts and up to 4 member avatars for a set of communities. */
async function decorate(list: Community[], userId: string) {
  if (!list.length) return [];
  const ids = list.map((c) => c.id);
  const mine = await members().findBy({ userId, communityId: In(ids) });
  const unread = mine.length
    ? await messages()
        .createQueryBuilder('msg')
        .innerJoin(CommunityMember, 'm', 'm.communityId = msg.communityId AND m.userId = :userId', { userId })
        .select('msg.communityId', 'communityId')
        .addSelect('COUNT(*)', 'n')
        .where('msg.communityId IN (:...ids)', { ids: mine.map((m) => m.communityId) })
        .andWhere('msg.createdAt > m.lastReadAt')
        .andWhere('msg.senderId != :userId', { userId })
        .groupBy('msg.communityId')
        .getRawMany<{ communityId: string; n: string }>()
    : [];
  const previews = await members()
    .createQueryBuilder('m')
    .leftJoinAndSelect('m.user', 'u')
    .where('m.communityId IN (:...ids)', { ids })
    .orderBy('m.createdAt', 'ASC')
    .getMany();
  return list.map((c) => ({
    ...c,
    isMember: mine.some((m) => m.communityId === c.id),
    unread: Number(unread.find((u) => u.communityId === c.id)?.n ?? 0),
    memberPreview: previews
      .filter((p) => p.communityId === c.id)
      .slice(0, 4)
      .map((p) => publicUser(p.user)),
  }));
}

function messageView(m: Message) {
  return {
    id: m.id,
    communityId: m.communityId,
    body: m.body,
    attachmentUrl: m.attachmentUrl,
    attachmentType: m.attachmentType,
    createdAt: m.createdAt,
    sender: publicUser(m.sender),
  };
}

async function addMember(communityId: string, userId: string, role: CommunityMember['role'] = 'member') {
  const exists = await membership(communityId, userId);
  if (exists) return exists;
  const m = await members().save(members().create({ communityId, userId, role, lastReadAt: new Date() }));
  await communities().increment({ id: communityId }, 'memberCount', 1);
  return m;
}

export const communityService = {
  async list(userId: string, q: PageQuery & { type?: CommunityType; scope: 'all' | 'mine' | 'recommended' }) {
    const qb = communities().createQueryBuilder('c');
    if (q.type) qb.andWhere('c.type = :type', { type: q.type });
    if (q.q) qb.andWhere('c.name ILIKE :q', { q: `%${q.q}%` });
    if (q.scope === 'mine') {
      qb.innerJoin(CommunityMember, 'm', 'm.communityId = c.id AND m.userId = :userId', { userId });
    } else {
      qb.andWhere('c.isPublic = true');
      if (q.scope === 'recommended') {
        qb.andWhere('NOT EXISTS (SELECT 1 FROM community_members x WHERE x."communityId" = c.id AND x."userId" = :userId)', { userId });
        qb.orderBy('c.isRecommended', 'DESC');
      }
    }
    qb.addOrderBy('c.memberCount', 'DESC');
    const [rows, total] = await qb.skip(offset(q)).take(q.limit).getManyAndCount();
    return paginate(await decorate(rows, userId), total, q);
  },

  async unreadTotal(userId: string) {
    const r = await messages()
      .createQueryBuilder('msg')
      .innerJoin(CommunityMember, 'm', 'm.communityId = msg.communityId AND m.userId = :userId', { userId })
      .where('msg.createdAt > m.lastReadAt AND msg.senderId != :userId', { userId })
      .getCount();
    const unreadDms = await repo(DirectMessage)
      .createQueryBuilder('d')
      .where('d.recipientId = :userId AND d.readAt IS NULL', { userId })
      .getCount();
    return { communities: r, direct: unreadDms, total: r + unreadDms };
  },

  async detail(id: string, userId: string) {
    const c = await getCommunity(id);
    const [decorated] = await decorate([c], userId);
    const course = c.courseId ? await repo(Course).findOne({ where: { id: c.courseId }, select: ['id', 'title', 'slug'] }) : null;
    return { ...decorated, course };
  },

  async create(user: Express.AuthUser, dto: {
    name: string;
    description?: string;
    avatarUrl?: string | null;
    type: CommunityType;
    isPublic: boolean;
    courseId?: string | null;
    memberIds?: string[];
  }) {
    const { memberIds, ...data } = dto;
    if (data.type === CommunityType.COMMUNITY && ![Role.TEACHER, Role.ADMIN].includes(user.role)) {
      // Learners create study groups; communities are run by instructors and admins.
      data.type = CommunityType.STUDY_GROUP;
    }
    const c = await communities().save(communities().create({ ...data, createdById: user.id, memberCount: 0 }));
    await addMember(c.id, user.id, 'owner');
    for (const id of memberIds ?? []) {
      if (id !== user.id && (await repo(User).existsBy({ id }))) {
        await addMember(c.id, id);
        await notificationService.notify(id, {
          title: `You were added to ${c.name}`,
          type: NotificationType.COMMUNITY,
          link: `/community/${c.id}`,
        });
      }
    }
    return this.detail(c.id, user.id);
  },

  async update(id: string, user: Express.AuthUser, dto: Partial<Community>) {
    const c = await getCommunity(id);
    const m = await membership(id, user.id);
    if (user.role !== Role.ADMIN && m?.role !== 'owner' && m?.role !== 'admin') throw ApiError.forbidden('Only group admins can edit this');
    await communities().update(c.id, dto);
    return this.detail(id, user.id);
  },

  async remove(id: string, user: Express.AuthUser) {
    const c = await getCommunity(id);
    if (user.role !== Role.ADMIN && c.createdById !== user.id) throw ApiError.forbidden('Only the owner can delete this');
    await communities().delete(id);
    return { ok: true };
  },

  async join(id: string, userId: string) {
    const c = await getCommunity(id);
    if (!c.isPublic) throw ApiError.forbidden('This group is private. Ask a member to add you.');
    await addMember(id, userId);
    return this.detail(id, userId);
  },

  async leave(id: string, userId: string) {
    const res = await members().delete({ communityId: id, userId });
    if (res.affected) await communities().decrement({ id }, 'memberCount', 1);
    return { ok: true };
  },

  async members(id: string, user: Express.AuthUser) {
    await getCommunity(id);
    const rows = await members().find({ where: { communityId: id }, order: { role: 'ASC', createdAt: 'ASC' } });
    return rows.map((m) => ({ ...publicUser(m.user), memberRole: m.role, title: m.title, joinedAt: m.createdAt }));
  },

  async messages(id: string, user: Express.AuthUser, q: { before?: Date; limit: number }) {
    await getCommunity(id);
    await requireMember(id, user);
    const rows = await messages().find({
      where: { communityId: id, ...(q.before ? { createdAt: LessThan(q.before) } : {}) },
      order: { createdAt: 'DESC' },
      take: q.limit,
    });
    return { items: rows.reverse().map(messageView), hasMore: rows.length === q.limit };
  },

  async send(id: string, user: Express.AuthUser, dto: { body: string; attachmentUrl?: string; attachmentType?: string }) {
    const c = await getCommunity(id);
    const m = await requireMember(id, user);
    const msg = await messages().save(
      messages().create({
        communityId: id,
        senderId: user.id,
        body: dto.body,
        attachmentUrl: dto.attachmentUrl ?? null,
        attachmentType: dto.attachmentType ?? null,
      }),
    );
    if (m) await members().update(m.id, { lastReadAt: new Date() });
    const full = await messages().findOneByOrFail({ id: msg.id });
    const view = messageView(full);
    realtime.toCommunity(c.id, 'message:new', view);
    return view;
  },

  async markRead(id: string, userId: string) {
    await members().update({ communityId: id, userId }, { lastReadAt: new Date() });
    return { ok: true };
  },

  async setLiveSession(id: string, user: Express.AuthUser, at: Date | null) {
    const c = await getCommunity(id);
    const m = await requireMember(id, user);
    if (user.role !== Role.ADMIN && m?.role === 'member' && user.role !== Role.TEACHER) {
      throw ApiError.forbidden('Only group admins or instructors can start a live session');
    }
    await communities().update(id, { liveSessionAt: at });
    if (at) {
      const ids = (await members().find({ where: { communityId: id }, select: ['userId'] })).map((x) => x.userId).filter((u) => u !== user.id);
      const soon = at.getTime() - Date.now() < 5 * 60_000;
      await notificationService.notifyMany(ids, {
        title: soon ? `Live session started in ${c.name}` : `Live session scheduled in ${c.name}`,
        body: soon ? 'Tap to join now.' : at.toUTCString(),
        type: NotificationType.COMMUNITY,
        link: `/community/${id}/live`,
      });
      realtime.toCommunity(id, 'live:update', { communityId: id, at });
    }
    return this.detail(id, user.id);
  },

  // ---------- Posts ----------

  async posts(userId: string, q: PageQuery & { communityId?: string; authorId?: string; feed: 'all' | 'following' }) {
    const qb = repo(Post).createQueryBuilder('p').leftJoinAndSelect('p.author', 'a');
    if (q.communityId) qb.andWhere('p.communityId = :cid', { cid: q.communityId });
    if (q.authorId) qb.andWhere('p.authorId = :aid', { aid: q.authorId });
    if (q.feed === 'following') {
      qb.andWhere('(p.authorId = :userId OR p.authorId IN (SELECT f."followingId" FROM follows f WHERE f."followerId" = :userId))', { userId });
    }
    if (q.q) qb.andWhere('p.body ILIKE :q', { q: `%${q.q}%` });
    const [rows, total] = await qb.orderBy('p.createdAt', 'DESC').skip(offset(q)).take(q.limit).getManyAndCount();
    const liked = rows.length ? await repo(PostLike).findBy({ userId, postId: In(rows.map((r) => r.id)) }) : [];
    const following = rows.length ? await repo(Follow).findBy({ followerId: userId, followingId: In(rows.map((r) => r.authorId)) }) : [];
    return paginate(
      rows.map((p) => ({
        id: p.id,
        body: p.body,
        imageUrl: p.imageUrl,
        communityId: p.communityId,
        likeCount: p.likeCount,
        commentCount: p.commentCount,
        createdAt: p.createdAt,
        author: publicUser(p.author),
        likedByMe: liked.some((l) => l.postId === p.id),
        followingAuthor: following.some((f) => f.followingId === p.authorId),
      })),
      total,
      q,
    );
  },

  async createPost(user: Express.AuthUser, dto: { body: string; imageUrl?: string; communityId?: string }) {
    if (dto.communityId) await requireMember(dto.communityId, user);
    const p = await repo(Post).save(repo(Post).create({ ...dto, authorId: user.id, imageUrl: dto.imageUrl ?? null, communityId: dto.communityId ?? null }));
    return repo(Post).findOneByOrFail({ id: p.id });
  },

  async deletePost(id: string, user: Express.AuthUser) {
    const p = await repo(Post).findOneBy({ id });
    if (!p) throw ApiError.notFound('Post not found');
    if (p.authorId !== user.id && user.role !== Role.ADMIN) throw ApiError.forbidden();
    await repo(Post).delete(id);
    return { ok: true };
  },

  async like(postId: string, userId: string, on: boolean) {
    const p = await repo(Post).findOneBy({ id: postId });
    if (!p) throw ApiError.notFound('Post not found');
    const exists = await repo(PostLike).existsBy({ postId, userId });
    if (on && !exists) {
      await repo(PostLike).save({ postId, userId });
      await repo(Post).increment({ id: postId }, 'likeCount', 1);
      if (p.authorId !== userId) {
        await notificationService.notify(p.authorId, { title: 'Someone liked your post', type: NotificationType.COMMUNITY, link: `/community/posts/${postId}` });
      }
    } else if (!on && exists) {
      await repo(PostLike).delete({ postId, userId });
      await repo(Post).decrement({ id: postId }, 'likeCount', 1);
    }
    const fresh = await repo(Post).findOneByOrFail({ id: postId });
    return { liked: on, likeCount: fresh.likeCount };
  },

  async comments(postId: string, q: PageQuery) {
    const [rows, total] = await repo(Comment).findAndCount({ where: { postId }, order: { createdAt: 'ASC' }, skip: offset(q), take: q.limit });
    return paginate(rows.map((c) => ({ id: c.id, body: c.body, createdAt: c.createdAt, author: publicUser(c.author) })), total, q);
  },

  async comment(postId: string, userId: string, body: string) {
    const p = await repo(Post).findOneBy({ id: postId });
    if (!p) throw ApiError.notFound('Post not found');
    const c = await repo(Comment).save(repo(Comment).create({ postId, authorId: userId, body }));
    await repo(Post).increment({ id: postId }, 'commentCount', 1);
    if (p.authorId !== userId) {
      await notificationService.notify(p.authorId, { title: 'New comment on your post', body: body.slice(0, 80), type: NotificationType.COMMUNITY, link: `/community/posts/${postId}` });
    }
    const full = await repo(Comment).findOneByOrFail({ id: c.id });
    return { id: full.id, body: full.body, createdAt: full.createdAt, author: publicUser(full.author) };
  },

  // ---------- Direct messages ----------

  async conversations(userId: string) {
    const rows: { otherId: string; lastAt: Date; unread: string }[] = await repo(DirectMessage).query(
      `SELECT CASE WHEN "senderId" = $1 THEN "recipientId" ELSE "senderId" END AS "otherId",
              MAX("createdAt") AS "lastAt",
              SUM(CASE WHEN "recipientId" = $1 AND "readAt" IS NULL THEN 1 ELSE 0 END) AS unread
         FROM direct_messages
        WHERE "senderId" = $1 OR "recipientId" = $1
        GROUP BY 1 ORDER BY 2 DESC`,
      [userId],
    );
    if (!rows.length) return [];
    const people = await repo(User).findBy({ id: In(rows.map((r) => r.otherId)) });
    const result = [];
    for (const r of rows) {
      const last = await repo(DirectMessage).findOne({
        where: [
          { senderId: userId, recipientId: r.otherId },
          { senderId: r.otherId, recipientId: userId },
        ],
        order: { createdAt: 'DESC' },
      });
      result.push({
        user: publicUser(people.find((p) => p.id === r.otherId)),
        lastMessage: last ? { body: last.body, createdAt: last.createdAt, fromMe: last.senderId === userId } : null,
        unread: Number(r.unread),
      });
    }
    return result;
  },

  async thread(userId: string, otherId: string, q: { before?: Date; limit: number }) {
    const other = await repo(User).findOneBy({ id: otherId });
    if (!other) throw ApiError.notFound('User not found');
    const before = q.before ? { createdAt: LessThan(q.before) } : {};
    const rows = await repo(DirectMessage).find({
      where: [
        { senderId: userId, recipientId: otherId, ...before },
        { senderId: otherId, recipientId: userId, ...before },
      ],
      order: { createdAt: 'DESC' },
      take: q.limit,
    });
    await repo(DirectMessage)
      .createQueryBuilder()
      .update()
      .set({ readAt: new Date() })
      .where('"senderId" = :otherId AND "recipientId" = :userId AND "readAt" IS NULL', { otherId, userId })
      .execute();
    return {
      user: publicUser(other),
      items: rows.reverse().map((d) => ({ id: d.id, body: d.body, createdAt: d.createdAt, fromMe: d.senderId === userId, readAt: d.readAt })),
      hasMore: rows.length === q.limit,
    };
  },

  async sendDirect(userId: string, otherId: string, body: string) {
    if (userId === otherId) throw ApiError.badRequest("You can't message yourself");
    if (!(await repo(User).existsBy({ id: otherId }))) throw ApiError.notFound('User not found');
    const d = await repo(DirectMessage).save(repo(DirectMessage).create({ senderId: userId, recipientId: otherId, body }));
    const payload = { id: d.id, body: d.body, createdAt: d.createdAt, senderId: userId, recipientId: otherId };
    realtime.toUser(otherId, 'dm:new', payload);
    return { ...payload, fromMe: true };
  },

  // ---------- Announcements ----------

  async announcements(user: Express.AuthUser) {
    if (user.role === Role.TEACHER) return repo(Announcement).find({ where: { authorId: user.id }, order: { createdAt: 'DESC' }, take: 50 });
    if (user.role === Role.ADMIN) return repo(Announcement).find({ order: { createdAt: 'DESC' }, take: 50 });
    const courseIds = (await repo(Enrollment).find({ where: { userId: user.id }, select: ['courseId'] })).map((e) => e.courseId);
    const instructorIds = courseIds.length
      ? (await repo(Course).find({ where: { id: In(courseIds) }, select: ['instructorId'] })).map((c) => c.instructorId)
      : [];
    const rows = await repo(Announcement)
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.author', 'u')
      .where('a.courseId IS NULL AND u.role = :admin', { admin: Role.ADMIN })
      .orWhere(courseIds.length ? 'a.courseId IN (:...courseIds)' : '1=0', { courseIds })
      .orWhere(instructorIds.length ? 'a.courseId IS NULL AND a.authorId IN (:...instructorIds)' : '1=0', { instructorIds })
      .orderBy('a.createdAt', 'DESC')
      .take(50)
      .getMany();
    return rows.map((a) => ({ ...a, author: publicUser(a.author) }));
  },

  async announce(user: Express.AuthUser, dto: { title: string; body: string; courseId?: string | null }) {
    let recipients: string[] = [];
    if (dto.courseId) {
      const course = await repo(Course).findOneBy({ id: dto.courseId });
      if (!course) throw ApiError.notFound('Course not found');
      if (user.role !== Role.ADMIN && course.instructorId !== user.id) throw ApiError.forbidden('Not your course');
      recipients = (await repo(Enrollment).find({ where: { courseId: dto.courseId }, select: ['userId'] })).map((e) => e.userId);
    } else if (user.role === Role.TEACHER) {
      recipients = (
        await repo(Enrollment)
          .createQueryBuilder('e')
          .innerJoin('e.course', 'c')
          .where('c.instructorId = :id', { id: user.id })
          .select('DISTINCT e.userId', 'userId')
          .getRawMany<{ userId: string }>()
      ).map((r) => r.userId);
    }
    const a = await repo(Announcement).save(repo(Announcement).create({ ...dto, courseId: dto.courseId ?? null, authorId: user.id }));
    await notificationService.notifyMany(recipients, { title: dto.title, body: dto.body.slice(0, 140), type: NotificationType.COURSE, link: '/announcements' });
    return a;
  },
};
