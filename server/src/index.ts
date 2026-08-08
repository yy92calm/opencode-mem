import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serve } from '@hono/node-server';
import { getConfig } from './config/index.js';
import { initDb, closeDb } from './db/schema.js';
import { initLLM } from './llm/client.js';
import { startCron, stopCron } from './cron/jobs.js';
import { authMiddleware } from './middleware/auth.js';
import { rawRoutes } from './routes/raw.js';
import { memoryRoutes } from './routes/memory.js';
import { profileRoutes } from './routes/profile.js';
import { skillRoutes } from './routes/skills.js';

function log(level: string, msg: string, extra?: object) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, scope: 'boot', msg, ...(extra || {}) }));
}

/**
 * Warn if the configured tz doesn't match the process's actual system tz.
 *
 * Daily summaries bucket raw timestamps by calendar day. The JS side
 * (yesterdayDate) honors config.tz, but SQLite's localtime() follows the
 * process's C-library TZ (the host/container tz, not the IANA name). If those
 * disagree, a day's worth of raws can land in the wrong summary bucket.
 *
 * Set the process tz to match config.tz (e.g. `TZ=Asia/Shanghai` env, or the
 * `tz:` field in docker-compose) to silence this.
 */
function checkTimezoneAlignment(configTz: string): void {
  const processTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  if (processTz !== configTz) {
    log('warn', `timezone mismatch: config.tz=${configTz} but process tz=${processTz}. ` +
      `Set the process/host TZ to match config.tz, or daily summaries may bucket the wrong day.`);
  }
}

function bootstrap() {
  const cfg = getConfig();
  initDb(cfg.db_path);
  initLLM(cfg.llm);
  checkTimezoneAlignment(cfg.tz);

  const app = new Hono<{ Variables: { user_id: string } }>();

  // CORS only on /api/*, restricted (override with explicit origin allowlist in prod)
  app.use('/api/*', cors({
    origin: process.env.CORS_ORIGIN?.split(',') ?? '*',
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
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
  app.route('/api/skills', skillRoutes);

  app.get('/api/whoami', (c) => c.json({ user_id: c.get('user_id') }));

  startCron();

  log('info', 'opencode-mem-worker ready', {
    port: cfg.port,
    db: cfg.db_path,
    llm_model: cfg.llm.model,
    users: cfg.users.length,
  });

  const server = serve({ fetch: app.fetch, port: cfg.port });
  installGracefulShutdown(server);
}

let shuttingDown = false;
function installGracefulShutdown(server: ReturnType<typeof serve>): void {
  const shutdown = (sig: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log('info', `shutdown received (${sig})`);

    // 1. Stop cron so no new LLM jobs start.
    stopCron();

    // 2. Stop accepting new connections.
    server.close(() => {
      // 3. Checkpoint WAL + close DB.
      closeDb();
      log('info', 'shutdown complete');
      process.exit(0);
    });

    // Force-exit if close() hangs (e.g. long-lived connections).
    setTimeout(() => {
      log('warn', 'shutdown timeout, forcing exit');
      closeDb();
      process.exit(1);
    }, 10000).unref();
  };

  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.on(sig, () => shutdown(sig));
  }
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
