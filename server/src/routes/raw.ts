import { Hono } from 'hono';
import { insertRaw, insertRawBatch, countRawByDate } from '../db/repo.js';

export const rawRoutes = new Hono<{ Variables: { user_id: string } }>();

/**
 * POST /api/raw
 * Body: a single RawConversation OR { items: [...] } for batch upload.
 * Plugin uses this for tool.execute.after + chat messages.
 */
rawRoutes.post('/', async (c) => {
  const user_id = c.get('user_id');
  const body = await c.req.json() as any;

  if (Array.isArray(body.items)) {
    const items = body.items.map((r: any) => ({ ...r, user_id }));
    const n = insertRawBatch(items);
    return c.json({ inserted: n });
  }

  const id = insertRaw({ ...body, user_id });
  return c.json({ id });
});

/**
 * GET /api/raw/count?date=YYYY-MM-DD
 * Lightweight health check.
 */
rawRoutes.get('/count', (c) => {
  const user_id = c.get('user_id');
  const date = c.req.query('date') || new Date().toISOString().slice(0, 10);
  return c.json({ user_id, date, count: countRawByDate(user_id, date) });
});
