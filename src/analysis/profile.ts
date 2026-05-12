import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { analyzeUserHabits } from './insights.js';
import { getMemDir } from '../storage/markdown.js';
import { logger } from '../utils/logger.js';
import { getOpencodeClient } from '../sdk/client.js';

const PROFILE_MAX_LINES = 60;
const UPDATE_INTERVAL_DAYS = 30;
const INITIAL_OBSERVATION_THRESHOLD = 20;
const UPDATE_OBSERVATION_THRESHOLD = 30;

const PROFILE_TEMPLATE = `# User Profile

> Auto-generated template. Will be filled by mem-profile analysis.

## Technical Stack
- Primary: 
- Frameworks: 
- Tools: 

## Work Habits
- Peak hours: 
- Preferred tools: 
- Common workflow: 

## Coding Style
- Language preference: 
- Architecture style: 
- Documentation: 

## Communication
- Response style: 
- Language: 
- Detail level: 

## Decision Patterns
- Speed: 
- Approach: 
- Risk tolerance: 
`;

export function getProfilePath(directory: string): string {
  return join(getMemDir(directory), 'profile.md');
}

export function initProfile(directory: string): boolean {
  const path = getProfilePath(directory);
  if (existsSync(path)) return false;

  const template = `# User Profile

> Auto-generated template. Will be populated by \`mem-profile\` analysis.

## Technical Stack
- Primary: 
- Frameworks: 
- Tools: 

## Work Habits
- Peak hours: 
- Preferred tools: 
- Common workflow: 

## Coding Style
- Language preference: 
- Architecture style: 
- Documentation: 

## Communication
- Response style: 
- Language: 
- Detail level: 

## Decision Patterns
- Speed: 
- Approach: 
- Risk tolerance: 
`;

  writeFileSync(path, template.trim(), 'utf-8');
  logger.info('PROFILE', `Initialized empty profile template at ${path}`);
  return true;
}

export function loadProfile(directory: string): string | null {
  const path = getProfilePath(directory);
  if (!existsSync(path)) return null;
  const content = readFileSync(path, 'utf-8');
  const trimmed = content.trim();
  if (!trimmed || trimmed.includes('> Auto-generated template')) return null;
  return trimmed;
}

export function shouldUpdateProfile(directory: string): boolean {
  const path = getProfilePath(directory);
  if (!existsSync(path)) return true;

  const content = readFileSync(path, 'utf-8');
  if (content.includes('> Auto-generated template')) {
    const insights = analyzeUserHabits(directory, { daysBack: 90 });
    return insights.totalObservations >= INITIAL_OBSERVATION_THRESHOLD;
  }

  try {
    const stats = require('fs').statSync(path);
    const daysSinceUpdate = (Date.now() - stats.mtimeMs) / (1000 * 60 * 60 * 24);
    if (daysSinceUpdate >= UPDATE_INTERVAL_DAYS) return true;

    const recentInsights = analyzeUserHabits(directory, { daysBack: 30 });
    if (recentInsights.totalObservations >= UPDATE_OBSERVATION_THRESHOLD) return true;
  } catch {
    return true;
  }

  return false;
}

export function saveProfile(directory: string, content: string): void {
  const path = getProfilePath(directory);
  const lines = content.split('\n').slice(0, PROFILE_MAX_LINES);
  const trimmed = lines.join('\n').trim();

  const final = `# User Profile

> Auto-generated from memory analysis. Updated: ${new Date().toISOString()}
> Max ${PROFILE_MAX_LINES} lines to control context size.

${trimmed}`;

  writeFileSync(path, final, 'utf-8');
  logger.info('PROFILE', `Saved profile to ${path}`);
}

export async function generateProfile(directory: string): Promise<string | null> {
  const insights = analyzeUserHabits(directory, { daysBack: 90 });

  if (insights.totalObservations === 0) {
    logger.warn('PROFILE', 'No observations found, cannot generate profile');
    return null;
  }

  const client = getOpencodeClient();
  if (!client) {
    return generateRuleBasedProfile(insights);
  }

  try {
    const prompt = buildProfilePrompt(insights);
    const result = await client.session.prompt({
      path: { id: 'mem-observer-profile' },
      body: {
        parts: [{ type: 'text', text: prompt }],
        noReply: true,
      },
    });

    const text = result?.data?.info?.content?.[0]?.text || '';
    if (text.trim()) {
      return text.trim();
    }
  } catch (error) {
    logger.warn('PROFILE', `AI generation failed: ${error}, using rule-based`);
  }

  return generateRuleBasedProfile(insights);
}

function buildProfilePrompt(insights: any): string {
  return `Based on the user's operation history analysis, generate a concise user profile (max 50 lines).

## Analysis Data

**Total Observations**: ${insights.totalObservations}
**Total Sessions**: ${insights.totalSessions}

### Tool Usage (top 5):
${insights.toolUsage.slice(0, 5).map((t: any) => `- ${t.tool}: ${t.count} times (${t.percentage}%)`).join('\n')}

### File Types (top 5):
${insights.filePatterns.slice(0, 5).map((f: any) => `- .${f.extension}: ${f.count} files`).join('\n')}

### Peak Hours (top 3):
${insights.timePatterns.slice(0, 3).map((t: any) => `- ${String(t.hour).padStart(2, '0')}:00 - ${t.count} ops`).join('\n')}

### Top Concepts (top 10):
${insights.conceptDistribution.slice(0, 10).map((c: any) => `- ${c.concept}: ${c.count}`).join('\n')}

### Workflow Patterns (top 5):
${insights.workflowPatterns.slice(0, 5).map((w: any) => `- ${w.pattern}: ${w.count}x`).join('\n')}

## Output Format

Generate a profile.md with these sections (keep it under 50 lines total):

## Technical Stack
(primary languages, frameworks, tools inferred from file types and concepts)

## Work Habits
(peak hours, preferred tools, common workflow patterns)

## Coding Style
(inferred from concepts and file patterns - e.g., prefers TypeScript, modular design)

## Communication
(inferred from session patterns - e.g., prefers direct answers)

## Decision Patterns
(inferred from tool usage patterns)

Keep each section to 2-4 bullet points. Be specific, not generic.
`;
}

function generateRuleBasedProfile(insights: any): string {
  const topTool = insights.toolUsage[0]?.tool || 'unknown';
  const topExt = insights.filePatterns[0]?.extension || 'unknown';
  const peakHour = insights.timePatterns[0]?.hour ?? 9;
  const topConcept = insights.conceptDistribution[0]?.concept || 'general';
  const topWorkflow = insights.workflowPatterns[0]?.pattern || 'read → edit';

  const peakEnd = String(Math.min(peakHour + 3, 23)).padStart(2, '0') + ':00';
  const peakStart = String(peakHour).padStart(2, '0') + ':00';

  return `## Technical Stack
- Primary: TypeScript, Node.js ecosystem
- Most edited: .${topExt} files
- Key domains: ${insights.conceptDistribution.slice(0, 3).map((c: any) => c.concept).join(', ')}

## Work Habits
- Peak hours: ${peakStart}-${peakEnd}
- Primary tool: ${topTool} (${insights.toolUsage[0]?.count || 0} uses)
- Common workflow: ${topWorkflow}

## Coding Style
- Type-safe: prefers TypeScript
- Modular: small focused files
- Iterative: quick edits, frequent commits

## Communication
- Direct: concise answers preferred
- Language: Chinese
- Detail: high-level with key specifics

## Decision Patterns
- Fast: tool selection, file operations
- Iterative: try → observe → refine
- Git-heavy: frequent commits and pushes`;
}
