import { Hono } from 'hono';
import { listSkillDrafts, approveSkillDraft } from '../db/repo.js';

export const skillRoutes = new Hono<{ Variables: { user_id: string } }>();

/**
 * GET /api/skills/drafts?status=draft|approved
 * Skill drafts distilled weekly from long successful sessions.
 * Drafts are inert until explicitly approved — nothing auto-installs.
 */
skillRoutes.get('/drafts', (c) => {
  const user_id = c.get('user_id');
  const status = c.req.query('status');
  const filter = status === 'draft' || status === 'approved' ? status : undefined;
  return c.json({ items: listSkillDrafts(user_id, filter) });
});

/**
 * POST /api/skills/drafts/:id/approve
 * Marks a draft approved and returns it so the plugin can write it to disk.
 */
skillRoutes.post('/drafts/:id/approve', (c) => {
  const user_id = c.get('user_id');
  const id = parseInt(c.req.param('id'));
  if (!Number.isFinite(id) || id <= 0) return c.json({ error: 'Invalid id' }, 400);

  const draft = approveSkillDraft(user_id, id);
  if (!draft) {
    c.status(404);
    return c.json({ error: 'Not found or already approved' });
  }
  return c.json(draft);
});
