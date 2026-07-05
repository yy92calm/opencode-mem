import { z } from 'zod';

export const rawItemSchema = z.object({
  session_id: z.string().min(1),
  role: z.enum(['user', 'assistant', 'tool']),
  content: z.string().default(''),
  tool_name: z.string().nullable().optional(),
  tool_input: z.string().nullable().optional(),
  tool_output: z.string().nullable().optional(),
  timestamp: z.string().min(1),
});

export const rawBatchSchema = z.object({
  items: z.array(rawItemSchema).min(1).max(1000),
});

export const hardMemorySchema = z.object({
  type: z.enum(['preference', 'config', 'decision', 'error', 'discovery', 'fact']).default('fact'),
  title: z.string().min(1).max(500).default('(untitled)'),
  content: z.string().default(''),
  facts: z.array(z.string()).default([]),
  concepts: z.array(z.string()).default([]),
  source: z.enum(['manual', 'auto-promoted']).default('manual'),
  priority: z.enum(['high', 'medium', 'low']).default('high'),
  session_id: z.string().nullable().optional(),
  timestamp: z.string().default(() => new Date().toISOString()),
});

export const regenerateSchema = z.object({
  scope: z.enum(['daily', 'weekly']).default('weekly'),
});

/** Parse with a schema; returns { ok, data, error }. */
export function safeParse<T>(schema: z.ZodType<T>, value: unknown):
  | { ok: true; data: T }
  | { ok: false; error: string } {
  const result = schema.safeParse(value);
  if (result.success) return { ok: true, data: result.data };
  return { ok: false, error: result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') };
}
