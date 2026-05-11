---
name: mem-search
description: Search persistent memory observations from past OpenCode sessions. Use when the user asks about past work, project history, previous decisions, or wants to recall what was done before.
license: MIT
compatibility: opencode
metadata:
  audience: developers
  workflow: memory-retrieval
---

# Memory Search Skill

Search and retrieve observations from previous OpenCode sessions stored in `.opencode/mem/`.

## When to Use

- User asks "what did we do last time?" or "what was the decision about X?"
- User wants to understand project history or past changes
- User asks about bugs that were fixed, features that were added, or patterns discovered
- You need context from previous sessions to continue work

## How to Use

### Via Custom Tool (Recommended)

Use the `mem-search` tool provided by the opencode-mem plugin:

```
mem_search(query="authentication bug", type="bugfix", limit=10)
```

Parameters:
- `query` (required): Search query string
- `type` (optional): Filter by type — bugfix, feature, refactor, decision, discovery, config, error
- `limit` (optional): Maximum results, default 10

### Via Manual File Search

Memory files are stored as Markdown in `.opencode/mem/`:

```
.opencode/mem/
├── INDEX.md              # Auto-generated index
├── observations/         # Individual observations
├── sessions/             # Session summaries
└── concepts/             # Concept documentation
```

Search using ripgrep:

```bash
rg "authentication" .opencode/mem/observations/
```

### Via Context Tool

Get the full memory context:

```
mem_context(maxObservations=15, maxSessions=3)
```

## Output Format

When presenting search results:

```markdown
## Memory Results: "authentication bug"

### #0042 — Authentication Token Expiration Bug
> Fixed JWT token expiration not being checked on API requests
- **Type**: bugfix
- **Date**: 2026-05-10
- **Files**: `packages/auth/jwt.ts`
- **Key Finding**: Token validation was missing the `exp` claim check
```

## Tips

- Search broadly first, then narrow down
- Check both `observations/` and `sessions/` directories
- The INDEX.md file provides a quick overview
- Observation IDs are sequential — higher IDs are more recent
