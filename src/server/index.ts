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
 *   POST /mod                 switch persona (boyfriend | girlfriend)
 *
 * The server is intentionally thin: it owns HTTP plumbing, CORS, and
 * lifecycle. Business logic lives in src/core/agent-loop.ts.
 *
 * Auth: none in v0.1. Add a bearer-token middleware before exposing
 * this beyond localhost.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { URL } from 'node:url';
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
import { requireAuth, optionalAuth, validateWsAuth, isAuthEnabled } from './auth.js';
import { createRateLimiter } from './rate-limit.js';
import { createBackup, exportMemory, listBackups, pruneBackups } from '../utils/backup.js';
import { sendToAllChannels, isNotifyEnabled, getNotifyChannels, sendTelegramMessage, sendWebhookMessage, sendWhatsAppMessage, sendDiscordMessage, sendSlackMessage } from './notify.js';
import { logger } from '../utils/logger.js';
import {
  getAnalyticsSnapshot,
  getEmotionTrends,
  getTopicHeatmap,
  getRelationshipTimeline,
  getConversationStats,
} from './analytics.js';
import { searchHandler } from './search.js';
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
import { modSoulPath } from '../memory/paths.js';
import { writeFileSyncSafe } from '../memory/bank.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

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
  | { type: 'switch_mod'; name: 'boyfriend' | 'girlfriend' }
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

/**
 * Start the HTTP + WebSocket server. Resolves once the server is listening.
 *
 * @param opts  Port + host overrides.
 * @returns     A handle to the running server (port + close fn).
 */
export async function startServer(opts: ServerOptions = {}): Promise<RunningServer> {
  const app = express();
  app.use(express.json({ limit: '5mb' })); // vision base64 can be large

  // ─── Rate limiting (DoS protection) ───
  // Applied BEFORE auth middleware — we want to block abusive IPs before
  // spending CPU cycles on authentication. GET /health is exempt so liveness
  // probes always work under load.
  app.use(createRateLimiter());

  // ─── Static files ───
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const webDir = join(__dirname, '..', '..', 'web');
  app.use(express.static(webDir));

  // Redirect / → /index.html
  app.get('/', (_req, res) => {
    res.redirect('/index.html');
  });

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

  app.post('/onboarding/next', async (req, res) => {
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
    saveOnboardingState(updated as Parameters<typeof saveOnboardingState>[0]);

    // If step 5 was answered, we're done (the CLI version sends the first message;
    // the web UI will do it separately via POST /chat)
    if (body.step >= 5) {
      res.json({ step: 0, question: '', done: true, key: '' });
      return;
    }

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
    res.json({ ok: true, name: 'mio', version: '0.1.0' });
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

  app.post('/voice/synthesize', requireAuth, async (req, res) => {
    const body = req.body as { text?: string } | undefined;
    if (!body || typeof body.text !== 'string') {
      res.status(400).json({ error: 'Missing "text" in body' });
      return;
    }
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

  app.post('/chat', requireAuth, async (req, res) => {
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

  app.post('/chat/stream', requireAuth, async (req, res) => {
    const body = req.body as { text?: string; sessionId?: string } | undefined;
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
      const result = await runTurn(
        { text: body.text, sessionId: body.sessionId },
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

  app.post('/mod', requireAuth, async (req, res) => {
    const body = req.body as { name?: string } | undefined;
    if (!body || (body.name !== 'boyfriend' && body.name !== 'girlfriend')) {
      res.status(400).json({ error: 'Invalid "name". Use "boyfriend" or "girlfriend".' });
      return;
    }
    try {
      await modManager().switchMod(body.name);
      updateConfig({ gender: body.name as Gender });
      res.json({ activeMod: modManager().activeMod });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  // ─── Persona Studio ───

  app.post('/persona/generate', requireAuth, async (req, res) => {
    const body = req.body as PersonaRequest | undefined;
    if (!body || !body.name || !body.gender || !body.style) {
      res.status(400).json({ error: 'Missing required fields: "name", "gender", "style"' });
      return;
    }
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

  app.post('/persona/save', requireAuth, async (req, res) => {
    const body = req.body as PersonaRequest | undefined;
    if (!body || !body.name || !body.gender || !body.style) {
      res.status(400).json({ error: 'Missing required fields: "name", "gender", "style"' });
      return;
    }
    try {
      const result = generatePersona(body);

      // Write to mods/<name>/soul.md
      const soulPath = modSoulPath(body.name);
      writeFileSyncSafe(soulPath, result.soul);
      logger.info('persona saved', { name: body.name, path: soulPath });

      // Activate the new mod
      try {
        await modManager().switchMod(body.name);
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

  app.post('/persona/mode', requireAuth, async (req, res) => {
    const body = req.body as { mode?: string } | undefined;
    if (!body || (body.mode !== 'base' && body.mode !== 'deep')) {
      res.status(400).json({ error: 'Invalid "mode". Use "base" or "deep".' });
      return;
    }
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

  app.post('/admin/backups/prune', requireAuth, (req, res) => {
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
  app.get('/analytics/emotion', requireAuth, (req, res) => {
    const days = parseInt(req.query.days as string, 10) || 30;
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

  // ─── Conversation search ───

  // GET /search?q=xxx&session=xxx&role=user&limit=20
  // Query param `q` is required; returns SearchResponse JSON.
  app.get('/search', requireAuth, async (req, res) => {
    const q = req.query.q as string | undefined;
    if (!q || !q.trim()) {
      res.status(400).json({ error: 'Missing required query parameter "q"' });
      return;
    }
    const session = req.query.session as string | undefined;
    const role = req.query.role as string | undefined;
    const limit = parseInt(req.query.limit as string, 10) || undefined;

    if (role && role !== 'user' && role !== 'assistant') {
      res.status(400).json({ error: 'Invalid role. Use "user" or "assistant".' });
      return;
    }

    res.json(
      await searchHandler(q, {
        sessionId: session,
        maxResults: limit,
        role: role as 'user' | 'assistant' | undefined,
      }),
    );
  });

  // ─── Notification channels ───

  // GET /notify/channels — list configured notification channels (no secrets)
  app.get('/notify/channels', requireAuth, (_req, res) => {
    res.json({
      enabled: isNotifyEnabled(),
      channels: getNotifyChannels(),
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

  // POST /notify/test/webhook — test Webhook only
  app.post('/notify/test/webhook', requireAuth, async (_req, res) => {
    const result = await sendWebhookMessage('Mio Webhook test');
    res.status(result.success ? 200 : 502).json(result);
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
  const host = opts.host ?? '127.0.0.1';

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
        payload = JSON.parse(raw.toString()) as WsClientMessage;
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
          if (payload.name !== 'boyfriend' && payload.name !== 'girlfriend') {
            safeSend(ws, { type: 'error', error: 'Invalid mod name' });
            return;
          }
          try {
            await modManager().switchMod(payload.name);
            updateConfig({ gender: payload.name });
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
      logger.info(`[mio]   POST /chat         { text, sessionId? }`);
      logger.info(`[mio]   POST /chat/stream  (SSE)`);
      logger.info(`[mio]   POST /mod          { name: "boyfriend" | "girlfriend" }`);
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
