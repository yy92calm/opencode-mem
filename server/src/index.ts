import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { loadConfig } from './config/index.js';
import { initDb } from './db/schema.js';
import { initLLM } from './llm/client.js';
import { startCron } from './cron/jobs.js';
import { authMiddleware } from './middleware/auth.js';
import { rawRoutes } from './routes/raw.js';
import { memoryRoutes } from './routes/memory.js';
import { profileRoutes } from './routes/profile.js';

function bootstrap() {
  const cfg = loadConfig();
  initDb(cfg.db_path);
  initLLM(cfg.llm);

  const app = new Hono<{ Variables: { user_id: string } }>();

  // CORS only on /api/*, restricted (override with explicit origin allowlist in prod)
  app.use('/api/*', cors({
    origin: process.env.CORS_ORIGIN?.split(',') ?? '*',
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE'],
  }));

  app.get('/health', (c) => c.json({
    status: 'ok',
    time: new Date().toISOString(),
    users: cfg.users.length,
  }));

  // All /api/* routes require bearer auth
  app.use('/api/*', authMiddleware);

  app.route('/api/raw', rawRoutes);
  app.route('/api/memory', memoryRoutes);
  app.route('/api/profile', profileRoutes);

  app.get('/api/whoami', (c) => c.json({ user_id: c.get('user_id') }));

  startCron();

  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    level: 'info',
    scope: 'boot',
    msg: 'opencode-mem-worker ready',
    port: cfg.port,
    db: cfg.db_path,
    llm_model: cfg.llm.model,
    users: cfg.users.length,
  }));

  serve({ fetch: app.fetch, port: cfg.port });
}

try {
  bootstrap();
} catch (e) {
  console.error(JSON.stringify({
    ts: new Date().toISOString(),
    level: 'fatal',
    scope: 'boot',
    error: String(e),
  }));
  process.exit(1);
}
