# opencode-mem

Persistent memory **plugin** for [OpenCode](https://opencode.ai) — context across sessions via Markdown files.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    OpenCode Server                       │
│  ┌───────────────────────────────────────────────────┐  │
│  │              opencode-mem Plugin                   │  │
│  │                                                    │  │
│  │  session.created ──→ inject memory context         │  │
│  │  tool.execute.after ──→ capture observation        │  │
│  │  message.updated ──→ track user prompts            │  │
│  │  session.idle ──→ write session summary            │  │
│  │                                                    │  │
│  │  Custom Tools:                                     │  │
│  │    mem-search   — search past observations         │  │
│  │    mem-capture  — manually capture observation     │  │
│  │    mem-context  — get full memory context          │  │
│  └──────────────────────┬────────────────────────────┘  │
│                         │                                │
│                         ▼                                │
│              .opencode/mem/                              │
│              ├── INDEX.md                                │
│              ├── observations/0001-xxx.md                │
│              ├── sessions/2026-05-11-xxx.md              │
│              └── concepts/                               │
└─────────────────────────────────────────────────────────┘
```

## Features

- **OpenCode Plugin** — Native plugin via `opencode.json` or `.opencode/plugins/`
- **Lifecycle Hooks** — `session.created`, `tool.execute.after`, `message.updated`, `session.idle`
- **Custom Tools** — `mem-search`, `mem-capture`, `mem-context`
- **Pure Markdown Storage** — All memories are `.md` files in `.opencode/mem/`
- **Git-Friendly** — Commit your memory files with the project
- **Zero Runtime Dependencies** — No database, no daemon, no external services

## Installation

### Option 1: npm Plugin (Recommended)

Add to your `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-mem"]
}
```

### Option 2: Local Plugin

Copy the built plugin to your project:

```bash
mkdir -p .opencode/plugins
cp dist/plugin.js .opencode/plugins/opencode-mem.js
```

Or globally:

```bash
mkdir -p ~/.config/opencode/plugins
cp dist/plugin.js ~/.config/opencode/plugins/opencode-mem.js
```

### Option 3: Skills Only

If you just want the skills without the plugin hooks:

```bash
cp -r skills/mem-* ~/.config/opencode/skills/
```

## Hooks

| Hook | Trigger | Action |
|------|---------|--------|
| `session.created` | New session starts | Inject memory context into system prompt |
| `tool.execute.after` | Tool execution completes | Capture observation if significant |
| `message.updated` | Message is updated | Track user prompts for session summary |
| `session.idle` | Session ends / goes idle | Write session summary |

## Custom Tools

### mem-search

Search past observations:

```
mem_search(query="authentication bug", type="bugfix", limit=10)
```

### mem-capture

Manually capture an observation:

```
mem_capture(
  type="decision",
  title="Use Zod for Validation",
  narrative="After comparing Zod and Joi..."
)
```

### mem-context

Get full memory context:

```
mem_context(maxObservations=15, maxSessions=3)
```

## Memory Structure

```
.opencode/mem/
├── INDEX.md              # Auto-generated index
├── observations/         # Individual observations
│   ├── 0001-auth-bug-fix.md
│   ├── 0002-api-refactor.md
│   └── 0003-decision-use-zod.md
├── sessions/             # Session summaries
│   ├── 2026-05-11-refactor-api.md
│   └── 2026-05-12-add-auth.md
└── concepts/             # Concept documentation
```

## Observation Format

```markdown
---
id: 1
type: "bugfix"
title: "JWT Expiration Bug"
subtitle: "Fixed token validation on API routes"
session: "session-abc123"
timestamp: "2026-05-11T14:30:00.000Z"
facts:
  - "Token validation missing exp check"
concepts:
  - "authentication"
  - "jwt"
files_read:
  - "packages/auth/jwt.ts"
files_modified:
  - "packages/auth/jwt.ts"
---

# JWT Expiration Bug

> Fixed token validation on API routes

## Narrative

The JWT middleware was not checking the `exp` claim...
```

## Development

```bash
npm install
npm run build
```

Then add to `opencode.json`:

```json
{
  "plugin": ["./path/to/opencode-mem"]
}
```

## Privacy

Use `<private>` tags in prompts to exclude content from automatic capture.

## License

MIT
