/**
 * Mio — Response Pattern Signals
 *
 * Tracks user response patterns as implicit emotional signals:
 *   - Response latency (time since last user message)
 *   - Message burst detection (3+ messages in < 2 minutes)
 *   - Length ratio (current msg length vs EMA average)
 *   - Session gap (hours since last session)
 *   - Engagement trend (rising / steady / falling over last 5 messages)
 *
 * Persists signal history to data/signal-history.json.
 *
 * Zero new dependencies — uses only node:fs and existing types.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getDataDir } from './config.internal.js';
import { readTranscript, listTranscripts, getLatestSessionId } from './transcript.internal.js';

// ─── Types ───

export interface ResponseSignals {
  responseLatencyMs: number;
  messageBurst: boolean;
  lengthRatio: number;
  sessionGapHours: number;
  engagementTrend: 'rising' | 'steady' | 'falling';
}

export interface SignalHistoryEntry {
  timestamp: string;
  sessionId: string;
  signals: ResponseSignals;
}

// ─── Constants ───

/** Burst threshold: 3+ messages within this window (ms). */
const BURST_WINDOW_MS = 2 * 60 * 1000; // 2 minutes
const BURST_MIN_COUNT = 3;

/** EMA smoothing factor for average message length. */
const EMA_ALPHA = 0.3;

/** Engagement trend window: last N messages. */
const TREND_WINDOW = 5;

// ─── Signal history persistence ───

function signalHistoryPath(): string {
  return join(getDataDir(), 'signal-history.json');
}

function readSignalHistory(): SignalHistoryEntry[] {
  const path = signalHistoryPath();
  try {
    if (!existsSync(path)) return [];
    const raw = readFileSync(path, 'utf-8');
    return JSON.parse(raw) as SignalHistoryEntry[];
  } catch {
    return [];
  }
}

function appendSignalHistory(entry: SignalHistoryEntry): void {
  const path = signalHistoryPath();
  mkdirSync(dirname(path), { recursive: true });
  const history = readSignalHistory();
  history.push(entry);
  // Keep last 500 entries to prevent unbounded growth
  const trimmed = history.slice(-500);
  writeFileSync(path, JSON.stringify(trimmed, null, 2), 'utf-8');
}

// ─── Moving average (EMA) ───

let _avgMsgLength: number | null = null;

/**
 * Get or initialize the EMA average message length.
 * Reads from signal history if available.
 */
function getAvgMsgLength(): number {
  if (_avgMsgLength !== null) return _avgMsgLength;

  const history = readSignalHistory();
  if (history.length === 0) {
    _avgMsgLength = 20; // reasonable default: ~20 chars per message
    return _avgMsgLength;
  }

  // Rebuild EMA from history
  let avg = 20;
  for (const entry of history) {
    const lengthRatio = entry.signals.lengthRatio;
    // Reverse-engineer message length from ratio * avg
    // lengthRatio = currentMsgLength / avgMsgLength
    // So implied length ≈ lengthRatio * avg
    const impliedLength = lengthRatio * avg;
    avg = EMA_ALPHA * impliedLength + (1 - EMA_ALPHA) * avg;
  }
  _avgMsgLength = avg;
  return _avgMsgLength;
}

function updateAvgMsgLength(currentLength: number): number {
  const avg = getAvgMsgLength();
  _avgMsgLength = EMA_ALPHA * currentLength + (1 - EMA_ALPHA) * avg;
  return _avgMsgLength;
}

// ─── Core analysis ───

/**
 * Analyze response signals from a user message and session context.
 *
 * @param userMessage  The current user message text.
 * @param sessionId    The current session ID.
 * @returns            Derived ResponseSignals.
 */
export function analyzeSignals(userMessage: string, sessionId: string): ResponseSignals {
  // 1. Read transcript entries for this session
  const entries = readTranscript(sessionId);
  const userMessages = entries.filter(
    (e) => e.type === 'message' && e.role === 'user' && e.timestamp,
  );

  const now = Date.now();

  // 2. Response latency: time since last user message
  let responseLatencyMs = 0;
  if (userMessages.length >= 2) {
    const lastMsg = userMessages[userMessages.length - 1];
    const secondLast = userMessages[userMessages.length - 2];
    const t1 = new Date(lastMsg.timestamp!).getTime();
    const t2 = new Date(secondLast.timestamp!).getTime();
    responseLatencyMs = t1 - t2;
    // Sanity check: clamp to reasonable range (1s ~ 7 days)
    if (responseLatencyMs < 1000) responseLatencyMs = 1000;
    if (responseLatencyMs > 7 * 24 * 3600 * 1000) responseLatencyMs = 7 * 24 * 3600 * 1000;
  }

  // 3. Message burst detection: 3+ messages in < 2 min window
  let messageBurst = false;
  if (userMessages.length >= BURST_MIN_COUNT) {
    const recentMsgs = userMessages.slice(-BURST_MIN_COUNT);
    const firstTs = new Date(recentMsgs[0].timestamp!).getTime();
    const lastTs = new Date(recentMsgs[recentMsgs.length - 1].timestamp!).getTime();
    if (lastTs - firstTs <= BURST_WINDOW_MS) {
      messageBurst = true;
    }
  }

  // 4. Length ratio: current message vs EMA average
  const currentLength = userMessage.trim().length;
  const avgLength = getAvgMsgLength();
  const lengthRatio = avgLength > 0 ? currentLength / avgLength : 1;
  updateAvgMsgLength(currentLength);

  // 5. Session gap: hours since last session
  let sessionGapHours = 0;
  try {
    const lastSessionId = getLatestSessionId();
    if (lastSessionId && lastSessionId !== sessionId) {
      const lastEntries = readTranscript(lastSessionId);
      // Find the last entry timestamp
      for (let i = lastEntries.length - 1; i >= 0; i--) {
        if (lastEntries[i].timestamp) {
          const lastTs = new Date(lastEntries[i].timestamp!).getTime();
          sessionGapHours = (now - lastTs) / 3_600_000;
          break;
        }
      }
    }
  } catch {
    // Couldn't determine session gap — leave at 0
  }

  // 6. Engagement trend: based on length and frequency changes over last 5 messages
  const engagementTrend = computeEngagementTrend(userMessages, lengthRatio);

  const signals: ResponseSignals = {
    responseLatencyMs,
    messageBurst,
    lengthRatio: parseFloat(lengthRatio.toFixed(2)),
    sessionGapHours: parseFloat(sessionGapHours.toFixed(1)),
    engagementTrend,
  };

  // 7. Persist
  appendSignalHistory({
    timestamp: new Date().toISOString(),
    sessionId,
    signals,
  });

  return signals;
}

/**
 * Compute engagement trend based on recent message patterns.
 */
function computeEngagementTrend(
  userMessages: Array<{ timestamp?: string; content?: string }>,
  currentLengthRatio: number,
): 'rising' | 'steady' | 'falling' {
  const recentMsgs = userMessages.slice(-TREND_WINDOW);
  if (recentMsgs.length < 3) return 'steady';

  // Trend factors:
  // 1. Length trend: are messages getting longer or shorter?
  // 2. Frequency trend: are messages coming faster or slower?

  // Length trend
  const lengths = recentMsgs.map((m) => (m.content ?? '').trim().length);
  const half = Math.floor(lengths.length / 2);
  const firstHalfAvg = lengths.slice(0, half).reduce((s, x) => s + x, 0) / half;
  const secondHalfAvg = lengths.slice(-half).reduce((s, x) => s + x, 0) / half;

  // If messages are > 30% longer in second half, trend rising
  // If messages are > 30% shorter, trend falling
  const lengthChange = firstHalfAvg > 0
    ? (secondHalfAvg - firstHalfAvg) / firstHalfAvg
    : 0;

  // Frequency trend: are timestamps getting closer together?
  const timestamps = recentMsgs
    .map((m) => (m.timestamp ? new Date(m.timestamp).getTime() : 0))
    .filter((t) => t > 0);

  let freqTrend = 0;
  if (timestamps.length >= 4) {
    const gaps: number[] = [];
    for (let i = 1; i < timestamps.length; i++) {
      gaps.push(timestamps[i] - timestamps[i - 1]);
    }
    const firstGaps = gaps.slice(0, Math.floor(gaps.length / 2));
    const lastGaps = gaps.slice(-Math.floor(gaps.length / 2));
    const firstGapAvg = firstGaps.reduce((s, x) => s + x, 0) / firstGaps.length;
    const lastGapAvg = lastGaps.reduce((s, x) => s + x, 0) / lastGaps.length;
    // Smaller gaps = more frequent = rising engagement
    freqTrend = firstGapAvg > 0
      ? (firstGapAvg - lastGapAvg) / firstGapAvg
      : 0;
  }

  // Combined signal: weighted sum
  // Length getting longer (+), gaps getting shorter (+) = rising
  const combined = lengthChange * 0.5 + freqTrend * 0.5;

  if (combined > 0.15) return 'rising';
  if (combined < -0.15) return 'falling';
  return 'steady';
}

/**
 * Generate a natural-language context string about user engagement signals.
 *
 * Returns null when there's nothing notable to report (so the prompt
 * doesn't get noise).
 */
export function getSignalContext(): string | null {
  const history = readSignalHistory();
  if (history.length === 0) return null;

  const latest = history[history.length - 1];
  const { signals } = latest;

  // Only report if there are notable signals
  const parts: string[] = [];

  // Message burst
  if (signals.messageBurst) {
    parts.push('他今天话特别多，心情应该不错');
  }

  // Engagement trend
  if (signals.engagementTrend === 'falling') {
    parts.push('他最近回复越来越短了——可能最近比较忙');
  } else if (signals.engagementTrend === 'rising') {
    const lastFew = history.slice(-3);
    const burstCount = lastFew.filter((e) => e.signals.messageBurst).length;
    if (burstCount >= 2) {
      parts.push('他今天兴致很高，比平时活跃不少');
    } else if (signals.lengthRatio > 1.5) {
      parts.push('他今天话比平时多，应该挺有分享欲的');
    }
  }

  // Session gap
  if (signals.sessionGapHours > 48) {
    const days = Math.round(signals.sessionGapHours / 24);
    parts.push(`他隔了${days}天才来——有点想他了`);
  } else if (signals.sessionGapHours > 24) {
    parts.push('他隔了一天多才来');
  } else if (signals.sessionGapHours > 12) {
    parts.push('他半天没说话了');
  }

  // Response latency
  if (signals.responseLatencyMs < 5000 && signals.responseLatencyMs > 0) {
    parts.push('他回得很快——应该刚好有空');
  } else if (signals.responseLatencyMs > 3600_000 && signals.responseLatencyMs < 86400_000) {
    parts.push('他隔了几小时才回');
  }

  // Length ratio extreme
  if (signals.lengthRatio > 3) {
    parts.push('他发了好长一段——肯定有很多想说的');
  } else if (signals.lengthRatio < 0.3 && signals.lengthRatio > 0) {
    parts.push('他回得很短——可能正在忙');
  }

  if (parts.length === 0) return null;

  return parts.join('。') + '。';
}

/**
 * Get the most recent signal history for analysis/debugging.
 */
export function getRecentSignalHistory(n: number = 10): SignalHistoryEntry[] {
  const history = readSignalHistory();
  return history.slice(-n);
}

/**
 * Reset signal state (for testing).
 */
export function resetAvgMsgLength(): void {
  _avgMsgLength = null;
}
