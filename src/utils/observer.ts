import type { Observation } from '../types/index.js';

export function classifyTool(tool: string, input: unknown, response: string): string {
  const lowerResponse = response.toLowerCase();
  const lowerInput = JSON.stringify(input).toLowerCase();

  if (lowerResponse.includes('error') || lowerResponse.includes('failed') || lowerResponse.includes('exception')) {
    return 'error';
  }

  if (lowerResponse.includes('fix') || lowerResponse.includes('bug') || lowerResponse.includes('issue')) {
    return 'bugfix';
  }

  if (lowerResponse.includes('decided') || lowerResponse.includes('chose') || lowerResponse.includes('approach')) {
    return 'decision';
  }

  switch (tool) {
    case 'write':
    case 'edit':
      if (lowerInput.includes('test') || lowerInput.includes('spec')) return 'feature';
      if (lowerInput.includes('refactor') || lowerInput.includes('restructure')) return 'refactor';
      return 'feature';
    case 'read':
      return 'discovery';
    case 'bash':
      if (lowerInput.includes('npm install') || lowerInput.includes('config')) return 'config';
      return 'discovery';
    default:
      return 'discovery';
  }
}

export function isTrivial(tool: string, input: unknown, response: string): boolean {
  const inputStr = JSON.stringify(input);

  if (tool === 'read' && inputStr.length < 100) return true;
  if (!response || response.trim().length < 50) return true;
  if (tool === 'bash') {
    const cmd = inputStr.toLowerCase();
    if (cmd.includes('ls') || cmd.includes('cat') || cmd.includes('echo') || cmd.includes('pwd')) return true;
  }

  return false;
}

export function generateObservation(
  tool: string,
  input: unknown,
  response: string,
  type: string,
  sessionId: string
): Omit<Observation, 'id'> | null {
  const title = generateTitle(tool, input, response);
  const subtitle = generateSubtitle(tool, input, response);
  const narrative = generateNarrative(tool, input, response);
  const facts = extractFacts(response);
  const concepts = extractConcepts(input, response);
  const filesRead = extractFiles(tool, input, 'read');
  const filesModified = extractFiles(tool, input, 'modified');

  return {
    type,
    title,
    subtitle,
    narrative,
    facts,
    concepts,
    filesRead,
    filesModified,
    sessionId,
    timestamp: new Date().toISOString(),
  };
}

function generateTitle(tool: string, input: unknown, response: string): string {
  const titleMatch = response.match(/(?:fixed|added|created|modified|removed|discovered)\s+(.+)/i);
  if (titleMatch) return titleMatch[1].substring(0, 80);

  const inputStr = JSON.stringify(input);
  const fileMatch = inputStr.match(/(?:path|file)["\s:]+([^"'\s,]+)/);
  if (fileMatch) return `${tool}: ${fileMatch[1].split('/').pop()}`;

  return `${tool} operation`;
}

function generateSubtitle(tool: string, input: unknown, response: string): string {
  const sentences = response.split(/[.!?]\s+/);
  for (const sentence of sentences) {
    if (sentence.length > 20 && sentence.length < 150) return sentence.trim();
  }
  return `${tool} completed successfully`;
}

function generateNarrative(tool: string, input: unknown, response: string): string {
  const inputStr = typeof input === 'string' ? input : JSON.stringify(input, null, 2);
  return `## Tool: ${tool}

### Input
\`\`\`
${inputStr.substring(0, 500)}${inputStr.length > 500 ? '...' : ''}
\`\`\`

### Response
\`\`\`
${response.substring(0, 1000)}${response.length > 1000 ? '...' : ''}
\`\`\`
`;
}

function extractFacts(response: string): string[] {
  const facts: string[] = [];
  const noteMatches = response.match(/(?:note|important|warning|caution)[:\s]+([^\n]+)/gi);
  if (noteMatches) {
    for (const match of noteMatches) {
      facts.push(match.replace(/^(note|important|warning|caution)[:\s]+/i, '').trim());
    }
  }
  return facts.slice(0, 5);
}

function extractConcepts(input: unknown, response: string): string[] {
  const concepts: string[] = [];
  const lowerContent = `${JSON.stringify(input)} ${response}`.toLowerCase();

  const conceptKeywords = [
    'authentication', 'authorization', 'database', 'api', 'middleware',
    'routing', 'state', 'component', 'hook', 'service', 'controller',
    'model', 'view', 'template', 'config', 'deployment', 'testing',
    'validation', 'error handling', 'logging', 'caching', 'performance',
    'security', 'types', 'interface', 'class', 'function', 'module',
  ];

  for (const keyword of conceptKeywords) {
    if (lowerContent.includes(keyword)) concepts.push(keyword);
  }

  return concepts.slice(0, 5);
}

export function extractFiles(tool: string, input: unknown, mode: 'read' | 'modified'): string[] {
  const files: string[] = [];
  const inputStr = JSON.stringify(input);

  if (tool === 'read' && mode === 'read') {
    const pathMatch = inputStr.match(/(?:path|file)["\s:]+([^"'\s,]+)/);
    if (pathMatch) files.push(pathMatch[1]);
  }

  if ((tool === 'write' || tool === 'edit') && mode === 'modified') {
    const pathMatch = inputStr.match(/(?:path|file)["\s:]+([^"'\s,]+)/);
    if (pathMatch) files.push(pathMatch[1]);
  }

  const fileMatches = inputStr.match(/[\w./-]+\.(ts|js|tsx|jsx|py|go|rs|md|json|yaml|yml)/g);
  if (fileMatches) {
    for (const f of fileMatches) {
      if (!files.includes(f)) files.push(f);
    }
  }

  return files.slice(0, 10);
}
