import { listObservations, listSessions } from '../storage/markdown.js';

import type { MemSettings } from '../types/index.js';

export function buildContext(
  directory: string,
  options: { maxObservations?: number; sessionCount?: number; memDir?: string } = {}
): string | null {
  const { maxObservations = 15, sessionCount = 3, memDir: customMemDir } = options;
  const settings = customMemDir ? { memDir: customMemDir } : undefined;

  const observations = listObservations(directory, settings).slice(-maxObservations).reverse();
  const sessions = listSessions(directory, settings).slice(0, sessionCount);

  if (observations.length === 0 && sessions.length === 0) return null;

  let context = `# Memory Context

> Retrieved from \`.opencode/mem/\` at ${new Date().toISOString()}

`;

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
