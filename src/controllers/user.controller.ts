import type { Request } from 'express';
import { env } from '../config/env';
import { me } from '../middlewares/auth.middleware';
import { notificationService } from '../services/notification.service';
import { userService } from '../services/user.service';
import { ApiError } from '../utils/ApiError';
import { selfUser } from '../utils/serialize';

export const userController = {
  me: async (req: Request) => selfUser(await userService.get(me(req).id)),
  update: (req: Request) => userService.updateProfile(me(req).id, req.body),
  settings: (req: Request) => userService.updateSettings(me(req).id, req.body),
  removeAvatar: (req: Request) => userService.updateProfile(me(req).id, { avatarUrl: null }),
  deleteAccount: (req: Request) => userService.deleteAccount(me(req).id),
  search: (req: Request) => userService.search(req.query as never, me(req).id),
  profile: (req: Request) => userService.profile(req.params.id, me(req).id),
  follow: (req: Request) => userService.follow(me(req).id, req.params.id),
  unfollow: (req: Request) => userService.unfollow(me(req).id, req.params.id),
};

export const notificationController = {
  list: (req: Request) => notificationService.list(me(req).id, req.query as never),
  markRead: (req: Request) => notificationService.markRead(me(req).id, req.body.ids),
  markAllRead: (req: Request) => notificationService.markAllRead(me(req).id),
  remove: (req: Request) => notificationService.remove(me(req).id, req.params.id),
};

export const uploadController = {
  async upload(req: Request) {
    const file = req.file;
    if (!file) throw ApiError.badRequest('Attach a file in the "file" field');
    if (file.mimetype.startsWith('image/') && file.size > 15 * 1024 * 1024) {
      throw ApiError.badRequest('Images must be under 15MB');
    }
    return {
      url: `${env.publicUrl}/uploads/${file.filename}`,
      path: `/uploads/${file.filename}`,
      name: file.originalname,
      size: file.size,
      mimeType: file.mimetype,
    };
  },
};
