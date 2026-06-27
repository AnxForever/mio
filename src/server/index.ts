/**
 * Mio — HTTP / WebSocket server
 *
 * Exposes:
 *   GET  /health              liveness probe
 *   GET  /status              JSON config + emotion + relationship snapshot
 *   POST /chat                non-streaming chat (full reply in one JSON body)
 *   POST /chat/stream         streaming chat via SSE (text/event-stream)
 *   WS   /ws                  full-duplex streaming chat (tokens as they emit)
 *   GET  /avatar/state         emotion → avatar params (Live2D/VRM ready)
 *   POST /mod                 switch persona (male | female)
 *
 * The server is intentionally thin: it owns HTTP plumbing, CORS, and
 * lifecycle. Business logic lives in src/core/agent-loop.ts.
 *
 * Auth: optional bearer-token middleware via MIO_AUTH_TOKEN.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { URL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { WebSocketServer, type WebSocket } from 'ws';
import express, { type Request, type Response, type NextFunction } from 'express';
import { runTurn } from '../core/agent-loop.js';
import { getConfig, updateConfig, PROVIDER_PRESETS } from '../config.js';
import { modManager } from '../mod/mod-manager.js';
import { readEmotionState } from '../emotion/state.js';
import { readRelationshipState, getProgressInfo } from '../relationship/progression.js';
import { buildAvatarState } from './avatar.js';
import { detectVoiceCapabilities, synthesizeToBuffer } from '../voice/voice-pipeline.js';
import { describeProvider } from '../memory/embedding.js';
import { indexStats } from '../memory/vector.js';
import { getProviderInfo, listAvailableProviders } from '../providers/index.js';
import { requireAuth, requireOpenAIAuth, optionalAuth, validateWsAuth, isAuthEnabled } from './auth.js';
import { createRateLimiter } from './rate-limit.js';
import {
  OpenAICompatError,
  buildOpenAICompletionResponse,
  buildOpenAIErrorResponse,
  buildOpenAIModelsResponse,
  createOpenAIStreamContext,
  extractOpenAIUserText,
  resolveOpenAISessionInfo,
  writeOpenAIStreamDone,
  writeOpenAIStreamError,
  writeOpenAIStreamStart,
  writeOpenAIStreamToken,
} from './openai-compat.js';
import {
  OneBotConfigError,
  dispatchOneBotReply,
  extractOneBotIncomingMessage,
  getOneBotBridgeStatus,
} from './onebot.js';
import { createBackup, exportMemory, listBackups, pruneBackups } from '../utils/backup.js';
import { sendToAllChannels, getNotifyChannels, sendTelegramMessage, sendWebhookMessage, sendWhatsAppMessage, sendDiscordMessage, sendSlackMessage, sendWeClawMessage } from './notify.js';
import { logger } from '../utils/logger.js';
import {
  validate,
  validateParams,
  validateQuery,
  chatBody,
  modBody,
  searchQuery,
  analyticsQuery,
  memoryQuery,
  memoryIdParam,
  memoryPatchBody,
  proactivePreferencesBody,
  onboardingBody,
  backupPruneBody,
  characterConfigSchema,
  personaBody,
  personaModeBody,
  openAIChatCompletionsBody,
  imageUploadBody,
  oneBotEventBody,
  modNameParam,
  soulBody,
  voiceSynthesizeBody,
  characterNameParam,
  wsClientMessageSchema,
} from '../validation.js';
import { createCharacter, listCharacters, deleteCharacter, activateCharacter } from '../character/factory.js';
import { readRecentEvents, memoryStreamStats } from '../character/memory-stream.js';
import { getPADState } from '../emotion/pad.js';
import {
  getAnalyticsSnapshot,
  getEmotionTrends,
  getTopicHeatmap,
  getRelationshipTimeline,
  getConversationStats,
} from './analytics.js';
import { searchHandler } from './search.js';
import {
  deleteMemoryReviewItem,
  listMemoryReviewItems,
  updateMemoryReviewItem,
} from './memories.js';
import {
  getSmartProactiveConfig,
  updateSmartProactiveConfig,
} from '../scheduler/smart-proactive.js';
import {
  isFirstRun,
  getOnboardingSteps,
  getStep,
  validateStep,
  applyValue,
  saveOnboardingState,
  loadOnboardingState,
} from '../onboarding/onboarding.js';
import type { Gender } from '../types.js';
import { generatePersona } from '../persona/generator.js';
import { getCurrentMode } from '../persona/dual-mode.js';
import type { PersonaRequest } from '../types.js';
import type { OneBotEventBody, OpenAIChatCompletionsBody } from '../validation.js';
import { imageUploadsDir, modSoulPath, uploadedImagePath } from '../memory/paths.js';
import { readFileSyncSafe, writeFileSyncSafe } from '../memory/bank.js';
import { upsertWeClawTarget } from '../memory/persona-delta.js';
import { refreshPersonaGraph } from '../persona/extractor.js';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, sep } from 'node:path';

// ─── WebSocket protocol ───

/**
 * Client → server message types. The server rejects unknown types.
 *
 * - `chat`             : run a turn. Returns streamed `token` events + final `done`.
 * - `switch_mod`       : change active persona. Returns `mod_switched`.
 * - `subscribe_avatar` : start receiving `emotion_changed` events after each turn.
 * - `ping`             : app-level heartbeat. Server replies with `pong`.
 * - `pong`             : response to server's `ping`. Updates the alive flag.
 */
export type WsClientMessage =
  | { type: 'chat'; text: string; sessionId?: string }
  | { type: 'switch_mod'; name: string }
  | { type: 'subscribe_avatar' }
  | { type: 'ping'; t?: number }
  | { type: 'pong'; t?: number };

function safeSend(ws: WebSocket, payload: unknown): void {
  if (ws.readyState !== ws.OPEN) return;
  try {
    ws.send(JSON.stringify(payload));
  } catch {
    // socket closed between the readyState check and the send; ignore.
  }
}

// ─── Server factory ───

export interface ServerOptions {
  /** HTTP port. 0 means let the OS pick. */
  port?: number;
  /** Bind address. Default '127.0.0.1' (localhost only). */
  host?: string;
}

export interface RunningServer {
  port: number;
  close: () => Promise<void>;
}

function applyCors(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin;
  const allowedOrigin = resolveAllowedOrigin(origin);

  if (allowedOrigin) {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Authorization,Content-Type,X-Mio-Session-Id,X-OpenAI-Session-Id,X-OpenClaw-Session-Id,X-OpenClaw-User-Id,X-WeChat-User-Id,X-OneBot-User-Id',
    );
    res.setHeader('Access-Control-Expose-Headers', 'X-Mio-Session-Id');
    res.setHeader('Access-Control-Max-Age', '86400');
  }

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  next();
}

function resolveAllowedOrigin(origin: string | undefined): string | null {
  if (!origin) return null;
  const raw = process.env.MIO_CORS_ORIGIN?.trim();
  if (!raw) return null;
  if (raw === '*') return '*';

  const allowed = raw.split(',').map((item) => item.trim()).filter(Boolean);
  return allowed.includes(origin) ? origin : null;
}

const IMAGE_EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

function detectImageMime(buffer: Buffer): string | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
  if (buffer.length >= 6) {
    const sig = buffer.subarray(0, 6).toString('ascii');
    if (sig === 'GIF87a' || sig === 'GIF89a') return 'image/gif';
  }
  return null;
}

function parseUploadedImage(body: { data: string; mimeType?: string }): { buffer: Buffer; mimeType: string; ext: string } {
  let raw = body.data.trim();
  let declared = body.mimeType;
  const dataUrl = raw.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/);
  if (dataUrl) {
    declared = dataUrl[1];
    raw = dataUrl[2];
  }

  const buffer = Buffer.from(raw.replace(/\s+/g, ''), 'base64');
  if (buffer.length === 0) throw new Error('Empty image upload');
  if (buffer.length > 4_500_000) throw new Error('Image too large. Maximum 4.5MB.');

  const detected = detectImageMime(buffer);
  if (!detected) throw new Error('Unsupported image data');
  if (declared && declared !== detected) throw new Error('Image MIME type does not match its content');

  return {
    buffer,
    mimeType: detected,
    ext: IMAGE_EXT_BY_MIME[detected] ?? 'img',
  };
}

function isUploadedImagePath(path: string): boolean {
  const root = resolve(imageUploadsDir());
  const target = resolve(path);
  return target === root || target.startsWith(root + sep);
}

function isWeClawContactId(raw: string | undefined): raw is string {
  return typeof raw === 'string' && /@im\.wechat$/i.test(raw.trim());
}

/**
 * Start the HTTP + WebSocket server. Resolves once the server is listening.
 *
 * @param opts  Port + host overrides.
 * @returns     A handle to the running server (port + close fn).
 */
export async function startServer(opts: ServerOptions = {}): Promise<RunningServer> {
  const app = express();
  app.use(applyCors);
  app.use(express.json({ limit: '8mb' })); // uploaded vision images are base64 encoded

  // ─── Static files ───
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const webDir = join(__dirname, '..', '..', 'web');
  app.use(express.static(webDir));

  // Redirect / → /index.html
  app.get('/', (_req, res) => {
    res.redirect('/index.html');
  });

  // ─── Rate limiting (DoS protection) ───
  // Applied to API routes after static assets, so initial web UI boot does not
  // consume the request budget with CSS/JS/image fetches.
  app.use(createRateLimiter());

  // ─── Onboarding routes (no auth — must be available before config exists) ───

  app.get('/onboarding/status', (_req, res) => {
    const needsOnboarding = isFirstRun();
    const state = loadOnboardingState();
    res.json({
      needsOnboarding,
      done: state?.done ?? false,
      currentStep: state?.currentStep ?? 1,
    });
  });

  app.post('/onboarding/start', (_req, res) => {
    const steps = getOnboardingSteps();
    if (steps.length === 0) {
      res.json({ step: 0, question: '', done: true });
      return;
    }
    const first = steps[0];
    res.json({ step: first.step, question: first.question, key: first.key });
  });

  app.post('/onboarding/next', validate(onboardingBody), async (req, res) => {
    const body = req.body as { step?: number; value?: string } | undefined;
    if (!body || typeof body.step !== 'number' || typeof body.value !== 'string') {
      res.status(400).json({ error: 'Missing "step" (number) and "value" (string) in body' });
      return;
    }

    // Validate
    const validationError = validateStep(body.step, body.value);
    if (validationError) {
      res.status(400).json({ error: validationError, step: body.step });
      return;
    }

    // Load or create state
    const state = loadOnboardingState() ?? { done: false, currentStep: 1 };
    const updated = applyValue(state, body.step, body.value);
    if (body.step === 6) {
      updateSmartProactiveConfig({ enabled: body.value === 'true' });
    }

    // If the final step was answered, we're done (the CLI version sends the first message;
    // the web UI will do it separately via POST /chat)
    if (body.step >= 7) {
      saveOnboardingState({
        ...(updated as Parameters<typeof saveOnboardingState>[0]),
        done: true,
        currentStep: 0,
      });
      res.json({ step: 0, question: '', done: true, key: '' });
      return;
    }

    saveOnboardingState(updated as Parameters<typeof saveOnboardingState>[0]);

    // Return next step
    const nextStep = getStep(body.step + 1);
    if (!nextStep) {
      res.json({ step: 0, question: '', done: true, key: '' });
      return;
    }
    res.json({ step: nextStep.step, question: nextStep.question, key: nextStep.key });
  });

  // ─── Routes ───

  app.get('/health', (_req, res) => {
    res.json({ ok: true, name: 'mio', version: '0.6.0' });
  });

  app.get('/status', (_req, res) => {
    const config = getConfig();
    const emotion = readEmotionState();
    const relationship = readRelationshipState();
    const progress = getProgressInfo();
    const memStats = indexStats();
    const providerInfo = getProviderInfo(config.provider, config.model);
    res.json({
      config: {
        gender: config.gender,
        name: config.name,
        provider: config.provider,
        providerLabel: providerInfo.preset.label,
        model: providerInfo.model,
        apiKeySet: !providerInfo.isMock,
        activeMod: modManager().activeMod,
      },
      provider: {
        preset: providerInfo.preset.name,
        label: providerInfo.preset.label,
        model: providerInfo.model,
        available: !providerInfo.isMock,
        reason: providerInfo.reason,
      },
      providers: listAvailableProviders().map((p) => ({
        name: p.name,
        label: p.label,
        model: p.model,
        configured: !!process.env[p.env],
      })),
      embedding: {
        provider: describeProvider(),
        indexEntries: memStats.entries,
        indexTypes: memStats.types,
      },
      emotion,
      relationship,
      progress,
    });
  });

  // ─── Avatar ───
  app.get('/avatar/state', (_req, res) => {
    const emotion = readEmotionState();
    const relationship = readRelationshipState();
    const avatar = buildAvatarState(emotion, relationship.stage);
    res.json(avatar);
  });

  // ─── Voice ───
  app.get('/voice/capabilities', (_req, res) => {
    res.json(detectVoiceCapabilities());
  });

  app.post('/voice/synthesize', requireAuth, validate(voiceSynthesizeBody), async (req, res) => {
    const body = req.body as { text: string };
    const cap = detectVoiceCapabilities();
    if (!cap.tts) {
      res.status(503).json({ error: 'edge-tts CLI not available' });
      return;
    }
    try {
      const audio = await synthesizeToBuffer(body.text, {
        gender: getConfig().gender as Gender,
        emotionState: readEmotionState(),
      });
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Content-Length', String(audio.length));
      res.send(audio);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  // ─── Uploads ───
  app.post('/uploads/images', requireAuth, validate(imageUploadBody), (req, res) => {
    try {
      const parsed = parseUploadedImage(req.body as { data: string; mimeType?: string });
      mkdirSync(imageUploadsDir(), { recursive: true });
      const fileName = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}.${parsed.ext}`;
      const path = uploadedImagePath(fileName);
      writeFileSync(path, parsed.buffer);
      res.json({
        ok: true,
        imagePath: path,
        mimeType: parsed.mimeType,
        size: parsed.buffer.length,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(msg.includes('too large') ? 413 : 400).json({ error: msg });
    }
  });

  // ─── OpenAI-compatible bridge ───
  // Lets IM gateways such as OpenClaw/ClawBot call Mio as a custom
  // OpenAI-compatible chat model while preserving Mio's own memory pipeline.
  app.get('/v1/models', requireOpenAIAuth, (_req, res) => {
    res.json(buildOpenAIModelsResponse());
  });

  app.post('/v1/chat/completions', requireOpenAIAuth, async (req, res) => {
    const parsed = openAIChatCompletionsBody.safeParse(req.body);
    if (!parsed.success) {
      const detail = parsed.error.issues.map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`).join('; ');
      res.status(400).json(buildOpenAIErrorResponse(`Invalid request body: ${detail}`, 'invalid_request_error', 'invalid_request'));
      return;
    }

    const body = parsed.data as OpenAIChatCompletionsBody;

    let text: string;
    let sessionId: string;
    try {
      text = extractOpenAIUserText(body);
      const session = resolveOpenAISessionInfo(body, req);
      sessionId = session.sessionId;
      if (isWeClawContactId(session.rawSessionId)) {
        upsertWeClawTarget(sessionId, session.rawSessionId, 'openai-bridge');
      }
    } catch (err) {
      const status = err instanceof OpenAICompatError ? err.status : 400;
      const message = err instanceof Error ? err.message : String(err);
      res.status(status).json(buildOpenAIErrorResponse(
        message,
        status === 413 ? 'input_too_long' : 'invalid_request_error',
        status === 413 ? 'input_too_long' : 'invalid_request',
      ));
      return;
    }

    if (body.stream) {
      const streamCtx = createOpenAIStreamContext(body);
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.setHeader('X-Mio-Session-Id', sessionId);
      res.flushHeaders?.();
      writeOpenAIStreamStart(res, streamCtx);

      try {
        await runTurn(
          { text, sessionId },
          {
            onToken: (chunk) => writeOpenAIStreamToken(res, streamCtx, chunk),
          },
        );
        writeOpenAIStreamDone(res, streamCtx);
        res.end();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        writeOpenAIStreamError(res, msg);
        res.end();
      }
      return;
    }

    try {
      const result = await runTurn({ text, sessionId });
      res.setHeader('X-Mio-Session-Id', result.sessionId);
      res.json(buildOpenAICompletionResponse(body, result));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json(buildOpenAIErrorResponse(msg, 'server_error'));
    }
  });

  // ─── OneBot v11 bridge ───
  // NapCatQQ/Lagrange can POST message events here. Mio replies either through
  // OneBot quick operation response or an outbound OneBot HTTP API call.
  app.get('/onebot/v11/status', requireAuth, (_req, res) => {
    res.json(getOneBotBridgeStatus());
  });

  app.post('/onebot/v11/events', requireAuth, validate(oneBotEventBody), async (req, res) => {
    const event = req.body as OneBotEventBody;
    const incoming = extractOneBotIncomingMessage(event);
    if ('skipped' in incoming) {
      res.json(incoming);
      return;
    }

    try {
      const result = await runTurn({ text: incoming.text, sessionId: incoming.sessionId });
      const responseBody = await dispatchOneBotReply(incoming, result);
      res.json(responseBody);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const status = err instanceof OneBotConfigError ? err.status : msg.startsWith('OneBot send failed') ? 502 : 500;
      res.status(status).json({ ok: false, error: msg });
    }
  });

  app.post('/chat', requireAuth, validate(chatBody), async (req, res) => {
    const body = req.body as { text?: string; sessionId?: string; imagePath?: string } | undefined;
    if (!body || typeof body.text !== 'string') {
      res.status(400).json({ error: 'Missing "text" in body' });
      return;
    }
    if (body.text.length > 10000) {
      res.status(413).json({ error: 'Input too long. Maximum 10000 characters.' });
      return;
    }
    try {
      // Support optional image via vision/image.ts
      let imageBlocks;
      if (body.imagePath) {
        if (!isUploadedImagePath(body.imagePath)) {
          res.status(400).json({ error: 'Invalid imagePath' });
          return;
        }
        const { processImage } = await import('../vision/image.js');
        try {
          const block = await processImage(body.imagePath);
          imageBlocks = [block];
        } catch { /* image processing failed, continue text-only */ }
      }
      const result = await runTurn({ text: body.text, sessionId: body.sessionId, imageBlocks });
      res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  app.post('/chat/stream', requireAuth, validate(chatBody), async (req, res) => {
    const body = req.body as { text?: string; sessionId?: string; imagePath?: string } | undefined;
    if (!body || typeof body.text !== 'string') {
      res.status(400).json({ error: 'Missing "text" in body' });
      return;
    }

    // SSE setup
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // disable proxy buffering
    res.flushHeaders?.();

    const writeEvent = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      let imageBlocks;
      if (body.imagePath) {
        if (!isUploadedImagePath(body.imagePath)) {
          writeEvent('error', { error: 'Invalid imagePath' });
          res.end();
          return;
        }
        const { processImage } = await import('../vision/image.js');
        try {
          const block = await processImage(body.imagePath);
          imageBlocks = [block];
        } catch { /* image processing failed, continue text-only */ }
      }
      const result = await runTurn(
        { text: body.text, sessionId: body.sessionId, imageBlocks },
        {
          onToken: (chunk) => writeEvent('token', { chunk }),
        },
      );
      writeEvent('done', result);
      res.end();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      writeEvent('error', { error: msg });
      res.end();
    }
  });

  app.post('/mod', requireAuth, validate(modBody), async (req, res) => {
    const name = (req.body as { name: string }).name;
    if (!modManager().isValidMod(name)) {
      res.status(400).json({ error: `Invalid mod. Available: ${modManager().listMods().join(', ')}` });
      return;
    }
    try {
      await modManager().switchMod(name);
      activateCharacter(name);
      updateConfig({ gender: name as Gender });
      res.json({ activeMod: modManager().activeMod });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  app.get('/mods/:name/soul', requireAuth, validateParams(modNameParam), (req, res) => {
    const { name } = req.params as { name: string };
    if (!modManager().isValidMod(name)) {
      res.status(404).json({ error: 'Mod not found' });
      return;
    }
    res.json({
      name,
      active: modManager().activeMod === name,
      soul: readFileSyncSafe(modSoulPath(name)),
    });
  });

  app.put('/mods/:name/soul', requireAuth, validateParams(modNameParam), validate(soulBody), async (req, res) => {
    const { name } = req.params as { name: string };
    const { soul } = req.body as { soul: string };
    if (!modManager().isValidMod(name)) {
      res.status(404).json({ error: 'Mod not found' });
      return;
    }

    try {
      writeFileSyncSafe(modSoulPath(name), soul);
      if (modManager().activeMod === name) {
        await modManager().refreshBankSoul();
        refreshPersonaGraph();
      }
      res.json({
        ok: true,
        name,
        active: modManager().activeMod === name,
        bytes: Buffer.byteLength(soul, 'utf-8'),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  // ─── Persona Studio ───

  app.post('/persona/generate', requireAuth, validate(personaBody), async (req, res) => {
    const body = req.body as PersonaRequest;
    try {
      const result = generatePersona(body);
      res.json({
        name: body.name,
        gender: body.gender,
        style: body.style,
        preview: result.preview,
        tokenEstimate: result.tokenEstimate,
        soul: result.soul,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  app.post('/persona/save', requireAuth, validate(personaBody), async (req, res) => {
    const body = req.body as PersonaRequest;
    try {
      const result = generatePersona(body);

      // Write to mods/<name>/soul.md
      const soulPath = modSoulPath(body.name);
      writeFileSyncSafe(soulPath, result.soul);
      logger.info('persona saved', { name: body.name, path: soulPath });

      // Activate the new mod
      try {
        await modManager().switchMod(body.name);
        activateCharacter(body.name);
        updateConfig({ gender: body.gender });
      } catch (switchErr) {
        // If switch fails, the file is still saved — just report warning
        logger.warn('persona saved but activation failed', { error: switchErr instanceof Error ? switchErr.message : String(switchErr) });
      }

      res.json({
        ok: true,
        name: body.name,
        gender: body.gender,
        path: soulPath,
        preview: result.preview,
        tokenEstimate: result.tokenEstimate,
        activated: true,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  // ─── Dual-Mode Persona ───

  app.get('/persona/mode', requireAuth, (_req, res) => {
    res.json({ mode: getCurrentMode() });
  });

  app.post('/persona/mode', requireAuth, validate(personaModeBody), async (req, res) => {
    const body = req.body as { mode: 'base' | 'deep' };
    try {
      const { executeSwitch } = await import('../persona/dual-mode.js');
      executeSwitch(body.mode);
      res.json({ mode: getCurrentMode(), switched: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  // ─── Admin (backup / export) ───
  app.get('/admin/backups', requireAuth, async (_req, res) => {
    try {
      const backups = listBackups();
      res.json({ backups });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  app.post('/admin/backup', requireAuth, async (_req, res) => {
    try {
      const path = await createBackup();
      logger.info('backup created', { path });
      res.json({ ok: true, path });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('backup failed', { error: msg });
      res.status(500).json({ error: msg });
    }
  });

  app.get('/admin/export', requireAuth, (_req, res) => {
    try {
      const text = exportMemory();
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="mio-export-${new Date().toISOString().slice(0, 10)}.txt"`);
      res.send(text);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  app.post('/admin/backups/prune', requireAuth, validate(backupPruneBody), (req, res) => {
    try {
      const body = req.body as { maxAgeDays?: number } | undefined;
      const days = body?.maxAgeDays ?? 7;
      const deleted = pruneBackups(days);
      res.json({ ok: true, deleted, maxAgeDays: days });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  app.get('/admin/log-level', (_req, res) => {
    res.json({ level: logger.level });
  });

  // ─── Analytics routes (READ-ONLY) ───

  // GET /analytics — full analytics snapshot
  app.get('/analytics', requireAuth, (_req, res) => {
    res.json(getAnalyticsSnapshot());
  });

  // GET /analytics/emotion — emotion trends (default 30 days)
  app.get('/analytics/emotion', requireAuth, validateQuery(analyticsQuery), (req, res) => {
    const days = (req.query as unknown as { days?: number }).days ?? 30;
    res.json(getEmotionTrends(days));
  });

  // GET /analytics/topics — topic heatmap
  app.get('/analytics/topics', requireAuth, (_req, res) => {
    res.json(getTopicHeatmap());
  });

  // GET /analytics/relationship — relationship timeline
  app.get('/analytics/relationship', requireAuth, (_req, res) => {
    res.json(getRelationshipTimeline());
  });

  // GET /analytics/conversation — conversation stats
  app.get('/analytics/conversation', requireAuth, (_req, res) => {
    res.json(getConversationStats());
  });

  // ─── Memory review ───

  app.get('/memories', requireAuth, validateQuery(memoryQuery), async (req, res) => {
    const { q, limit } = req.query as unknown as { q?: string; limit?: number };
    const items = listMemoryReviewItems().slice(0, limit ?? 100);
    const trimmed = q?.trim();
    const searchResults = trimmed
      ? (await searchHandler(trimmed, { maxResults: limit ?? 20 })).results
      : [];
    res.json({ items, searchResults });
  });

  app.patch('/memories/:id', requireAuth, validateParams(memoryIdParam), validate(memoryPatchBody), async (req, res) => {
    const { id } = req.params as { id: string };
    const item = await updateMemoryReviewItem(id, req.body);
    if (!item) {
      res.status(404).json({ error: 'Memory not found' });
      return;
    }
    res.json({ item });
  });

  app.delete('/memories/:id', requireAuth, validateParams(memoryIdParam), (req, res) => {
    const { id } = req.params as { id: string };
    const deleted = deleteMemoryReviewItem(id);
    if (!deleted) {
      res.status(404).json({ error: 'Memory not found' });
      return;
    }
    res.json({ ok: true, id });
  });

  // ─── Proactive preferences ───

  app.get('/proactive/preferences', requireAuth, (_req, res) => {
    res.json({ preferences: getSmartProactiveConfig() });
  });

  app.post('/proactive/preferences', requireAuth, validate(proactivePreferencesBody), (req, res) => {
    const preferences = updateSmartProactiveConfig(req.body);
    res.json({ preferences });
  });

  // ─── Conversation search ───

  // GET /search?q=xxx&session=xxx&role=user&limit=20
  // Query param `q` is required; returns SearchResponse JSON.
  app.get('/search', requireAuth, validateQuery(searchQuery), async (req, res) => {
    const { q, session, role, limit } = req.query as unknown as {
      q: string;
      session?: string;
      role?: 'user' | 'assistant';
      limit?: number;
    };

    res.json(
      await searchHandler(q, {
        sessionId: session,
        maxResults: limit,
        role,
      }),
    );
  });

  // ─── Notification channels ───

  // GET /notify/channels — list configured notification channels (no secrets)
  app.get('/notify/channels', requireAuth, (_req, res) => {
    const channels = getNotifyChannels();
    res.json({
      enabled: channels.some((channel) => channel.enabled),
      channels,
    });
  });

  // POST /notify/test — send a test message to all configured channels
  app.post('/notify/test', requireAuth, async (_req, res) => {
    const testMessage = 'Mio notification test — 这是一条测试消息。如果收到，说明通知渠道配置正确。';
    const results = await sendToAllChannels(testMessage);
    const allOk = results.length > 0 && results.every((r) => r.success);
    res.status(allOk ? 200 : 502).json({
      ok: allOk,
      results,
    });
  });

  // Individual channel test endpoints
  // POST /notify/test/telegram — test Telegram only
  app.post('/notify/test/telegram', requireAuth, async (_req, res) => {
    const result = await sendTelegramMessage('Mio Telegram test');
    res.status(result.success ? 200 : 502).json(result);
  });

  // POST /notify/test/whatsapp — test WhatsApp only
  app.post('/notify/test/whatsapp', requireAuth, async (_req, res) => {
    const result = await sendWhatsAppMessage('Mio WhatsApp test');
    res.status(result.success ? 200 : 502).json(result);
  });

  // POST /notify/test/discord — test Discord only
  app.post('/notify/test/discord', requireAuth, async (_req, res) => {
    const result = await sendDiscordMessage('Mio Discord test');
    res.status(result.success ? 200 : 502).json(result);
  });

  // POST /notify/test/slack — test Slack only
  app.post('/notify/test/slack', requireAuth, async (_req, res) => {
    const result = await sendSlackMessage('Mio Slack test');
    res.status(result.success ? 200 : 502).json(result);
  });

  // POST /notify/test/weclaw — test WeClaw only
  app.post('/notify/test/weclaw', requireAuth, async (_req, res) => {
    const result = await sendWeClawMessage('Mio WeClaw test', { allowEnvFallback: true });
    res.status(result.success ? 200 : 502).json(result);
  });

  // POST /notify/test/webhook — test Webhook only
  app.post('/notify/test/webhook', requireAuth, async (_req, res) => {
    const result = await sendWebhookMessage('Mio Webhook test');
    res.status(result.success ? 200 : 502).json(result);
  });

  // ─── Character management ───

  // POST /character/create — create custom character
  app.post('/character/create', requireAuth, validate(characterConfigSchema), async (req, res) => {
    try {
      const char = createCharacter(req.body);
      res.json({ success: true, data: char });
    } catch (err) {
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  // GET /characters — list all characters
  app.get('/characters', requireAuth, (_req, res) => {
    try {
      const chars = listCharacters();
      res.json({ success: true, data: chars });
    } catch (err) {
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  // POST /character/:name/activate — activate a character
  app.post('/character/:name/activate', requireAuth, validateParams(characterNameParam), async (req, res) => {
    try {
      const name = String(req.params.name);
      const char = activateCharacter(name);
      if (!char) return res.status(404).json({ success: false, error: 'Character not found' });
      await modManager().switchMod(name);
      updateConfig({ gender: char.config.gender as Gender });
      res.json({ success: true, data: { ...char, activeMod: modManager().activeMod } });
    } catch (err) {
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  // DELETE /character/:name — delete custom character
  app.delete('/character/:name', requireAuth, validateParams(characterNameParam), (req, res) => {
    const name = String(req.params.name);
    const result = deleteCharacter(name);
    res.status(result.success ? 200 : 400).json(result);
  });

  // GET /character/:name/life — character life journal
  app.get('/character/:name/life', requireAuth, validateParams(characterNameParam), (req, res) => {
    try {
      const name = String(req.params.name);
      const events = readRecentEvents(name, 50);
      const stats = memoryStreamStats(name);
      const pad = getPADState();
      res.json({
        success: true,
        data: {
          events,
          stats,
          pad: { pleasure: pad.pleasure, arousal: pad.arousal, dominance: pad.dominance },
        },
      });
    } catch (err) {
      res.status(500).json({ success: false, error: String(err) });
    }
  });

  // 404 + error handlers (must come last)
  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: err.message });
  });

  // ─── HTTP + WebSocket server ───

  const port = opts.port ?? getConfig().httpPort ?? 0;
  const host = opts.host ?? process.env.MIO_HTTP_HOST ?? '127.0.0.1';

  const server = createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws: WebSocket) => {
    let sessionId: string | undefined;
    let alive = true;
    let avatarSubscribed = false;

    // Heartbeat: respond to ping frames; if we miss 2 pongs, terminate the
    // dead connection. Pings happen on the protocol level (built-in ws);
    // we also send an app-level "ping" every 30s as a redundancy for proxies
    // that strip protocol-level frames.
    ws.on('pong', () => {
      alive = true;
    });
    const heartbeat = setInterval(() => {
      if (!alive) {
        // Previous ping got no pong — terminate the dead socket.
        try { ws.terminate(); } catch { /* ignore */ }
        return;
      }
      alive = false;
      try {
        ws.ping();
        // App-level heartbeat for visibility into the wire state.
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: 'ping', t: Date.now() }));
        }
      } catch {
        // ignore; terminate will be picked up by the next interval
      }
    }, 30_000);

    // Welcome message so the client knows the server is alive and what
    // protocol it speaks.
    safeSend(ws, { type: 'hello', protocol: 'mio.ws/1', sessionId: null });

    ws.on('message', async (raw) => {
      let payload: WsClientMessage;
      try {
        const parsed = JSON.parse(raw.toString());
        const result = wsClientMessageSchema.safeParse(parsed);
        if (!result.success) {
          safeSend(ws, {
            type: 'error',
            error: 'Invalid message',
            details: result.error.issues.map((i) => ({
              path: i.path.join('.'),
              message: i.message,
            })),
          });
          return;
        }
        payload = result.data as WsClientMessage;
      } catch {
        safeSend(ws, { type: 'error', error: 'Invalid JSON' });
        return;
      }

      switch (payload.type) {
        case 'pong':
          // Client acknowledging our app-level ping.
          alive = true;
          return;

        case 'switch_mod': {
          if (!modManager().isValidMod(payload.name)) {
            safeSend(ws, { type: 'error', error: 'Invalid mod name' });
            return;
          }
          try {
            await modManager().switchMod(payload.name);
            activateCharacter(payload.name);
            updateConfig({ gender: payload.name as Gender });
            safeSend(ws, { type: 'mod_switched', activeMod: modManager().activeMod });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            safeSend(ws, { type: 'error', error: msg });
          }
          return;
        }

        case 'chat': {
          if (typeof payload.text !== 'string') {
            safeSend(ws, { type: 'error', error: 'Missing text' });
            return;
          }
          sessionId = payload.sessionId ?? sessionId;
          try {
            const result = await runTurn(
              { text: payload.text, sessionId },
              {
                onToken: (chunk) => safeSend(ws, { type: 'token', chunk }),
              },
            );
            sessionId = result.sessionId;
            safeSend(ws, { type: 'done', ...result });

            // If the client subscribed to avatar updates, push the new state.
            if (avatarSubscribed) {
              const emotion = readEmotionState();
              const relationship = readRelationshipState();
              const avatar = buildAvatarState(emotion, relationship.stage);
              safeSend(ws, { type: 'emotion_changed', state: avatar });
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            safeSend(ws, { type: 'error', error: msg });
          }
          return;
        }

        case 'ping':
          // App-level ping from client.
          safeSend(ws, { type: 'pong', t: Date.now() });
          return;

        case 'subscribe_avatar':
          avatarSubscribed = true;
          // Immediately send current state so client can render right away.
          {
            const emotion = readEmotionState();
            const relationship = readRelationshipState();
            const avatar = buildAvatarState(emotion, relationship.stage);
            safeSend(ws, { type: 'avatar_state', state: avatar });
          }
          return;

        default:
          safeSend(ws, { type: 'error', error: `Unknown message type: ${(payload as { type?: string }).type}` });
      }
    });

    ws.on('close', () => {
      clearInterval(heartbeat);
    });
    ws.on('error', () => {
      clearInterval(heartbeat);
    });
  });

  // Upgrade HTTP → WS on /ws
  server.on('upgrade', (req: IncomingMessage, socket, head) => {
    const { pathname } = new URL(req.url ?? '/', `http://${req.headers.host}`);
    if (pathname === '/ws') {
      if (!validateWsAuth(req)) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
      });
    } else {
      socket.destroy();
    }
  });

  // Track the resolved port (needed when port: 0)
  const actualPort = await new Promise<number>((resolve) => {
    server.listen(port, host, () => {
      const addr = server.address();
      const p = typeof addr === 'object' && addr ? addr.port : port;
      logger.info(`[mio] server listening on http://${host}:${p}`);
      logger.info(`[mio]   auth: ${isAuthEnabled() ? 'enabled (Bearer token required)' : 'disabled (no auth)'}`);
      logger.info(`[mio]   GET  /health`);
      logger.info(`[mio]   GET  /status`);
      logger.info(`[mio]   GET  /v1/models       OpenAI-compatible model list`);
      logger.info(`[mio]   POST /v1/chat/completions OpenAI-compatible chat`);
      logger.info(`[mio]   GET  /onebot/v11/status OneBot bridge status`);
      logger.info(`[mio]   POST /onebot/v11/events OneBot event webhook`);
      logger.info(`[mio]   POST /chat         { text, sessionId? }`);
      logger.info(`[mio]   POST /chat/stream  (SSE)`);
      logger.info(`[mio]   POST /mod          { name: "male" | "female" }`);
      logger.info(`[mio]   WS   /ws            (full-duplex streaming)`);
      logger.info(`[mio]   GET  /analytics            full analytics snapshot`);
      logger.info(`[mio]   GET  /analytics/emotion    emotion trends (query: ?days=30)`);
      logger.info(`[mio]   GET  /analytics/topics     topic heatmap`);
      logger.info(`[mio]   GET  /analytics/relationship relationship timeline`);
      logger.info(`[mio]   GET  /analytics/conversation conversation stats`);
      logger.info(`[mio]   GET  /search?q=<query>&session=&role=&limit=  full-text transcript search`);
      logger.info(`[mio]   Notify:`);
      logger.info(`[mio]   GET  /notify/channels     list configured channels`);
      logger.info(`[mio]   POST /notify/test          send test message to all channels`);
      logger.info(`[mio]   POST /notify/test/telegram test Telegram channel`);
      logger.info(`[mio]   POST /notify/test/whatsapp  test WhatsApp channel`);
      logger.info(`[mio]   POST /notify/test/discord   test Discord channel`);
      logger.info(`[mio]   POST /notify/test/slack     test Slack channel`);
      logger.info(`[mio]   POST /notify/test/weclaw    test WeClaw channel`);
      logger.info(`[mio]   POST /notify/test/webhook   test Webhook channel`);
      logger.info(`[mio]   Admin:`);
      logger.info(`[mio]   GET  /admin/backups       list backups`);
      logger.info(`[mio]   POST /admin/backup        create backup`);
      logger.info(`[mio]   GET  /admin/export        export memory as text`);
      logger.info(`[mio]   POST /admin/backups/prune prune old backups`);
      resolve(p);
    });
  });

  return {
    port: actualPort,
    close: () =>
      new Promise<void>((resolve) => {
        wss.close();
        server.close(() => resolve());
      }),
  };
}
