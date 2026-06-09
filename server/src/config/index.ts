import { readFileSync, existsSync } from 'fs';
import { parse as parseYaml } from 'yaml';
import type { ServerConfig } from '../types/index.js';

const DEFAULT_CONFIG_PATH = process.env.CONFIG_PATH || './config.yaml';

function expandEnv(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, name) => {
    const v = process.env[name];
    if (v === undefined) {
      throw new Error(`Missing required env var: ${name}`);
    }
    return v;
  });
}

function deepExpand(obj: any): any {
  if (typeof obj === 'string') return expandEnv(obj);
  if (Array.isArray(obj)) return obj.map(deepExpand);
  if (obj && typeof obj === 'object') {
    const result: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj)) result[k] = deepExpand(v);
    return result;
  }
  return obj;
}

export function loadConfig(path: string = DEFAULT_CONFIG_PATH): ServerConfig {
  if (!existsSync(path)) {
    throw new Error(`Config file not found: ${path}. Copy config.example.yaml to config.yaml first.`);
  }

  const raw = readFileSync(path, 'utf-8');
  const parsed = parseYaml(raw);
  const expanded = deepExpand(parsed);

  // Validate required fields
  if (!expanded.llm?.api_key) throw new Error('Config: llm.api_key is required');
  if (!expanded.llm?.model) throw new Error('Config: llm.model is required');
  if (!Array.isArray(expanded.users) || expanded.users.length === 0) {
    throw new Error('Config: at least one user binding is required');
  }

  return {
    port: expanded.port ?? 3777,
    db_path: expanded.db_path ?? './data/memory.db',
    llm: {
      provider: expanded.llm.provider ?? 'openai-compatible',
      base_url: expanded.llm.base_url ?? 'https://api.openai.com/v1',
      api_key: expanded.llm.api_key,
      model: expanded.llm.model,
      timeout_ms: expanded.llm.timeout_ms ?? 60000,
      max_retries: expanded.llm.max_retries ?? 3,
    },
    users: expanded.users,
    cron: {
      daily_summary: expanded.cron?.daily_summary ?? '0 3 * * *',
      weekly_profile: expanded.cron?.weekly_profile ?? '0 3 * * 0',
      hard_memory_threshold: expanded.cron?.hard_memory_threshold ?? 10,
    },
  };
}

// Singleton for runtime use
let _config: ServerConfig | null = null;

export function getConfig(): ServerConfig {
  if (!_config) _config = loadConfig();
  return _config;
}

export function resetConfig(): void {
  _config = null;
}
