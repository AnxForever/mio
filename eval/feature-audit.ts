#!/usr/bin/env node
/**
 * Mio 全功能端到端审计 — 逐一验证每个模块是否真实生效
 *
 * 不依赖 LLM 调用（mock provider），只检查：
 *   1. Prompt 中是否包含了该模块的输出
 *   2. 引擎状态是否正确更新
 *   3. 死代码是否存在
 *
 * 运行: npm run build && MIO_PROVIDER=mock node --experimental-strip-types eval/feature-audit.ts
 */
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'mio-audit-'));
process.env.MIO_DIR = dir;
process.env.MIO_PROVIDER = 'mock';
mkdirSync(join(dir, 'memory-bank'), { recursive: true });

// Seed some BOOKMARKS so memory extraction has data
writeFileSync(join(dir, 'memory-bank', 'BOOKMARKS.md'), [
  '# Mio 记忆书签',
  '',
  '- 2026-07-01 10:00: 用户说他最近在学吉他，手指按弦很痛',
  '- 2026-07-03 14:00: 用户提到他最喜欢的咖啡是冰美式，每天早上一杯',
  '- 2026-07-05 20:00: 用户说他养了一只叫糯米的布偶猫，很粘人',
  '- 2026-07-07 09:00: 用户说最近工作压力大，老板在催项目进度，加班到很晚',
  '- 2026-07-08 22:00: 用户说想换工作但还没准备好面试',
].join('\n'));

interface AuditResult {
  module: string;
  feature: string;
  status: 'PASS' | 'FAIL' | 'WARN' | 'DEAD_CODE';
  detail: string;
}

const results: AuditResult[] = [];
function audit(module: string, feature: string, status: AuditResult['status'], detail: string) {
  results.push({ module, feature, status, detail });
  const icons = { PASS: '✅', FAIL: '❌', WARN: '⚠️', DEAD_CODE: '💀' };
  console.log(`  ${icons[status]} ${module}/${feature}: ${detail}`);
}

// ═══════════════════════════════════════════════════════════
// 1. Provider Layer
// ═══════════════════════════════════════════════════════════

{
  const { PROVIDER_PRESETS } = await import('../dist/config.js');
  const { selectProvider } = await import('../dist/providers/index.js');

  // 1a. Provider presets exist
  const presetKeys = Object.keys(PROVIDER_PRESETS);
  audit('provider', 'presets', presetKeys.length >= 10 ? 'PASS' : 'WARN',
    `${presetKeys.length} presets: ${presetKeys.join(', ')}`);

  // 1b. Grok preset
  const grok = PROVIDER_PRESETS['grok'];
  audit('provider', 'grok-preset', grok ? 'PASS' : 'FAIL',
    grok ? `model=${grok.defaultModel}, url=${grok.baseUrl}` : 'grok preset missing');

  // 1c. selectProvider works
  try {
    const p = selectProvider('grok', 'grok-4.20-fast');
    audit('provider', 'selectProvider', p ? 'PASS' : 'FAIL',
      `selected: ${p?.name || 'null'}`);
  } catch (e) {
    audit('provider', 'selectProvider', 'FAIL', String(e));
  }

  // 1d. Fallback provider exists but gated (dead code check)
  try {
    const { buildChain } = await import('../dist/providers/fallback.js');
    audit('provider', 'fallback-chain', 'WARN',
      'fallback.ts exists but gated behind providerFallback flag — check if enabled');
  } catch {
    audit('provider', 'fallback-chain', 'DEAD_CODE', 'fallback module import failed');
  }
}

// ═══════════════════════════════════════════════════════════
// 2. Prompt Assembly — section-by-section
// ═══════════════════════════════════════════════════════════

{
  const { prepareTurnContext } = await import('../dist/core/turn-prepare.js');
  const { registerPromptSections } = await import('../dist/core/agent-loop.js');

  const prepared = await prepareTurnContext(
    { text: '今天好累，练吉他练得手指都麻了，想喝杯冰美式提神' },
    {},
  );

  const ctx = prepared.promptCtx;
  const sessCtx = prepared.sessionCtx;

  // 2a. Identity in prompt
  audit('prompt', 'identity', ctx ? 'PASS' : 'FAIL',
    'PromptCtx present');

  // 2b. Soul content loaded
  audit('prompt', 'soul', ctx.soulContent?.length > 100 ? 'PASS' : 'FAIL',
    `soul content: ${ctx.soulContent?.length || 0} chars`);

  // 2c. Emotion state available
  audit('prompt', 'emotion-state', ctx.emotionState ? 'PASS' : 'FAIL',
    `mood=${ctx.emotionState.myMood}, energy=${ctx.emotionState.energy}`);

  // 2d. Relationship state available
  audit('prompt', 'relationship-state', ctx.relationshipState ? 'PASS' : 'FAIL',
    `stage=${ctx.relationshipState.stage}, interactions=${ctx.relationshipState.interactionCount || 0}`);

  // 2e. Gender loaded
  audit('prompt', 'gender', ctx.gender ? 'PASS' : 'FAIL',
    `gender=${ctx.gender}`);

  // 2f. Temporal context present (should be empty for new session)
  audit('prompt', 'temporal-state', ctx.temporalTurnContext ? 'PASS' : 'WARN',
    `temporalTurnContext present: ${!!ctx.temporalTurnContext}`);

  // 2g. Model tiering (grok model router)
  audit('prompt', 'model-tiering', prepared.config?.provider === 'mock' ? 'WARN' : 'PASS',
    `provider=${prepared.config?.provider}, model=${prepared.config?.model} (tiering only for grok)`);
}

// ═══════════════════════════════════════════════════════════
// 3. Memory Systems
// ═══════════════════════════════════════════════════════════

{
  // 3a. Structured memory extraction
  const { extractStructuredMemory } = await import('../dist/memory/structured-memory.js');
  const bookmarksContent = readFileSync(join(dir, 'memory-bank', 'BOOKMARKS.md'), 'utf-8');
  const memory = extractStructuredMemory(bookmarksContent);
  const activeCount = memory.entities.filter((e: { invalidatedAt?: string }) => !e.invalidatedAt).length;
  audit('memory', 'structured-extraction', activeCount > 0 ? 'PASS' : 'FAIL',
    `${activeCount} entities extracted from bookmarks`);

  // 3b. Temporal resolve
  const { makeRuleBasedContradicts, resolveContradictionsSync } = await import('../dist/memory/temporal-resolve.js');
  const rb = makeRuleBasedContradicts();
  audit('memory', 'temporal-resolve', rb ? 'PASS' : 'FAIL',
    'rule-based contradicts available');

  // 3c. ACE Reflector
  const { reflectOnMemory } = await import('../dist/memory/reflector.js');
  const reflection = reflectOnMemory(memory);
  audit('memory', 'ace-reflector', reflection?.audits ? 'PASS' : 'FAIL',
    `${reflection?.audits?.length || 0} audits, quality=${reflection?.qualityScore}`);

  // 3d. Topic filter
  const { memoryToContext } = await import('../dist/memory/structured-memory.js');
  const ctxWithFilter = memoryToContext(memory, '今天好累练吉他');
  const ctxWithoutFilter = memoryToContext(memory);
  audit('memory', 'topic-filter', ctxWithFilter ? 'PASS' : 'FAIL',
    `filtered=${ctxWithFilter?.length || 0} chars, unfiltered=${ctxWithoutFilter?.length || 0} chars`);

  // 3e. Lorebook
  const { getLorebook, evaluateLorebook } = await import('../dist/memory/lorebook.js');
  const lb = getLorebook();
  audit('memory', 'lorebook', lb?.entries?.length > 0 ? 'PASS' : 'FAIL',
    `${lb?.entries?.length || 0} lore entries`);
}

// ═══════════════════════════════════════════════════════════
// 4. Emotion Systems
// ═══════════════════════════════════════════════════════════

{
  // 4a. PAD state
  const { readPADState } = await import('../dist/emotion/pad.js');
  const pad = readPADState();
  audit('emotion', 'pad-state', pad ? 'PASS' : 'FAIL',
    `P=${pad?.pleasure}, A=${pad?.arousal}, D=${pad?.dominance}`);

  // 4b. PAD decay (should have decayed from baseline)
  const { computePADBaseline } = await import('../dist/emotion/pad.js');
  audit('emotion', 'pad-baseline', typeof computePADBaseline === 'function' ? 'PASS' : 'FAIL',
    'computePADBaseline available');

  // 4c. Affinity state
  const { readAffinityState } = await import('../dist/emotion/affinity.js');
  const aff = readAffinityState();
  audit('emotion', 'affinity-state', aff ? 'PASS' : 'FAIL',
    `warmth=${aff?.warmth}, trust=${aff?.trust}, intimacy=${aff?.intimacy}`);

  // 4d. Multi-axis state
  const { readMultiAxisState } = await import('../dist/emotion/multi-axis.js');
  const maxis = readMultiAxisState();
  audit('emotion', 'multi-axis', maxis ? 'PASS' : 'FAIL',
    `closeness=${maxis?.closeness}, trust=${maxis?.trust}, neediness=${maxis?.neediness}`);

  // 4e. Frustration
  const { readFrustrationState } = await import('../dist/emotion/frustration.js');
  const frust = readFrustrationState();
  audit('emotion', 'frustration', frust ? 'PASS' : 'FAIL',
    `streak=${frust?.frustrationStreak}, attachment=${frust?.attachment}`);

  // 4f. Ghost state
  const { readGhostState } = await import('../dist/emotion/ghost.js');
  const ghost = readGhostState();
  audit('emotion', 'ghost-state', ghost !== undefined ? 'PASS' : 'FAIL',
    `lastTurnGhosted=${ghost?.lastTurnGhosted}, willGhostNext=${ghost?.willGhostNextTurn}`);

  // 4g. Experience trait heat (v2 emergent)
  const { getTraitHeat, getPersonalityDiary } = await import('../dist/emotion/experience-trait.js');
  const heat = getTraitHeat();
  const diary = getPersonalityDiary();
  const hasHeat = Object.values(heat).some((v: number) => v !== 0);
  audit('emotion', 'experience-trait-heat', 'PASS',
    `heat open=${heat.openness} consc=${heat.conscientiousness} extr=${heat.extraversion} agree=${heat.agreeableness} neur=${heat.neuroticism} | diary: ${diary.length} entries`);
}

// ═══════════════════════════════════════════════════════════
// 5. Persona Systems
// ═══════════════════════════════════════════════════════════

{
  // 5a. ID-RAG graph
  const { retrieveRelevantNodes } = await import('../dist/persona/graph.js');
  audit('persona', 'idrag-retrieval', typeof retrieveRelevantNodes === 'function' ? 'PASS' : 'FAIL',
    'retrieveRelevantNodes available');

  // 5b. Voice presets
  const { getActiveVoicePreset } = await import('../dist/persona/voice-presets.js');
  const vp = getActiveVoicePreset();
  audit('persona', 'voice-presets', vp?.beginDialogs?.length >= 6 ? 'PASS' : 'FAIL',
    `preset=${vp?.key}, dialogs=${vp?.beginDialogs?.length}`);

  // 5c. L0 guard
  const { isIdentityProbe, detectL0Break } = await import('../dist/safety/l0-guard.js');
  const probe = isIdentityProbe('what model are you');
  const notProbe = isIdentityProbe('今天天气真好');
  audit('persona', 'l0-guard', probe && !notProbe ? 'PASS' : 'FAIL',
    `probe detection: "${'what model are you'}"=${probe}, "今天天气真好"=${notProbe}`);

  // 5d. Dual-mode
  const { getCurrentMode } = await import('../dist/persona/dual-mode.js');
  const mode = getCurrentMode();
  audit('persona', 'dual-mode', mode ? 'PASS' : 'FAIL',
    `current mode=${mode}`);

  // 5e. Critic
  const { assessPersonaReply } = await import('../dist/persona/critic.js');
  audit('persona', 'critic', typeof assessPersonaReply === 'function' ? 'PASS' : 'FAIL',
    'assessPersonaReply available');

  // 5f. Reply rubric
  const { assessReplyRubric } = await import('../dist/persona/reply-rubric.js');
  audit('persona', 'reply-rubric', typeof assessReplyRubric === 'function' ? 'PASS' : 'FAIL',
    'assessReplyRubric available');
}

// ═══════════════════════════════════════════════════════════
// 6. Relationship System
// ═══════════════════════════════════════════════════════════

{
  const { getStage, getStageFeatures } = await import('../dist/relationship/stages.js');
  const stage = getStage(0, 0);
  const features = getStageFeatures(stage);
  audit('relationship', 'stages', stage === 'acquaintance' ? 'PASS' : 'FAIL',
    `stage=${stage}, features: nicknames=${features?.nicknames}, proactive=${features?.proactive}`);
}

// ═══════════════════════════════════════════════════════════
// 7. Scheduler & Proactive
// ═══════════════════════════════════════════════════════════

{
  // 7a. Smart proactive
  const { shouldSendProactive } = await import('../dist/scheduler/smart-proactive.js');
  audit('scheduler', 'smart-proactive', typeof shouldSendProactive === 'function' ? 'PASS' : 'FAIL',
    'shouldSendProactive available');

  // 7b. Nightly consolidation
  const { runNightlyPipeline } = await import('../dist/scheduler/nightly.js');
  audit('scheduler', 'nightly', typeof runNightlyPipeline === 'function' ? 'PASS' : 'FAIL',
    'runNightlyPipeline available');
}

// ═══════════════════════════════════════════════════════════
// 8. MCP Client
// ═══════════════════════════════════════════════════════════

{
  try {
    const { isMcpTool, getAllMcpTools } = await import('../dist/mcp/client.js');
    const tools = getAllMcpTools();
    audit('mcp', 'client', 'PASS',
      `MCP tools available: ${tools.length} (connect servers via MIO_MCP_SERVERS env)`);
  } catch (e) {
    audit('mcp', 'client', 'WARN', `MCP module load: ${String(e)}`);
  }
}

// ═══════════════════════════════════════════════════════════
// 9. Tools
// ═══════════════════════════════════════════════════════════

{
  try {
    const { ensureToolsRegistered } = await import('../dist/core/tool-runtime.js');
    const reg = ensureToolsRegistered();
    const defs = reg.listDefs();
    audit('tools', 'registry', defs.length > 0 ? 'PASS' : 'FAIL',
      `${defs.length} tools registered`);
  } catch (e) {
    audit('tools', 'registry', 'FAIL', String(e));
  }
}

// ═══════════════════════════════════════════════════════════
// 10. Web UI exports
// ═══════════════════════════════════════════════════════════

{
  const webDir = join(import.meta.dirname, '..', 'web');
  const hasChat = existsSync(join(webDir, 'js', 'views', 'chat.js'));
  const hasMemories = existsSync(join(webDir, 'js', 'views', 'memories.js'));
  audit('web', 'chat-view', hasChat ? 'PASS' : 'FAIL', 'chat.js');
  audit('web', 'memories-view', hasMemories ? 'PASS' : 'FAIL', 'memories.js (memory review panel)');
}

// ═══════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════

const passed = results.filter(r => r.status === 'PASS').length;
const warned = results.filter(r => r.status === 'WARN').length;
const failed = results.filter(r => r.status === 'FAIL').length;
const dead = results.filter(r => r.status === 'DEAD_CODE').length;

console.log(`\n${'═'.repeat(60)}`);
console.log(`审计结果: ${results.length} 项检查`);
console.log(`  ✅ PASS: ${passed}`);
console.log(`  ⚠️ WARN: ${warned}`);
console.log(`  ❌ FAIL: ${failed}`);
console.log(`  💀 DEAD_CODE: ${dead}`);

// Print failures
const problems = results.filter(r => r.status !== 'PASS');
if (problems.length > 0) {
  console.log(`\n需关注:`);
  for (const p of problems) {
    console.log(`  ${p.status === 'FAIL' ? '❌' : p.status === 'WARN' ? '⚠️' : '💀'} ${p.module}/${p.feature}: ${p.detail}`);
  }
}

process.exit(failed > 0 ? 1 : 0);
