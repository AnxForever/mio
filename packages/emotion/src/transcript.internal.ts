/**
 * Transcript stubs for @mio/emotion.
 */
import { getIO } from './context.js';
import type { TranscriptEntry } from './types.internal.js';
export type { TranscriptEntry } from './types.internal.js';

export function getRecentTranscripts(count?: number): TranscriptEntry[] {
  // Simplified — host app implements actual retrieval
  return [];
}

export function readTranscript(sessionId: string): TranscriptEntry[] {
  return getIO().readTranscript(sessionId) as TranscriptEntry[];
}

export function listTranscripts(): string[] {
  return getIO().listTranscripts();
}

export function getLatestSessionId(): string | null {
  return getIO().getLatestSessionId();
}
