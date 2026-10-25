import type { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import { env } from '../config/env';
import { scoped } from '../utils/logger';
import { verifyToken } from '../utils/tokens';

const log = scoped('socket');

let io: Server | null = null;

/**
 * Socket.IO at path /socket.io, namespace /realtime.
 * Connect with `io(API_URL + '/realtime', { auth: { token: accessToken } })`.
 * Each socket joins `user:<id>`; `community:join` subscribes to a community's `message:new` and `typing` events.
 */
export function initSockets(server: HttpServer) {
  io = new Server(server, { cors: { origin: env.corsOrigins, credentials: true } });
  const nsp = io.of('/realtime');

  nsp.use((socket, next) => {
    const token =
      (socket.handshake.auth?.token as string | undefined) ??
      (socket.handshake.headers.authorization ?? '').replace(/^Bearer /, '');
    const payload = token ? verifyToken(token, 'access') : null;
    if (!payload) {
      log.warn('Rejected socket connection', { ip: socket.handshake.address });
      return next(new Error('unauthorized'));
    }
    socket.data.userId = payload.sub;
    next();
  });

  nsp.on('connection', (socket) => {
    socket.join(`user:${socket.data.userId}`);
    log.debug('Connected', { userId: socket.data.userId, socketId: socket.id });
    socket.on('disconnect', (reason) => log.debug('Disconnected', { userId: socket.data.userId, reason }));
    socket.on('community:join', (communityId: string) => socket.join(`community:${communityId}`));
    socket.on('community:leave', (communityId: string) => socket.leave(`community:${communityId}`));
    socket.on('typing', (body: { communityId: string }) =>
      socket.to(`community:${body.communityId}`).emit('typing', { userId: socket.data.userId, communityId: body.communityId }),
    );
  });
  return io;
}

export const realtime = {
  toUser(userId: string, event: string, data: unknown) {
    io?.of('/realtime').to(`user:${userId}`).emit(event, data);
  },
  toCommunity(communityId: string, event: string, data: unknown) {
    io?.of('/realtime').to(`community:${communityId}`).emit(event, data);
  },
};
