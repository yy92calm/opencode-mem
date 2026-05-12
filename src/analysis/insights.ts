import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { parseFrontmatter, getMemDir } from '../storage/markdown.js';

interface ToolUsage {
  tool: string;
  count: number;
  percentage: number;
}

interface FilePattern {
  extension: string;
  count: number;
}

interface TimePattern {
  hour: number;
  count: number;
}

interface ConceptDistribution {
  concept: string;
  count: number;
}

interface WorkflowPattern {
  pattern: string;
  count: number;
}

interface UserInsights {
  toolUsage: ToolUsage[];
  filePatterns: FilePattern[];
  timePatterns: TimePattern[];
  conceptDistribution: ConceptDistribution[];
  workflowPatterns: WorkflowPattern[];
  totalObservations: number;
  totalSessions: number;
  dateRange: { start: string; end: string };
  avgToolsPerSession: number;
}

export function analyzeUserHabits(
  directory: string,
  options: { daysBack?: number } = {}
): UserInsights {
  const { daysBack = 90 } = options;
  const memDir = getMemDir(directory);
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysBack);

  // Collect all observations
  const allFiles = walkMdFiles(memDir, 'observations');
  const observations = allFiles
    .map(f => {
      const content = readFileSync(f, 'utf-8');
      const fm = parseFrontmatter(content);
      const timestamp = String(fm.timestamp || '');
      if (timestamp && new Date(timestamp) < cutoffDate) return null;
      return { content, fm, filepath: f };
    })
    .filter(Boolean);

  const sessions = new Set(observations.map(o => o?.fm?.session || '').filter(Boolean));

  // Analyze tool usage
  const toolCounts: Record<string, number> = {};
  for (const obs of observations) {
    if (!obs) continue;
    const title = String(obs.fm.title || '');
    const subtitle = String(obs.fm.subtitle || '');
    const narrative = obs.content;

    // Detect tool from title/subtitle/narrative
    let tool = detectTool(title, subtitle, narrative);
    if (tool) {
      toolCounts[tool] = (toolCounts[tool] || 0) + 1;
    }
  }

  const totalTools = Object.values(toolCounts).reduce((a, b) => a + b, 0);
  const toolUsage: ToolUsage[] = Object.entries(toolCounts)
    .map(([tool, count]) => ({
      tool,
      count,
      percentage: totalTools > 0 ? Math.round((count / totalTools) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count);

  // Analyze file patterns
  const extCounts: Record<string, number> = {};
  for (const obs of observations) {
    if (!obs) continue;
    const filesRead = Array.isArray(obs.fm.files_read) ? obs.fm.files_read as string[] : [];
    const filesModified = Array.isArray(obs.fm.files_modified) ? obs.fm.files_modified as string[] : [];
    const allFiles = [...filesRead, ...filesModified];

    for (const file of allFiles) {
      const ext = file.split('.').pop() || 'no-ext';
      extCounts[ext] = (extCounts[ext] || 0) + 1;
    }
  }

  const filePatterns: FilePattern[] = Object.entries(extCounts)
    .map(([extension, count]) => ({ extension, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Analyze time patterns
  const hourCounts: Record<number, number> = {};
  for (const obs of observations) {
    if (!obs) continue;
    const timestamp = String(obs.fm.timestamp || '');
    if (timestamp) {
      const hour = new Date(timestamp).getHours();
      hourCounts[hour] = (hourCounts[hour] || 0) + 1;
    }
  }

  const timePatterns: TimePattern[] = Object.entries(hourCounts)
    .map(([hour, count]) => ({ hour: parseInt(hour), count }))
    .sort((a, b) => b.count - a.count);

  // Analyze concept distribution
  const conceptCounts: Record<string, number> = {};
  for (const obs of observations) {
    if (!obs) continue;
    const concepts = Array.isArray(obs.fm.concepts) ? obs.fm.concepts as string[] : [];
    for (const concept of concepts) {
      conceptCounts[concept] = (conceptCounts[concept] || 0) + 1;
    }
  }

  const conceptDistribution: ConceptDistribution[] = Object.entries(conceptCounts)
    .map(([concept, count]) => ({ concept, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);

  // Analyze workflow patterns
  const workflowPatterns = detectWorkflowPatterns(observations);

  // Date range
  const timestamps = observations
    .map(o => o?.fm?.timestamp)
    .filter(Boolean)
    .map(t => String(t))
    .sort();

  // Average tools per session
  const avgToolsPerSession = sessions.size > 0 ? Math.round((totalTools / sessions.size) * 10) / 10 : 0;

  return {
    toolUsage,
    filePatterns,
    timePatterns,
    conceptDistribution,
    workflowPatterns,
    totalObservations: observations.length,
    totalSessions: sessions.size,
    dateRange: {
      start: timestamps[0] || '',
      end: timestamps[timestamps.length - 1] || '',
    },
    avgToolsPerSession,
  };
}

function detectTool(title: string, subtitle: string, narrative: string): string | null {
  const combined = `${title} ${subtitle} ${narrative}`.toLowerCase();

  if (combined.includes('tool: bash') || combined.includes('command:')) return 'bash';
  if (combined.includes('tool: read') || combined.includes('file exploration')) return 'read';
  if (combined.includes('tool: edit') || combined.includes('file modified')) return 'edit';
  if (combined.includes('tool: write') || combined.includes('file created')) return 'write';
  if (combined.includes('tool: glob') || combined.includes('files discovered')) return 'glob';
  if (combined.includes('tool: grep') || combined.includes('code search')) return 'grep';
  if (combined.includes('tool: webfetch') || combined.includes('web content')) return 'webfetch';
  if (combined.includes('todowrite')) return 'todowrite';
  if (combined.includes('git add') || combined.includes('git commit') || combined.includes('git push')) return 'git';
  if (combined.includes('npm install') || combined.includes('dependencies')) return 'npm';

  return null;
}

function detectWorkflowPatterns(observations: any[]): WorkflowPattern[] {
  const patterns: Record<string, number> = {};

  // Group observations by session
  const sessionGroups: Record<string, any[]> = {};
  for (const obs of observations) {
    if (!obs) continue;
    const sessionId = String(obs.fm.session || 'unknown');
    if (!sessionGroups[sessionId]) sessionGroups[sessionId] = [];
    sessionGroups[sessionId].push(obs);
  }

  // Detect patterns within each session
  for (const [, sessionObs] of Object.entries(sessionGroups)) {
    const tools = sessionObs.map(o => {
      const title = String(o.fm.title || '');
      const subtitle = String(o.fm.subtitle || '');
      return detectTool(title, subtitle, o.content);
    }).filter(Boolean);

    // Detect common patterns
    for (let i = 0; i < tools.length - 1; i++) {
      const pair = `${tools[i]} → ${tools[i + 1]}`;
      patterns[pair] = (patterns[pair] || 0) + 1;
    }

    // Detect triple patterns
    for (let i = 0; i < tools.length - 2; i++) {
      const triple = `${tools[i]} → ${tools[i + 1]} → ${tools[i + 2]}`;
      patterns[triple] = (patterns[triple] || 0) + 1;
    }
  }

  return Object.entries(patterns)
    .map(([pattern, count]) => ({ pattern, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}

function walkMdFiles(memDir: string, subDir: string): string[] {
  const files: string[] = [];
  const targetDir = join(memDir, subDir);

  if (!existsSync(targetDir)) return files;

  // Walk through all month directories
  const entries = readdirSync(memDir);
  for (const entry of entries) {
    const monthDir = join(memDir, entry);
    if (!statSync(monthDir).isDirectory()) continue;
    if (!/^\d{4}-\d{2}$/.test(entry)) continue;

    const obsDir = join(monthDir, subDir);
    if (!existsSync(obsDir)) continue;

    files.push(...walkFilesRecursive(obsDir));
  }

  // Also check root observations directory (legacy files)
  if (existsSync(targetDir)) {
    files.push(...walkFilesRecursive(targetDir));
  }

  return files;
}

function walkFilesRecursive(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const files: string[] = [];
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      files.push(...walkFilesRecursive(fullPath));
    } else if (entry.endsWith('.md')) {
      files.push(fullPath);
    }
  }
  return files;
}

function formatInsights(insights: UserInsights): string {
  let output = `# User Operation Habits Analysis

> Analyzed ${insights.totalObservations} observations across ${insights.totalSessions} sessions
> Date range: ${insights.dateRange.start} to ${insights.dateRange.end}
> Average tools per session: ${insights.avgToolsPerSession}

## Tool Usage Distribution

`;

  for (const tool of insights.toolUsage.slice(0, 10)) {
    const bar = '█'.repeat(Math.floor(tool.percentage / 2));
    output += `- **${tool.tool}**: ${tool.count} times (${tool.percentage}%) ${bar}\n`;
  }

  output += `\n## File Type Distribution\n\n`;
  for (const fp of insights.filePatterns.slice(0, 8)) {
    output += `- **.${fp.extension}**: ${fp.count} files\n`;
  }

  output += `\n## Active Hours\n\n`;
  for (const tp of insights.timePatterns.slice(0, 8)) {
    const hour = String(tp.hour).padStart(2, '0') + ':00';
    const bar = '█'.repeat(Math.floor(tp.count / 2));
    output += `- ${hour}: ${tp.count} operations ${bar}\n`;
  }

  output += `\n## Top Concepts\n\n`;
  for (const cd of insights.conceptDistribution.slice(0, 10)) {
    output += `- **${cd.concept}**: mentioned ${cd.count} times\n`;
  }

  output += `\n## Common Workflow Patterns\n\n`;
  for (const wp of insights.workflowPatterns.slice(0, 8)) {
    output += `- **${wp.pattern}**: ${wp.count} times\n`;
  }

  // Generate summary
  output += `\n## Summary\n\n`;

  if (insights.toolUsage.length > 0) {
    const topTool = insights.toolUsage[0];
    output += `- Most used tool: **${topTool.tool}** (${topTool.count} times, ${topTool.percentage}%)\n`;
  }

  if (insights.filePatterns.length > 0) {
    output += `- Most edited file type: **.${insights.filePatterns[0].extension}**\n`;
  }

  if (insights.timePatterns.length > 0) {
    const peakHour = insights.timePatterns[0];
    output += `- Peak activity: **${String(peakHour.hour).padStart(2, '0')}:00** (${peakHour.count} operations)\n`;
  }

  if (insights.conceptDistribution.length > 0) {
    output += `- Top concept: **${insights.conceptDistribution[0].concept}**\n`;
  }

  if (insights.workflowPatterns.length > 0) {
    output += `- Common workflow: **${insights.workflowPatterns[0].pattern}**\n`;
  }

  return output;
}

export { formatInsights };
