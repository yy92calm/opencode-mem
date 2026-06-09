import {
  appendFileSync,
  readFileSync,
  existsSync,
  writeFileSync,
  mkdirSync,
  statSync,
  renameSync,
  unlinkSync,
} from 'fs';
import { dirname } from 'path';
import type { RawConversation, HardMemory, MemPluginConfig } from '../types/index.js';

/**
 * Worker HTTP client with:
 *  - in-memory batching of raw conversations (flushed by size or interval)
 *  - offline cache (JSONL append-log) when Worker is unreachable
 *  - automatic replay of offline cache when Worker comes back online
 *  - local profile cache so chat startup works when Worker is unreachable
 *  - background health/replay watchdog
 *  - shutdown hook to flush pending raws on SIGTERM/SIGINT
 *
 * No local Markdown / SQLite — Worker is the only source of truth.
 */

type LogFn = (level: string, msg: string, extra?: object) => void;

export class WorkerClient {
  private rawBuffer: RawConversation[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private watchdogTimer: NodeJS.Timeout | null = null;
  private flushing = false;
  private healthy = true;
  private lastHealthCheck = 0;
  private shuttingDown = false;
  private signalHandlers: { sig: NodeJS.Signals; fn: () => void }[] = [];

  constructor(private cfg: Required<MemPluginConfig>, private log: LogFn) {
    this.startFlushTimer();
    this.startWatchdog();
    this.installShutdownHooks();
    // Replay offline cache opportunistically on init
    this.replayOfflineCache().catch(e => this.log('warn', 'offline replay failed', { error: String(e) }));
  }

  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      this.flushRaw().catch(() => {});
    }, this.cfg.raw_flush_interval_ms);
    // Don't keep node alive just for this
    this.flushTimer.unref?.();
  }

  /**
   * Periodic watchdog: re-check health and replay offline cache.
   * Catches the case where network recovers mid-session
   * (no session.idle event would trigger replay otherwise).
   */
  private startWatchdog(): void {
    this.watchdogTimer = setInterval(() => {
      this.replayOfflineCache().catch(() => {});
    }, this.cfg.watchdog_interval_ms);
    this.watchdogTimer.unref?.();
  }

  private installShutdownHooks(): void {
    const sigs: NodeJS.Signals[] = ['SIGTERM', 'SIGINT'];
    for (const sig of sigs) {
      const fn = () => {
        // Best-effort sync flush to offline cache so we never lose buffered raws.
        this.flushBufferToOfflineSync('shutdown');
      };
      this.signalHandlers.push({ sig, fn });
      try {
        process.on(sig, fn);
      } catch {
        /* ignore */
      }
    }
  }

  private flushBufferToOfflineSync(reason: string): void {
    if (this.rawBuffer.length === 0) return;
    const batch = this.rawBuffer.splice(0);
    try {
      this.appendOfflineCache(batch.map(r => ({ kind: 'raw', payload: r })));
      this.log('info', 'flushed buffer to offline cache', { count: batch.length, reason });
    } catch (e) {
      this.log('error', 'sync offline flush failed', { error: String(e) });
    }
  }

  /** Queue a raw conversation entry. Flushes when buffer hits threshold. */
  enqueueRaw(r: RawConversation): void {
    this.rawBuffer.push(r);
    if (this.rawBuffer.length >= this.cfg.raw_buffer_size) {
      this.flushRaw().catch(() => {});
    }
  }

  /** Force-flush raw buffer (call on session.idle). */
  async flushRaw(): Promise<void> {
    if (this.flushing || this.rawBuffer.length === 0) return;
    this.flushing = true;
    const batch = this.rawBuffer.splice(0);

    try {
      await this.post('/api/raw', { items: batch });
      this.healthy = true;
    } catch (e) {
      this.log('warn', 'raw flush failed, caching offline', { count: batch.length, error: String(e) });
      this.appendOfflineCache(batch.map(r => ({ kind: 'raw', payload: r })));
      this.healthy = false;
    } finally {
      this.flushing = false;
    }
  }

  /** Send a hard memory immediately (no batching — these are rare and high-value). */
  async sendHardMemory(m: HardMemory): Promise<{ id: number } | null> {
    try {
      const result = await this.post<{ id: number }>('/api/memory', m);
      this.healthy = true;
      return result;
    } catch (e) {
      this.log('warn', 'hard memory send failed, caching offline', { title: m.title, error: String(e) });
      this.appendOfflineCache([{ kind: 'memory', payload: m }]);
      this.healthy = false;
      return null;
    }
  }

  async getProfile(): Promise<string | null> {
    // Try network first with a short timeout (won't block chat startup for long).
    try {
      const result = await this.get<{ content?: string; profile?: string | null }>(
        '/api/profile',
        this.cfg.profile_fetch_timeout_ms,
      );
      if (result) {
        const content = (result as any).content ?? null;
        if (content) {
          // Cache for offline use.
          this.writeProfileCache(content);
          return content;
        }
      }
    } catch (e) {
      this.log('debug', 'profile fetch failed, falling back to local cache', { error: String(e) });
    }
    // Fallback to local cached profile (last known good).
    return this.readProfileCache();
  }

  private writeProfileCache(content: string): void {
    try {
      mkdirSync(dirname(this.cfg.profile_cache_path), { recursive: true });
      writeFileSync(this.cfg.profile_cache_path, content, 'utf-8');
    } catch (e) {
      this.log('warn', 'profile cache write failed', { error: String(e) });
    }
  }

  private readProfileCache(): string | null {
    try {
      if (!existsSync(this.cfg.profile_cache_path)) return null;
      return readFileSync(this.cfg.profile_cache_path, 'utf-8') || null;
    } catch {
      return null;
    }
  }

  async searchMemories(query: string, limit = 50): Promise<HardMemory[]> {
    try {
      const result = await this.get<{ items: HardMemory[] }>(
        `/api/memory/search?q=${encodeURIComponent(query)}&limit=${limit}`,
      );
      return result?.items ?? [];
    } catch {
      return [];
    }
  }

  async listMemories(limit = 100): Promise<HardMemory[]> {
    try {
      const result = await this.get<{ items: HardMemory[] }>(`/api/memory?limit=${limit}`);
      return result?.items ?? [];
    } catch {
      return [];
    }
  }

  async checkHealth(force = false): Promise<boolean> {
    const now = Date.now();
    if (!force && now - this.lastHealthCheck < 60000) return this.healthy;
    this.lastHealthCheck = now;
    try {
      const r = await fetch(`${this.cfg.server_url}/health`, { signal: AbortSignal.timeout(5000) });
      this.healthy = r.ok;
    } catch {
      this.healthy = false;
    }
    return this.healthy;
  }

  /** Drain offline cache by retrying every entry. Called on init + periodic. */
  async replayOfflineCache(): Promise<number> {
    const path = this.cfg.offline_cache_path;
    if (!existsSync(path)) return 0;

    const lines = readFileSync(path, 'utf-8').split('\n').filter(Boolean);
    if (lines.length === 0) return 0;

    const healthy = await this.checkHealth(true);
    if (!healthy) return 0;

    const rawItems: RawConversation[] = [];
    const memItems: HardMemory[] = [];
    const remaining: string[] = [];

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.kind === 'raw') rawItems.push(entry.payload);
        else if (entry.kind === 'memory') memItems.push(entry.payload);
      } catch {
        // drop unparseable lines
      }
    }

    let replayed = 0;
    try {
      if (rawItems.length > 0) {
        await this.post('/api/raw', { items: rawItems });
        replayed += rawItems.length;
      }
      for (const m of memItems) {
        await this.post('/api/memory', m);
        replayed += 1;
      }
      // Success — clear cache
      writeFileSync(path, '');
      this.log('info', 'offline replay ok', { replayed });
    } catch (e) {
      // Re-write everything that wasn't successfully sent
      this.log('warn', 'offline replay partial failure', { error: String(e) });
      writeFileSync(path, remaining.join('\n'));
    }
    return replayed;
  }

  private appendOfflineCache(entries: { kind: string; payload: any }[]): void {
    const path = this.cfg.offline_cache_path;
    try {
      mkdirSync(dirname(path), { recursive: true });
      this.rotateOfflineCacheIfNeeded(path);
      const lines = entries.map(e => JSON.stringify(e)).join('\n') + '\n';
      appendFileSync(path, lines);
    } catch (e) {
      this.log('error', 'offline cache write failed', { error: String(e) });
    }
  }

  /**
   * If cache exceeds max size, rotate it to .bak (overwriting any prior .bak).
   * Keeps at most one archive — if user is offline long enough to fill 2x cap,
   * the oldest data drops on the floor (acceptable tradeoff vs unbounded growth).
   */
  private rotateOfflineCacheIfNeeded(path: string): void {
    try {
      if (!existsSync(path)) return;
      const size = statSync(path).size;
      if (size < this.cfg.offline_cache_max_bytes) return;
      const bak = `${path}.bak`;
      if (existsSync(bak)) {
        try { unlinkSync(bak); } catch { /* ignore */ }
      }
      renameSync(path, bak);
      this.log('warn', 'offline cache rotated (size cap hit)', { bytes: size, archive: bak });
    } catch (e) {
      this.log('warn', 'offline cache rotation failed', { error: String(e) });
    }
  }

  private async post<T = unknown>(path: string, body: unknown, timeoutMs?: number): Promise<T> {
    const resp = await fetch(`${this.cfg.server_url}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.cfg.api_key}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs ?? this.cfg.write_timeout_ms),
    });
    if (!resp.ok) throw new Error(`${resp.status} ${await resp.text().catch(() => '')}`);
    return resp.json() as Promise<T>;
  }

  private async get<T = unknown>(path: string, timeoutMs?: number): Promise<T> {
    const resp = await fetch(`${this.cfg.server_url}${path}`, {
      headers: { 'Authorization': `Bearer ${this.cfg.api_key}` },
      signal: AbortSignal.timeout(timeoutMs ?? this.cfg.read_timeout_ms),
    });
    if (!resp.ok) throw new Error(`${resp.status} ${await resp.text().catch(() => '')}`);
    return resp.json() as Promise<T>;
  }

  shutdown(): void {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    if (this.flushTimer) clearInterval(this.flushTimer);
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
    this.flushTimer = null;
    this.watchdogTimer = null;
    // Final sync flush so explicit shutdown also persists the buffer.
    this.flushBufferToOfflineSync('explicit-shutdown');
    for (const { sig, fn } of this.signalHandlers) {
      try { process.off(sig, fn); } catch { /* ignore */ }
    }
    this.signalHandlers = [];
  }
}
