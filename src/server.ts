import 'reflect-metadata';
import { createServer } from 'http';
import { createApp } from './app';
import { AppDataSource } from './config/database';
import { env } from './config/env';
import { billingService } from './services/billing.service';
import { initSockets } from './sockets';
import { logger, scoped } from './utils/logger';

const log = scoped('server');

process.on('unhandledRejection', (reason) => log.error('Unhandled promise rejection', { err: reason }));
process.on('uncaughtException', (err) => {
  log.error('Uncaught exception — shutting down', { err });
  setTimeout(() => process.exit(1), 500);
});

async function main() {
  await AppDataSource.initialize();
  log.info(`Database connected: ${env.db.name}@${env.db.host}${env.db.sync ? ' (schema sync on)' : ''}`);

  const server = createServer(createApp());
  initSockets(server);
  server.listen(env.port, () => {
    log.info(`Academia Universal API listening on :${env.port} (${env.nodeEnv})`);
    log.info(`API docs: ${env.publicUrl}/api/docs`);
    log.info(env.paystack.secretKey ? `Paystack enabled (${env.paystack.secretKey.startsWith('sk_live') ? 'LIVE' : 'test'} mode)` : 'Paystack disabled — set PAYSTACK_SECRET_KEY');
  });

  // Background jobs: expire Pro plans and abandon stale checkouts.
  const housekeeping = setInterval(() => {
    billingService.housekeeping().catch((err) => log.error('Housekeeping failed', { err }));
  }, 15 * 60_000);
  housekeeping.unref();

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info(`${signal} received — shutting down`);
    clearInterval(housekeeping);
    server.close();
    await AppDataSource.destroy().catch(() => undefined);
    logger.on('finish', () => process.exit(0));
    logger.end();
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  log.error('Failed to start', { err });
  setTimeout(() => process.exit(1), 500);
});
