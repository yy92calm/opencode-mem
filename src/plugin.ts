import { type Plugin, type PluginInput, tool } from '@opencode-ai/plugin';
import { z } from 'zod';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { WorkerClient } from './sdk/remote.js';
import { setLoggerClient, logger } from './utils/logger.js';
import { isTrivial, safeStringify } from './utils/observer.js';
import type { MemPluginConfig, HardMemory } from './types/index.js';

const SERVICE = 'opencode-mem';
const MEM_DIR = join(homedir(), '.config', 'opencode', 'mem');
const DEFAULT_OFFLINE_CACHE = join(MEM_DIR, 'offline.jsonl');
const DEFAULT_PROFILE_CACHE = join(MEM_DIR, 'profile.cache.md');

function loadConfig(directory: string): MemPluginConfig | null {
  const candidates = [
    join(directory, '.opencode', 'mem', 'config.json'),
    join(directory, 'mem-config.json'),
    join(homedir(), '.config', 'opencode', 'mem', 'config.json'),
  ];

  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      const cfg = JSON.parse(readFileSync(path, 'utf-8')) as MemPluginConfig;
      if (cfg.server_url && cfg.api_key) return cfg;
    } catch {
      continue;
    }
  }

  // Env fallback
  const env_url = process.env.MEM_SERVER_URL;
  const env_key = process.env.MEM_API_KEY;
  if (env_url && env_key) {
    return { server_url: env_url, api_key: env_key };
  }
  return null;
}

function fillDefaults(cfg: MemPluginConfig): Required<MemPluginConfig> {
  return {
    server_url: cfg.server_url.replace(/\/$/, ''),
    api_key: cfg.api_key,
    raw_buffer_size: cfg.raw_buffer_size ?? 20,
    raw_flush_interval_ms: cfg.raw_flush_interval_ms ?? 10000,
    watchdog_interval_ms: cfg.watchdog_interval_ms ?? 5 * 60 * 1000,
    write_timeout_ms: cfg.write_timeout_ms ?? 15000,
    read_timeout_ms: cfg.read_timeout_ms ?? 10000,
    profile_fetch_timeout_ms: cfg.profile_fetch_timeout_ms ?? 2000,
    offline_cache_path: cfg.offline_cache_path ?? DEFAULT_OFFLINE_CACHE,
    offline_cache_max_bytes: cfg.offline_cache_max_bytes ?? 10 * 1024 * 1024,
    profile_cache_path: cfg.profile_cache_path ?? DEFAULT_PROFILE_CACHE,
    profile_cache_ttl_ms: cfg.profile_cache_ttl_ms ?? 60_000,
    memories_cache_ttl_ms: cfg.memories_cache_ttl_ms ?? 30_000,
    inject_char_budget: cfg.inject_char_budget ?? 6000,
  };
}

export const MemPlugin: Plugin = async ({ client, directory }: PluginInput) => {
  setLoggerClient(client);

  const rawCfg = loadConfig(directory);
  if (!rawCfg) {
    logger.warn(SERVICE, 'No memory config found. Skipping. Set MEM_SERVER_URL + MEM_API_KEY env, or create .opencode/mem/config.json');
    // Return a no-op plugin so OpenCode doesn't crash
    return {};
  }

  const cfg = fillDefaults(rawCfg);
  const worker = new WorkerClient(cfg, (level, msg, extra) => {
    switch (level) {
      case 'debug': logger.debug(SERVICE, msg, extra); break;
      case 'info': logger.info(SERVICE, msg, extra); break;
      case 'warn': logger.warn(SERVICE, msg, extra); break;
      case 'error': logger.error(SERVICE, msg, extra); break;
      case 'fatal': logger.fatal(SERVICE, msg, extra); break;
      default: logger.info(SERVICE, msg, extra);
    }
  });

  const healthy = await worker.checkHealth(true);
  logger.info(SERVICE, `MemPlugin initialized`, {
    server: cfg.server_url,
    healthy,
    offline_cache: cfg.offline_cache_path,
  });

  return {
    /**
     * Capture every tool execution as a raw conversation entry.
     * No client-side AI, no titles, no narratives — Worker handles all that.
     */
    'tool.execute.after': async (input, output) => {
      const toolName = input.tool;
      const toolInput = input.args;
      const toolResult = output.output;
      const sid = input.sessionID || 'unknown';

      if (isTrivial(toolName, toolInput, toolResult)) return;

      worker.enqueueRaw({
        session_id: sid,
        role: 'tool',
        content: '',
        tool_name: toolName,
        tool_input: safeStringify(toolInput),
        tool_output: safeStringify(toolResult, 6000),
        timestamp: new Date().toISOString(),
      });
    },

    event: async ({ event }) => {
      // Capture user prompts as raw conversations
      if (event.type === 'message.updated') {
        const msg = (event as any).properties?.info;
        if (msg?.role === 'user') {
          const sid = msg.sessionID || 'unknown';
          const text = safeStringify((msg as any).content ?? (msg as any).parts ?? '', 4000);
          if (text) {
            worker.enqueueRaw({
              session_id: sid,
              role: 'user',
              content: text,
              timestamp: new Date().toISOString(),
            });
          }
        }
      }

      // Flush + replay on session idle
      if (event.type === 'session.idle') {
        await worker.flushRaw();
        worker.replayOfflineCache().catch(() => {});
      }
    },

    /**
     * Inject the user profile into the system prompt at the start of each turn.
     * Profile is maintained server-side; we just fetch the latest.
     * Note: hook return type is void — we mutate the output array in place.
     *
     * Memories are budgeted, not bulk-injected: ranked by source (manual first)
     * then priority then recency, and cut when the char budget is exhausted.
     * The rest stays reachable on-demand via mem-search.
     */
    'experimental.chat.system.transform': async (_input, output) => {
      const [profile, memories] = await Promise.all([
        worker.getProfile(),
        worker.listMemories(50),
      ]);

      const parts: string[] = [];
      if (profile) {
        parts.push(`\n\n## User Profile (auto-maintained)\n\n${profile}`);
      }
      if (memories.length > 0) {
        const sourceRank: Record<string, number> = { manual: 0, 'auto-promoted': 1, auto: 2 };
        const priorityRank: Record<string, number> = { high: 0, medium: 1, low: 2 };
        const ranked = [...memories].sort((a, b) =>
          (sourceRank[a.source ?? 'manual'] ?? 0) - (sourceRank[b.source ?? 'manual'] ?? 0) ||
          (priorityRank[a.priority ?? 'high'] ?? 0) - (priorityRank[b.priority ?? 'high'] ?? 0) ||
          (b.timestamp || '').localeCompare(a.timestamp || ''),
        );

        const budget = cfg.inject_char_budget;
        const lines: string[] = [];
        let used = 0;
        let omitted = 0;
        for (const m of ranked) {
          const line = `- [${m.type}] ${m.title}: ${m.content.slice(0, 300)}`;
          if (used + line.length > budget) {
            omitted++;
            continue;
          }
          lines.push(line);
          used += line.length;
        }
        if (lines.length > 0) {
          const hint = omitted > 0 ? `\n(${omitted} more memories omitted — use mem-search to recall them)` : '';
          parts.push(`\n\n## Hard Memories (user-asserted + auto-distilled)\n\n${lines.join('\n')}${hint}`);
        }
      }
      if (parts.length > 0 && Array.isArray((output as any).system)) {
        (output as any).system.push(parts.join('\n'));
      }
    },

    tool: {
      /**
       * Explicit "remember X" — called by mem-remember Skill.
       */
      'mem-capture': tool({
        description: 'Persist a hard memory (user explicitly asked to remember something)',
        args: {
          type: z.enum(['preference', 'config', 'decision', 'error', 'discovery', 'fact', 'constraint', 'pattern'])
            .describe('Memory type'),
          title: z.string().describe('Short title summarizing the memory'),
          content: z.string().describe('Full description'),
          facts: z.array(z.string()).default([]).describe('Key facts (2-5 bullet points)'),
          concepts: z.array(z.string()).default([]).describe('Related concept tags'),
          priority: z.enum(['high', 'medium', 'low']).default('high'),
        },
        execute: async (args, context) => {
          const m: HardMemory = {
            type: args.type,
            title: args.title,
            content: args.content,
            facts: args.facts ?? [],
            concepts: args.concepts ?? [],
            source: 'manual',
            priority: args.priority ?? 'high',
            session_id: context.sessionID,
            timestamp: new Date().toISOString(),
          };
          const result = await worker.sendHardMemory(m);
          return result
            ? `✓ Remembered: ${args.title} (id=${result.id})`
            : `⚠ Cached offline (worker unreachable): ${args.title}`;
        },
      }),

      'mem-search': tool({
        description: 'Search hard memories by keyword (full-text)',
        args: {
          query: z.string().describe('Search query'),
          limit: z.number().optional().default(50),
        },
        execute: async (args) => {
          const items = await worker.searchMemories(args.query, args.limit);
          if (items.length === 0) return `No memories matched "${args.query}".`;
          return items.map(m => `- [${m.type}] ${m.title}\n  ${m.content.slice(0, 200)}`).join('\n');
        },
      }),

      'mem-list': tool({
        description: 'List recent hard memories',
        args: {
          limit: z.number().optional().default(50),
        },
        execute: async (args) => {
          const items = await worker.listMemories(args.limit);
          if (items.length === 0) return 'No memories yet.';
          return items.map(m => `- [${m.type}] ${m.title}`).join('\n');
        },
      }),

      'mem-profile': tool({
        description: 'Fetch the latest auto-generated user profile from the Worker',
        args: {},
        execute: async () => {
          const profile = await worker.getProfile();
          return profile ?? 'No profile yet. Worker will generate one after enough activity.';
        },
      }),

      'mem-health': tool({
        description: 'Check Worker connectivity and replay offline cache if available',
        args: {},
        execute: async () => {
          const healthy = await worker.checkHealth(true);
          const replayed = healthy ? await worker.replayOfflineCache() : 0;
          return JSON.stringify({
            server_url: cfg.server_url,
            healthy,
            offline_cache_replayed: replayed,
          }, null, 2);
        },
      }),

      /**
       * Sync approved skill drafts from the Worker into ~/.config/opencode/skills/.
       * Drafts are auto-distilled weekly; nothing lands on disk without the
       * user approving them server-side first.
       */
      'mem-skill-sync': tool({
        description: 'List Worker skill drafts, optionally approve them and install approved ones into ~/.config/opencode/skills/',
        args: {
          approve: z.array(z.number()).optional().default([])
            .describe('Draft ids to approve before syncing'),
          install: z.boolean().optional().default(true)
            .describe('Write approved drafts to ~/.config/opencode/skills/'),
        },
        execute: async (args) => {
          // Approve requested drafts first (one-by-one; failures don't block the rest)
          for (const id of args.approve ?? []) {
            await worker.approveSkillDraft(id);
          }

          const drafts = await worker.listSkillDrafts('approved');
          if (!args.install) {
            return drafts.length === 0
              ? 'No approved skill drafts.'
              : drafts.map(d => `- #${d.id} ${d.title}`).join('\n');
          }
          if (drafts.length === 0) return 'No approved skill drafts to install.';

          const skillsDir = join(homedir(), '.config', 'opencode', 'skills');
          const installed: string[] = [];
          const skipped: string[] = [];
          for (const d of drafts) {
            const slug = d.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || `skill-${d.id}`;
            const dir = join(skillsDir, slug);
            const file = join(dir, 'SKILL.md');
            // Never clobber an existing skill — human edits win over drafts.
            if (existsSync(file)) {
              skipped.push(slug);
              continue;
            }
            try {
              mkdirSync(dir, { recursive: true });
              writeFileSync(file, d.content_md, 'utf-8');
              installed.push(slug);
            } catch (e) {
              logger.warn(SERVICE, `skill write failed`, { slug, error: String(e) });
              skipped.push(slug);
            }
          }
          return JSON.stringify({ installed, skipped_existing: skipped }, null, 2);
        },
      }),
    },
  };
};

export default MemPlugin;
