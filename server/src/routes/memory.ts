import { Hono } from 'hono';
import { insertHard, listHard, searchHard, searchSummaries, deleteHard, setHardStatus, touchHardUsage, getStats } from '../db/repo.js';
import { maybeTriggerProfileRefresh } from '../cron/jobs.js';
import { hardMemorySchema, memoryStatusSchema, safeParse } from '../validation.js';

export const memoryRoutes = new Hono<{ Variables: { user_id: string } }>();

/**
 * GET /api/memory/stats
 * Per-user store health: counts by source/status, profile freshness,
 * pending skill drafts, and the most frequently recalled memories.
 */
memoryRoutes.get('/stats', (c) => {
  const user_id = c.get('user_id');
  return c.json(getStats(user_id));
});

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
 * GET /api/memory?limit=100&include_deprecated=0
 * Defaults to active memories only (deprecated stay auditable via the flag).
 */
memoryRoutes.get('/', (c) => {
  const user_id = c.get('user_id');
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '100') || 100, 1), 500);
  const includeDeprecated = c.req.query('include_deprecated') === '1';
  return c.json({ items: listHard(user_id, limit, includeDeprecated) });
});

/**
 * GET /api/memory/search?q=...&limit=50&char_budget=8000&min_results=3
 *
 * Budgeted two-tier retrieval (mirrors layered-memory designs):
 *  1. hard memories by FTS rank, cut when the char budget is exhausted;
 *  2. if fewer than min_results matched, fall back to daily summaries with
 *     the remaining budget (returned as pseudo-memories, source='summary').
 * Usage counters of served hard memories are bumped async.
 */
memoryRoutes.get('/search', (c) => {
  const user_id = c.get('user_id');
  const q = c.req.query('q') || '';
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '50') || 50, 1), 200);
  const charBudget = Math.min(Math.max(parseInt(c.req.query('char_budget') || '8000') || 8000, 500), 100000);
  const minResults = Math.min(Math.max(parseInt(c.req.query('min_results') || '3') || 3, 0), 50);

  const all = searchHard(user_id, q, limit);

  // First tier: fill up to the char budget in rank order.
  const items: any[] = [];
  let used = 0;
  let truncated = false;
  for (const m of all) {
    const size = (m.title?.length ?? 0) + (m.content?.length ?? 0);
    if (used + size > charBudget && items.length > 0) {
      truncated = true;
      break;
    }
    items.push(m);
    used += size;
  }

  // Second tier: daily summaries absorb the remaining budget.
  if (q.trim() && items.length < minResults && used < charBudget) {
    for (const s of searchSummaries(user_id, q, 5)) {
      let text = s.content;
      try {
        const parsed = JSON.parse(s.content);
        text = [parsed.narrative, ...(parsed.decisions ?? []), ...(parsed.problems ?? [])]
          .filter(Boolean)
          .join('\n');
      } catch {
        /* content wasn't JSON — use raw */
      }
      if (used + text.length > charBudget) {
        truncated = true;
        break;
      }
      items.push({
        id: `summary:${s.id}`,
        user_id,
        type: 'fact',
        title: `Daily summary ${s.date}`,
        content: text,
        facts: [],
        concepts: [],
        source: 'summary',
        priority: 'low',
        status: 'active',
        timestamp: s.generated_at,
      });
      used += text.length;
    }
  }

  // Usage accounting for served hard memories (fire-and-forget).
  const hardIds = items.map(m => m.id).filter((id): id is number => typeof id === 'number');
  if (hardIds.length > 0) {
    Promise.resolve().then(() => touchHardUsage(hardIds)).catch(() => {});
  }

  return c.json({ items, truncated });
});

/**
 * PATCH /api/memory/:id
 * Body: { status: 'active' | 'deprecated' } — soft state transitions only;
 * physical removal stays behind DELETE.
 */
memoryRoutes.patch('/:id', async (c) => {
  const user_id = c.get('user_id');
  const id = parseInt(c.req.param('id'));
  if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);

  const body = await c.req.json().catch(() => null);
  const parsed = safeParse(memoryStatusSchema, body);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);

  const ok = setHardStatus(user_id, id, parsed.data.status);
  if (!ok) {
    c.status(404);
    return c.json({ error: 'Not found' });
  }
  return c.json({ id, status: parsed.data.status });
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
