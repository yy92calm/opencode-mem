import Database from 'better-sqlite3';
import { dirname } from 'path';
import { mkdirSync, existsSync } from 'fs';

let db: Database.Database | null = null;

export function initDb(dbPath: string): Database.Database {
  if (db) return db;

  const dir = dirname(dbPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');

  db.exec(SCHEMA);
  return db;
}

export function getDb(): Database.Database {
  if (!db) throw new Error('DB not initialized. Call initDb() first.');
  return db;
}

const SCHEMA = `
-- Raw conversation data (high volume, low density)
CREATE TABLE IF NOT EXISTS raw_conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
  content TEXT NOT NULL DEFAULT '',
  tool_name TEXT,
  tool_input TEXT,
  tool_output TEXT,
  timestamp TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_raw_user_ts ON raw_conversations(user_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_raw_session ON raw_conversations(session_id);
CREATE INDEX IF NOT EXISTS idx_raw_user_date ON raw_conversations(user_id, date(timestamp));

-- Hard memories (user-triggered "remember X", high value)
CREATE TABLE IF NOT EXISTS hard_memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  facts TEXT NOT NULL DEFAULT '[]',
  concepts TEXT NOT NULL DEFAULT '[]',
  source TEXT NOT NULL DEFAULT 'manual',
  priority TEXT NOT NULL DEFAULT 'high',
  session_id TEXT,
  timestamp TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_hard_user_ts ON hard_memories(user_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_hard_user_type ON hard_memories(user_id, type);

-- FTS5 for hard_memories full-text search
CREATE VIRTUAL TABLE IF NOT EXISTS hard_memories_fts USING fts5(
  title, content, facts, concepts,
  content='hard_memories',
  content_rowid='id'
);

CREATE TRIGGER IF NOT EXISTS hard_memories_ai AFTER INSERT ON hard_memories BEGIN
  INSERT INTO hard_memories_fts(rowid, title, content, facts, concepts)
  VALUES (new.id, new.title, new.content, new.facts, new.concepts);
END;

CREATE TRIGGER IF NOT EXISTS hard_memories_ad AFTER DELETE ON hard_memories BEGIN
  INSERT INTO hard_memories_fts(hard_memories_fts, rowid, title, content, facts, concepts)
  VALUES ('delete', old.id, old.title, old.content, old.facts, old.concepts);
END;

CREATE TRIGGER IF NOT EXISTS hard_memories_au AFTER UPDATE ON hard_memories BEGIN
  INSERT INTO hard_memories_fts(hard_memories_fts, rowid, title, content, facts, concepts)
  VALUES ('delete', old.id, old.title, old.content, old.facts, old.concepts);
  INSERT INTO hard_memories_fts(rowid, title, content, facts, concepts)
  VALUES (new.id, new.title, new.content, new.facts, new.concepts);
END;

-- Daily summaries (LLM-distilled from raw conversations)
CREATE TABLE IF NOT EXISTS daily_summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  content TEXT NOT NULL,
  raw_count INTEGER NOT NULL DEFAULT 0,
  generated_at TEXT NOT NULL,
  UNIQUE(user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_summary_user_date ON daily_summaries(user_id, date DESC);

-- User profiles (LLM-generated from daily summaries; hard memories injected separately by plugin)
CREATE TABLE IF NOT EXISTS user_profiles (
  user_id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  generated_at TEXT NOT NULL,
  source_raw_count INTEGER NOT NULL DEFAULT 0,
  source_memory_count INTEGER NOT NULL DEFAULT 0
);

-- Track when each user last had their profile recomputed (for delta triggers)
CREATE TABLE IF NOT EXISTS profile_meta (
  user_id TEXT PRIMARY KEY,
  last_hard_memory_id INTEGER NOT NULL DEFAULT 0,
  last_check_at TEXT NOT NULL
);
`;
