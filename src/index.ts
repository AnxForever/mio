#!/usr/bin/env node
/**
 * Mio — CLI entry point
 *
 * Modes:
 *   mio                   Start an interactive REPL (read-eval-print loop).
 *   mio chat "<message>"  One-shot: send a single message and print the reply.
 *   mio mod <name>        Switch the active persona (male | female).
 *   mio status            Print current config + emotion + relationship state.
 *   mio serve             Start the HTTP/WebSocket server (Phase 5).
 *   mio diary             Trigger the nightly consolidation pass manually.
 *   mio voice             Print detected voice capabilities.
 *
 * REPL slash commands (only when voice is available):
 *   /listen [duration_ms]    record from mic, transcribe, send as turn
 *   /speak <text>            speak text through speakers
 *   /capabilities            print detected voice capabilities
 *
 * The REPL is the most-used mode. It streams tokens as the model emits them
 * and runs slash commands locally without round-tripping through the model.
 *
 * Notes:
 *   - Reads ANTHROPIC_API_KEY (or falls back to MockProvider).
 *   - Honors MIO_DIR for the data directory.
 *   - The REPL is line-buffered: enter to send, no multi-line input.
 */

import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { runTurn } from './core/agent-loop.js';
import { getConfig, updateConfig } from './config.js';
import { modManager } from './mod/mod-manager.js';
import { readEmotionState } from './emotion/state.js';
import { readRelationshipState, getProgressInfo } from './relationship/progression.js';
import { nightlyScheduler } from './scheduler/nightly.js';
import { lifeScheduler } from './scheduler/life.js';
import { startServer } from './server/index.js';
import { runDiary } from './subagent/diary.js';
import { selectProvider, getProviderInfo } from './providers/index.js';
import { detectVoiceCapabilities, listenForInput, speakOutput } from './voice/voice-pipeline.js';
import { isFirstRun, runOnboarding } from './onboarding/onboarding.js';
import type { Gender } from './types.js';

// ─── Slash commands ───

const SLASH_COMMANDS: Record<string, string> = {
  '/help': 'Show this help.',
  '/quit': 'Exit the REPL (also /exit, Ctrl-D).',
  '/exit': 'Alias for /quit.',
  '/status': 'Print config + emotion + relationship state.',
  '/mod': 'Switch persona. Usage: /mod male | female',
  '/progress': 'Show relationship stage + thresholds to next stage.',
  '/diary': 'Run the diary-writing pass for today (no nightly consolidation).',
  '/nightly': 'Run the full nightly pipeline (snapshot + consolidate + diary).',
  '/listen': 'Record from mic, transcribe, send as a turn. Usage: /listen [duration_ms=5000]',
  '/speak': 'Speak text through speakers. Usage: /speak <text>',
  '/capabilities': 'Print detected voice capabilities (recording / TTS / STT).',
};

// ─── Argv parsing ───

/**
 * Parse the argv into a subcommand. Returns { command, args } where
 * command is one of: 'repl' | 'chat' | 'mod' | 'status' | 'serve' | 'diary' | 'help' | 'unknown'.
 */
function parseArgv(argv: string[]): { command: string; args: string[] } {
  if (argv.length === 0) return { command: 'repl', args: [] };
  const [first, ...rest] = argv;
  switch (first) {
    case 'chat':
      return { command: 'chat', args: rest };
    case 'mod':
      return { command: 'mod', args: rest };
    case 'status':
      return { command: 'status', args: [] };
    case 'serve':
      return { command: 'serve', args: rest };
    case 'diary':
      return { command: 'diary', args: [] };
    case 'voice':
      return { command: 'voice', args: [] };
    case 'help':
    case '--help':
    case '-h':
      return { command: 'help', args: [] };
    case 'repl':
      return { command: 'repl', args: [] };
    default:
      return { command: 'unknown', args: [first, ...rest] };
  }
}

// ─── REPL ───

async function startRepl(): Promise<void> {
  console.log('Mio REPL — type a message, /help for commands, /quit to exit.\n');

  const rl = createInterface({ input, output });
  let sessionId: string | undefined;

  for (;;) {
    let line: string;
    try {
      line = await rl.question('> ');
    } catch {
      // EOF (Ctrl-D) → exit cleanly
      console.log('\n[bye]');
      break;
    }

    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    // ─── Slash commands (no model call) ───
    if (trimmed.startsWith('/')) {
      const [cmd, ...rest] = trimmed.split(/\s+/);
      switch (cmd) {
        case '/help':
          for (const [name, desc] of Object.entries(SLASH_COMMANDS)) {
            console.log(`  ${name.padEnd(10)} ${desc}`);
          }
          console.log('');
          continue;
        case '/quit':
        case '/exit':
          console.log('[bye]');
          rl.close();
          return;
        case '/status':
          printStatus();
          continue;
        case '/mod':
          await handleModSwitch(rest[0]);
          continue;
        case '/progress':
          printProgress();
          continue;
        case '/diary':
          await handleDiary();
          continue;
        case '/nightly':
          await handleNightly();
          continue;
        case '/capabilities':
          handleCapabilities();
          continue;
        case '/listen': {
          const dur = rest[0] ? parseInt(rest[0], 10) : 5000;
          const r = await listenForInput(dur);
          if (!r.ok) {
            console.log(`  [listen] ${r.reason}`);
            continue;
          }
          if (r.text.trim().length === 0) {
            console.log('  [listen] (no speech detected)');
            continue;
          }
          console.log(`  [listen] "${r.text}"`);
          // Treat the transcribed text as a normal turn
          const result = await runTurn({ text: r.text, sessionId });
          sessionId = result.sessionId;
          console.log(`\n  ${result.text}\n  [turns=${result.turns}]\n`);
          continue;
        }
        case '/speak': {
          const text = rest.join(' ').trim();
          if (!text) {
            console.log('  Usage: /speak <text>');
            continue;
          }
          const r = speakOutput(text);
          if (!r.ok) console.log(`  [speak] ${r.reason}`);
          continue;
        }
        default:
          console.log(`Unknown command: ${cmd}. Try /help.`);
          continue;
      }
    }

    // ─── Regular turn → agent loop ───
    process.stdout.write('\n');
    let firstToken = true;
    try {
      const result = await runTurn(
        { text: trimmed, sessionId },
        {
          onToken: (chunk) => {
            if (firstToken) {
              // Indent the first token to make streaming output visually distinct
              process.stdout.write('  ');
              firstToken = false;
            }
            process.stdout.write(chunk);
          },
        },
      );
      sessionId = result.sessionId;
      process.stdout.write('\n');
      if (result.crisisFlagged) {
        process.stdout.write('  [crisis-signal: logged]\n');
      }
      process.stdout.write(
        `  [turns=${result.turns} tools=${result.toolCallCount} session=${sessionId}]\n\n`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stdout.write(`\n  [error] ${msg}\n\n`);
    }
  }
}

// ─── One-shot chat ───

async function runChat(args: string[]): Promise<void> {
  const text = args.join(' ').trim();
  if (text.length === 0) {
    console.error('Usage: mio chat "<message>"');
    process.exit(1);
  }

  try {
    const result = await runTurn({ text });
    process.stdout.write(result.text + '\n');
    if (result.crisisFlagged) {
      process.stderr.write('[crisis-signal: logged]\n');
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`error: ${msg}\n`);
    process.exit(1);
  }
}

// ─── Mod switch ───

async function handleModSwitch(name: string | undefined): Promise<void> {
  if (!name) {
    console.log(`Current mod: ${modManager().activeMod}`);
    console.log('Usage: /mod male | female');
    return;
  }
  if (name !== 'male' && name !== 'female') {
    console.log(`Invalid mod: "${name}". Use 'male' or 'female'.`);
    return;
  }
  try {
    await modManager().switchMod(name);
    // Also persist the gender in config so voice picks the right voice pool.
    updateConfig({ gender: name as Gender });
    console.log(`Switched to ${name}.`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`Failed to switch mod: ${msg}`);
  }
}

// ─── Status ───

function printStatus(): void {
  const config = getConfig();
  const emotion = readEmotionState();
  const relationship = readRelationshipState();
  const info = getProviderInfo(config.provider, config.model);
  console.log('Config:');
  console.log(`  gender       ${config.gender}`);
  console.log(`  name         ${config.name}`);
  console.log(`  provider     ${info.preset.label} (${config.provider})`);
  console.log(`  model        ${info.model}`);
  console.log(`  apiKey       ${info.isMock ? '(none — MockProvider)' : 'set'}`);
  console.log(`  reason       ${info.reason}`);
  console.log(`  dataDir      ${config.dataDir || '(default)'}`);
  console.log(`  httpPort     ${config.httpPort}`);
  console.log(`  active mod   ${modManager().activeMod}`);
  if (config.authToken) console.log(`  auth         token set`);
  console.log('Emotion:');
  console.log(`  myMood       ${emotion.myMood}`);
  console.log(`  userMood     ${emotion.userMood}`);
  console.log(`  affection    ${emotion.affection}/100`);
  console.log(`  energy       ${emotion.energy}`);
  console.log(`  recentTopics ${emotion.recentTopics.join(', ') || '(none)'}`);
  console.log('Relationship:');
  console.log(`  stage        ${relationship.stage}`);
  console.log(`  interactions ${relationship.interactionCount}`);
  console.log(`  depth        ${relationship.emotionalDepth}`);
  console.log(`  sharedMem    ${relationship.sharedMemories.length}`);
  console.log(`  nicknames    ${JSON.stringify(relationship.nicknames)}`);
}

function printProgress(): void {
  const info = getProgressInfo();
  console.log(`Stage: ${info.currentStage}`);
  if (info.nextStage) {
    console.log(`Next:  ${info.nextStage}`);
    console.log(`  interactions to go: ${info.interactionsToNext}`);
    console.log(`  depth to go:        ${info.depthToNext}`);
  } else {
    console.log('Max stage reached.');
  }
}

// ─── Diary / Nightly ───

async function handleDiary(): Promise<void> {
  console.log('[diary] starting...');
  const today = new Date().toISOString().slice(0, 10);
  const config = getConfig();
  const provider = selectProvider(config.provider, config.model);
  try {
    const result = await runDiary(today, today, provider);
    console.log(`[diary] done: ${result.slice(0, 200)}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`[diary] failed: ${msg}`);
  }
}

async function handleNightly(): Promise<void> {
  console.log('[nightly] starting...');
  try {
    await nightlyScheduler().triggerNow();
    console.log('[nightly] done.');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`[nightly] failed: ${msg}`);
  }
}

// ─── Help / unknown ───

function handleCapabilities(): void {
  const cap = detectVoiceCapabilities();
  console.log('Voice capabilities:');
  console.log(`  recording (ffmpeg/sox):  ${cap.recording ? '✓' : '✗'}`);
  console.log(`  tts (edge-tts):          ${cap.tts ? '✓' : '✗'}`);
  console.log(`  stt (Whisper):           ${cap.stt ? '✓' : '✗'}`);
  console.log(`  full-duplex:             ${cap.fullDuplex ? '✓' : '✗'}`);
  if (!cap.fullDuplex) {
    console.log('');
    console.log('To enable full voice:');
    if (!cap.recording) console.log('  • install ffmpeg: https://ffmpeg.org/download.html');
    if (!cap.tts) console.log('  • npm i -g edge-tts');
    if (!cap.stt) console.log('  • set OPENAI_API_KEY');
  }
}

function printHelp(): void {
  console.log(`Mio — emotional companion agent

Usage:
  mio                        Start interactive REPL
  mio chat "<message>"       One-shot message
  mio mod <name>             Switch persona (male | female)
  mio status                 Show config + state
  mio voice                  Show detected voice capabilities
  mio serve [--port N]       Start HTTP/WebSocket server
  mio diary                  Run the diary pass for today
  mio help                   Show this help

REPL slash commands:
  /help / /quit / /status / /mod / /progress / /diary / /nightly
  /listen [ms]   record + transcribe a turn
  /speak <text>  speak through speakers
  /capabilities  show voice capability detection

Environment:
  ANTHROPIC_API_KEY          Required for real Claude (else MockProvider)
  OPENAI_API_KEY             For voice transcription (Whisper)
  MIO_DIR                    Data directory (default: ./data)
  COLA_MODEL                 Model name (default: claude-sonnet-4-20250514)
  MIO_NIGHTLY_CRON           Cron expression for nightly (default: 30 21 * * *)
`);
}

// ─── Entry ───

const argv = process.argv.slice(2);
const { command, args } = parseArgv(argv);

switch (command) {
  case 'repl':
    if (isFirstRun()) {
      console.log('[first run detected]');
      runOnboarding().catch((err) => {
        console.error(err);
        process.exit(1);
      }).then(() => {
        startRepl().catch((err) => {
          console.error(err);
          process.exit(1);
        });
      });
    } else {
      startRepl().catch((err) => {
        console.error(err);
        process.exit(1);
      });
    }
    break;
  case 'chat':
    runChat(args).catch((err) => {
      console.error(err);
      process.exit(1);
    });
    break;
  case 'mod':
    handleModSwitch(args[0]).then(() => process.exit(0));
    break;
  case 'status':
    printStatus();
    process.exit(0);
    break;
  case 'serve': {
    // Parse --port N from args
    let port: number | undefined;
    const portIdx = args.indexOf('--port');
    if (portIdx >= 0 && args[portIdx + 1]) {
      port = parseInt(args[portIdx + 1], 10);
    }
    lifeScheduler().start();
    startServer({ port }).catch((err) => {
      console.error(err);
      process.exit(1);
    });
    break;
  }
  case 'diary':
    handleDiary().then(() => process.exit(0));
    break;
  case 'voice':
    handleCapabilities();
    process.exit(0);
    break;
  case 'help':
    printHelp();
    process.exit(0);
    break;
  case 'unknown':
  default:
    console.error(`Unknown command: ${args[0] ?? '(none)'}`);
    console.error('Run "mio help" for usage.');
    process.exit(1);
}
