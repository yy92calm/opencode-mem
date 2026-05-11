export interface Observation {
  id: number;
  type: string;
  title: string;
  subtitle: string;
  narrative: string;
  facts: string[];
  concepts: string[];
  filesRead: string[];
  filesModified: string[];
  sessionId: string;
  timestamp: string;
}

export interface SessionSummary {
  sessionId: string;
  project: string;
  request: string;
  investigated: string;
  learned: string;
  completed: string;
  nextSteps: string;
  filesRead: string[];
  filesEdited: string[];
  timestamp: string;
}

export interface MemSettings {
  memDir: string;
  maxObservations: number;
  maxSessions: number;
  observationTypes: string[];
  skipTools: string[];
  skipPatterns: string[];
}

export interface SearchResult {
  id: number;
  type: string;
  title: string;
  subtitle: string;
  file: string;
  snippet: string;
  timestamp: string;
  concepts: string[];
  facts: string[];
}

export interface PluginContext {
  project: {
    name: string;
    path: string;
  };
  directory: string;
  worktree: string;
  client: unknown;
  $: unknown;
}
