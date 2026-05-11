import type { Observation } from '../types/index.js';

export function classifyTool(tool: string, input: unknown, response: string): string {
  const lowerResponse = response.toLowerCase();

  // Only check for errors if the response actually contains error indicators
  if (lowerResponse.includes('error') || lowerResponse.includes('failed') || lowerResponse.includes('exception')) {
    // Make sure it's actually an error, not just mentioning the word
    if (lowerResponse.includes('error:') || lowerResponse.includes('failed:') || lowerResponse.includes('exception:')) {
      return 'error';
    }
  }

  // Read operations are always discovery
  if (tool === 'read') return 'discovery';

  return 'discovery';
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
  const inputObj = input as Record<string, unknown>;
  const filePath = inputObj?.filePath as string || inputObj?.path as string || '';
  const fileName = filePath ? filePath.split('/').pop() || filePath : '';

  // Generate title based on tool type and context
  const title = generateTitle(tool, fileName, response, type);
  
  // Generate subtitle (one sentence summary)
  const subtitle = generateSubtitle(tool, fileName, response, type);
  
  // Generate narrative with full context
  const narrative = generateNarrative(tool, input, response);
  
  // Extract facts and concepts
  const facts = extractFacts(response);
  const concepts = extractConcepts(input, response);
  
  // Track files
  const filesRead = tool === 'read' && filePath ? [filePath] : [];
  const filesModified = (tool === 'write' || tool === 'edit') && filePath ? [filePath] : [];

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

function generateTitle(tool: string, fileName: string, response: string, type: string): string {
  // Focus on WHAT was learned/built, not WHAT was done
  switch (tool) {
    case 'read':
      if (fileName) {
        return `Explored: ${fileName}`;
      }
      return 'Codebase exploration';
    case 'write':
      if (fileName) {
        return `Created: ${fileName}`;
      }
      return 'File created';
    case 'edit':
      if (fileName) {
        return `Modified: ${fileName}`;
      }
      return 'File modified';
    case 'bash':
      // For bash, check response for common commands
      if (response.toLowerCase().includes('node_modules') || response.includes('added') || response.includes('up to date')) {
        return 'Dependencies installed';
      }
      if (response.includes('commit') || response.includes('branch') || response.includes('On branch')) {
        return 'Git operation executed';
      }
      return `Command executed`;
    case 'glob':
      return 'Files discovered';
    case 'grep':
      return 'Code search completed';
    case 'webfetch':
      return 'Web content fetched';
    default:
      return `${tool} operation`;
  }
}

function generateSubtitle(tool: string, fileName: string, response: string, type: string): string {
  // One sentence summary of what happened
  switch (tool) {
    case 'read':
      return fileName ? `Read ${fileName} to understand implementation` : 'Explored codebase structure';
    case 'write':
      return fileName ? `Created new file ${fileName}` : 'File created';
    case 'edit':
      return fileName ? `Modified ${fileName}` : 'File modified';
    case 'bash':
      if (response.toLowerCase().includes('npm')) return 'Installed project dependencies';
      if (response.includes('commit') || response.includes('branch')) return 'Executed git command';
      return `Command executed successfully`;
    case 'glob':
      const fileCount = response.split('\n').filter(line => line.trim()).length;
      return `Found ${fileCount} matching files`;
    case 'grep':
      const matchCount = response.split('\n').filter(line => line.trim()).length;
      return `Found ${matchCount} matches in search`;
    case 'webfetch':
      return 'Retrieved web content successfully';
    default:
      return `${tool} completed`;
  }
}

function generateNarrative(tool: string, input: unknown, response: string): string {
  const inputObj = input as Record<string, unknown>;
  const filePath = inputObj?.filePath as string || inputObj?.path as string || '';
  const command = inputObj?.command as string || '';

  let narrative = '';

  if (tool === 'read' && filePath) {
    narrative = `## File Exploration\n\n**File**: \`${filePath}\`\n\n`;
    // Extract key content from response (first 500 chars)
    const content = response.replace(/<[^>]+>/g, '').trim();
    if (content.length > 100) {
      narrative += `**Content Summary**:\n\`\`\`\n${content.substring(0, 500)}${content.length > 500 ? '...' : ''}\n\`\`\`\n`;
    }
  } else if ((tool === 'write' || tool === 'edit') && filePath) {
    narrative = `## File Modification\n\n**File**: \`${filePath}\`\n\n`;
    const content = response.replace(/<[^>]+>/g, '').trim();
    if (content.length > 100) {
      narrative += `**Changes**:\n\`\`\`\n${content.substring(0, 500)}${content.length > 500 ? '...' : ''}\n\`\`\`\n`;
    }
  } else if (tool === 'bash' && command) {
    narrative = `## Command Execution\n\n**Command**: \`${command}\`\n\n`;
    const output = response.replace(/<[^>]+>/g, '').trim();
    if (output.length > 50) {
      narrative += `**Output**:\n\`\`\`\n${output.substring(0, 500)}${output.length > 500 ? '...' : ''}\n\`\`\`\n`;
    }
  } else {
    narrative = `## Tool Execution\n\n**Tool**: ${tool}\n\n`;
    const output = response.replace(/<[^>]+>/g, '').trim();
    if (output.length > 50) {
      narrative += `\`\`\`\n${output.substring(0, 500)}${output.length > 500 ? '...' : ''}\n\`\`\`\n`;
    }
  }

  return narrative;
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
  const inputObj = input as Record<string, unknown>;
  const filePath = inputObj?.filePath as string || inputObj?.path as string || '';

  if (tool === 'read' && mode === 'read' && filePath) {
    files.push(filePath);
  }

  if ((tool === 'write' || tool === 'edit') && mode === 'modified' && filePath) {
    files.push(filePath);
  }

  return files.slice(0, 10);
}
