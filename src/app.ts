import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import { AppDataSource } from './config/database';
import { env } from './config/env';
import { buildOpenApi } from './docs/openapi';
import { errorHandler, notFoundHandler } from './middlewares/error.middleware';
import { requestLogger } from './middlewares/requestLogger.middleware';
import { UPLOAD_DIR } from './middlewares/upload.middleware';
import api from './routes';

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(requestLogger);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || env.corsOrigins.includes(origin) || !env.isProd),
      credentials: true,
    }),
  );
  app.use(
    express.json({
      limit: '2mb',
      // Keep the exact bytes for webhook signature checks (Paystack signs the raw body).
      verify: (req, _res, buf) => {
        if ((req as express.Request).originalUrl?.startsWith('/api/webhooks/')) (req as express.Request).rawBody = Buffer.from(buf);
      },
    }),
  );
  app.use(express.urlencoded({ extended: true }));

  // Liveness: the process is up.
  app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'academia-universal-api', time: new Date().toISOString() }));
  // Readiness: the database answers (used by Docker / load balancer health checks).
  app.get('/health/ready', async (_req, res) => {
    try {
      await AppDataSource.query('SELECT 1');
      res.json({ status: 'ready', db: 'up', paystack: env.paystack.secretKey ? 'configured' : 'not configured' });
    } catch {
      res.status(503).json({ status: 'unavailable', db: 'down' });
    }
  });
  app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }));

  const spec = buildOpenApi();
  app.get('/api/docs.json', (_req, res) => res.json(spec));
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(spec, { customSiteTitle: 'Academia Universal API' }));

  app.use('/api', api);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
