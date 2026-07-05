# opencode-mem-worker

Centralized memory backend for [opencode-mem-plugin](../). HTTP service backed by SQLite, with cron-driven profile generation.

## What it does

1. Receives two kinds of data from the plugin:
   - **Raw conversation data** — every message and tool call (high volume)
   - **Hard memories** — explicit "记住X / remember X" entries (high value)
2. Stores everything in SQLite with FTS5 for hard-memory search
3. Runs scheduled LLM jobs to produce:
   - **Daily summaries** of raw conversations (every night)
   - **User profiles** synthesizing daily summaries (weekly + on-demand); hard memories are injected into the system prompt separately by the plugin
4. Serves the latest profile back to the plugin for context injection

## Architecture

```
Plugin (per device)        Worker (single instance)
─────────────────          ───────────────────────
POST /api/raw       ────►  raw_conversations
POST /api/memory    ────►  hard_memories
GET  /api/profile   ◄────  user_profiles
                              ▲
                              │ cron
                              │
                          daily_summaries ──► profile (weekly)
                                          ──► profile (on threshold)
```

## Quick start

```bash
# 1. Install
cd server
npm install

# 2. Configure
cp config.example.yaml config.yaml
# Edit config.yaml: set users, choose LLM model

# 3. Set secrets via env
export LLM_API_KEY=sk-...
export USER_VINCENT_KEY=$(openssl rand -hex 32)

# 4. Dev
npm run dev

# 5. Production via Docker
npm run build
docker compose up -d
```

## API

All `/api/*` endpoints require `Authorization: Bearer <api_key>`. The api_key resolves to a `user_id` via the `users` block in config.yaml.

| Method | Path                        | Purpose                              |
|--------|----------------------------|--------------------------------------|
| GET    | `/health`                   | Liveness check (no auth)             |
| GET    | `/api/whoami`               | Returns the resolved user_id         |
| POST   | `/api/raw`                  | Upload one or many raw conversations |
| GET    | `/api/raw/count?date=...`   | Count today/given date raw rows      |
| POST   | `/api/memory`               | Insert a hard memory                 |
| GET    | `/api/memory?limit=N`       | List recent hard memories            |
| GET    | `/api/memory/search?q=...`  | FTS5 search hard memories            |
| DELETE | `/api/memory/:id`           | Delete one hard memory               |
| GET    | `/api/profile`              | Get current user profile (Markdown)  |
| POST   | `/api/profile/regenerate`   | Manual trigger for current user (`scope: daily│weekly`) |

### Raw upload payload

Single:
```json
{
  "session_id": "abc123",
  "role": "user",
  "content": "how do I configure X?",
  "timestamp": "2026-06-08T00:00:00Z"
}
```

Batch:
```json
{
  "items": [ {...}, {...} ]
}
```

Tool calls use `role: "tool"` with `tool_name`, `tool_input`, `tool_output`.

### Hard memory payload

```json
{
  "type": "preference",
  "title": "项目构建偏好：使用 Bun",
  "content": "用户指定使用 Bun 作为构建工具",
  "facts": ["构建工具：Bun"],
  "concepts": ["build", "bun"],
  "priority": "high",
  "timestamp": "2026-06-08T00:00:00Z"
}
```

## Cron schedule

Defaults (override in config.yaml `cron:` block):

| Job             | Schedule           | Behavior |
|-----------------|--------------------|----------|
| Daily summary   | `0 3 * * *`        | For each user with raw data yesterday → LLM produces structured daily summary. Idempotent. |
| Weekly profile  | `0 3 * * 0`        | For each user → LLM regenerates profile from last 7 days summaries. Hard memories are tracked for delta triggers but not fed into the profile (they're injected into the system prompt separately). |
| Raw prune       | `0 4 1 * *`        | Drop raw_conversations > 90 days old. Summaries kept forever. |
| Delta trigger   | on-write           | When user accumulates ≥10 new hard memories since last profile run, refresh profile immediately. |

## LLM cost estimate

Per user per week:
- 7 daily summaries × ~3k input tokens × $0.15/M (gpt-4o-mini) ≈ **$0.003**
- 1 weekly profile × ~5k input tokens ≈ **$0.001**
- 1-2 delta profile refreshes ≈ **$0.002**

**Total: ~$0.006/user/week** with gpt-4o-mini.

## Data model

```
raw_conversations   (volume tier — pruned at 90 days)
  ├─ user_id, session_id, role, content, tool_*
  └─ indexed by (user_id, date(timestamp))

hard_memories       (value tier — kept forever)
  ├─ user_id, type, title, content, facts[], concepts[]
  ├─ FTS5 virtual table for search
  └─ indexed by (user_id, timestamp)

daily_summaries     (LLM output — kept forever)
  └─ unique(user_id, date)

user_profiles       (LLM output — single row per user, upserted)
  └─ pk: user_id

profile_meta        (delta tracking)
  └─ last_hard_memory_id per user
```

## Security & operations checklist

- ✅ Bearer auth on all `/api/*`
- ✅ User isolation: API key → user_id mapping, all queries scoped
- ✅ Per-user FTS5 query parameterized + quoted
- ✅ Request body validation (zod) on all write endpoints
- ✅ Config validation: cron expressions, port range, non-empty/duplicate credentials
- ✅ Graceful shutdown: SIGTERM/SIGINT stops cron, closes connections, checkpoints WAL before exit
- ⚠️ Set `CORS_ORIGIN` explicitly in production (default `*`)
- ⚠️ Don't expose port 3777 publicly without a reverse proxy + TLS
- ⚠️ Rotate `LLM_API_KEY` and user API keys periodically
