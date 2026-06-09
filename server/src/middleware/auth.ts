import { getConfig } from '../config/index.js';
import type { Context, Next } from 'hono';

type AuthVars = { user_id: string };

/**
 * Bearer auth middleware that validates against configured user API keys.
 * Extracts user_id from matched key and stores it in context.
 */
export async function authMiddleware(
  c: Context<{ Variables: AuthVars }>,
  next: Next,
): Promise<Response | void> {
  const authHeader = c.req.header('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or invalid authorization header' }, 401);
  }

  const token = authHeader.slice(7);
  const cfg = getConfig();
  const binding = cfg.users.find(u => u.api_key === token);

  if (!binding) {
    return c.json({ error: 'Invalid API key' }, 403);
  }

  c.set('user_id', binding.user_id);
  await next();
}
