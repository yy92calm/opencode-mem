import Database from 'better-sqlite3';

const db = new Database('./data/test-memory.db');

// A daily summary containing a term that exists nowhere in hard memories,
// so the search tier-2 fallback (daily_summaries_fts) must surface it.
db.prepare(`
  INSERT OR REPLACE INTO daily_summaries (user_id, date, content, raw_count, generated_at)
  VALUES ('tester', '2026-08-07', ?, 42, datetime('now'))
`).run(JSON.stringify({
  topics: ['kubernetes migration'],
  decisions: ['moved batch jobs to kubernetes cron'],
  problems: [],
  narrative: 'Spent the day on the kubernetes migration.',
}));

// An auto-distilled atom with the same title a manual insert will use later,
// to verify the manual-insert dedup deprecates it.
db.prepare(`
  INSERT INTO hard_memories (user_id, type, title, content, facts, concepts, source, priority, source_date, timestamp)
  VALUES ('tester', 'fact', 'Auto Atom From Session', 'distilled automatically', '[]', '[]', 'auto', 'medium', '2026-08-07', datetime('now'))
`).run();

// A second websocket memory with large content so char_budget=500 truncates.
db.prepare(`
  INSERT INTO hard_memories (user_id, type, title, content, facts, concepts, source, priority, source_date, timestamp)
  VALUES ('tester', 'fact', 'Websocket big note', ?, '[]', '["websocket"]', 'auto', 'medium', '2026-08-07', datetime('now'))
`).run('websocket '.repeat(80));

// A skill draft to exercise the approval endpoint.
db.prepare(`
  INSERT INTO skill_drafts (user_id, title, content_md, session_id)
  VALUES ('tester', 'fix-websocket-reconnect', '---\nname: fix-websocket-reconnect\n---\n# Fix Websocket Reconnect\n', 'sess-aaaa1111')
`).run();

// CJK search fixtures: unicode61 used to miss these entirely; trigram + LIKE
// fallback must surface them for both long (>=3 char) and short (2 char) terms.
db.prepare(`
  INSERT INTO hard_memories (user_id, type, title, content, facts, concepts, source, priority, source_date, timestamp)
  VALUES ('tester', 'preference', '项目构建偏好', '使用 Bun 作为构建工具，禁止使用 webpack，构建产物放在 dist 目录', '["bun"]', '["构建"]', 'manual', 'high', '2026-08-07', datetime('now'))
`).run();

db.prepare(`
  INSERT OR REPLACE INTO daily_summaries (user_id, date, content, raw_count, generated_at)
  VALUES ('tester', '2026-08-06', ?, 10, datetime('now'))
`).run(JSON.stringify({
  topics: ['数据库迁移'],
  decisions: ['决定采用 SQLite 作为存储'],
  problems: [],
  narrative: '当天完成了数据库迁移方案评审。',
}));

console.log('seeded');
