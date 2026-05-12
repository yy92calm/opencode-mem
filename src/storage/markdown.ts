import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'fs';
import { join, isAbsolute } from 'path';
import { homedir } from 'os';
import type { Observation, SessionSummary, MemSettings } from '../types/index.js';

const DEFAULT_SETTINGS: MemSettings = {
  memDir: join(homedir(), '.config', 'opencode', 'mem'),
  maxObservations: 20,
  maxSessions: 5,
  observationTypes: ['bugfix', 'feature', 'refactor', 'decision', 'discovery', 'config', 'error'],
  skipTools: ['ls', 'cat', 'echo', 'pwd'],
  skipPatterns: ['node_modules', '.git', 'dist', 'build'],
};

export function getMemDir(directory: string, settings?: Partial<MemSettings>): string {
  const resolved = { ...DEFAULT_SETTINGS, ...settings };
  return resolved.memDir;
}

function getMonthDir(timestamp: string, memDir: string): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return join(memDir, `${year}-${month}`);
}

export function ensureMemDirs(directory: string, settings?: Partial<MemSettings>): void {
  const memDir = getMemDir(directory, settings);
  const now = new Date().toISOString();
  const monthDir = getMonthDir(now, memDir);
  for (const sub of ['observations', 'sessions']) {
    const dir = join(monthDir, sub);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}

export function yamlFrontmatter(data: Record<string, unknown>): string {
  let out = '---\n';
  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      out += `${key}:\n`;
      for (const item of value) {
        out += `  - "${String(item).replace(/"/g, '\\"')}"\n`;
      }
    } else if (value !== undefined && value !== null) {
      out += `${key}: "${String(value).replace(/"/g, '\\"')}"\n`;
    }
  }
  out += '---\n';
  return out;
}

export function parseFrontmatter(content: string): Record<string, unknown> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};

  const data: Record<string, unknown> = {};
  const lines = match[1].split('\n');
  let currentKey: string | null = null;

  for (const line of lines) {
    const arrayMatch = line.match(/^(\w+):\s*$/);
    const kvMatch = line.match(/^(\w+):\s*"?(.*?)"?\s*$/);

    if (arrayMatch) {
      currentKey = arrayMatch[1];
      data[currentKey] = [];
    } else if (kvMatch) {
      currentKey = kvMatch[1];
      let value: unknown = kvMatch[2];
      if (value === 'true') value = true;
      else if (value === 'false') value = false;
      else if (!isNaN(Number(value)) && value !== '') value = Number(value);
      data[currentKey] = value;
      currentKey = null;
    } else if (currentKey && line.trim().startsWith('- ')) {
      if (Array.isArray(data[currentKey])) {
        (data[currentKey] as string[]).push(line.trim().substring(2).replace(/^"|"$/g, ''));
      }
    }
  }

  return data;
}

export function getNextId(dir: string): number {
  if (!existsSync(dir)) return 1;
  const files = readdirSync(dir).filter((f: string) => f.endsWith('.md'));
  const ids = files.map((f: string) => {
    const match = f.match(/^(\d+)-/);
    return match ? parseInt(match[1], 10) : 0;
  });
  return ids.length > 0 ? Math.max(...ids) + 1 : 1;
}

export function padId(id: number): string {
  return String(id).padStart(4, '0');
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .substring(0, 50) || 'untitled';
}

export function writeObservation(
  directory: string,
  obs: Omit<Observation, 'id'>,
  settings?: Partial<MemSettings>
): { id: number; filepath: string } {
  const memDir = getMemDir(directory, settings);
  const monthDir = getMonthDir(obs.timestamp, memDir);
  const obsDir = join(monthDir, 'observations');
  
  if (!existsSync(obsDir)) mkdirSync(obsDir, { recursive: true });

  const id = getNextId(obsDir);
  const paddedId = padId(id);
  const slug = slugify(obs.title);
  const filename = `${paddedId}-${slug}.md`;
  const filepath = join(obsDir, filename);

  const frontmatter = yamlFrontmatter({
    id,
    type: obs.type,
    title: obs.title,
    subtitle: obs.subtitle,
    session: obs.sessionId,
    timestamp: obs.timestamp,
    facts: obs.facts,
    concepts: obs.concepts,
    files_read: obs.filesRead,
    files_modified: obs.filesModified,
  });

  const content = `${frontmatter}
# ${obs.title}

> ${obs.subtitle}

## Narrative

${obs.narrative}

## Files

${obs.filesRead.length > 0 ? `### Read\n${obs.filesRead.map(f => `- \`${f}\``).join('\n')}\n` : ''}
${obs.filesModified.length > 0 ? `### Modified\n${obs.filesModified.map(f => `- \`${f}\``).join('\n')}\n` : ''}
`;

  writeFileSync(filepath, content, 'utf-8');
  return { id, filepath };
}

export function writeSessionSummary(
  directory: string,
  summary: SessionSummary,
  settings?: Partial<MemSettings>
): { filepath: string } {
  const memDir = getMemDir(directory, settings);
  const monthDir = getMonthDir(summary.timestamp, memDir);
  const sesDir = join(monthDir, 'sessions');
  
  if (!existsSync(sesDir)) mkdirSync(sesDir, { recursive: true });

  const dateStr = summary.timestamp.split('T')[0];
  const slug = slugify(summary.request || 'session');
  const filename = `${dateStr}-${slug}.md`;
  const filepath = join(sesDir, filename);

  const frontmatter = yamlFrontmatter({
    session_id: summary.sessionId,
    project: summary.project,
    timestamp: summary.timestamp,
    files_read: summary.filesRead,
    files_edited: summary.filesEdited,
  });

  const content = `${frontmatter}
# Session: ${summary.request || 'Untitled'}

## Investigated

${summary.investigated || 'N/A'}

## Learned

${summary.learned || 'N/A'}

## Completed

${summary.completed || 'N/A'}

## Next Steps

${summary.nextSteps || 'N/A'}

## Files

${summary.filesRead.length > 0 ? `### Read\n${summary.filesRead.map(f => `- \`${f}\``).join('\n')}\n` : ''}
${summary.filesEdited.length > 0 ? `### Edited\n${summary.filesEdited.map(f => `- \`${f}\``).join('\n')}\n` : ''}
`;

  writeFileSync(filepath, content, 'utf-8');
  return { filepath };
}

export function readObservation(filepath: string): Observation | null {
  if (!existsSync(filepath)) return null;
  const content = readFileSync(filepath, 'utf-8');
  const fm = parseFrontmatter(content);

  return {
    id: Number(fm.id) || 0,
    type: String(fm.type || 'unknown'),
    title: String(fm.title || ''),
    subtitle: String(fm.subtitle || ''),
    narrative: content.replace(/^---\n[\s\S]*?\n---\n/, '').trim(),
    facts: Array.isArray(fm.facts) ? fm.facts as string[] : [],
    concepts: Array.isArray(fm.concepts) ? fm.concepts as string[] : [],
    filesRead: Array.isArray(fm.files_read) ? fm.files_read as string[] : [],
    filesModified: Array.isArray(fm.files_modified) ? fm.files_modified as string[] : [],
    sessionId: String(fm.session || ''),
    timestamp: String(fm.timestamp || ''),
  };
}

function getAllMonthDirs(memDir: string): string[] {
  if (!existsSync(memDir)) return [];
  const entries = readdirSync(memDir).filter((entry: string) => {
    const fullPath = join(memDir, entry);
    return statSync(fullPath).isDirectory() && /^\d{4}-\d{2}$/.test(entry);
  }).sort();
  return entries.map(entry => join(memDir, entry));
}

function walkFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const files: string[] = [];
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      files.push(...walkFiles(fullPath));
    } else if (entry.endsWith('.md')) {
      files.push(fullPath);
    }
  }
  return files;
}

export function listObservations(directory: string, settings?: Partial<MemSettings>): Observation[] {
  const memDir = getMemDir(directory, settings);
  const allFiles: string[] = [];
  
  const monthDirs = getAllMonthDirs(memDir);
  for (const monthDir of monthDirs) {
    const obsDir = join(monthDir, 'observations');
    allFiles.push(...walkFiles(obsDir));
  }

  return allFiles
    .map(f => readObservation(f))
    .filter((obs): obs is Observation => obs !== null);
}

export function listSessions(directory: string, settings?: Partial<MemSettings>): SessionSummary[] {
  const memDir = getMemDir(directory, settings);
  const allFiles: string[] = [];
  
  const monthDirs = getAllMonthDirs(memDir);
  for (const monthDir of monthDirs) {
    const sesDir = join(monthDir, 'sessions');
    allFiles.push(...walkFiles(sesDir));
  }

  return allFiles.map(f => {
    const content = readFileSync(f, 'utf-8');
    const fm = parseFrontmatter(content);
    return {
      sessionId: String(fm.session_id || ''),
      project: String(fm.project || ''),
      timestamp: String(fm.timestamp || ''),
      filesRead: Array.isArray(fm.files_read) ? fm.files_read as string[] : [],
      filesEdited: Array.isArray(fm.files_edited) ? fm.files_edited as string[] : [],
      request: extractTitle(content),
      investigated: extractSection(content, 'Investigated'),
      learned: extractSection(content, 'Learned'),
      completed: extractSection(content, 'Completed'),
      nextSteps: extractSection(content, 'Next Steps'),
    };
  });
}

export function updateIndex(directory: string, settings?: Partial<MemSettings>): void {
  const memDir = getMemDir(directory, settings);
  const observations = listObservations(directory, settings);
  const sessions = listSessions(directory, settings);

  const byType: Record<string, typeof observations> = {};
  for (const obs of observations) {
    const type = obs.type || 'uncategorized';
    if (!byType[type]) byType[type] = [];
    byType[type].push(obs);
  }

  let index = `# OpenCode Memory Index

> Auto-generated index. Do not edit manually.

## Stats

- **Total Observations**: ${observations.length}
- **Total Sessions**: ${sessions.length}
- **Last Updated**: ${new Date().toISOString()}

## Observations by Type

`;

  for (const [type, items] of Object.entries(byType).sort()) {
    index += `### ${type}\n\n`;
    for (const obs of items) {
      const monthDir = getMonthDir(obs.timestamp, memDir);
      const relativePath = monthDir.replace(memDir + '/', '');
      const file = `${padId(obs.id)}-${slugify(obs.title)}.md`;
      index += `- [${obs.title}](${relativePath}/observations/${file}) — ${obs.subtitle}\n`;
    }
    index += '\n';
  }

  index += '## Sessions\n\n';
  for (const ses of sessions) {
    index += `- \`${ses.timestamp.split('T')[0]}\` — ${ses.project}: ${ses.request}\n`;
  }

  writeFileSync(join(memDir, 'INDEX.md'), index, 'utf-8');
}

function extractTitle(content: string): string {
  const match = content.match(/^# (.+)$/m);
  return match ? match[1] : 'Untitled';
}

function extractSection(content: string, heading: string): string {
  const regex = new RegExp(`## ${heading}\\n([\\s\\S]*?)(?=## |$)`);
  const match = content.match(regex);
  return match ? match[1].trim() : '';
}
