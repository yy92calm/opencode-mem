import { getLLM } from './client.js';
import type { RawConversation, HardMemory, DailySummary } from '../types/index.js';

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

Input: recent daily summaries + hard memories.

CRITICAL: Hard memories are injected SEPARATELY into the system prompt. The profile must NOT contain ANY information from hard memories. Only use daily summaries to build the profile.

Output: a Markdown profile under 60 lines, with these sections:

## Identity & Context
(2-3 lines: what kind of work they do, primary environment — from daily summaries only)

## Stack & Tools
(bullet list of confirmed tech from daily summaries: languages, frameworks, build tools, editors)

## Preferences
(coding style, communication patterns OBSERVED from daily summaries — NOT explicit user commands)

## Active Projects
(what they're currently building / debugging — keep current, drop stale)

## Recent Patterns
(2-3 bullets: themes from the last week)

If daily summaries are empty or insufficient, leave sections as "(pending more data)".
Do NOT invent facts. Do NOT repeat hard memory content.`;

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

  const response = await getLLM().chat([
    { role: 'system', content: DAILY_SUMMARY_SYSTEM },
    {
      role: 'user',
      content: `Date: ${date}\nUser: ${user_id}\n\nConversations:\n${formatted}\n\nReturn JSON only.`,
    },
  ], {
    temperature: 0.2,
    response_format: { type: 'json_object' },
  });

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

export async function generateProfile(
  user_id: string,
  summaries: DailySummary[],
  hardMemories: HardMemory[],
): Promise<string> {
  const summariesText = summaries
    .map(s => `### ${s.date} (${s.raw_count} msgs)\n${s.content}`)
    .join('\n\n');

  const memoriesText = hardMemories
    .map(m => `- [${m.type}] ${m.title}: ${m.content.slice(0, 300)}`)
    .join('\n');

  const userContent = `User: ${user_id}

=== Recent Daily Summaries ===
${summariesText || '(none)'}

=== Hard Memories (user-asserted) ===
${memoriesText || '(none)'}

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
