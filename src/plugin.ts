import { writeObservation, writeSessionSummary, updateIndex, getMemDir, ensureMemDirs } from './storage/markdown.js';
import { classifyTool, isTrivial, generateObservation, extractFiles } from './utils/observer.js';
import { buildContext } from './context/inject.js';
import { searchMemories } from './search/search.js';

interface PluginContext {
  project: { name: string; path: string };
  directory: string;
  worktree: string;
  client: { app: { log: (args: { body: { service: string; level: string; message: string } }) => Promise<void> } };
  $: unknown;
}

interface HookInput {
  session?: { id: string };
  tool?: { name: string };
  input?: Record<string, unknown>;
}

interface HookOutput {
  session?: { id: string };
  result?: string;
  message?: { parts: Array<{ type: string; text?: string; assistant?: boolean }> };
  system?: string;
}

type HookFn = (input: HookInput, output: HookOutput) => Promise<void>;

interface ToolDef {
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<string>;
}

interface PluginResult {
  'session.created'?: HookFn;
  'tool.execute.after'?: HookFn;
  'message.updated'?: HookFn;
  'session.idle'?: HookFn;
  tool?: Record<string, ToolDef>;
}

type Plugin = (ctx: PluginContext) => Promise<PluginResult>;

const sessionFilesRead: Record<string, Set<string>> = {};
const sessionFilesEdited: Record<string, Set<string>> = {};
const sessionUserPrompt: Record<string, string> = {};

export const MemPlugin: Plugin = async ({ project, client, directory }: PluginContext) => {
  const memDir = getMemDir(directory);
  ensureMemDirs(directory);

  const sessionId = project?.path || directory;
  if (!sessionFilesRead[sessionId]) sessionFilesRead[sessionId] = new Set();
  if (!sessionFilesEdited[sessionId]) sessionFilesEdited[sessionId] = new Set();

  return {
    'session.created': async (_input, output) => {
      const sid = output.session?.id || sessionId;
      sessionFilesRead[sid] = new Set();
      sessionFilesEdited[sid] = new Set();

      await client.app.log({
        body: {
          service: 'opencode-mem',
          level: 'info',
          message: `Session created, loading memory context from ${memDir}`,
        },
      });

      const context = buildContext(directory, { maxObservations: 15, sessionCount: 3 });
      if (context) {
        output.system = output.system || '';
        output.system += `\n\n${context}`;
      }
    },

    'tool.execute.after': async (input, output) => {
      const sid = input.session?.id || sessionId;
      const toolName = input.tool?.name || '';
      const toolInput = input.input || {};
      const toolResult = output?.result || '';

      if (isTrivial(toolName, toolInput, toolResult)) return;

      const filesRead = extractFiles(toolName, toolInput, 'read');
      const filesModified = extractFiles(toolName, toolInput, 'modified');

      for (const f of filesRead) sessionFilesRead[sid]?.add(f);
      for (const f of filesModified) sessionFilesEdited[sid]?.add(f);

      const type = classifyTool(toolName, toolInput, toolResult);
      const obs = generateObservation(toolName, toolInput, toolResult, type, sid);

      if (obs) {
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

    'message.updated': async (input, output) => {
      const sid = input.session?.id || sessionId;
      const parts = output.message?.parts || [];

      for (const part of parts) {
        if (part.type === 'text' && !part.assistant) {
          sessionUserPrompt[sid] = part.text || '';
        }
      }
    },

    'session.idle': async (input, _output) => {
      const sid = input.session?.id || sessionId;
      const filesRead = Array.from(sessionFilesRead[sid] || []);
      const filesEdited = Array.from(sessionFilesEdited[sid] || []);
      const userPrompt = sessionUserPrompt[sid] || '';

      const summary = {
        sessionId: sid,
        project: project?.name || directory,
        request: userPrompt.substring(0, 200),
        investigated: 'See observations for details.',
        learned: '',
        completed: `${filesEdited.length} files edited: ${filesEdited.slice(0, 5).join(', ')}`,
        nextSteps: '',
        filesRead,
        filesEdited,
        timestamp: new Date().toISOString(),
      };

      writeSessionSummary(directory, summary);
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
    },
  };
};

export default MemPlugin;
