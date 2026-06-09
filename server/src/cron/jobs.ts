import cron from 'node-cron';
import {
  listAllUsers,
  listRawByDate,
  countRawByDate,
  upsertDailySummary,
  listRecentSummaries,
  listHard,
  upsertProfile,
  getProfileMeta,
  updateProfileMeta,
  getMaxHardId,
  countHardSince,
  pruneRawOlderThan,
} from '../db/repo.js';
import { generateDailySummary, generateProfile } from '../llm/prompts.js';
import { getConfig } from '../config/index.js';

function log(level: string, msg: string, extra?: object) {
  const ts = new Date().toISOString();
  console.log(JSON.stringify({ ts, level, scope: 'cron', msg, ...(extra || {}) }));
}

function yesterdayDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Daily job: for each user, summarize yesterday's raw conversations.
 * Idempotent — re-running same day overwrites the summary.
 */
export async function runDailySummary(): Promise<void> {
  const date = yesterdayDate();
  const users = listAllUsers();
  log('info', `daily_summary start`, { date, users: users.length });

  for (const user_id of users) {
    try {
      const count = countRawByDate(user_id, date);
      if (count === 0) {
        log('debug', `skip empty`, { user_id, date });
        continue;
      }
      const raws = listRawByDate(user_id, date);
      const result = await generateDailySummary(user_id, date, raws);
      if (!result) continue;

      upsertDailySummary({
        user_id,
        date,
        content: result.content,
        raw_count: result.raw_count,
        generated_at: new Date().toISOString(),
      });
      log('info', `summary ok`, { user_id, date, raw_count: result.raw_count });
    } catch (e) {
      log('error', `summary failed`, { user_id, date, error: String(e) });
    }
  }
}

/**
 * Weekly job: regenerate full profile from last 7 days summaries + all hard memories.
 */
export async function runWeeklyProfile(): Promise<void> {
  const users = listAllUsers();
  log('info', `weekly_profile start`, { users: users.length });

  for (const user_id of users) {
    try {
      await regenerateProfile(user_id, 'weekly');
    } catch (e) {
      log('error', `profile failed`, { user_id, error: String(e) });
    }
  }
}

/**
 * Triggered when hard memory delta crosses threshold for a user.
 * Called from API layer after hard memory insert (debounced).
 */
export async function maybeTriggerProfileRefresh(user_id: string): Promise<boolean> {
  const cfg = getConfig();
  const meta = getProfileMeta(user_id);
  const delta = countHardSince(user_id, meta.last_hard_memory_id);

  if (delta < cfg.cron.hard_memory_threshold) return false;

  log('info', `delta trigger`, { user_id, delta, threshold: cfg.cron.hard_memory_threshold });
  await regenerateProfile(user_id, 'delta');
  return true;
}

async function regenerateProfile(user_id: string, reason: string): Promise<void> {
  const summaries = listRecentSummaries(user_id, 7);
  const hards = listHard(user_id, 200);

  if (summaries.length === 0 && hards.length === 0) {
    log('debug', `profile skip empty`, { user_id });
    return;
  }

  const content = await generateProfile(user_id, summaries, hards);
  upsertProfile({
    user_id,
    content,
    version: 1, // upsert increments
    generated_at: new Date().toISOString(),
    source_raw_count: summaries.reduce((a, s) => a + s.raw_count, 0),
    source_memory_count: hards.length,
  });
  updateProfileMeta(user_id, getMaxHardId(user_id));
  log('info', `profile updated`, { user_id, reason, lines: content.split('\n').length });
}

/**
 * Optional cleanup: drop raw conversations older than 90 days
 * (summaries and hard memories are kept forever).
 */
export async function runRawPrune(): Promise<void> {
  const deleted = pruneRawOlderThan(90);
  log('info', `prune raw`, { deleted });
}

let started = false;

export function startCron(): void {
  if (started) return;
  started = true;

  const cfg = getConfig();
  log('info', `scheduling`, { daily: cfg.cron.daily_summary, weekly: cfg.cron.weekly_profile });

  cron.schedule(cfg.cron.daily_summary, () => {
    runDailySummary().catch(e => log('error', 'daily uncaught', { error: String(e) }));
  });

  cron.schedule(cfg.cron.weekly_profile, () => {
    runWeeklyProfile().catch(e => log('error', 'weekly uncaught', { error: String(e) }));
  });

  // prune monthly
  cron.schedule('0 4 1 * *', () => {
    runRawPrune().catch(e => log('error', 'prune uncaught', { error: String(e) }));
  });
}
