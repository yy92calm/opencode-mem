import { Hono } from 'hono';
import { insertHard, listHard, searchHard, deleteHard } from '../db/repo.js';
import { maybeTriggerProfileRefresh } from '../cron/jobs.js';
import { hardMemorySchema, safeParse } from '../validation.js';

export const memoryRoutes = new Hono<{ Variables: { user_id: string } }>();

/**
 * POST /api/memory
 * Body: HardMemory (without user_id, server overrides).
 * Plugin uses this when user says "记住X" / "remember X".
 */
memoryRoutes.post('/', async (c) => {
  const user_id = c.get('user_id');
  const body = await c.req.json().catch(() => null);

  const parsed = safeParse(hardMemorySchema, body);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);

  const m = parsed.data;
  const id = insertHard({
    user_id,
    type: m.type,
    title: m.title,
    content: m.content,
    facts: m.facts,
    concepts: m.concepts,
    source: m.source,
    priority: m.priority,
    session_id: m.session_id ?? null,
    timestamp: m.timestamp,
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
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '100') || 100, 1), 500);
  return c.json({ items: listHard(user_id, limit) });
});

/**
 * GET /api/memory/search?q=...&limit=50
 */
memoryRoutes.get('/search', (c) => {
  const user_id = c.get('user_id');
  const q = c.req.query('q') || '';
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '50') || 50, 1), 200);
  return c.json({ items: searchHard(user_id, q, limit) });
});

/**
 * DELETE /api/memory/:id
 */
memoryRoutes.delete('/:id', (c) => {
  const user_id = c.get('user_id');
  const id = parseInt(c.req.param('id'));
  if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);
  const ok = deleteHard(user_id, id);
  if (!ok) {
    c.status(404);
    return c.json({ error: 'Not found' });
  }
  return c.json({ deleted: true });
});
