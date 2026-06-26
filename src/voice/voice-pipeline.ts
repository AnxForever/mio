/**
 * Mio — Voice pipeline orchestrator
 *
 * Single entry point for voice I/O. Hides the platform differences and
 * gracefully degrades when tools (ffmpeg, edge-tts) are missing.
 *
 * Components used:
 *   - recordAudio()         from ./stt.ts     (ffmpeg / sox → WAV)
 *   - transcribeAudio()     from ./stt.ts     (WAV → text via Whisper)
 *   - synthesizeToBuffer()  from ./tts.ts     (text → MP3 via edge-tts)
 *   - speak()               from ./tts.ts     (text → audio playback)
 *
 * The pipeline is intentionally synchronous-feeling for the caller:
 *   - `listenForInput()` returns the transcribed text.
 *   - `speakOutput()`    returns once the audio is queued for playback.
 *
 * Both functions do a capability check up front and return a structured
 * result, so callers can fall back to text I/O without throwing.
 */

import { recordAudio, transcribeAudio, sttPipeline } from './stt.js';
import { speak, synthesizeToBuffer, stopSpeaking } from './tts.js';
import { getConfig } from '../config.js';
import { readEmotionState } from '../emotion/state.js';
import type { Gender } from '../types.js';

// ─── Capability detection ───

export interface VoiceCapabilities {
  /** ffmpeg or sox is on PATH. */
  recording: boolean;
  /** edge-tts CLI is on PATH. */
  tts: boolean;
  /** OPENAI_API_KEY is set for Whisper. */
  stt: boolean;
  /** Overall: can the full voice pipeline work? */
  fullDuplex: boolean;
}

/**
 * Detect which voice capabilities are available on this machine.
 *
 * Cached after first call (capabilities don't change at runtime).
 */
let _cached: VoiceCapabilities | null = null;
export function detectVoiceCapabilities(): VoiceCapabilities {
  if (_cached) return _cached;
  const cap: VoiceCapabilities = {
    recording: hasCommand('ffmpeg') || hasCommand('sox'),
    tts: hasCommand('edge-tts'),
    stt: !!process.env.OPENAI_API_KEY,
    fullDuplex: false,
  };
  cap.fullDuplex = cap.recording && cap.tts && cap.stt;
  _cached = cap;
  return cap;
}

function hasCommand(cmd: string): boolean {
  try {
    const check = process.platform === 'win32' ? `where ${cmd}` : `which ${cmd}`;
    // Use sync child_process import lazily to avoid pulling it for non-voice users.
    const { execSync } = require('node:child_process');
    execSync(check, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// ─── Listen (STT) ───

export interface ListenResult {
  ok: boolean;
  text: string;
  /** Reason if not ok. */
  reason?: string;
}

/**
 * Record audio from the mic for `durationMs` and transcribe it.
 *
 * @param durationMs  Recording duration in ms.
 * @returns           { ok, text } — text is empty when ok is false.
 */
export async function listenForInput(durationMs: number = 5000): Promise<ListenResult> {
  const cap = detectVoiceCapabilities();
  if (!cap.recording) {
    return { ok: false, text: '', reason: 'no recording tool (install ffmpeg or sox)' };
  }
  if (!cap.stt) {
    return { ok: false, text: '', reason: 'no OPENAI_API_KEY for Whisper' };
  }
  try {
    const text = await sttPipeline(durationMs);
    return { ok: true, text };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { ok: false, text: '', reason };
  }
}

// ─── Speak (TTS) ───

export interface SpeakResult {
  ok: boolean;
  reason?: string;
}

/**
 * Synthesize text and play it through the speakers.
 *
 * Uses the current emotion state to pick voice + rate, and the current
 * gender to pick the voice pool. No-op if TTS is unavailable.
 */
export function speakOutput(text: string): SpeakResult {
  const cap = detectVoiceCapabilities();
  if (!cap.tts) {
    return { ok: false, reason: 'no edge-tts CLI (npm i -g edge-tts)' };
  }
  try {
    const config = getConfig();
    const emotionState = readEmotionState();
    speak(text, {
      gender: config.gender as Gender,
      emotionState,
    });
    return { ok: true };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { ok: false, reason };
  }
}

/**
 * Stop any currently-playing speech. Useful for barge-in.
 */
export function stopVoice(): void {
  stopSpeaking();
}

// Re-export for convenience
export { synthesizeToBuffer };
