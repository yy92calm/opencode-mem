import cron from 'node-cron';
import {
  listAllUsers,
  listRawByDate,
  countRawByDate,
  upsertDailySummary,
  listRecentSummaries,
  upsertProfile,
  getProfileMeta,
  updateProfileMeta,
  getMaxHardId,
  countHardSince,
  countHard,
  pruneRawOlderThan,
} from '../db/repo.js';
import { generateDailySummary, generateProfile } from '../llm/prompts.js';
import { getConfig } from '../config/index.js';

function log(level: string, msg: string, extra?: object) {
  const ts = new Date().toISOString();
  console.log(JSON.stringify({ ts, level, scope: 'cron', msg, ...(extra || {}) }));
}

// Per-user in-flight guards: prevent concurrent regenerations of the same kind.
// profileInFlight coalesces profile refreshes (weekly + delta).
// dailyInFlight coalesces same-day daily summaries (cron + manual trigger).
const profileInFlight = new Set<string>();
const dailyInFlight = new Set<string>();

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Validate and normalize a YYYY-MM-DD date string. Throws on malformed input
 * so callers (route handlers) can surface it as a 400 to the client.
 */
function assertDate(date: string): void {
  if (!DATE_RE.test(date)) throw new Error(`Invalid date (expected YYYY-MM-DD): "${date}"`);
}

/**
 * Yesterday's date in the configured timezone.
 *
 * NOTE on timezones: raw_conversations stores timestamps as ISO strings (UTC),
 * but SQLite queries like `date(timestamp)` and `date('now')` interpret those
 * strings in UTC. For users not on UTC, the plugin-side local day does not line
 * up with the server-side query day, so a daily summary can silently cover the
 * wrong calendar day.
 *
 * The Worker resolves this by loading raw timestamps into the configured tz via
 * `datetime(timestamp, 'localtime')` in repo queries, and by computing
 * "yesterday" here in the same tz. cron itself runs on the host wall clock, so
 * keep server host tz aligned with `tz` for correct 03:00-local scheduling.
 */
function yesterdayDate(): string {
  const tz = getConfig().tz;
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const today = fmt.format(new Date());
  const [y, m, d] = today.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  const yo = dt.getUTCFullYear();
  const mo = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const do_ = String(dt.getUTCDate()).padStart(2, '0');
  return `${yo}-${mo}-${do_}`;
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
      await runDailySummaryForUser(user_id, date);
    } catch (e) {
      log('error', `summary failed`, { user_id, date, error: String(e) });
    }
  }
}

/**
 * Summarize a single user's raw conversations for a given date.
 * Coalesced via dailyInFlight: while one summary for (user_id, date) is
 * running, concurrent triggers (cron overlapping a manual click) are skipped
 * instead of spending another LLM call on the same day.
 */
export async function runDailySummaryForUser(user_id: string, date: string = yesterdayDate()): Promise<boolean> {
  assertDate(date);
  const key = `${user_id}|${date}`;
  if (dailyInFlight.has(key)) {
    log('debug', `daily summary skipped (already running)`, { user_id, date });
    return false;
  }
  dailyInFlight.add(key);
  try {
    const count = countRawByDate(user_id, date);
    if (count === 0) {
      log('debug', `skip empty`, { user_id, date });
      return false;
    }
    const raws = listRawByDate(user_id, date);
    const result = await generateDailySummary(user_id, date, raws);
    if (!result) return false;

    upsertDailySummary({
      user_id,
      date,
      content: result.content,
      raw_count: result.raw_count,
      generated_at: new Date().toISOString(),
    });
    log('info', `summary ok`, { user_id, date, raw_count: result.raw_count });
    return true;
  } finally {
    dailyInFlight.delete(key);
  }
}

/**
 * Weekly job: regenerate full profile from last 7 days summaries.
 * (Hard memories are tracked for delta triggers + counts, but not fed to
 * the LLM — they're injected into the system prompt separately by the plugin.)
 */
export async function runWeeklyProfile(): Promise<void> {
  const users = listAllUsers();
  log('info', `weekly_profile start`, { users: users.length });

  for (const user_id of users) {
    try {
      await regenerateProfileForUser(user_id, 'weekly');
    } catch (e) {
      log('error', `profile failed`, { user_id, error: String(e) });
    }
  }
}

/**
 * Triggered when hard memory delta crosses threshold for a user.
 * Called from API layer after hard memory insert.
 * Debounced via an in-flight guard: while one refresh is running for a user,
 * further triggers are skipped (next cron cycle catches any leftover delta).
 */
export async function maybeTriggerProfileRefresh(user_id: string): Promise<boolean> {
  const cfg = getConfig();
  const meta = getProfileMeta(user_id);
  const delta = countHardSince(user_id, meta.last_hard_memory_id);

  if (delta < cfg.cron.hard_memory_threshold) return false;

  const ran = await regenerateProfileForUser(user_id, 'delta');
  if (!ran) {
    log('debug', `delta trigger skipped (already running)`, { user_id, delta });
  }
  return ran;
}

/**
 * Regenerate a single user's profile. Returns false if a refresh is already
 * running for this user (coalescing), true if it ran.
 */
export async function regenerateProfileForUser(user_id: string, reason: string): Promise<boolean> {
  if (profileInFlight.has(user_id)) {
    log('debug', `profile skipped (already running)`, { user_id, reason });
    return false;
  }
  profileInFlight.add(user_id);
  try {
    await doRegenerateProfile(user_id, reason);
  } finally {
    profileInFlight.delete(user_id);
  }
  return true;
}

async function doRegenerateProfile(user_id: string, reason: string): Promise<void> {
  const summaries = listRecentSummaries(user_id, 7);
  // Hard memories are never fed to the profile LLM — they're injected into the
  // system prompt separately by the plugin. So we only need a count here, not
  // the full rows. Saves deserializing 200 rows on every refresh.
  const hardCount = countHard(user_id);

  if (summaries.length === 0 && hardCount === 0) {
    log('debug', `profile skip empty`, { user_id });
    return;
  }

  // Profile is built from observed summaries only; hard memories are
  // injected into the system prompt separately by the plugin.
  const content = await generateProfile(user_id, summaries);
  upsertProfile({
    user_id,
    content,
    version: 1, // upsert increments
    generated_at: new Date().toISOString(),
    source_raw_count: summaries.reduce((a, s) => a + s.raw_count, 0),
    source_memory_count: hardCount,
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
const scheduledTasks: cron.ScheduledTask[] = [];

export function startCron(): void {
  if (started) return;
  started = true;

  const cfg = getConfig();
  log('info', `scheduling`, { daily: cfg.cron.daily_summary, weekly: cfg.cron.weekly_profile });

  scheduledTasks.push(
    cron.schedule(cfg.cron.daily_summary, () => {
      runDailySummary().catch(e => log('error', 'daily uncaught', { error: String(e) }));
    }),
  );

  scheduledTasks.push(
    cron.schedule(cfg.cron.weekly_profile, () => {
      runWeeklyProfile().catch(e => log('error', 'weekly uncaught', { error: String(e) }));
    }),
  );

  // prune monthly
  scheduledTasks.push(
    cron.schedule('0 4 1 * *', () => {
      runRawPrune().catch(e => log('error', 'prune uncaught', { error: String(e) }));
    }),
  );
}

export function stopCron(): void {
  for (const t of scheduledTasks) {
    try { t.stop(); } catch { /* ignore */ }
  }
  scheduledTasks.length = 0;
  started = false;
  log('info', `cron stopped`);
}
