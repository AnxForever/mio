/**
 * Transcript stubs for @mio/emotion.
 */
import { getIO } from './context.js';

export function getRecentTranscripts(count?: number): unknown[] {
  // Simplified — host app implements actual retrieval
  return [];
}

export type TranscriptEntry = {
  time: string;
  role: 'user' | 'agent' | 'system';
  text: string;
};

export function readTranscript(sessionId: string): unknown[] {
  return getIO().readTranscript(sessionId);
}

export function listTranscripts(): string[] {
  return getIO().listTranscripts();
}

export function getLatestSessionId(): string | null {
  return getIO().getLatestSessionId();
}
