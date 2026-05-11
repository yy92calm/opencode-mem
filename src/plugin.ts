import { writeObservation, writeSessionSummary, updateIndex, getMemDir, ensureMemDirs } from './storage/markdown.js';
import { classifyTool, isTrivial, generateObservation, extractFiles } from './utils/observer.js';
import { buildContext } from './context/inject.js';
import { searchMemories } from './search/search.js';
import { setOpencodeClient, isSDKAvailable, generateObservationViaSDK, generateSessionSummaryViaSDK } from './sdk/client.js';
import type { ObservationSchema, SessionSummarySchema } from './sdk/observer.js';
import { type Plugin, type PluginInput, tool } from '@opencode-ai/plugin';
import { z } from 'zod';

const sessionFilesRead: Record<string, Set<string>> = {};
const sessionFilesEdited: Record<string, Set<string>> = {};
const sessionUserPrompt: Record<string, string> = {};

export const MemPlugin: Plugin = async ({ project, client, directory }: PluginInput) => {
  // Set OpenCode SDK client for AI observation generation
  setOpencodeClient(client);
  
  await client.app.log({
    body: {
      service: 'opencode-mem',
      level: 'info',
      message: 'MemPlugin initialized with OpenCode SDK integration',
    },
  });

  const memDir = getMemDir(directory);
  ensureMemDirs(directory);

  const sessionId = directory; // 使用 directory 作为 session ID
  if (!sessionFilesRead[sessionId]) sessionFilesRead[sessionId] = new Set();
  if (!sessionFilesEdited[sessionId]) sessionFilesEdited[sessionId] = new Set();

  return {
    'tool.execute.after': async (input, output) => {
      const toolName = input.tool;
      const toolInput = input.args;
      const toolResult = output.output;
      const sid = input.sessionID || sessionId;

      await client.app.log({
        body: {
          service: 'opencode-mem',
          level: 'debug',
          message: `tool.execute.after: tool=${toolName}`,
        },
      });

      if (isTrivial(toolName, toolInput, toolResult)) {
        return;
      }

      const filesRead = toolName === 'read' ? extractFiles(toolName, toolInput, 'read') : [];
      const filesModified = (toolName === 'write' || toolName === 'edit') ? extractFiles(toolName, toolInput, 'modified') : [];

      for (const f of filesRead) sessionFilesRead[sid]?.add(f);
      for (const f of filesModified) sessionFilesEdited[sid]?.add(f);

      // Try AI observation generation via OpenCode SDK
      let obsData: ObservationSchema | null = null;
      
      if (isSDKAvailable()) {
        obsData = await generateObservationViaSDK(sid, {
          tool: toolName,
          input: toolInput,
          output: toolResult,
          workdir: directory,
        });
      }
      
      // Fallback to rule-based generation if SDK unavailable or AI failed
      if (!obsData) {
        const type = classifyTool(toolName, toolInput, toolResult);
        const ruleBasedObs = generateObservation(toolName, toolInput, toolResult, type, sid);
        if (ruleBasedObs) {
          obsData = {
            type: ruleBasedObs.type,
            title: ruleBasedObs.title,
            subtitle: ruleBasedObs.subtitle,
            narrative: ruleBasedObs.narrative,
            facts: ruleBasedObs.facts,
            concepts: ruleBasedObs.concepts,
            filesRead: ruleBasedObs.filesRead,
            filesModified: ruleBasedObs.filesModified,
          };
        }
      }

      if (obsData) {
        const obs = {
          type: obsData.type || 'discovery',
          title: obsData.title || '',
          subtitle: obsData.subtitle || '',
          narrative: obsData.narrative || '',
          facts: obsData.facts || [],
          concepts: obsData.concepts || [],
          filesRead: [...(obsData.filesRead || []), ...filesRead],
          filesModified: [...(obsData.filesModified || []), ...filesModified],
          sessionId: sid,
          timestamp: new Date().toISOString(),
        };

        const result = writeObservation(directory, obs);
        updateIndex(directory);

        await client.app.log({
          body: {
            service: 'opencode-mem',
            level: 'debug',
            message: `Captured observation #${result.id}: ${obs.title}`,
          },
        });
      }
    },

    event: async ({ event }) => {
      if (event.type === 'session.created') {
        const sid = sessionId;
        sessionFilesRead[sid] = new Set();
        sessionFilesEdited[sid] = new Set();

        await client.app.log({
          body: {
            service: 'opencode-mem',
            level: 'info',
            message: `Session created, loading memory context from ${memDir}`,
          },
        });
      }

      if (event.type === 'session.idle') {
        const sid = sessionId;
        const filesRead = Array.from(sessionFilesRead[sid] || []);
        const filesEdited = Array.from(sessionFilesEdited[sid] || []);
        const userPrompt = sessionUserPrompt[sid] || '';

        // Default summary structure
        const defaultSummary = {
          sessionId: sid,
          project: project?.id || directory,
          request: userPrompt.substring(0, 200),
          investigated: 'See observations for details.',
          learned: `${filesEdited.length} files edited: ${filesEdited.slice(0, 5).join(', ')}`,
          completed: `${filesEdited.length} files edited`,
          nextSteps: '',
          notes: '',
          filesRead,
          filesEdited,
          timestamp: new Date().toISOString(),
        };

        // Try AI summary generation via OpenCode SDK
        let summaryContent = defaultSummary;

        if (isSDKAvailable()) {
          // Collect recent observations for this session
          const sessionObsDir = `${memDir}/observations`;
          let recentObservations: string[] = [];
          try {
            const fs = await import('fs');
            if (fs.existsSync(sessionObsDir)) {
              const files = fs.readdirSync(sessionObsDir);
              recentObservations = files
                .filter(f => f.endsWith('.md'))
                .slice(-5)
                .map(f => f.replace('.md', '').replace(/^\d+-/, '').replace('-', ' '));
            }
          } catch (e) {
            // Ignore errors reading observations
          }

          const aiSummary = await generateSessionSummaryViaSDK(sid, {
            userRequest: userPrompt,
            toolsUsed: [],
            filesRead,
            filesModified: filesEdited,
            recentObservations,
          });

          if (aiSummary) {
            summaryContent = {
              sessionId: sid,
              project: project?.id || directory,
              request: aiSummary.request || userPrompt.substring(0, 200),
              investigated: aiSummary.investigated || 'See observations for details.',
              learned: aiSummary.learned || `${filesEdited.length} files edited`,
              completed: aiSummary.completed || `${filesEdited.length} files modified`,
              nextSteps: aiSummary.nextSteps || '',
              notes: aiSummary.notes || '',
              filesRead,
              filesEdited,
              timestamp: new Date().toISOString(),
            };
          }
        }

        writeSessionSummary(directory, summaryContent);
        updateIndex(directory);

        await client.app.log({
          body: {
            service: 'opencode-mem',
            level: 'info',
            message: `Session summary saved for ${sid}`,
          },
        });

        delete sessionFilesRead[sid];
        delete sessionFilesEdited[sid];
        delete sessionUserPrompt[sid];
      }
    },

tool: {
      'mem-search': tool({
        description: 'Search persistent memory observations from past sessions',
        args: {
          query: z.string().describe('Search query'),
          type: z.string().optional().describe('Filter by observation type'),
          limit: z.number().optional().default(10).describe('Max results'),
        },
        execute: async (args, context) => {
          const results = searchMemories(context.directory, args.query, {
            type: args.type,
            limit: args.limit ?? 10,
          });
          return JSON.stringify(results, null, 2);
        },
      }),
      'mem-capture': tool({
        description: 'Capture an observation to persistent memory',
        args: {
          type: z.string().describe('Observation type: bugfix|feature|refactor|decision|discovery|config|error'),
          title: z.string().describe('Short title'),
          subtitle: z.string().optional().describe('One-line summary'),
          narrative: z.string().describe('Detailed description'),
          facts: z.array(z.string()).optional().describe('Key facts'),
          concepts: z.array(z.string()).optional().describe('Related concepts'),
          filesRead: z.array(z.string()).optional().describe('Files read'),
          filesModified: z.array(z.string()).optional().describe('Files modified'),
        },
        execute: async (args, context) => {
          const obs = {
            type: args.type,
            title: args.title,
            subtitle: args.subtitle ?? '',
            narrative: args.narrative,
            facts: args.facts ?? [],
            concepts: args.concepts ?? [],
            filesRead: args.filesRead ?? [],
            filesModified: args.filesModified ?? [],
            sessionId: context.sessionID,
            timestamp: new Date().toISOString(),
          };
          const result = writeObservation(context.directory, obs);
          updateIndex(context.directory);
          return `Observation #${result.id} saved: ${result.filepath}`;
        },
      }),
      'mem-context': tool({
        description: 'Get memory context from past sessions for the current project',
        args: {
          maxObservations: z.number().optional().default(15).describe('Max observations to include'),
          maxSessions: z.number().optional().default(3).describe('Max sessions to include'),
        },
        execute: async (args, context) => {
          return buildContext(context.directory, {
            maxObservations: args.maxObservations ?? 15,
            sessionCount: args.maxSessions ?? 3,
          }) || 'No memory context available.';
        },
      }),
      'mem-summarize': tool({
        description: 'Generate a summary of the current session and save it to memory',
        args: {
          focus: z.string().optional().describe('What to focus the summary on'),
        },
        execute: async (args, context) => {
          const sid = context.sessionID;
          const filesRead = Array.from(sessionFilesRead[sid] || []);
          const filesEdited = Array.from(sessionFilesEdited[sid] || []);
          const userPrompt = sessionUserPrompt[sid] || '';
          const focus = args.focus ?? 'general progress';

          const summary = `## Session Summary (${focus})

**Request**: ${userPrompt || 'N/A'}

**Files Read**: ${filesRead.length}
${filesRead.slice(0, 10).map(f => `- ${f}`).join('\n')}

**Files Edited**: ${filesEdited.length}
${filesEdited.slice(0, 10).map(f => `- ${f}`).join('\n')}

See observations for detailed changes.`;

          const obs = {
            type: 'discovery',
            title: `Session Summary (${focus})`,
            subtitle: `Summary of session activity`,
            narrative: summary,
            facts: [`Files read: ${filesRead.length}`, `Files edited: ${filesEdited.length}`],
            concepts: ['session-summary'],
            filesRead,
            filesModified: filesEdited,
            sessionId: sid,
            timestamp: new Date().toISOString(),
          };

          const obsResult = writeObservation(context.directory, obs);
          updateIndex(context.directory);
          return `Session summary saved as observation #${obsResult.id}`;
        },
      }),
    },
  };
};

export default MemPlugin;
