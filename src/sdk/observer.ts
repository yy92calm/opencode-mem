/**
 * OpenCode SDK Integration for AI-Driven Observations
 * 
 * Uses OpenCode's session.prompt() with JSON Schema structured output
 * to generate observations using the configured AI model.
 * 
 * Advantages:
 * - No need for separate Anthropic API key
 * - Uses user's configured model (Claude, OpenRouter, Gemini, etc.)
 * - Leverages OpenCode's model selection and provider system
 * - Integrated session management
 * - Structured output validation via JSON Schema
 */

// Note: We don't import Session type from SDK since the client
// is injected via plugin context, not created directly

export interface ObservationSchema {
  type: string;
  title: string;
  subtitle: string;
  narrative: string;
  facts: string[];
  concepts: string[];
  filesRead: string[];
  filesModified: string[];
}

export interface SessionSummarySchema {
  request: string;
  investigated: string;
  learned: string;
  completed: string;
  nextSteps: string;
  notes: string;
}

/**
 * JSON Schema for observation generation
 * Used with OpenCode SDK's structured output
 */
export const observationJsonSchema = {
  type: 'object' as const,
  properties: {
    type: {
      type: 'string',
      enum: ['discovery', 'feature', 'bugfix', 'refactor', 'change', 'decision'],
      description: 'Observation type',
    },
    title: {
      type: 'string',
      maxLength: 200,
      description: 'Short title capturing what was learned (max 60 chars recommended)',
    },
    subtitle: {
      type: 'string',
      maxLength: 500,
      description: 'One sentence explanation of the observation (max 120 chars)',
    },
    narrative: {
      type: 'string',
      maxLength: 5000,
      description: 'Full context: What was done, findings, why it matters',
    },
    facts: {
      type: 'array',
      items: { type: 'string' },
      maxItems: 10,
      description: 'Key concrete facts discovered (2-5 recommended)',
    },
    concepts: {
      type: 'array',
      items: { type: 'string' },
      maxItems: 10,
      description: 'Related domain concepts (auth, database, api, performance, security, etc.)',
    },
    filesRead: {
      type: 'array',
      items: { type: 'string' },
      maxItems: 50,
      description: 'Files read during this operation',
    },
    filesModified: {
      type: 'array',
      items: { type: 'string' },
      maxItems: 50,
      description: 'Files modified during this operation',
    },
  },
  required: ['type', 'title', 'subtitle', 'narrative', 'facts', 'concepts'],
};

/**
 * JSON Schema for session summary generation
 */
export const sessionSummaryJsonSchema = {
  type: 'object' as const,
  properties: {
    request: {
      type: 'string',
      maxLength: 1000,
      description: 'What was the user trying to accomplish? (1-2 sentences)',
    },
    investigated: {
      type: 'string',
      maxLength: 1000,
      description: 'What was explored/researched? (2-3 bullet points)',
    },
    learned: {
      type: 'string',
      maxLength: 1000,
      description: 'What was learned about the system? (2-3 bullet points)',
    },
    completed: {
      type: 'string',
      maxLength: 1000,
      description: 'What work was completed/shipped? (2-3 bullet points)',
    },
    nextSteps: {
      type: 'string',
      maxLength: 1000,
      description: 'What should be done next? (2-3 bullet points)',
    },
    notes: {
      type: 'string',
      maxLength: 1000,
      description: 'Any additional important context',
    },
  },
  required: ['request', 'investigated', 'learned', 'completed', 'nextSteps'],
};

/**
 * Build prompt for AI to generate observation from tool execution
 */
export function buildObservationPrompt(toolExecution: {
  tool: string;
  input: unknown;
  output: string;
  workdir?: string;
}): string {
  const inputJson =
    typeof toolExecution.input === 'string'
      ? toolExecution.input
      : JSON.stringify(toolExecution.input, null, 2);
  const outputPreview = toolExecution.output.substring(0, 2000);

  return `You are an AI observer analyzing a software development tool execution.

## Tool Execution

**Tool**: ${toolExecution.tool}
**Working Directory**: ${toolExecution.workdir || 'unknown'}

**Input Parameters**:
\`\`\`json
${inputJson}
\`\`\`

**Execution Output** (first 2000 chars):
\`\`\`
${outputPreview}
\`\`\`

## Your Task

Analyze what was learned or discovered from this tool execution and generate a structured observation.

Focus on:
- WHAT WAS LEARNED or DISCOVERED (not what operation was performed)
- Key findings and facts from the output
- Relevant concepts and domain areas
- Files that were affected

## Guidelines

- **type**: Must be one of: discovery | feature | bugfix | refactor | change | decision
- **title**: Answer "what did we learn?" not "what tool was run?" (max 60 chars recommended)
- **subtitle**: One-line summary (max 120 chars)
- **facts**: 2-5 concrete, self-contained statements
- **concepts**: Domain areas: auth, database, api, testing, performance, security, logging, validation, deployment, types, etc.
- **filesRead/filesModified**: Extract from parameters and output

Skip trivial operations (empty output, simple ls/echo, etc.) by returning minimal content.`;
}

/**
 * Build prompt for AI to generate session summary
 */
export function buildSessionSummaryPrompt(sessionInfo: {
  userRequest: string;
  toolsUsed: string[];
  filesRead: string[];
  filesModified: string[];
  recentObservations: string[];
}): string {
  return `You are summarizing a development session. Create a concise checkpoint.

## Session Context

**User's Request**: ${sessionInfo.userRequest || 'General development'}

**Tools Used**: ${sessionInfo.toolsUsed.join(', ') || 'N/A'}

**Files Read** (${sessionInfo.filesRead.length}):
${sessionInfo.filesRead.slice(0, 10).join(', ')}

**Files Modified** (${sessionInfo.filesModified.length}):
${sessionInfo.filesModified.slice(0, 10).join(', ')}

**Recent Observations**:
${sessionInfo.recentObservations.slice(0, 5).join('; ')}

## Your Task

Generate a concise session summary covering:
- What the user was trying to accomplish
- What was explored/researched
- Key learnings about the system
- What work was completed/shipped
- Next steps to continue

Keep each field concise (under 100 words total). Focus on substantive progress.`;
}

/**
 * Parse observation response from structured output
 */
export function parseObservationResponse(data: any): ObservationSchema | null {
  if (!data) return null;

  try {
    return {
      type: data.type || 'discovery',
      title: String(data.title || ''),
      subtitle: String(data.subtitle || ''),
      narrative: String(data.narrative || ''),
      facts: Array.isArray(data.facts) ? data.facts.map(String) : [],
      concepts: Array.isArray(data.concepts) ? data.concepts.map(String) : [],
      filesRead: Array.isArray(data.filesRead) ? data.filesRead.map(String) : [],
      filesModified: Array.isArray(data.filesModified) ? data.filesModified.map(String) : [],
    };
  } catch (error) {
    return null;
  }
}

/**
 * Parse session summary response from structured output
 */
export function parseSessionSummaryResponse(data: any): SessionSummarySchema | null {
  if (!data) return null;

  try {
    return {
      request: String(data.request || ''),
      investigated: String(data.investigated || ''),
      learned: String(data.learned || ''),
      completed: String(data.completed || ''),
      nextSteps: String(data.nextSteps || ''),
      notes: String(data.notes || ''),
    };
  } catch (error) {
    return null;
  }
}
