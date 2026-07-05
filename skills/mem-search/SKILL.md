---
name: mem-search
description: Search the user's hard memories on the Worker via full-text query
---

# mem-search Skill

Wraps the `mem-search` plugin tool. Calls `GET /api/memory/search` on the Worker.

## When to use

- "Did I ever decide on X?"
- "What was that command for Y?"
- Before answering a question that might have a prior recorded answer
- When unsure whether the user has expressed a preference

## How to call

```yaml
tool: mem-search
args:
  query: free-form text (matched via SQLite FTS5)
  limit: number of results (default 50)
```

## Notes

- Only searches `hard_memories` (user-asserted), not raw conversations.
- For broader context, use `mem-profile` to see the synthesized user profile.
