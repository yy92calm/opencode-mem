import { getDb } from './schema.js';
import type { RawConversation, HardMemory, DailySummary, UserProfile } from '../types/index.js';

// ===== Raw conversations =====

export function insertRaw(r: Omit<RawConversation, 'id'>): number {
  const stmt = getDb().prepare(`
    INSERT INTO raw_conversations (user_id, session_id, role, content, tool_name, tool_input, tool_output, timestamp)
    VALUES (@user_id, @session_id, @role, @content, @tool_name, @tool_input, @tool_output, @timestamp)
  `);
  const r2 = {
    ...r,
    tool_name: r.tool_name ?? null,
    tool_input: r.tool_input ?? null,
    tool_output: r.tool_output ?? null,
  };
  const result = stmt.run(r2);
  return Number(result.lastInsertRowid);
}

export function insertRawBatch(items: Omit<RawConversation, 'id'>[]): number {
  if (items.length === 0) return 0;
  const stmt = getDb().prepare(`
    INSERT INTO raw_conversations (user_id, session_id, role, content, tool_name, tool_input, tool_output, timestamp)
    VALUES (@user_id, @session_id, @role, @content, @tool_name, @tool_input, @tool_output, @timestamp)
  `);
  const tx = getDb().transaction((rows: any[]) => {
    for (const r of rows) {
      stmt.run({
        ...r,
        tool_name: r.tool_name ?? null,
        tool_input: r.tool_input ?? null,
        tool_output: r.tool_output ?? null,
      });
    }
  });
  tx(items);
  return items.length;
}

export function listRawByDate(user_id: string, date: string): RawConversation[] {
  return getDb()
    .prepare(`SELECT * FROM raw_conversations WHERE user_id = ? AND date(timestamp) = ? ORDER BY timestamp ASC`)
    .all(user_id, date) as RawConversation[];
}

export function countRawByDate(user_id: string, date: string): number {
  const row = getDb()
    .prepare(`SELECT COUNT(*) as c FROM raw_conversations WHERE user_id = ? AND date(timestamp) = ?`)
    .get(user_id, date) as { c: number };
  return row.c;
}

export function pruneRawOlderThan(days: number): number {
  const result = getDb()
    .prepare(`DELETE FROM raw_conversations WHERE date(timestamp) < date('now', '-' || ? || ' days')`)
    .run(days);
  return Number(result.changes);
}

// ===== Hard memories =====

export function insertHard(m: Omit<HardMemory, 'id'>): number {
  const stmt = getDb().prepare(`
    INSERT INTO hard_memories (user_id, type, title, content, facts, concepts, source, priority, session_id, timestamp)
    VALUES (@user_id, @type, @title, @content, @facts, @concepts, @source, @priority, @session_id, @timestamp)
  `);
  const result = stmt.run({
    ...m,
    facts: JSON.stringify(m.facts),
    concepts: JSON.stringify(m.concepts),
    session_id: m.session_id ?? null,
  });
  return Number(result.lastInsertRowid);
}

export function listHard(user_id: string, limit = 100): HardMemory[] {
  const rows = getDb()
    .prepare(`SELECT * FROM hard_memories WHERE user_id = ? ORDER BY timestamp DESC LIMIT ?`)
    .all(user_id, limit) as any[];
  return rows.map(deserializeHard);
}

export function searchHard(user_id: string, query: string, limit = 50): HardMemory[] {
  if (!query.trim()) return listHard(user_id, limit);
  // Escape FTS5 special chars by quoting the whole query
  const safe = `"${query.replace(/"/g, '""')}"`;
  const rows = getDb()
    .prepare(`
      SELECT h.* FROM hard_memories_fts fts
      JOIN hard_memories h ON h.id = fts.rowid
      WHERE hard_memories_fts MATCH ? AND h.user_id = ?
      ORDER BY rank LIMIT ?
    `)
    .all(safe, user_id, limit) as any[];
  return rows.map(deserializeHard);
}

export function deleteHard(user_id: string, id: number): boolean {
  const result = getDb()
    .prepare(`DELETE FROM hard_memories WHERE user_id = ? AND id = ?`)
    .run(user_id, id);
  return result.changes > 0;
}

export function countHardSince(user_id: string, sinceId: number): number {
  const row = getDb()
    .prepare(`SELECT COUNT(*) as c FROM hard_memories WHERE user_id = ? AND id > ?`)
    .get(user_id, sinceId) as { c: number };
  return row.c;
}

export function getMaxHardId(user_id: string): number {
  const row = getDb()
    .prepare(`SELECT COALESCE(MAX(id), 0) as m FROM hard_memories WHERE user_id = ?`)
    .get(user_id) as { m: number };
  return row.m;
}

function deserializeHard(row: any): HardMemory {
  return {
    ...row,
    facts: JSON.parse(row.facts || '[]'),
    concepts: JSON.parse(row.concepts || '[]'),
  };
}

// ===== Daily summaries =====

export function upsertDailySummary(s: Omit<DailySummary, 'id'>): void {
  getDb()
    .prepare(`
      INSERT INTO daily_summaries (user_id, date, content, raw_count, generated_at)
      VALUES (@user_id, @date, @content, @raw_count, @generated_at)
      ON CONFLICT(user_id, date) DO UPDATE SET
        content = excluded.content,
        raw_count = excluded.raw_count,
        generated_at = excluded.generated_at
    `)
    .run(s);
}

export function listRecentSummaries(user_id: string, days: number): DailySummary[] {
  return getDb()
    .prepare(`
      SELECT * FROM daily_summaries
      WHERE user_id = ? AND date >= date('now', '-' || ? || ' days')
      ORDER BY date DESC
    `)
    .all(user_id, days) as DailySummary[];
}

// ===== User profiles =====

export function upsertProfile(p: UserProfile): void {
  getDb()
    .prepare(`
      INSERT INTO user_profiles (user_id, content, version, generated_at, source_raw_count, source_memory_count)
      VALUES (@user_id, @content, @version, @generated_at, @source_raw_count, @source_memory_count)
      ON CONFLICT(user_id) DO UPDATE SET
        content = excluded.content,
        version = user_profiles.version + 1,
        generated_at = excluded.generated_at,
        source_raw_count = excluded.source_raw_count,
        source_memory_count = excluded.source_memory_count
    `)
    .run(p);
}

export function getProfile(user_id: string): UserProfile | null {
  const row = getDb()
    .prepare(`SELECT * FROM user_profiles WHERE user_id = ?`)
    .get(user_id) as UserProfile | undefined;
  return row ?? null;
}

// ===== Profile meta (delta tracking) =====

export function getProfileMeta(user_id: string): { last_hard_memory_id: number; last_check_at: string } {
  const row = getDb()
    .prepare(`SELECT last_hard_memory_id, last_check_at FROM profile_meta WHERE user_id = ?`)
    .get(user_id) as any;
  return row ?? { last_hard_memory_id: 0, last_check_at: '1970-01-01' };
}

export function updateProfileMeta(user_id: string, last_hard_memory_id: number): void {
  getDb()
    .prepare(`
      INSERT INTO profile_meta (user_id, last_hard_memory_id, last_check_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(user_id) DO UPDATE SET
        last_hard_memory_id = excluded.last_hard_memory_id,
        last_check_at = excluded.last_check_at
    `)
    .run(user_id, last_hard_memory_id);
}

export function listAllUsers(): string[] {
  const rows = getDb().prepare(`
    SELECT DISTINCT user_id FROM (
      SELECT user_id FROM raw_conversations
      UNION SELECT user_id FROM hard_memories
    )
  `).all() as { user_id: string }[];
  return rows.map(r => r.user_id);
}
