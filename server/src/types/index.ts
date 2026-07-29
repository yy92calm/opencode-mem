/**
 * Core types shared across the Worker
 */

export interface RawConversation {
  id?: number;
  user_id: string;
  session_id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  tool_name?: string | null;
  tool_input?: string | null;
  tool_output?: string | null;
  timestamp: string;
}

export interface HardMemory {
  id?: number;
  user_id: string;
  type: 'preference' | 'config' | 'decision' | 'error' | 'discovery' | 'fact';
  title: string;
  content: string;
  facts: string[];
  concepts: string[];
  source: 'manual' | 'auto-promoted';
  priority: 'high' | 'medium' | 'low';
  session_id?: string | null;
  timestamp: string;
}

export interface DailySummary {
  id?: number;
  user_id: string;
  date: string;            // YYYY-MM-DD
  content: string;         // LLM-generated daily synthesis
  raw_count: number;
  generated_at: string;
}

export interface UserProfile {
  user_id: string;
  content: string;
  version: number;
  generated_at: string;
  source_raw_count: number;
  source_memory_count: number;
}

export interface LLMConfig {
  provider: string;
  base_url: string;
  api_key: string;
  model: string;
  timeout_ms: number;
  max_retries: number;
}

export interface UserBinding {
  user_id: string;
  api_key: string;
}

export interface CronConfig {
  daily_summary: string;
  weekly_profile: string;
  hard_memory_threshold: number;
}

export interface ServerConfig {
  port: number;
  db_path: string;
  /**
   * IANA timezone (e.g. "Asia/Shanghai", "UTC"). Used for daily-summary date
   * math and SQLite localtime() so raw timestamps are bucketed into the
   * calendar day the user actually experienced. Default: host tz.
   */
  tz: string;
  llm: LLMConfig;
  users: UserBinding[];
  cron: CronConfig;
}
