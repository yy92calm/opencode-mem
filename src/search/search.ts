import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { parseFrontmatter, getMemDir } from '../storage/markdown.js';
import type { SearchResult, MemSettings } from '../types/index.js';

export function searchMemories(
  directory: string,
  query: string,
  options: { type?: string; limit?: number; memDir?: string; daysBack?: number } = {}
): SearchResult[] {
  const { type, limit = 20, memDir: customMemDir, daysBack = 30 } = options;
  const memDir = customMemDir || getMemDir(directory);
  const results: SearchResult[] = [];

  const cutoffDate = daysBack > 0 ? new Date() : null;
  if (cutoffDate) {
    cutoffDate.setDate(cutoffDate.getDate() - daysBack);
  }

  const searchDirs: { dir: string; resultType: string }[] = [];
  if (!type || type === 'observation' || type === 'bugfix' || type === 'feature' || type === 'refactor' || type === 'decision' || type === 'discovery' || type === 'config' || type === 'error') {
    searchDirs.push({ dir: 'observations', resultType: 'observation' });
  }
  if (!type || type === 'summary') {
    searchDirs.push({ dir: 'sessions', resultType: 'summary' });
  }

  for (const { dir, resultType } of searchDirs) {
    const fullPath = join(memDir, dir);
    if (!existsSync(fullPath)) continue;

    const files = walkMdFiles(fullPath);
    for (const filepath of files) {
      const content = readFileSync(filepath, 'utf-8');

      if (matchesQuery(content, query)) {
        const fm = parseFrontmatter(content);
        const obsType = String(fm.type || '');
        const timestamp = String(fm.timestamp || '');

        // Filter by type
        if (type && resultType === 'observation' && type !== 'observation' && obsType !== type) {
          continue;
        }

        // Filter by date
        if (cutoffDate && timestamp) {
          const fileDate = new Date(timestamp);
          if (fileDate < cutoffDate) {
            continue;
          }
        }

        results.push({
          id: Number(fm.id) || 0,
          type: resultType,
          title: String(fm.title || fm.request || filepath.split('/').pop()?.replace('.md', '') || ''),
          subtitle: String(fm.subtitle || fm.learned || ''),
          file: filepath,
          snippet: extractSnippet(content, query),
          timestamp: timestamp,
          concepts: Array.isArray(fm.concepts) ? fm.concepts as string[] : [],
          facts: Array.isArray(fm.facts) ? fm.facts as string[] : [],
        });
      }
    }
  }

  return results.slice(0, limit);
}

function walkMdFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const files: string[] = [];
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      try {
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          files.push(...walkMdFiles(fullPath));
        } else if (entry.endsWith('.md')) {
          files.push(fullPath);
        }
      } catch {
        // Skip inaccessible files
      }
    }
  } catch {
    // Skip inaccessible directories
  }
  return files;
}

function matchesQuery(content: string, query: string): boolean {
  if (!query) return true;
  const lowerContent = content.toLowerCase();
  const terms = query.toLowerCase().split(/\s+/);

  for (const term of terms) {
    if (term.length < 2) continue;
    if (!lowerContent.includes(term)) return false;
  }
  return true;
}

function extractSnippet(content: string, query: string): string {
  const terms = query.toLowerCase().split(/\s+/).filter(t => t.length >= 3);
  const lowerContent = content.toLowerCase();

  for (const term of terms) {
    const idx = lowerContent.indexOf(term);
    if (idx !== -1) {
      const start = Math.max(0, idx - 60);
      const end = Math.min(content.length, idx + term.length + 100);
      let snippet = content.substring(start, end);
      if (start > 0) snippet = '...' + snippet;
      if (end < content.length) snippet = snippet + '...';
      return snippet;
    }
  }

  return content.substring(0, 200);
}
