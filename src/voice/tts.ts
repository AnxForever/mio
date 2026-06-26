/**
 * Mio — Text-to-Speech (TTS)
 *
 * speak(text, opts?):         Synthesize and play speech.
 * synthesizeToBuffer(opts?):  Return audio buffer without playing.
 * stopSpeaking():             Cancel current playback.
 *
 * Providers:
 *   - 'edge-tts': Microsoft Edge TTS CLI (supports emotional voice/rate mapping).
 *   - 'system':   Windows SAPI (PowerShell) or macOS `say`.
 *
 * Emotional voice mapping based on EmotionState.myMood:
 *   "开心" → cheerful
 *   "难过" → sad
 *   "温柔" → gentle
 *   default → neutral
 */

import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { logger } from '../utils/logger.js';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { EmotionState, Gender } from '../types.js';
import { getConfig } from '../config.js';

// ─── Types ───

export interface TtsOptions {
  /** TTS provider. Defaults to config.ttsProvider. */
  provider?: 'edge-tts' | 'system';
  /** Override voice name (edge-tts only). */
  voice?: string;
  /** Override rate string, e.g. "+10%" or "-15%". */
  rate?: string;
  /** Agent gender — selects male or female voice set. */
  gender?: Gender;
  /** Emotion state for automatic voice/rate selection. */
  emotionState?: EmotionState;
}

// ─── Emotional voice mapping ───

interface VoiceConfig {
  voice: string;
  rate: string;
}

/** Maps emotion style → voice config, per gender. */
const VOICE_MAPS: Record<Gender, Record<string, VoiceConfig>> = {
  female: {
    cheerful: { voice: 'zh-CN-XiaoyiNeural', rate: '+10%' },
    sad: { voice: 'zh-CN-XiaomoNeural', rate: '-15%' },
    gentle: { voice: 'zh-CN-XiaoxiaoNeural', rate: '-5%' },
    neutral: { voice: 'zh-CN-XiaoyiNeural', rate: '+0%' },
  },
  male: {
    cheerful: { voice: 'zh-CN-YunxiNeural', rate: '+10%' },
    sad: { voice: 'zh-CN-YunyangNeural', rate: '-15%' },
    gentle: { voice: 'zh-CN-YunyangNeural', rate: '-5%' },
    neutral: { voice: 'zh-CN-YunxiNeural', rate: '+0%' },
  },
};

/**
 * Map an EmotionState.myMood string to a TTS style.
 *   "开心" → cheerful
 *   "难过" → sad
 *   "温柔" → gentle
 *   default → neutral
 */
function mapEmotionToStyle(mood: string): string {
  switch (mood) {
    case '\u5f00\u5fc3': // 开心
      return 'cheerful';
    case '\u96be\u8fc7': // 难过
      return 'sad';
    case '\u6e29\u67d4': // 温柔
      return 'gentle';
    default:
      return 'neutral';
  }
}

/** Resolve the voice config from options or emotion state. */
function resolveVoiceConfig(opts?: TtsOptions): VoiceConfig {
  const gender: Gender = opts?.gender ?? getConfig().gender;
  const map = VOICE_MAPS[gender] ?? VOICE_MAPS.female;

  // Explicit overrides take priority.
  if (opts?.voice && opts?.rate) {
    return { voice: opts.voice, rate: opts.rate };
  }
  if (opts?.voice) {
    return { voice: opts.voice, rate: '+0%' };
  }

  // Emotion-based selection.
  const style = opts?.emotionState
    ? mapEmotionToStyle(opts.emotionState.myMood)
    : 'neutral';
  return map[style] ?? map.neutral;
}

// ─── Helpers ───

/**
 * Resolve a shell executable string. TypeScript's ExecSyncOptions narrows
 * `shell` to `string`, so we have to pass a string here. We use the platform
 * default shell (cmd.exe on Windows, $SHELL or /bin/sh elsewhere).
 */
function shellString(): string {
  if (process.platform === 'win32') {
    return process.env.ComSpec ?? 'cmd.exe';
  }
  return process.env.SHELL ?? '/bin/sh';
}

/** Check whether a CLI command is available. */
function hasCommand(cmd: string): boolean {
  try {
    const check = process.platform === 'win32' ? `where ${cmd}` : `which ${cmd}`;
    const _out: string = execSync(check, {
      stdio: 'ignore',
      shell: shellString(),
      encoding: 'utf-8',
    });
    void _out;
    return true;
  } catch {
    return false;
  }
}

/** Play an audio file using the best available player (async, non-blocking). */
function playAudio(filePath: string): ChildProcess | null {
  const platform = process.platform;

  if (hasCommand('ffplay')) {
    return spawn(
      'ffplay',
      ['-nodisp', '-autoexit', '-loglevel', 'quiet', filePath],
      { stdio: 'ignore' },
    );
  }
  if (platform === 'darwin') {
    return spawn('afplay', [filePath], { stdio: 'ignore' });
  }
  if (platform === 'win32') {
    // Windows: use PowerShell with MediaPlayer (supports MP3).
    return spawn(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Add-Type -AssemblyName PresentationCore; ` +
          `$p = New-Object System.Windows.Media.MediaPlayer; ` +
          `$p.Open([uri]'${filePath.replace(/'/g, "''")}'); ` +
          `$p.Play(); Start-Sleep -Seconds 60;`,
      ],
      { stdio: 'ignore' },
    );
  }
  // Linux fallback.
  if (hasCommand('mpg123')) {
    return spawn('mpg123', ['-q', filePath], { stdio: 'ignore' });
  }

  logger.error(
    '[tts] No audio player found. Install ffplay (from ffmpeg) or mpg123.',
  );
  return null;
}

// ─── Playback state ───

let currentProcess: ChildProcess | null = null;

// ─── Public API ───

/**
 * Cancel any currently-playing speech.
 */
export function stopSpeaking(): void {
  if (currentProcess) {
    try {
      currentProcess.kill();
    } catch {
      // Process may have already exited.
    }
    currentProcess = null;
  }
}

/**
 * Synthesize speech from `text` and play it through the speakers.
 *
 * If `opts.provider` is 'edge-tts' (default), uses the edge-tts CLI
 * to generate an MP3, then plays it with ffplay/afplay/etc.
 * If 'system', uses Windows SAPI or macOS `say` directly.
 *
 * @param text  Text to speak.
 * @param opts  Optional TTS settings (provider, voice, emotion state, etc.)
 */
export function speak(text: string, opts?: TtsOptions): void {
  // Cancel any ongoing playback.
  stopSpeaking();

  const provider = opts?.provider ?? getConfig().ttsProvider;

  if (provider === 'system') {
    speakSystem(text);
    return;
  }

  speakEdgeTts(text, opts);
}

/**
 * Synthesize speech to a Buffer without playing it.
 *
 * Currently only supported for the 'edge-tts' provider.
 *
 * @param text  Text to synthesize.
 * @param opts  Optional TTS settings.
 * @returns     Audio buffer (MP3 data).
 * @throws      Error if provider is 'system' (not supported) or synthesis fails.
 */
export async function synthesizeToBuffer(
  text: string,
  opts?: TtsOptions,
): Promise<Buffer> {
  const provider = opts?.provider ?? getConfig().ttsProvider;

  if (provider === 'system') {
    throw new Error(
      'synthesizeToBuffer is not supported for the "system" TTS provider. ' +
        'Use "edge-tts" instead.',
    );
  }

  return synthesizeEdgeTtsToBuffer(text, opts);
}

// ─── edge-tts implementation ───

function speakEdgeTts(text: string, opts?: TtsOptions): void {
  const cfg = resolveVoiceConfig(opts);
  const outFile = join(tmpdir(), `mio-tts-${randomUUID().slice(0, 8)}.mp3`);

  // Synthesize to temp file.
  try {
    const _out: string = execSync(
      `edge-tts --text "${text.replace(/"/g, '\\"')}" ` +
        `--voice "${cfg.voice}" --rate "${cfg.rate}" ` +
        `--write-media "${outFile}"`,
      {
        stdio: 'ignore',
        shell: shellString(),
        encoding: 'utf-8',
      },
    );
    void _out;
  } catch {
    // Fallback to system TTS if edge-tts fails.
    speakSystem(text);
    return;
  }

  if (!existsSync(outFile)) {
    speakSystem(text);
    return;
  }

  // Play the synthesized audio.
  currentProcess = playAudio(outFile);

  if (currentProcess) {
    currentProcess.on('exit', () => {
      currentProcess = null;
      try {
        unlinkSync(outFile);
      } catch {
        // Ignore cleanup errors.
      }
    });
  } else {
    // No player — clean up immediately.
    try {
      unlinkSync(outFile);
    } catch {
      // Ignore.
    }
  }
}

async function synthesizeEdgeTtsToBuffer(
  text: string,
  ttsOpts?: TtsOptions,
): Promise<Buffer> {
  const cfg = resolveVoiceConfig(ttsOpts);
  const outFile = join(tmpdir(), `mio-tts-${randomUUID().slice(0, 8)}.mp3`);

  const _out: string = execSync(
    `edge-tts --text "${text.replace(/"/g, '\\"')}" ` +
      `--voice "${cfg.voice}" --rate "${cfg.rate}" ` +
      `--write-media "${outFile}"`,
    {
      stdio: 'ignore',
      shell: shellString(),
      encoding: 'utf-8',
    },
  );
  void _out;
  void _out;

  try {
    return readFileSync(outFile);
  } finally {
    try {
      unlinkSync(outFile);
    } catch {
      // Ignore cleanup errors.
    }
  }
}

// ─── System TTS implementation ───

function speakSystem(text: string): void {
  const platform = process.platform;
  const escaped = text.replace(/'/g, "''");

  if (platform === 'win32') {
    // Windows SAPI via PowerShell.
    currentProcess = spawn(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Add-Type -AssemblyName System.Speech; ` +
          `$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; ` +
          `$s.Speak('${escaped}')`,
      ],
      { stdio: 'ignore' },
    );
  } else if (platform === 'darwin') {
    // macOS `say` command.
    currentProcess = spawn('say', [text], { stdio: 'ignore' });
  } else {
    // Linux: try espeak, fallback to flite.
    if (hasCommand('espeak')) {
      currentProcess = spawn('espeak', [text], { stdio: 'ignore' });
    } else if (hasCommand('flite')) {
      currentProcess = spawn('flite', ['-t', text], { stdio: 'ignore' });
    } else {
      logger.error(
        '[tts] No system TTS engine found. Install espeak or flate.',
      );
    }
  }

  if (currentProcess) {
    currentProcess.on('exit', () => {
      currentProcess = null;
    });
  }
}
