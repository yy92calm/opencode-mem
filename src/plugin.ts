import { writeObservation, writeSessionSummary, updateIndex, getMemDir, ensureMemDirs } from './storage/markdown.js';
import { classifyTool, isTrivial, generateObservation, extractFiles } from './utils/observer.js';
import { buildContext } from './context/inject.js';
import { searchMemories } from './search/search.js';
import { setOpencodeClient, isSDKAvailable, generateObservationViaSDK, generateSessionSummaryViaSDK } from './sdk/client.js';
import type { ObservationSchema, SessionSummarySchema } from './sdk/observer.js';

interface PluginContext {
  project: { name: string; path: string };
  directory: string;
  worktree: string;
  client: { app: { log: (args: { body: { service: string; level: string; message: string } }) => Promise<void> } };
  $: unknown;
}

interface ToolInput {
  tool?: string;
  name?: string;
  input?: Record<string, unknown>;
  args?: Record<string, unknown>;
  session?: { id: string };
}

interface ToolOutput {
  result?: string;
  output?: string;
  args?: Record<string, unknown>;
}

type ToolHookFn = (input: ToolInput, output: ToolOutput) => Promise<void>;

interface EventData {
  type: string;
  data?: unknown;
}

type EventHookFn = (ctx: { event: EventData }) => Promise<void>;

interface ToolDef {
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<string>;
}

interface PluginResult {
  'tool.execute.before'?: ToolHookFn;
  'tool.execute.after'?: ToolHookFn;
  event?: EventHookFn;
  tool?: Record<string, ToolDef>;
}

type Plugin = (ctx: PluginContext) => Promise<PluginResult>;

const sessionFilesRead: Record<string, Set<string>> = {};
const sessionFilesEdited: Record<string, Set<string>> = {};
const sessionUserPrompt: Record<string, string> = {};

export const MemPlugin: Plugin = async ({ project, client, directory }: PluginContext) => {
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

  const sessionId = project?.path || directory;
  if (!sessionFilesRead[sessionId]) sessionFilesRead[sessionId] = new Set();
  if (!sessionFilesEdited[sessionId]) sessionFilesEdited[sessionId] = new Set();

  return {
    'tool.execute.after': async (input, output) => {
      const toolName = input?.tool || input?.name || '';
      const toolInput = input?.input || input?.args || {};
      const toolResult = output?.result || output?.output || '';
      const sid = input?.session?.id || sessionId;

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
          project: project?.name || directory,
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
              project: project?.name || directory,
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
      'mem-search': {
        description: 'Search persistent memory observations from past sessions',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' },
            type: { type: 'string', description: 'Filter by observation type' },
            limit: { type: 'number', description: 'Max results', default: 10 },
          },
          required: ['query'],
        },
        execute: async (args: Record<string, unknown>) => {
          const results = searchMemories(directory, String(args.query || ''), {
            type: args.type ? String(args.type) : undefined,
            limit: typeof args.limit === 'number' ? args.limit : 10,
          });
          return JSON.stringify(results, null, 2);
        },
      },
      'mem-capture': {
        description: 'Capture an observation to persistent memory',
        parameters: {
          type: 'object',
          properties: {
            type: { type: 'string', description: 'Observation type: bugfix|feature|refactor|decision|discovery|config|error' },
            title: { type: 'string', description: 'Short title' },
            subtitle: { type: 'string', description: 'One-line summary' },
            narrative: { type: 'string', description: 'Detailed description' },
            facts: { type: 'array', items: { type: 'string' }, description: 'Key facts' },
            concepts: { type: 'array', items: { type: 'string' }, description: 'Related concepts' },
            filesRead: { type: 'array', items: { type: 'string' }, description: 'Files read' },
            filesModified: { type: 'array', items: { type: 'string' }, description: 'Files modified' },
          },
          required: ['type', 'title', 'narrative'],
        },
        execute: async (args: Record<string, unknown>) => {
          const obs = {
            type: String(args.type || 'discovery'),
            title: String(args.title || ''),
            subtitle: String(args.subtitle || ''),
            narrative: String(args.narrative || ''),
            facts: Array.isArray(args.facts) ? args.facts as string[] : [],
            concepts: Array.isArray(args.concepts) ? args.concepts as string[] : [],
            filesRead: Array.isArray(args.filesRead) ? args.filesRead as string[] : [],
            filesModified: Array.isArray(args.filesModified) ? args.filesModified as string[] : [],
            sessionId,
            timestamp: new Date().toISOString(),
          };
          const result = writeObservation(directory, obs);
          updateIndex(directory);
          return `Observation #${result.id} saved: ${result.filepath}`;
        },
      },
      'mem-context': {
        description: 'Get memory context from past sessions for the current project',
        parameters: {
          type: 'object',
          properties: {
            maxObservations: { type: 'number', description: 'Max observations to include', default: 15 },
            maxSessions: { type: 'number', description: 'Max sessions to include', default: 3 },
          },
        },
        execute: async (args: Record<string, unknown>) => {
          return buildContext(directory, {
            maxObservations: typeof args.maxObservations === 'number' ? args.maxObservations : 15,
            sessionCount: typeof args.maxSessions === 'number' ? args.maxSessions : 3,
          }) || 'No memory context available.';
        },
      },
      'mem-summarize': {
        description: 'Generate a summary of the current session and save it to memory',
        parameters: {
          type: 'object',
          properties: {
            focus: { type: 'string', description: 'What to focus the summary on (e.g., "bugs fixed", "decisions made")' },
          },
        },
        execute: async (args: Record<string, unknown>) => {
          const sid = sessionId;
          const filesRead = Array.from(sessionFilesRead[sid] || []);
          const filesEdited = Array.from(sessionFilesEdited[sid] || []);
          const userPrompt = sessionUserPrompt[sid] || '';
          const focus = args.focus ? String(args.focus) : 'general progress';

          // Simple summary (AI summarization deferred for now)
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

          try {
            const obsResult = writeObservation(directory, obs);
            updateIndex(directory);
            return `Session summary saved as observation #${obsResult.id}`;
          } catch (error) {
            return `Failed to save summary: ${error}`;
          }
        },
      },
    },
  };
};

export default MemPlugin;
