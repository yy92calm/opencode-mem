/**
 * AI Observer Prompts for OpenCode
 * 
 * These prompts guide Claude AI in generating meaningful observations
 * from tool executions, similar to claude-mem architecture
 */

export interface ToolExecution {
  tool: string;
  input: unknown;
  output: string;
  timestamp: string;
  workdir?: string;
}

export function buildObservationPrompt(exec: ToolExecution): string {
  const inputJson = typeof exec.input === 'string' ? exec.input : JSON.stringify(exec.input, null, 2);
  const outputPreview = exec.output.substring(0, 2000); // Limit output size

  return `You are an AI observer for a software development session. Analyze this tool execution and create a meaningful observation record.

## Tool Execution

**Tool**: ${exec.tool}
**Working Directory**: ${exec.workdir || 'unknown'}
**Timestamp**: ${exec.timestamp}

**Input Parameters**:
\`\`\`json
${inputJson}
\`\`\`

**Execution Output** (first 2000 chars):
\`\`\`
${outputPreview}
\`\`\`

## Your Task

Generate a structured observation that captures what was learned or discovered. Focus on:
- WHAT WAS LEARNED or DISCOVERED (not what was executed)
- Key facts and findings from the output
- Relevant concepts or patterns
- Files affected

## Output Format

Return ONLY a single valid JSON object (no markdown, no extra text):

\`\`\`json
{
  "type": "discovery",
  "title": "[One-line title describing what was learned, max 60 chars]",
  "subtitle": "[One sentence summary, max 120 chars]",
  "narrative": "[2-3 sentences with full context and findings]",
  "facts": ["fact 1", "fact 2", "fact 3"],
  "concepts": ["concept1", "concept2"],
  "filesRead": ["file1", "file2"],
  "filesModified": ["file3"]
}
\`\`\`

## Guidelines

- **type** must be one of: "discovery", "feature", "bugfix", "refactor", "change", "decision"
- **title** should answer "what did we learn?" not "what operation ran?"
- **facts** should be 2-5 concrete, self-contained statements
- **concepts** should relate to domain areas: auth, database, api, testing, performance, security, etc.
- If output is empty or trivial, return null for narrative/facts
- Return empty arrays for files* if none were affected

Skip this observation if:
- Output is just a simple file listing with no findings
- It's a routine operation (ls, pwd, echo)
- Error message shows nothing was learned

In skip cases, return this special value:
\`\`\`json
{ "skip": true }
\`\`\`
`;
}

export function buildSessionSummaryPrompt(
  sessionInfo: {
    userRequest: string;
    toolsUsed: string[];
    filesRead: string[];
    filesModified: string[];
    observations: string[];
  }
): string {
  return `You are summarizing a development session. Create a concise progress checkpoint.

## Session Context

**User's Initial Request**: ${sessionInfo.userRequest || 'General development'}

**Tools Used**: ${sessionInfo.toolsUsed.join(', ')}

**Files Read** (${sessionInfo.filesRead.length}): ${sessionInfo.filesRead.slice(0, 10).join(', ')}

**Files Modified** (${sessionInfo.filesModified.length}): ${sessionInfo.filesModified.slice(0, 10).join(', ')}

**Observations Made** (${sessionInfo.observations.length} total):
${sessionInfo.observations.slice(0, 5).join('\n')}
${sessionInfo.observations.length > 5 ? `... and ${sessionInfo.observations.length - 5} more` : ''}

## Your Task

Generate a concise session summary that captures:
- What was the user trying to accomplish?
- What was discovered/built/fixed?
- Key decisions made
- What should be done next?

## Output Format

Return ONLY a single valid JSON object:

\`\`\`json
{
  "request": "[What was the user trying to do? 1-2 sentences]",
  "investigated": "[What was explored/researched? 2-3 bullet points]",
  "learned": "[What did we learn about the system? 2-3 bullet points]",
  "completed": "[What work was completed/shipped? 2-3 bullet points]",
  "nextSteps": "[What should be done next? 2-3 bullet points]",
  "notes": "[Any additional important context]"
}
\`\`\`

Keep each field concise (under 100 words total). Focus on substantive progress, not routine operations.
`;
}

export interface ParsedObservation {
  skip?: boolean;
  type?: string;
  title?: string;
  subtitle?: string;
  narrative?: string;
  facts?: string[];
  concepts?: string[];
  filesRead?: string[];
  filesModified?: string[];
}

export function parseObservationResponse(response: string): ParsedObservation | null {
  try {
    // Extract JSON from response (might be wrapped in markdown code fence)
    const jsonMatch = response.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    const jsonStr = jsonMatch ? jsonMatch[1] : response;
    const parsed = JSON.parse(jsonStr);
    
    if (parsed.skip) {
      return { skip: true };
    }

    return {
      type: parsed.type || 'discovery',
      title: parsed.title?.substring(0, 200) || '',
      subtitle: parsed.subtitle?.substring(0, 500) || '',
      narrative: parsed.narrative?.substring(0, 5000) || '',
      facts: (Array.isArray(parsed.facts) ? parsed.facts : []).slice(0, 10),
      concepts: (Array.isArray(parsed.concepts) ? parsed.concepts : []).slice(0, 10),
      filesRead: (Array.isArray(parsed.filesRead) ? parsed.filesRead : []).slice(0, 50),
      filesModified: (Array.isArray(parsed.filesModified) ? parsed.filesModified : []).slice(0, 50),
    };
  } catch (error) {
    return null;
  }
}

export interface ParsedSummary {
  request?: string;
  investigated?: string;
  learned?: string;
  completed?: string;
  nextSteps?: string;
  notes?: string;
}

export function parseSummaryResponse(response: string): ParsedSummary | null {
  try {
    const jsonMatch = response.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    const jsonStr = jsonMatch ? jsonMatch[1] : response;
    const parsed = JSON.parse(jsonStr);

    return {
      request: parsed.request?.substring(0, 1000) || '',
      investigated: parsed.investigated?.substring(0, 1000) || '',
      learned: parsed.learned?.substring(0, 1000) || '',
      completed: parsed.completed?.substring(0, 1000) || '',
      nextSteps: parsed.nextSteps?.substring(0, 1000) || '',
      notes: parsed.notes?.substring(0, 1000) || '',
    };
  } catch (error) {
    return null;
  }
}
