# opencode-mem

**[中文文档](./README_CN.md)**

> Persistent memory for [OpenCode](https://opencode.ai) via a centralized Worker. Conversations are captured; cron jobs distill them into a per-user profile that's injected back into future sessions.

This monorepo has two parts:

| Path        | What it is                                              |
|-------------|---------------------------------------------------------|
| [`server/`](./server)  | **Worker** — Hono + SQLite + cron + LLM. Run once, anywhere. |
| [`src/`](./src)        | **Plugin** — thin OpenCode hook client. Runs in every OpenCode instance. |

## How it works

```
┌─────────────────────────┐         ┌─────────────────────────────────┐
│  OpenCode (each device) │  HTTPS  │   Worker (single instance)      │
│  ─────────────────────  │  ─────► │   ────────────────────────────  │
│  • tool.execute.after   │  raw    │   raw_conversations   (90 days) │
│  • user messages        │  ─────► │   hard_memories       (forever) │
│  • "记住X" → Skill      │  memory │             │                   │
│                         │         │             ▼ cron               │
│  • inject system prompt │  ◄───── │   daily_summaries (LLM)         │
│                         │ profile │   user_profiles   (LLM)         │
└─────────────────────────┘         └─────────────────────────────────┘
```

**Two data tracks, served by one HTTP API:**

1. **Raw conversations** — every tool call + user message, batched and flushed by the plugin. Cheap, lossy, pruned after 90 days.
2. **Hard memories** — explicit "记住 X / remember X" entries created via the `mem-remember` skill. Stored forever, FTS5-searchable.

**Three scheduled jobs run inside the Worker:**

| When                   | What                                                      |
|------------------------|-----------------------------------------------------------|
| Every day at 03:00     | LLM distills yesterday's raw conversations → daily summary |
| Every Sunday at 03:00  | LLM builds profile from last 7 daily summaries (hard memories injected separately) |
| When user adds ≥10 new hard memories | LLM refreshes profile immediately                |

The Worker is the only source of truth. The plugin has no local storage beyond a small JSONL offline cache (used only when the Worker is unreachable).

## Quick start

### 1. Run the Worker

```bash
cd server
cp config.example.yaml config.yaml         # edit users + LLM model
export LLM_API_KEY=sk-...                  # your OpenAI/OpenRouter/etc key
export USER_VINCENT_KEY=$(openssl rand -hex 32)
npm install
npm run dev                                # or `docker compose up -d`
```

See [`server/README.md`](./server/README.md) for full deployment + API docs.

### 2. Install the plugin

```bash
npm install
npm run build:all
npm run install:opencode                   # copies bundle + skills to ~/.config/opencode/
```

### 3. Configure the plugin

Either set env vars:

```bash
export MEM_SERVER_URL=http://localhost:3777
export MEM_API_KEY=<the same key from step 1>
```

Or write `~/.config/opencode/mem/config.json`:

```json
{
  "server_url": "http://localhost:3777",
  "api_key": "<the same key>"
}
```

Restart OpenCode. Done.

## Bad-network behavior

Designed to fail gracefully when the Worker is unreachable:

| Scenario | Behavior |
|---|---|
| Worker down → raw upload | Batch falls through to `offline.jsonl` cache, no data loss |
| Worker down → hard memory write | Cached locally, returns `null`, no crash |
| Worker down → profile fetch | Falls back to last-known profile in `profile.cache.md` |
| Worker recovers mid-session | Background watchdog (5 min default) replays cache automatically |
| Process killed (SIGTERM/SIGINT) | In-memory buffer flushed to offline cache before exit |
| Cache grows unboundedly | Rotated to `.jsonl.bak` at 10 MB (overwrites prior `.bak`) |
| Cache contains invalid entries | 4xx (server-rejected) entries dropped as dead letters; 5xx/network errors retry |
| High latency on chat startup | Profile fetch capped at 2 s timeout, falls back to local cache |

All thresholds are tunable in the plugin config:

| Key                          | Default | Purpose |
|------------------------------|---------|---------|
| `raw_buffer_size`            | 20      | Auto-flush when buffer hits N items |
| `raw_flush_interval_ms`      | 10 000  | Periodic flush even if buffer isn't full |
| `watchdog_interval_ms`       | 300 000 | Replay offline cache + recheck health |
| `write_timeout_ms`           | 15 000  | POST request timeout |
| `read_timeout_ms`            | 10 000  | GET request timeout |
| `profile_fetch_timeout_ms`   | 2 000   | Tight cap for chat-startup profile fetch |
| `profile_cache_ttl_ms`       | 60 000  | In-memory profile cache TTL (0 disables) |
| `memories_cache_ttl_ms`      | 30 000  | In-memory hard-memories cache TTL (0 disables) |
| `offline_cache_path`         | `~/.config/opencode/mem/offline.jsonl` | JSONL append-log |
| `offline_cache_max_bytes`    | `10485760` | Rotation threshold (10 MB) |
| `profile_cache_path`         | `~/.config/opencode/mem/profile.cache.md` | Last-known profile |

## Where to deploy the Worker

The Worker is just an HTTP service. Put it wherever fits your trust boundary:

- **Localhost** — single-user, no network exposure, `127.0.0.1:3777`
- **Home server / NAS** — multi-device personal use over LAN/VPN
- **Cloud VM** — multi-device anywhere; **must** put TLS + restrict CORS

The plugin only sees `server_url`. Same binary, same config schema, different network position.

## What the plugin provides

5 tools, all backed by Worker HTTP calls:

| Tool           | Purpose                                          |
|----------------|--------------------------------------------------|
| `mem-capture`  | Insert a hard memory (called by `mem-remember` skill) |
| `mem-search`   | Full-text search hard memories                   |
| `mem-list`     | List recent hard memories                        |
| `mem-profile`  | Fetch latest user profile                        |
| `mem-health`   | Check Worker connectivity + drain offline cache |

The 4 skills in [`skills/`](./skills/) wrap the plugin tools. `mem-remember` is a trigger-word skill that routes to `mem-capture`; the others (`mem-capture`, `mem-search`, `mem-profile`) each wrap their same-named tool.

## Migration from v1 (local Markdown)

v1 wrote Markdown files to `~/.config/opencode/mem/`. v2 has no local store. Migration script TODO — for now, hard memories can be re-entered manually (raw history isn't worth migrating).

## License

MIT
