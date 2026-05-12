import { listObservations, listSessions } from '../storage/markdown.js';
import { loadProfile } from '../analysis/profile.js';

import type { MemSettings } from '../types/index.js';

export function buildContext(
  directory: string,
  options: { maxObservations?: number; sessionCount?: number; memDir?: string; daysBack?: number } = {}
): string | null {
  const { maxObservations = 15, sessionCount = 3, memDir: customMemDir, daysBack = 7 } = options;
  const settings = customMemDir ? { memDir: customMemDir } : undefined;

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysBack);

  const allObservations = listObservations(directory, settings);
  const allSessions = listSessions(directory, settings);

  const observations = allObservations
    .filter(obs => new Date(obs.timestamp) >= cutoffDate)
    .slice(-maxObservations)
    .reverse();
  const sessions = allSessions
    .filter(ses => new Date(ses.timestamp) >= cutoffDate)
    .slice(0, sessionCount);

  const profile = loadProfile(directory);

  if (!profile && observations.length === 0 && sessions.length === 0) return null;

  let context = `# Memory Context

> Retrieved from memory store at ${new Date().toISOString()}
> Showing last ${daysBack} days

`;

  if (profile) {
    context += `## User Profile\n\n${profile}\n\n`;
  }

  if (observations.length > 0) {
    context += `## Recent Observations\n\n`;
    for (const obs of observations) {
      context += `### ${obs.title}\n`;
      if (obs.subtitle) context += `> ${obs.subtitle}\n`;
      context += `- **Type**: ${obs.type}\n`;
      if (obs.concepts.length > 0) context += `- **Concepts**: ${obs.concepts.join(', ')}\n`;
      if (obs.filesModified.length > 0) context += `- **Files**: ${obs.filesModified.join(', ')}\n`;
      context += `- **Time**: ${obs.timestamp}\n\n`;
    }
  }

  if (sessions.length > 0) {
    context += `## Recent Sessions\n\n`;
    for (const ses of sessions) {
      context += `### ${ses.request}\n`;
      if (ses.learned) context += `**Learned**: ${ses.learned}\n`;
      if (ses.completed) context += `**Completed**: ${ses.completed}\n`;
      if (ses.nextSteps) context += `**Next**: ${ses.nextSteps}\n`;
      context += '\n';
    }
  }

  return context;
}
