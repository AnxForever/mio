/**
 * Mio — Poisson-Based Smart Proactive Messaging Scheduler
 *
 * Replaces rigid cron-based decisions with probabilistic inference:
 * - Poisson process for "when" (time since last message / base rate / stage multiplier)
 * - Bayesian updates for "whether" (user response probability per hour)
 * - Topic hints scavenged from recent bookmarks
 *
 * Persistence is global for local single-user sessions and per-contact under
 * `data/users/<sessionId>/user-activity.json` for external IM sessions.
 */

import { globalUserActivityPath, smartProactiveConfigPath, userActivityPath } from '../memory/paths.js';
import { readFileSyncSafe, writeFileSyncSafe } from '../memory/bank.js';
import { isPersonalityDriverEnabled, getPersonalityState } from '../persona/driver.js';

// ─── Types ───

export interface UserActivityPattern {
  hourDistribution: number[];    // 24 elements — probability of user being active each hour
  responseProbability: number[]; // 24 elements — probability user responds if messaged at hour H
  avgResponseTime: number;       // minutes — average time to respond
  lastActive: string;            // ISO timestamp of last user activity
  totalSessions: number;
}

export interface ProactiveDecision {
  shouldMessage: boolean;
  confidence: number;       // 0–1
  reason: string;
  suggestedContent?: string; // topic hint based on recent context
}

export interface SmartProactiveConfig {
  enabled: boolean;
  minIntervalMinutes: number;   // minimum time between proactive messages (default 120)
  baseRate: number;             // Poisson base rate λ (default 0.1 per hour)
  stageMultiplier: Record<string, number>;
  responseThreshold: number;    // min predicted response probability to send (default 0.3)
  quietHours: {
    enabled: boolean;
    startHour: number;           // inclusive, 0-23
    endHour: number;             // exclusive, 0-23; may wrap past midnight
  };
}

// ─── Timeseries record for outcome tracking ───

interface ProactiveOutcome {
  timestamp: string;
  sent: boolean;
  userResponded?: boolean;
  hour: number;           // hour of day when sent
}

interface ActivityRecord {
  sessionId: string;
  hour: number;
  minute: number;
  weekday: number;
  timestamp: string;
  isUserMessage: boolean;
}

// ─── Internal helpers ───

const GLOBAL_ACTIVITY_SCOPE = '__global__';

function activityPath(userId?: string): string {
  return userId?.trim() ? userActivityPath(userId) : globalUserActivityPath();
}

function activityScope(userId?: string): string {
  return userId?.trim() || GLOBAL_ACTIVITY_SCOPE;
}

function cloneDefaultActivity(): UserActivityPattern {
  return {
    ...DEFAULT_ACTIVITY,
    hourDistribution: [...DEFAULT_ACTIVITY.hourDistribution],
    responseProbability: [...DEFAULT_ACTIVITY.responseProbability],
  };
}

// ─── Defaults ───

const DEFAULT_ACTIVITY: UserActivityPattern = {
  hourDistribution: new Array(24).fill(1 / 24),
  responseProbability: new Array(24).fill(0.3),
  avgResponseTime: 30,
  lastActive: new Date().toISOString(),
  totalSessions: 0,
};

const DEFAULT_SMART_CONFIG: SmartProactiveConfig = {
  enabled: true,
  minIntervalMinutes: 120,
  baseRate: 0.1,
  stageMultiplier: {
    acquaintance: 0.4,
    familiar: 0.7,
    ambiguous: 1.0,
    intimate: 1.2,
  },
  responseThreshold: 0.3,
  quietHours: {
    enabled: false,
    startHour: 23,
    endHour: 8,
  },
};

// ─── In-memory cache ───

let cachedActivityByScope = new Map<string, UserActivityPattern>();
let cachedSmartConfig: SmartProactiveConfig | null = null;

// Raw outcome history (persisted alongside activity)
let outcomeHistoryByScope = new Map<string, ProactiveOutcome[]>();

// Raw activity records (kept for hourly distribution, trimmed to last 1000 entries)
let activityRecordsByScope = new Map<string, ActivityRecord[]>();

// ─── Persistence helpers ───

function readActivityFile(userId?: string): { activity: UserActivityPattern; outcomes: ProactiveOutcome[]; records: ActivityRecord[] } {
  const scope = activityScope(userId);
  const cachedActivity = cachedActivityByScope.get(scope);
  if (cachedActivity) {
    return {
      activity: cachedActivity,
      outcomes: outcomeHistoryByScope.get(scope) ?? [],
      records: activityRecordsByScope.get(scope) ?? [],
    };
  }

  const path = activityPath(userId);
  try {
    const raw = readFileSyncSafe(path, '');
    if (!raw) {
      const activity = cloneDefaultActivity();
      const outcomes: ProactiveOutcome[] = [];
      const records: ActivityRecord[] = [];
      cachedActivityByScope.set(scope, activity);
      outcomeHistoryByScope.set(scope, outcomes);
      activityRecordsByScope.set(scope, records);
      return { activity, outcomes, records };
    }
    const parsed = JSON.parse(raw);
    // Merge with defaults in case of partial data
    const activity: UserActivityPattern = {
      hourDistribution: Array.isArray(parsed.hourDistribution) ? parsed.hourDistribution : [...DEFAULT_ACTIVITY.hourDistribution],
      responseProbability: Array.isArray(parsed.responseProbability) ? parsed.responseProbability : [...DEFAULT_ACTIVITY.responseProbability],
      avgResponseTime: typeof parsed.avgResponseTime === 'number' ? parsed.avgResponseTime : DEFAULT_ACTIVITY.avgResponseTime,
      lastActive: parsed.lastActive || DEFAULT_ACTIVITY.lastActive,
      totalSessions: typeof parsed.totalSessions === 'number' ? parsed.totalSessions : DEFAULT_ACTIVITY.totalSessions,
    };
    const outcomes = Array.isArray(parsed.outcomes) ? parsed.outcomes : [];
    const records = Array.isArray(parsed.records) ? parsed.records : [];
    cachedActivityByScope.set(scope, activity);
    outcomeHistoryByScope.set(scope, outcomes);
    activityRecordsByScope.set(scope, records);
    return { activity, outcomes, records };
  } catch {
    const activity = cloneDefaultActivity();
    const outcomes: ProactiveOutcome[] = [];
    const records: ActivityRecord[] = [];
    cachedActivityByScope.set(scope, activity);
    outcomeHistoryByScope.set(scope, outcomes);
    activityRecordsByScope.set(scope, records);
    return { activity, outcomes, records };
  }
}

function persistActivity(userId?: string): void {
  const scope = activityScope(userId);
  const activity = cachedActivityByScope.get(scope);
  if (!activity) return;
  const outcomes = outcomeHistoryByScope.get(scope) ?? [];
  const records = activityRecordsByScope.get(scope) ?? [];
  const path = activityPath(userId);
  try {
    const data = {
      ...activity,
      outcomes: outcomes.slice(-500),   // keep last 500 outcomes
      records: records.slice(-1000),    // keep last 1000 records
    };
    writeFileSyncSafe(path, JSON.stringify(data, null, 2));
  } catch {
    // best-effort
  }
}

function readSmartConfigFile(): SmartProactiveConfig {
  try {
    const raw = readFileSyncSafe(smartProactiveConfigPath(), '');
    if (!raw) return { ...DEFAULT_SMART_CONFIG };
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_SMART_CONFIG,
      ...parsed,
      quietHours: {
        ...DEFAULT_SMART_CONFIG.quietHours,
        ...(parsed.quietHours ?? {}),
      },
      stageMultiplier: {
        ...DEFAULT_SMART_CONFIG.stageMultiplier,
        ...(parsed.stageMultiplier ?? {}),
      },
    };
  } catch {
    return { ...DEFAULT_SMART_CONFIG };
  }
}

function persistSmartConfig(): void {
  try {
    writeFileSyncSafe(smartProactiveConfigPath(), JSON.stringify(cachedSmartConfig, null, 2));
  } catch {
    // best-effort
  }
}

// ─── Exported API ───

/**
 * Update the user activity pattern based on a recent session interaction.
 *
 * 1. Records the timestamp and hour of this interaction.
 * 2. Updates `hourDistribution`: the normalised frequency of activity per hour.
 * 3. Updates `totalSessions`.
 * 4. Persists to `data/user-activity.json`.
 *
 * Lightweight — call this after every user message in the agent loop.
 */
export function updateActivityPattern(sessionId: string): void {
  if (!isExternalIMSession(sessionId)) updateActivityScope(sessionId);
  if (sessionId.trim()) updateActivityScope(sessionId, sessionId);
}

export function isExternalIMSession(sessionId: string): boolean {
  return /^openai-/.test(sessionId)
    || /^onebot-(?:private|group)-/.test(sessionId)
    || /^wechat-native-/.test(sessionId);
}

function updateActivityScope(sessionId: string, userId?: string): void {
  const now = new Date();
  const hour = now.getHours();
  const { activity, records } = readActivityFile(userId);

  // Record this activity (bounded: keep last 1000)
  records.push({
    sessionId,
    hour,
    minute: now.getMinutes(),
    weekday: now.getDay(),
    timestamp: now.toISOString(),
    isUserMessage: true,
  });
  if (records.length > 1000) records.splice(0, records.length - 1000);

  // Update last active
  activity.lastActive = now.toISOString();

  // Recompute hour distribution from recent records (last 200)
  const recentRecords = records.slice(-200);
  const hourCounts = new Array(24).fill(0);
  for (const r of recentRecords) {
    hourCounts[r.hour]++;
  }
  const total = hourCounts.reduce((a, b) => a + b, 0);
  if (total > 0) {
    for (let i = 0; i < 24; i++) {
      activity.hourDistribution[i] = hourCounts[i] / total;
    }
  }

  // Update total sessions
  const uniqueSessions = new Set(records.map(r => r.sessionId));
  activity.totalSessions = uniqueSessions.size;

  const scope = activityScope(userId);
  cachedActivityByScope.set(scope, activity);
  activityRecordsByScope.set(scope, records);
  persistActivity(userId);
}

/**
 * Core decision function: should Mio send a proactive message right now?
 *
 * The decision pipeline:
 * 1. **Minimum interval guard** — skip if less than `minIntervalMinutes` since last proactive message.
 * 2. **Poisson probability** — P(message) = 1 - e^(-lambda * hoursSinceLastMessage)
 *    where lambda = baseRate * stageMultiplier[stage] * hourActivityFactor(currentHour)
 * 3. **Response prediction** — look up `responseProbability[currentHour]`.
 *    If below `responseThreshold`, confidence drops sharply.
 * 4. **Random roll** — draw a uniform random number. If it's below the
 *    adjusted Poisson probability, return `shouldMessage: true`.
 *
 * @param relationshipStage  Current stage from relationship state
 * @param lastInteraction    ISO timestamp of last user interaction (from emotion state)
 */
export function decideProactiveMessage(
  relationshipStage: string,
  lastInteraction: string,
  userId?: string,
): ProactiveDecision {
  const cfg = getSmartProactiveConfig();
  if (!cfg.enabled) {
    return { shouldMessage: false, confidence: 0, reason: 'smart scheduler disabled' };
  }

  const currentHour = new Date().getHours();
  if (isQuietHour(currentHour, cfg.quietHours)) {
    return {
      shouldMessage: false,
      confidence: 0,
      reason: `quiet hours: current hour ${currentHour} is within ${cfg.quietHours.startHour}:00-${cfg.quietHours.endHour}:00`,
    };
  }

  const { activity, outcomes } = readActivityFile(userId);
  const now = Date.now();

  // Step 0: Personality driver modulation
  let personalityModifier = 1.0;
  if (isPersonalityDriverEnabled()) {
    try {
      const pState = getPersonalityState();
      // High initiative → more likely to message (increase lambda)
      const initMod = 0.5 + (pState.initiative / 100) * 1.0; // 0.5 to 1.5
      // Low sociability → less likely to message
      const socMod = 0.3 + (pState.sociability / 100) * 0.8; // 0.3 to 1.1
      // Combined: initiative drives the base, sociability is a ceiling
      personalityModifier = Math.max(0.3, Math.min(1.5, initMod * socMod));
    } catch {
      // Best-effort
    }
  }

  // Step 1: Minimum interval guard
  const lastOutcome = outcomes.filter(o => o.sent).at(-1);
  if (lastOutcome) {
    const msSinceLast = now - new Date(lastOutcome.timestamp).getTime();
    const minutesSinceLast = msSinceLast / 60_000;
    if (minutesSinceLast < cfg.minIntervalMinutes) {
      const remaining = Math.round(cfg.minIntervalMinutes - minutesSinceLast);
      return {
        shouldMessage: false,
        confidence: 0,
        reason: `cooldown: only ${Math.round(minutesSinceLast)}m since last message (need ${cfg.minIntervalMinutes}m, ${remaining}m remaining)`,
      };
    }
  }

  // Step 2: Poisson probability
  const stageMult = cfg.stageMultiplier[relationshipStage] ?? 1.0;
  const hourActivityFactor = Math.max(0.2, activity.hourDistribution[currentHour] * 24); // scale up so avg ~1.0
  const effectiveLambda = cfg.baseRate * stageMult * hourActivityFactor * personalityModifier;

  // Calculate hours since last interaction (cap at 24 for rate stability)
  const effectiveLastInteraction =
    userId && activity.totalSessions > 0 ? activity.lastActive : lastInteraction;
  const lastInteractionMs = new Date(effectiveLastInteraction).getTime();
  const hoursSinceLast = Math.min(24, Math.max(0, (now - lastInteractionMs) / 3_600_000));
  const poissonProb = 1 - Math.exp(-effectiveLambda * hoursSinceLast);

  // Step 3: Response prediction
  const predictedResponseProb = activity.responseProbability[currentHour] ?? 0.3;

  // Step 4: Combine probabilities
  // If response probability is too low, reduce confidence proportionally
  let confidence: number;
  let reason: string;

  if (predictedResponseProb < cfg.responseThreshold) {
    // Penalise low predicted response rate at this hour
    const penalty = predictedResponseProb / cfg.responseThreshold;
    confidence = poissonProb * penalty;
    reason = `low response probability at hour ${currentHour} (${(predictedResponseProb * 100).toFixed(0)}%), penalised to ${(confidence * 100).toFixed(0)}%`;
  } else {
    confidence = poissonProb;
    reason = `λ=${effectiveLambda.toFixed(3)} (personalityMod=${personalityModifier.toFixed(2)}), ${hoursSinceLast.toFixed(1)}h since interaction, P(poisson)=${(poissonProb * 100).toFixed(1)}%, P(response|h${currentHour})=${(predictedResponseProb * 100).toFixed(0)}%`;
  }

  // Clamp
  confidence = Math.max(0, Math.min(1, confidence));

  // Step 4: Random roll
  const roll = Math.random();
  const shouldMessage = roll < confidence;

  if (!shouldMessage) {
    return {
      shouldMessage: false,
      confidence,
      reason: `roll=${roll.toFixed(3)} >= confidence=${confidence.toFixed(3)}: ${reason}`,
    };
  }

  // Step 5: Generate topic hint from recent context (best-effort)
  const suggestedContent = generateTopicHint(activity, outcomes);

  return {
    shouldMessage: true,
    confidence,
    reason: `roll=${roll.toFixed(3)} < confidence=${confidence.toFixed(3)}: ${reason}`,
    suggestedContent,
  };
}

/**
 * Return the current smart proactive config.
 * Loads from disk on first call; uses in-memory cache thereafter.
 */
export function getSmartProactiveConfig(): SmartProactiveConfig {
  if (!cachedSmartConfig) {
    cachedSmartConfig = readSmartConfigFile();
  }
  return cachedSmartConfig;
}

/**
 * Apply a partial update to the smart proactive config and persist.
 *
 * @param patch  Partial config properties to update.
 */
export function updateSmartProactiveConfig(patch: Partial<SmartProactiveConfig>): SmartProactiveConfig {
  const current = getSmartProactiveConfig();
  cachedSmartConfig = {
    ...current,
    ...patch,
    quietHours: {
      ...current.quietHours,
      ...(patch.quietHours ?? {}),
    },
    stageMultiplier: {
      ...current.stageMultiplier,
      ...(patch.stageMultiplier ?? {}),
    },
  };
  persistSmartConfig();
  return cachedSmartConfig;
}

/**
 * Record whether a proactive message was sent and (later) whether the user responded.
 *
 * Bayesian-inspired update to `responseProbability`:
 * - If sent + user responded at hour H → increment "successes" for hour H
 * - If sent + no response within window → increment "failures" for hour H
 * - responseProbability[H] = successes[H] / (successes[H] + failures[H]), with Laplace smoothing
 *
 * @param sent             Whether the message was sent
 * @param userResponded    Whether the user responded within ~30 minutes (optional, can be updated later)
 */
export function recordProactiveMessage(sent: boolean, userResponded?: boolean, userId?: string): void {
  const now = new Date();
  const hour = now.getHours();
  const { activity, outcomes } = readActivityFile(userId);

  outcomes.push({
    timestamp: now.toISOString(),
    sent,
    userResponded,
    hour,
  });

  // Bayesian-inspired update: Laplace-smoothed success rate per hour
  if (sent && userResponded !== undefined) {
    // Count all sent outcomes with explicit response tracking for this hour
    const relevant = outcomes.filter(o => o.sent && o.userResponded !== undefined && o.hour === hour);
    const successes = relevant.filter(o => o.userResponded).length;
    const failures = relevant.filter(o => !o.userResponded).length;
    // Laplace smoothing: add 1 pseudo-success and 1 pseudo-failure
    activity.responseProbability[hour] = (successes + 1) / (failures + successes + 2);
  }

  // Recompute average response time from recent outcomes where user responded
  const responded = outcomes.filter(o => o.userResponded).slice(-20);
  if (responded.length > 1) {
    let totalMinutes = 0;
    let count = 0;
    for (let i = 1; i < responded.length; i++) {
      const ms = new Date(responded[i].timestamp).getTime() - new Date(responded[i - 1].timestamp).getTime();
      totalMinutes += ms / 60_000;
      count++;
    }
    if (count > 0) {
      activity.avgResponseTime = Math.round(totalMinutes / count);
    }
  }

  const scope = activityScope(userId);
  cachedActivityByScope.set(scope, activity);
  outcomeHistoryByScope.set(scope, outcomes);
  persistActivity(userId);
}

/**
 * Return a human-readable summary of the user's activity pattern.
 *
 * Example: "用户通常在晚上9-11点最活跃，早上7-8点回应概率最高"
 */
export function getActivityInsight(userId?: string): string {
  const { activity } = readActivityFile(userId);

  const peakActivityHours = topHours(activity.hourDistribution, 2);
  const peakResponseHours = topHours(activity.responseProbability, 2);

  const formatHours = (hours: number[]): string =>
    hours.map(h => `${h}点`).join('-');

  const parts: string[] = [];
  if (peakActivityHours.length > 0) {
    parts.push(`用户通常在${formatHours(peakActivityHours)}最活跃`);
  }
  if (peakResponseHours.length > 0) {
    parts.push(`${formatHours(peakResponseHours)}回应概率最高`);
  }
  if (activity.totalSessions > 0) {
    parts.push(`共有${activity.totalSessions}次会话`);
  }
  if (activity.avgResponseTime < 60) {
    parts.push(`平均回应时间约${activity.avgResponseTime}分钟`);
  }

  return parts.length > 0 ? parts.join('，') : '暂无足够数据';
}

// ─── Internal helpers ───

/**
 * Return the indices (0–23) of the `n` highest values in an array.
 */
function topHours(arr: number[], n: number): number[] {
  const entries = arr.map((v, i) => ({ v, i }));
  entries.sort((a, b) => b.v - a.v);
  return entries.slice(0, n).map(e => e.i).sort((a, b) => a - b);
}

export function isQuietHour(
  hour: number,
  quietHours: SmartProactiveConfig['quietHours'],
): boolean {
  if (!quietHours.enabled) return false;
  const start = normalizeHour(quietHours.startHour);
  const end = normalizeHour(quietHours.endHour);
  const current = normalizeHour(hour);
  if (start === end) return true;
  if (start < end) return current >= start && current < end;
  return current >= start || current < end;
}

function normalizeHour(hour: number): number {
  if (!Number.isFinite(hour)) return 0;
  return ((Math.trunc(hour) % 24) + 24) % 24;
}

/**
 * Generate a topic hint for the proactive message based on recent activity
 * and outcome history. Uses simple heuristics — no LLM call.
 *
 * Possible hints:
 * - "你上次跟他聊了工作的事，可以问问后来怎么样了"
 * - "该说晚安了"
 * - "他今天心情好像不太好，可以问问"
 */
function generateTopicHint(
  activity: UserActivityPattern,
  outcomes: ProactiveOutcome[],
): string | undefined {
  const now = new Date();
  const hour = now.getHours();

  // Evening — suggest goodnight message
  if (hour >= 21 || hour < 6) {
    return 'time_for_goodnight';
  }

  // Morning — suggest morning greeting
  if (hour >= 6 && hour < 9) {
    return 'time_for_morning_greeting';
  }

  // If user has been inactive for a long time, suggest a check-in
  const lastActiveMs = new Date(activity.lastActive).getTime();
  const hoursSinceActive = (Date.now() - lastActiveMs) / 3_600_000;
  if (hoursSinceActive > 24) {
    return 'long_time_no_talk';
  }

  // Suggest based on average response time — short = engaged, can ask casual
  if (activity.avgResponseTime < 30) {
    return 'casual_checkin';
  }

  return undefined;
}

/**
 * Reset the in-memory cache so the next read forces a fresh load from disk.
 * Useful for testing.
 */
export function _resetCache(userId?: string): void {
  if (userId) {
    const scope = activityScope(userId);
    cachedActivityByScope.delete(scope);
    outcomeHistoryByScope.delete(scope);
    activityRecordsByScope.delete(scope);
    return;
  }

  cachedActivityByScope = new Map();
  cachedSmartConfig = null;
  outcomeHistoryByScope = new Map();
  activityRecordsByScope = new Map();
}
