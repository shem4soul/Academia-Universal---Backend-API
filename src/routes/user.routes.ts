import { Router } from 'express';
import { notificationController, uploadController, userController as c } from '../controllers/user.controller';
import { authenticate } from '../middlewares/auth.middleware';
import { upload } from '../middlewares/upload.middleware';
import { idParam, validate } from '../middlewares/validate.middleware';
import { handle } from '../utils/asyncHandler';
import * as v from '../validators/user.validator';

export const userRoutes = Router();
userRoutes.use(authenticate);
userRoutes.get('/me', handle(c.me));
userRoutes.patch('/me', validate({ body: v.updateProfileSchema }), handle(c.update));
userRoutes.patch('/me/settings', validate({ body: v.updateSettingsSchema }), handle(c.settings));
userRoutes.delete('/me/avatar', handle(c.removeAvatar));
userRoutes.delete('/me', handle(c.deleteAccount));
userRoutes.get('/', validate({ query: v.userSearchQuery }), handle(c.search));
userRoutes.get('/:id', validate({ params: idParam }), handle(c.profile));
userRoutes.post('/:id/follow', validate({ params: idParam }), handle(c.follow));
userRoutes.delete('/:id/follow', validate({ params: idParam }), handle(c.unfollow));

export const notificationRoutes = Router();
notificationRoutes.use(authenticate);
notificationRoutes.get('/', validate({ query: v.notificationQuery }), handle(notificationController.list));
notificationRoutes.post('/read', validate({ body: v.markReadSchema }), handle(notificationController.markRead));
notificationRoutes.post('/read-all', handle(notificationController.markAllRead));
notificationRoutes.delete('/:id', validate({ params: idParam }), handle(notificationController.remove));

export const uploadRoutes = Router();
uploadRoutes.post('/', authenticate, upload.single('file'), handle(uploadController.upload, 201));
