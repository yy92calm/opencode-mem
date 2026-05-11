---
name: mem-capture
description: Capture important observations, decisions, and learnings during an OpenCode session for future reference. Use after completing significant work.
license: MIT
compatibility: opencode
metadata:
  audience: developers
  workflow: memory-capture
---

# Memory Capture Skill

Capture observations and session summaries to `.opencode/mem/` so future sessions can recall them.

## When to Use

- After fixing a non-obvious bug
- After making an architectural decision
- After discovering an important pattern or gotcha
- At the end of a significant session
- When the user says "remember this" or "save this for later"

## How to Use

### Via Custom Tool (Recommended)

Use the `mem-capture` tool provided by the opencode-mem plugin:

```
mem_capture(
  type="decision",
  title="Use Zod for Validation",
  subtitle="Chose Zod over Joi for schema validation",
  narrative="After comparing Zod and Joi, we chose Zod because...",
  facts=["Zod has better TypeScript support", "Zod is lighter weight"],
  concepts=["validation", "types"],
  filesModified=["packages/validation/schema.ts"]
)
```

Parameters:
- `type` (required): bugfix, feature, refactor, decision, discovery, config, error
- `title` (required): Short title
- `narrative` (required): Detailed description
- `subtitle` (optional): One-line summary
- `facts` (optional): Array of key facts
- `concepts` (optional): Array of related concepts
- `filesRead` (optional): Files that were read
- `filesModified` (optional): Files that were modified

## What to Capture

### Observation Types

| Type | Description |
|------|-------------|
| `bugfix` | Bugs fixed and how |
| `feature` | Features implemented and approach |
| `refactor` | Refactoring decisions and rationale |
| `decision` | Architectural or design decisions |
| `discovery` | Important discoveries about the codebase |
| `config` | Configuration changes and why |
| `error` | Errors encountered and solutions |

## Privacy

Use `<private>` tags in prompts to exclude sensitive content from automatic capture:

```
<private>
This contains API keys — do not capture.
</private>
```

## Tips

- Keep observations concise but complete
- Include file paths for context
- Tag with relevant concepts for discoverability
- One observation per distinct finding
- Capture at natural breakpoints, not every tool use
