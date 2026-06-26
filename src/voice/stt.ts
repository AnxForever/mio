/**
 * Mio — Speech-to-Text (STT)
 *
 * recordAudio:  Use ffmpeg or sox to capture microphone input.
 * transcribeAudio: Send audio to OpenAI Whisper API.
 * sttPipeline:  Full pipeline — record → transcribe → return text.
 *
 * Windows uses ffmpeg with `-f dshow -i audio="Microphone"`.
 * macOS uses ffmpeg with `-f avfoundation -i ":0"`.
 * Linux uses ffmpeg with `-f pulse -i default`.
 * Fallback: sox (`sox -d`).
 * If neither tool is installed, throw with install instructions.
 */

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

// ─── Helpers ───

/** Check whether a CLI command is available on PATH. */
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

// ─── Public API ───

/**
 * Record audio from the default microphone for `durationMs` milliseconds.
 *
 * Uses ffmpeg (dshow on Windows, avfoundation on macOS, pulse on Linux)
 * or sox as a fallback. Returns the path to the recorded WAV file.
 *
 * @throws Error if no recording tool is found or recording fails.
 */
export function recordAudio(durationMs: number): string {
  const outFile = join(tmpdir(), `mio-rec-${randomUUID().slice(0, 8)}.wav`);
  const durationSec = Math.max(1, Math.ceil(durationMs / 1000));
  const platform = process.platform;

  if (hasCommand('ffmpeg')) {
    let cmd: string;
    if (platform === 'win32') {
      // Windows: dshow with "Microphone" device name.
      // If the device name differs, the user can set MIO_MIC_DEVICE env var.
      const micDevice = process.env.MIO_MIC_DEVICE ?? 'Microphone';
      cmd = `ffmpeg -y -f dshow -i audio="${micDevice}" -t ${durationSec} -ar 16000 -ac 1 "${outFile}"`;
    } else if (platform === 'darwin') {
      // macOS: avfoundation, ":0" = first audio input device.
      cmd = `ffmpeg -y -f avfoundation -i ":0" -t ${durationSec} -ar 16000 -ac 1 "${outFile}"`;
    } else {
      // Linux: pulseaudio default.
      cmd = `ffmpeg -y -f pulse -i default -t ${durationSec} -ar 16000 -ac 1 "${outFile}"`;
    }
    const _ff: string = execSync(cmd, {
      stdio: 'ignore',
      shell: shellString(),
      encoding: 'utf-8',
    });
    void _ff;
  } else if (hasCommand('sox')) {
    // sox fallback: `sox -d` records from default input.
    execSync(
      `sox -d -r 16000 -c 1 "${outFile}" trim 0 ${durationSec}`,
      {
        stdio: 'ignore',
        shell: shellString(),
        encoding: 'utf-8',
      },
    );
  } else {
    throw new Error(
      'No audio recording tool found. Install ffmpeg or sox.\n' +
        '  ffmpeg: https://ffmpeg.org/download.html\n' +
        '  sox:    https://sox.sourceforge.net/',
    );
  }

  if (!existsSync(outFile)) {
    throw new Error(
      'Recording failed: output file was not created. ' +
        'Check microphone permissions and device name. ' +
        'On Windows, set MIO_MIC_DEVICE env var to match your device name.',
    );
  }

  return outFile;
}

/**
 * Send an audio file to the OpenAI Whisper API for transcription.
 *
 * @param audioPath  Path to the audio file (wav, mp3, etc.)
 * @param apiKey     OpenAI API key. Falls back to OPENAI_API_KEY env var.
 * @returns          Transcribed text.
 * @throws           Error if API key is missing or the API returns an error.
 */
export async function transcribeAudio(
  audioPath: string,
  apiKey?: string,
): Promise<string> {
  const key = apiKey ?? process.env.OPENAI_API_KEY;
  if (!key) {
    throw new Error(
      'OpenAI API key required for Whisper transcription. ' +
        'Set OPENAI_API_KEY env var or pass apiKey parameter.',
    );
  }

  const audioBuffer = readFileSync(audioPath);
  const blob = new Blob([audioBuffer], { type: 'audio/wav' });

  const formData = new FormData();
  formData.append('file', blob, basename(audioPath));
  formData.append('model', process.env.MIO_WHISPER_MODEL ?? 'whisper-1');
  formData.append('response_format', 'json');
  // Optional: hint the language to improve accuracy for Chinese input.
  formData.append('language', process.env.MIO_WHISPER_LANG ?? 'zh');

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: formData,
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Whisper API error (${res.status}): ${detail}`);
  }

  const data = (await res.json()) as { text: string };
  return data.text;
}

/**
 * Full STT pipeline: record → transcribe → return text.
 *
 * @param durationMs  Recording duration in milliseconds.
 * @param apiKey      Optional OpenAI API key.
 * @returns           Transcribed text.
 */
export async function sttPipeline(
  durationMs: number,
  apiKey?: string,
): Promise<string> {
  const audioPath = recordAudio(durationMs);
  try {
    const text = await transcribeAudio(audioPath, apiKey);
    return text;
  } finally {
    // Clean up the temp audio file.
    try {
      unlinkSync(audioPath);
    } catch {
      // Ignore cleanup errors.
    }
  }
}
