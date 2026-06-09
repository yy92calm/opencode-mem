import { Hono } from 'hono';
import { insertHard, listHard, searchHard, deleteHard } from '../db/repo.js';
import { maybeTriggerProfileRefresh } from '../cron/jobs.js';

export const memoryRoutes = new Hono<{ Variables: { user_id: string } }>();

/**
 * POST /api/memory
 * Body: HardMemory (without user_id, server overrides).
 * Plugin uses this when user says "记住X" / "remember X".
 */
memoryRoutes.post('/', async (c) => {
  const user_id = c.get('user_id');
  const body = await c.req.json() as any;

  const id = insertHard({
    user_id,
    type: body.type ?? 'fact',
    title: body.title ?? '(untitled)',
    content: body.content ?? '',
    facts: body.facts ?? [],
    concepts: body.concepts ?? [],
    source: body.source ?? 'manual',
    priority: body.priority ?? 'high',
    session_id: body.session_id,
    timestamp: body.timestamp ?? new Date().toISOString(),
  });

  // Fire-and-forget delta-triggered profile refresh.
  maybeTriggerProfileRefresh(user_id).catch(() => {});

  return c.json({ id });
});

/**
 * GET /api/memory?limit=100
 */
memoryRoutes.get('/', (c) => {
  const user_id = c.get('user_id');
  const limit = parseInt(c.req.query('limit') || '100');
  return c.json({ items: listHard(user_id, limit) });
});

/**
 * GET /api/memory/search?q=...&limit=50
 */
memoryRoutes.get('/search', (c) => {
  const user_id = c.get('user_id');
  const q = c.req.query('q') || '';
  const limit = parseInt(c.req.query('limit') || '50');
  return c.json({ items: searchHard(user_id, q, limit) });
});

/**
 * DELETE /api/memory/:id
 */
memoryRoutes.delete('/:id', (c) => {
  const user_id = c.get('user_id');
  const id = parseInt(c.req.param('id'));
  const ok = deleteHard(user_id, id);
  if (!ok) {
    c.status(404);
    return c.json({ error: 'Not found' });
  }
  return c.json({ deleted: true });
});
