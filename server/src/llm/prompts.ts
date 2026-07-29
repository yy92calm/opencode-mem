import { getLLM } from './client.js';
import type { RawConversation, DailySummary } from '../types/index.js';

const DAILY_SUMMARY_SYSTEM = `You analyze a developer's coding session conversations and produce a concise daily summary.

Output a JSON object with this exact shape:
{
  "topics": ["short topic 1", "short topic 2", ...],          // 3-7 items, what the user worked on
  "decisions": ["decision 1", ...],                            // any explicit choices made (libraries, patterns, etc)
  "problems": ["problem 1", ...],                              // errors, blockers, things being debugged
  "preferences_observed": ["e.g. prefers TypeScript strict mode"],   // implicit style/tool preferences hinted by behavior
  "narrative": "2-4 sentence prose summary"
}

Be specific. Skip filler like "user asked questions". Focus on signals useful for future sessions.`;

const PROFILE_SYSTEM = `You generate or update a developer's persistent profile, used to give future AI assistants context about who they're helping.

Input: recent daily summaries (distilled from observed conversations).

The profile captures what is OBSERVED about the user from their behavior. Explicit, user-asserted facts are tracked separately and injected into the system prompt independently — therefore this profile must NOT duplicate them. Focus on patterns, stack, and working style inferred from the daily summaries.

Output: a Markdown profile under 60 lines, with these sections:

## Identity & Context
(2-3 lines: what kind of work they do, primary environment)

## Stack & Tools
(bullet list of confirmed tech from daily summaries: languages, frameworks, build tools, editors)

## Preferences
(coding style, communication patterns OBSERVED from daily summaries — NOT explicit user commands)

## Active Projects
(what they're currently building / debugging — keep current, drop stale)

## Recent Patterns
(2-3 bullets: themes from the last week)

If daily summaries are empty or insufficient, leave sections as "(pending more data)".
Do NOT invent facts.`;

export interface DailySummaryResult {
  date: string;
  raw_count: number;
  content: string;       // JSON string with structured fields
  narrative: string;
}

function formatRawForLLM(raws: RawConversation[]): string {
  const lines: string[] = [];
  let lastSession = '';
  for (const r of raws) {
    if (r.session_id !== lastSession) {
      lines.push(`\n--- session ${r.session_id.slice(0, 8)} ---`);
      lastSession = r.session_id;
    }
    if (r.role === 'tool' && r.tool_name) {
      const input = (r.tool_input || '').slice(0, 200);
      const output = (r.tool_output || '').slice(0, 300);
      lines.push(`[tool:${r.tool_name}] in=${input} out=${output}`);
    } else {
      const content = r.content.slice(0, 800);
      lines.push(`[${r.role}] ${content}`);
    }
  }
  return lines.join('\n');
}

export async function generateDailySummary(
  user_id: string,
  date: string,
  raws: RawConversation[],
): Promise<DailySummaryResult | null> {
  if (raws.length === 0) return null;

  // Cap context to avoid blowing up token limits (~50k chars ≈ 12k tokens)
  const formatted = formatRawForLLM(raws).slice(0, 50000);

  const messages = [
    { role: 'system' as const, content: DAILY_SUMMARY_SYSTEM },
    {
      role: 'user' as const,
      content: `Date: ${date}\nUser: ${user_id}\n\nConversations:\n${formatted}\n\nReturn JSON only.`,
    },
  ];

  // Prefer structured JSON output. Some OpenAI-compatible endpoints (Ollama,
  // certain Volc/Together deployments) reject the response_format field with a
  // 4xx. On that, retry once without it and parse the model's free-form output.
  let response: string;
  try {
    response = await getLLM().chat(messages, {
      temperature: 0.2,
      response_format: { type: 'json_object' },
    });
  } catch (e) {
    const msg = String(e);
    if (/\b4\d{2}\b/.test(msg) || /response_format/i.test(msg)) {
      response = await getLLM().chat(messages, { temperature: 0.2 });
    } else {
      throw e;
    }
  }

  let parsed: any;
  try {
    parsed = JSON.parse(response);
  } catch {
    return { date, raw_count: raws.length, content: response, narrative: response.slice(0, 500) };
  }

  return {
    date,
    raw_count: raws.length,
    content: JSON.stringify(parsed, null, 2),
    narrative: parsed.narrative ?? '',
  };
}

/**
 * Generate a user profile from daily summaries only.
 * Hard memories are intentionally excluded — they're injected into the
 * system prompt separately by the plugin, so including them here would
 * duplicate content and blur the observed/asserted distinction.
 */
export async function generateProfile(
  user_id: string,
  summaries: DailySummary[],
): Promise<string> {
  const summariesText = summaries
    .map(s => `### ${s.date} (${s.raw_count} msgs)\n${s.content}`)
    .join('\n\n');

  const userContent = `User: ${user_id}

=== Recent Daily Summaries ===
${summariesText || '(none)'}

Generate the profile now.`;

  const response = await getLLM().chat([
    { role: 'system', content: PROFILE_SYSTEM },
    { role: 'user', content: userContent },
  ], {
    temperature: 0.3,
  });

  // Trim to 60 lines hard cap
  return response.split('\n').slice(0, 60).join('\n').trim();
}
