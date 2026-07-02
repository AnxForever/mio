/**
 * Injectable context for @mio/emotion.
 *
 * Instead of importing from memory/paths/bank/transcript/config directly,
 * the emotion package accepts these as injectable functions via `initEmotion()`.
 * This keeps the package zero-dependency and embeddable in any project.
 */

// ─── Paths (to be provided by the host app) ───
export interface EmotionPaths {
  padState: string;
  affinityState: string;
  multiAxis: string;
  emotionState: string;
  ritualState: string;
  cardboardState: string;
  /** Optional — older hosts omit it; falls back to <dataDir>/frustration-state.json. */
  frustrationState?: string;
  /** Optional — older hosts omit it; falls back to <dataDir>/ghost-state.json. */
  ghostState?: string;
}

// ─── I/O callbacks (to be provided by the host app) ───
export interface EmotionIO {
  readJSON<T>(path: string): T | null;
  writeJSON(path: string, data: unknown): void;
  appendBookmark(entry: { time: string; what: string; evidence: string }): void;
  readTranscript(sessionId: string): unknown[];
  listTranscripts(): string[];
  getLatestSessionId(): string | null;
}

// ─── Context ───
let _paths: EmotionPaths | null = null;
let _io: EmotionIO | null = null;
let _config: EmotionConfig | null = null;

export interface EmotionConfig {
  dataDir: string;
  padEnabled?: boolean;
  multiAxisEnabled?: boolean;
}

export function initEmotion(paths: EmotionPaths, io: EmotionIO, config: EmotionConfig): void {
  _paths = paths;
  _io = io;
  _config = config;
}

export function getPaths(): EmotionPaths {
  if (!_paths) throw new Error('@mio/emotion not initialized. Call initEmotion() first.');
  return _paths;
}

export function getIO(): EmotionIO {
  if (!_io) throw new Error('@mio/emotion not initialized. Call initEmotion() first.');
  return _io;
}

export function getEmotionConfig(): EmotionConfig {
  if (!_config) throw new Error('@mio/emotion not initialized. Call initEmotion() first.');
  return _config;
}
