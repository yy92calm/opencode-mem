/**
 * Types shared by the plugin and matching the Worker API contract.
 * See server/README.md for the canonical API spec.
 */

export interface RawConversation {
  session_id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  tool_name?: string;
  tool_input?: string;
  tool_output?: string;
  timestamp: string;
}

export interface HardMemory {
  type: 'preference' | 'config' | 'decision' | 'error' | 'discovery' | 'fact';
  title: string;
  content: string;
  facts: string[];
  concepts: string[];
  source?: 'manual' | 'auto-promoted';
  priority?: 'high' | 'medium' | 'low';
  session_id?: string;
  timestamp: string;
}

export interface MemPluginConfig {
  /** Worker base URL, e.g. http://localhost:3777 or https://mem.example.com */
  server_url: string;
  /** Per-user API key issued by Worker admin */
  api_key: string;
  /** Buffer size before raw flush (default 20) */
  raw_buffer_size?: number;
  /** Raw flush interval ms (default 10000) */
  raw_flush_interval_ms?: number;
  /** Watchdog: periodic health + replay (default 300000 = 5 min) */
  watchdog_interval_ms?: number;
  /** Per-request timeout for writes (default 15000) */
  write_timeout_ms?: number;
  /** Per-request timeout for reads (default 10000) */
  read_timeout_ms?: number;
  /** Tight timeout for profile fetch on chat startup (default 2000) */
  profile_fetch_timeout_ms?: number;
  /** Offline cache JSONL path (default ~/.config/opencode/mem/offline.jsonl) */
  offline_cache_path?: string;
  /** Offline cache size cap before rotation to .bak (default 10MB) */
  offline_cache_max_bytes?: number;
  /** Local cached profile path (default ~/.config/opencode/mem/profile.cache.md) */
  profile_cache_path?: string;
  /** In-memory profile cache TTL ms (default 60000 = 1 min). 0 disables. */
  profile_cache_ttl_ms?: number;
  /** In-memory hard-memories cache TTL ms (default 30000 = 30s). 0 disables. */
  memories_cache_ttl_ms?: number;
}
