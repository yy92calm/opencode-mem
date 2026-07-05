---
name: mem-profile
description: Fetch the latest auto-generated user profile from the Worker
---

# mem-profile Skill

Wraps the `mem-profile` plugin tool. Returns the Markdown profile that the
Worker maintains automatically.

## When to use

- At the start of a session when you need to know who you're helping
- When the user asks "what do you remember about me / this project?"
- To debug why injected context looks stale

## How to call

```yaml
tool: mem-profile
args: {}
```

## How the profile gets built

The Worker runs LLM jobs on a schedule:

- **Daily 03:00** — distills yesterday's raw conversations into a daily summary
- **Weekly Sunday 03:00** — builds a profile from the last 7 days of daily summaries
- **On demand** — refreshes profile when ≥10 new hard memories accumulate (delta trigger)

Hard memories are NOT fed into the profile — they're injected into the system
prompt separately by the plugin. The profile captures only what's *observed*
from behavior; hard memories capture what the user *asserted*.

Profiles are capped at 60 lines and structured by section
(Identity & Context, Stack & Tools, Preferences, Active Projects, Recent Patterns).

## Notes

- The plugin automatically injects this profile into every chat system prompt;
  you usually don't need to call this skill explicitly.
- If the Worker is unreachable, the plugin falls back to a local cache of the
  last known profile.
