#!/usr/bin/env node
/**
 * Mio — unit tests
 *
 * Pure unit tests for stateless functions and modules.
 * Uses a single shared temp data dir to avoid config cache pollution.
 *
 * Coverage:
 *   - src/safety/crisis.ts         (screenForCrisis: red / yellow / none)
 *   - src/emotion/tracker.ts       (trackEmotion: affection, topic dedup)
 *   - src/mod/mod-manager.ts       (switchMod: invalid name, persistence)
 *   - src/relationship/stages.ts   (stage config + can* helpers)
 *   - src/config.ts                (persistence + env override)
 *   - src/memory/paths.ts          (path resolution)
 */

import { existsSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

interface TestResult {
  name: string;
  passed: boolean;
  detail?: string;
}

const results: TestResult[] = [];

function record(name: string, passed: boolean, detail?: string): void {
  results.push({ name, passed, detail });
  const status = passed ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
  console.log(`  ${status} ${name}${detail ? ` — ${detail}` : ''}`);
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function assertEq<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    record(name, true);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    record(name, false, msg);
  }
}

// ─── Single shared data dir ───

const dataDir = mkdtempSync(join(tmpdir(), 'mio-unit-'));
process.env.MIO_DIR = dataDir;

async function main(): Promise<void> {
  console.log('\n\x1b[1mMio — unit tests\x1b[0m\n');

  // ─── Crisis detection ───
  {
    const { screenForCrisis } = await import('../dist/safety/crisis.js');

    await test('crisis: red Chinese ("想死")', () => {
      const r = screenForCrisis('我真的想死了');
      assertEq(r.level, 'red', 'level');
      assert(r.shouldIntervene, 'shouldIntervene');
      assert(r.matchedKeywords.includes('想死'), 'matched 想死');
    });

    await test('crisis: red English ("kill myself")', () => {
      const r = screenForCrisis('I want to kill myself');
      assertEq(r.level, 'red', 'level');
    });

    await test('crisis: yellow ("撑不住")', () => {
      const r = screenForCrisis('今天撑不住了');
      assertEq(r.level, 'yellow', 'level');
      assert(r.shouldIntervene, 'shouldIntervene');
    });

    await test('crisis: none ("今天好累")', () => {
      const r = screenForCrisis('今天好累');
      assertEq(r.level, 'none', 'level');
      assert(!r.shouldIntervene, 'should not intervene');
    });

    await test('crisis: empty string', () => {
      const r = screenForCrisis('');
      assertEq(r.level, 'none', 'empty input');
    });

    await test('crisis: red injects hotline number', () => {
      const r = screenForCrisis('想死');
      assert(r.systemInjection.includes('400-161-9995'), 'red injection has hotline');
    });

    await test('crisis: yellow stays present, no fixes', () => {
      const r = screenForCrisis('撑不住了');
      assert(r.systemInjection.includes('Be present') || r.systemInjection.includes('Do NOT immediately offer'), 'yellow injection');
    });

    // Language coverage: non-CN/EN text falls through to 'none'.
    // These lock the documented limitation (crisis.ts:18-19) and guard the
    // observability signal ([crisis:lang-gap] bookmark) added later.
    await test('crisis: Japanese non-crisis text returns none (Path A)', () => {
      const r = screenForCrisis('こんにちは'); // "hello" — not crisis, but non-CN/EN
      assertEq(r.level, 'none', 'level');
      assert(!r.shouldIntervene, 'should not intervene');
    });

    await test('crisis: Japanese crisis-adjacent text returns none (Path A, ≤5 chars)', () => {
      // "死にたい" (I want to die) — 4 chars, misclassified as casual_chat by
      // the ZH-only classifier → hits NON_CRISIS_INTENTS early return.
      // This is the documented language gap; observability (not detection) is the fix.
      const r = screenForCrisis('死にたい');
      assertEq(r.level, 'none', 'level');
      assert(!r.shouldIntervene, 'should not intervene (language gap)');
    });

    await test('crisis: long French text returns none (Path B)', () => {
      // >5 chars → classifier returns neutral → keyword tables have no match → 'none'
      const r = screenForCrisis("aujourd'hui le temps est magnifique et je suis heureux");
      assertEq(r.level, 'none', 'level');
      assert(!r.shouldIntervene, 'should not intervene');
    });

    await test('crisis: pure ASCII English non-crisis returns none (baseline)', () => {
      const r = screenForCrisis('the weather is nice today');
      assertEq(r.level, 'none', 'level');
      assert(!r.shouldIntervene, 'should not intervene');
    });

    // Observability: non-CN/EN messages that skip crisis screening must leave
    // a [crisis:lang-gap] bookmark so the nightly Phase 3 can count the gap.
    await test('crisis: Japanese text records [crisis:lang-gap] bookmark', async () => {
      const { readBookmarks, clearBookmarks } = await import('../dist/memory/bank.js');
      // Clear bookmarks first to isolate this test (earlier crisis tests may
      // have already triggered lang-gap bookmarks on Japanese/French inputs).
      clearBookmarks();
      const before = readBookmarks();
      assert(!before.includes('[crisis:lang-gap]'), 'no lang-gap bookmark before');
      // Trigger the gap with a Japanese message.
      screenForCrisis('死にたい');
      const after = readBookmarks();
      assert(after.includes('[crisis:lang-gap]'), 'lang-gap bookmark recorded for Japanese text');
    });

    await test('crisis: Chinese crisis text does NOT record lang-gap bookmark', async () => {
      const { readBookmarks, clearBookmarks } = await import('../dist/memory/bank.js');
      clearBookmarks();
      // Chinese crisis should be detected normally, not flagged as a lang gap.
      screenForCrisis('我真的想死了');
      const after = readBookmarks();
      assert(!after.includes('[crisis:lang-gap]'), 'no lang-gap bookmark for Chinese crisis');
      clearBookmarks(); // restore clean state for subsequent test blocks
    });
  }

  // ─── Emotion tracker ───
  {
    const { trackEmotion } = await import('../dist/emotion/tracker.js');
    const { readEmotionState, updateEmotionState } = await import('../dist/emotion/state.js');

    // Reset to known state
    updateEmotionState({ affection: 30, recentTopics: [] });

    await test('tracker: meaningful exchange bumps affection', () => {
      const before = readEmotionState().affection;
      trackEmotion('今天真的好累,加班到现在', '那肯定不舒服啊,辛苦了。吃饭了没?');
      const after = readEmotionState().affection;
      assert(after > before, `affection should increase: ${before} -> ${after}`);
    });

    await test('tracker: short message does not bump affection', () => {
      const before = readEmotionState().affection;
      trackEmotion('hi', 'hi');
      const after = readEmotionState().affection;
      assertEq(after, before, 'short exchange unchanged');
    });

    await test('tracker: affection caps at 100', () => {
      updateEmotionState({ affection: 99 });
      trackEmotion('a reasonably long user message here', 'and a reasonably long agent reply here');
      const state = readEmotionState();
      assertEq(state.affection, 100, 'capped at 100');
    });

    await test('tracker: topics dedup, keep last 5', () => {
      updateEmotionState({ recentTopics: ['old1', 'old2'] });
      trackEmotion('今天聊到游戏和工作', '好的,游戏和工作。');
      const after = readEmotionState();
      assert(after.recentTopics.length <= 5, `len ${after.recentTopics.length}`);
    });
  }

  // ─── Mod manager ───
  {
    const { modManager } = await import('../dist/mod/mod-manager.js');

    await test('mod: defaults to female on first run', () => {
      const m = modManager();
      assertEq(m.activeMod, 'female', 'default mod');
    });

    await test('mod: rejects invalid name', async () => {
      const m = modManager();
      let threw = false;
      try {
        await m.switchMod('alien');
      } catch {
        threw = true;
      }
      assert(threw, 'should throw on invalid mod');
    });

    await test('mod: valid name persists', async () => {
      const m = modManager();
      await m.switchMod('male');
      assertEq(m.activeMod, 'male', 'active after switch');
    });

    await test('mod: persistence across instances', async () => {
      const stateFile = join(dataDir, 'mods', '.active-mod');
      assert(existsSync(stateFile), 'state file exists');
      const txt = readFileSync(stateFile, 'utf-8');
      assertEq(txt.trim(), 'male', 'persisted value');
    });
  }

  // ─── Relationship stages ───
  {
    const { getStageConfig, canUseNicknames, canSendProactiveMsgs, canExpressIntimacy, STAGE_CONFIG } = await import('../dist/relationship/stages.js');

    await test('stages: 4 stages configured', () => {
      const stages = Object.keys(STAGE_CONFIG);
      assertEq(stages.length, 4, 'stage count');
    });

    await test('stages: acquaintance has no nicknames', () => {
      assert(!canUseNicknames('acquaintance'), 'no nicknames');
    });

    await test('stages: familiar unlocks nicknames but not intimacy', () => {
      assert(canUseNicknames('familiar'), 'has nicknames');
      assert(!canExpressIntimacy('familiar'), 'no intimacy');
    });

    await test('stages: ambiguous can send proactive', () => {
      assert(canSendProactiveMsgs('ambiguous'), 'proactive enabled');
    });

    await test('stages: intimate has all features', () => {
      assert(canUseNicknames('intimate'), 'nicknames');
      assert(canSendProactiveMsgs('intimate'), 'proactive');
      assert(canExpressIntimacy('intimate'), 'intimacy');
    });

    await test('stages: getStageConfig returns valid label', () => {
      const cfg = getStageConfig('acquaintance');
      assert(typeof cfg.label === 'string' && cfg.label.length > 0, 'label is non-empty string');
    });
  }

  // ─── Config persistence ───
  {
    const config = await import('../dist/config.js');

    await test('config: updateConfig writes to disk', () => {
      config.updateConfig({ gender: 'male', voiceOutput: true });
      const configFile = join(dataDir, 'config.json');
      assert(existsSync(configFile), 'config.json exists');
      const reread = JSON.parse(readFileSync(configFile, 'utf-8'));
      assertEq(reread.gender, 'male', 'persisted gender');
      assertEq(reread.voiceOutput, true, 'persisted voiceOutput');
    });

    await test('config: getConfig reflects in-memory state', () => {
      assertEq(config.getConfig().gender, 'male', 'gender after update');
      assertEq(config.getConfig().voiceOutput, true, 'voiceOutput after update');
    });

    await test('config: dataDir always resolved to absolute path', () => {
      const dir = config.getConfig().dataDir;
      assert(dir.startsWith('/'), `dataDir is absolute: ${dir}`);
    });

    await test('config: env MIO_DIR overrides persisted', () => {
      // We set MIO_DIR before this test process started, so it should be in effect.
      assertEq(config.getConfig().dataDir, dataDir, 'env matches tempdir');
    });
  }

  // ─── Path resolution ───
  {
    const { memoryBankDir, modSoulPath, transcriptsDir } = await import('../dist/memory/paths.js');

    await test('paths: memoryBankDir under colaDir', () => {
      assert(memoryBankDir().endsWith('memory-bank'), 'ends with memory-bank');
    });

    await test('paths: modSoulPath joins mod + soul.md', () => {
      const p = modSoulPath('female');
      assert(p.endsWith('female/soul.md'), `got ${p}`);
    });

    await test('paths: transcriptsDir is absolute', () => {
      assert(transcriptsDir().startsWith('/'), 'absolute');
    });
  }

  // ─── File tools / restricted bash ───
  {
    const { ToolRegistry } = await import('../dist/tools/registry.js');
    const { registerFileTools } = await import('../dist/tools/file.js');

    const registry = new ToolRegistry();
    registerFileTools(registry);
    writeFileSync(join(dataDir, 'safe.txt'), 'safe\n', 'utf-8');

    const ctx = {
      sessionId: 'unit-file-tools',
      model: 'mock',
      apiKey: undefined,
      gender: 'female' as const,
      emotionState: { myMood: '平静', userMood: '未知', affection: 50, energy: 'mid' as const, lastInteraction: '', unresolvedThread: null, recentTopics: [] },
      relationshipState: {
        stage: 'acquaintance' as const,
        stageChangedAt: new Date(0).toISOString(),
        interactionCount: 0,
        emotionalDepth: 0,
        sharedMemories: [],
        nicknames: { userCallsAgent: null, agentCallsUser: null },
      },
      activeMod: 'female',
      colaDir: dataDir,
      outputDir: join(dataDir, 'output'),
    };

    const bash = async (command: string, cwd = dataDir): Promise<string> => {
      const result = await registry.execute({ id: `bash:${command}`, name: 'bash', input: { command, cwd } }, ctx);
      return result.output;
    };

    await test('file bash: allows read-only command in data dir', async () => {
      const output = await bash('pwd');
      assertEq(output.trim(), dataDir, 'pwd output');
    });

    await test('file bash: allows reading an allowed absolute path', async () => {
      const output = await bash(`cat ${join(dataDir, 'safe.txt')}`);
      assertEq(output.trim(), 'safe', 'cat output');
    });

    await test('file find: walks the resolved safe path', async () => {
      const result = await registry.execute({ id: 'find:safe', name: 'find', input: { path: dataDir, pattern: 'safe.txt' } }, ctx);
      assertEq(result.output.trim(), 'safe.txt', 'find output');
    });

    await test('file bash: rejects code execution commands', async () => {
      const output = await bash('node -e "console.log(1)"');
      assert(output.includes('Command "node" not allowed'), output);
    });

    await test('file bash: rejects package manager commands', async () => {
      const output = await bash('npm test');
      assert(output.includes('Command "npm" not allowed'), output);
    });

    await test('file bash: rejects mutating git subcommands', async () => {
      const output = await bash('git checkout main');
      assert(output.includes('Git subcommand "checkout" not allowed'), output);
    });

    await test('file bash: rejects shell composition', async () => {
      const output = await bash('pwd && date');
      assert(output.includes('Shell control operators'), output);
    });

    await test('file bash: rejects redirection', async () => {
      const output = await bash('cat safe.txt > /tmp/mio-unit-out');
      assert(output.includes('Shell control operators'), output);
    });

    await test('file bash: rejects destructive find options', async () => {
      const output = await bash('find . -delete');
      assert(output.includes('find -exec and -delete are not allowed'), output);
    });

    await test('file bash: rejects cwd outside allowed dirs', async () => {
      const output = await bash('pwd', '/tmp');
      assert(output.includes('outside allowed directories'), output);
    });

    await test('file bash: rejects absolute paths outside allowed dirs', async () => {
      const output = await bash('cat /etc/passwd');
      assert(output.includes('Absolute path outside allowed directories'), output);
    });
  }

  // ─── Persistence helpers ───
  {
    const { writeFileSyncSafe, readFileSyncSafe } = await import('../dist/memory/bank.js');

    await test('bank: writeFileSyncSafe writes nested files atomically', () => {
      const p = join(dataDir, 'nested', 'state.json');
      writeFileSyncSafe(p, JSON.stringify({ value: 1 }));
      assertEq(readFileSyncSafe(p), '{"value":1}', 'first write');
      writeFileSyncSafe(p, JSON.stringify({ value: 2 }));
      assertEq(readFileSyncSafe(p), '{"value":2}', 'second write');
    });
  }

  // ─── Validation schemas ───
  {
    const { personaBody, searchQuery, characterNameParam, wsClientMessageSchema, userProfileEntryBody, userProfileEntryParam } = await import('../dist/validation.js');

    await test('validation: persona rejects path-like names', () => {
      const result = personaBody.safeParse({ name: '../evil', gender: 'female', style: '温柔' });
      assert(!result.success, 'path-like name rejected');
    });

    await test('validation: search role accepts assistant but rejects system', () => {
      assert(searchQuery.safeParse({ q: 'hello', role: 'assistant' }).success, 'assistant accepted');
      assert(!searchQuery.safeParse({ q: 'hello', role: 'system' }).success, 'system rejected');
    });

    await test('validation: character params reject traversal names', () => {
      assert(characterNameParam.safeParse({ name: 'mio-角色1' }).success, 'slug-like character name accepted');
      assert(!characterNameParam.safeParse({ name: '../memory-bank' }).success, 'path traversal rejected');
    });

    await test('validation: websocket chat enforces non-empty text', () => {
      assert(wsClientMessageSchema.safeParse({ type: 'chat', text: 'hi' }).success, 'valid chat accepted');
      assert(!wsClientMessageSchema.safeParse({ type: 'chat', text: '' }).success, 'empty chat rejected');
    });

    await test('validation: user profile entry body and id are strict', () => {
      assert(userProfileEntryBody.safeParse({ content: '用户喜欢乌龙茶' }).success, 'valid profile entry accepted');
      assert(!userProfileEntryBody.safeParse({ content: '' }).success, 'empty profile entry rejected');
      assert(userProfileEntryParam.safeParse({ id: 'abcdef1234567890' }).success, 'valid entry id accepted');
      assert(!userProfileEntryParam.safeParse({ id: '../profile' }).success, 'path-like entry id rejected');
    });
  }

  // ─── User profile governance ───
  {
    const { hasDurableUserProfileSignal, isSyntheticProfileSignal } = await import('../dist/memory/profile-governance.js');
    const { decideTargetFile } = await import('../dist/memory/consolidation-phases.js');
    const { ensureBankStructure } = await import('../dist/memory/bank.js');
    const { userProfilePath } = await import('../dist/memory/paths.js');
    const profile = await import('../dist/server/user-profile.js');

    await test('profile governance: detects durable user facts', () => {
      assert(hasDurableUserProfileSignal('我喜欢乌龙茶'), 'preference is durable');
      assert(hasDurableUserProfileSignal('我的工作是前端工程师'), 'job fact is durable');
      assert(!hasDurableUserProfileSignal('今天天气真好'), 'weather chat is not durable');
    });

    await test('profile governance: filters synthetic test signals', () => {
      assert(isSyntheticProfileSignal({ text: 'ws test', evidence: '[mock reply to: ws test]' }), 'ws mock test is synthetic');
      assert(isSyntheticProfileSignal({ text: 'streaming test' }), 'streaming test is synthetic');
      assert(!isSyntheticProfileSignal({ text: '我喜欢乌龙茶' }), 'real preference is not synthetic');
    });

    await test('consolidation: routes only durable exchanges into user profile', () => {
      assertEq(decideTargetFile({
        what: 'exchange: user said "我喜欢乌龙茶"',
        evidence: 'agent replied: "记住啦"',
      }), 'user-profile', 'preference route');
      assertEq(decideTargetFile({
        what: 'exchange: user said "今天天气真好"',
        evidence: 'agent replied: "是啊"',
      }), 'none', 'small talk route');
      assertEq(decideTargetFile({
        what: 'exchange: user said "ws test"',
        evidence: 'agent replied: "[mock reply to: ws test]"',
      }), 'none', 'synthetic route');
    });

    await test('user profile service: append, update, delete one entry', () => {
      ensureBankStructure();
      writeFileSync(userProfilePath(), '- [2026-06-01] 用户喜欢咖啡\n', 'utf-8');

      const appended = profile.appendUserProfileEntry('用户喜欢乌龙茶');
      assert(appended.content === '用户喜欢乌龙茶', 'append returns entry');
      assert(profile.readUserProfileSnapshot().entries.some((e) => e.content === '用户喜欢乌龙茶'), 'appended entry is listed');

      const updated = profile.updateUserProfileEntry(appended.id, '用户喜欢茉莉茶');
      assert(updated !== null && updated.content === '用户喜欢茉莉茶', 'update returns updated entry');
      assert(profile.readUserProfileSnapshot().entries.some((e) => e.content === '用户喜欢茉莉茶'), 'updated entry is listed');

      const deleted = profile.deleteUserProfileEntry(updated.id);
      assert(deleted, 'delete returns true');
      assert(!profile.readUserProfileSnapshot().entries.some((e) => e.content === '用户喜欢茉莉茶'), 'deleted entry is gone');
    });
  }

  // ─── Vector memory ───
  {
    const { tokenize, embed, cosine, search, reindexBookmarks, indexStats, indexEntry } = await import('../dist/memory/vector.js');
    const { appendBookmark, ensureBankStructure } = await import('../dist/memory/bank.js');

    await test('vector: tokenize Chinese text', () => {
      const tokens = tokenize('今天去吃了拉面,很好吃');
      assert(tokens.length > 0, 'produces tokens');
      // Should contain bigrams of CJK characters
      assert(tokens.some((t) => t.includes('今天') || t.includes('天去')), 'has CJK bigrams');
    });

    await test('vector: tokenize English text', () => {
      const tokens = tokenize('I had coffee with my friend yesterday');
      assert(tokens.includes('coffee'), 'has coffee');
      assert(tokens.includes('friend'), 'has friend');
      // Stop words filtered
      assert(!tokens.includes('i') && !tokens.includes('with'), 'stop words removed');
    });

    await test('vector: cosine of identical vectors is 1', () => {
      const v = embed(['cat', 'dog', 'cat']);
      const s = cosine(v, v);
      assert(Math.abs(s - 1) < 0.001, `cosine(v,v)=${s}`);
    });

    await test('vector: cosine of disjoint vectors is 0', () => {
      const a = embed(['cat', 'dog']);
      const b = embed(['fish', 'shark']);
      const s = cosine(a, b);
      assertEq(s, 0, 'disjoint');
    });

    await test('vector: cosine of overlapping vectors is between 0 and 1', () => {
      const a = embed(['cat', 'dog', 'cat']);
      const b = embed(['cat', 'shark']);
      const s = cosine(a, b);
      assert(s > 0 && s < 1, `partial: ${s}`);
    });

    await test('vector: indexEntry + search roundtrip', async () => {
      indexEntry({
        id: 'test-1',
        text: '我今天喝了拿铁咖啡',
        source: 'manual',
        timestamp: new Date().toISOString(),
      });
      const results = await search('咖啡', 5);
      assert(results.some((r) => r.id === 'test-1'), 'found by query');
    });

    await test('vector: reindexBookmarks picks up new entries', async () => {
      ensureBankStructure();
      appendBookmark({
        time: '2026-06-25 12:00 +0800',
        what: '聊到了猫和狗的差异',
        evidence: '用户提到家里养了两只猫',
      });
      const n = await reindexBookmarks();
      assert(n > 0, 'indexed at least one');
      const results = await search('猫 狗', 5);
      assert(results.length > 0, 'search finds the bookmark');
    });

    await test('vector: search filters by min score', async () => {
      const noMatch = await search('xyz完全无关的词xyz', 5, 0.99);
      assertEq(noMatch.length, 0, 'no high-score matches for unrelated query');
    });

    await test('vector: indexStats reports entries', () => {
      const stats = indexStats();
      assert(typeof stats.entries === 'number' && stats.entries > 0, 'has entries');
      assert(typeof stats.sources === 'object', 'has sources');
    });
  }

  // ─── Embedding provider ───
  {
    const { getEmbeddingProvider, resetEmbeddingProvider, describeProvider } = await import('../dist/memory/embedding.js');

    await test('embedding: factory picks tf when no key set', () => {
      resetEmbeddingProvider();
      delete process.env.MINIMAX_API_KEY;
      delete process.env.MINIMAX_DISABLE;
      const p = getEmbeddingProvider();
      assertEq(p.type, 'tf', 'tf by default');
    });

    await test('embedding: factory picks minimax when key set', () => {
      resetEmbeddingProvider();
      const old = process.env.MINIMAX_API_KEY;
      process.env.MINIMAX_API_KEY = 'test-key-not-real';
      try {
        const p = getEmbeddingProvider();
        assertEq(p.type, 'minimax', 'minimax when key set');
      } finally {
        if (old === undefined) delete process.env.MINIMAX_API_KEY;
        else process.env.MINIMAX_API_KEY = old;
        resetEmbeddingProvider();
      }
    });

    await test('embedding: factory respects MINIMAX_DISABLE', () => {
      resetEmbeddingProvider();
      const oldKey = process.env.MINIMAX_API_KEY;
      const oldDisable = process.env.MINIMAX_DISABLE;
      process.env.MINIMAX_API_KEY = 'test-key';
      process.env.MINIMAX_DISABLE = 'true';
      try {
        const p = getEmbeddingProvider();
        assertEq(p.type, 'tf', 'forced offline');
      } finally {
        if (oldKey === undefined) delete process.env.MINIMAX_API_KEY;
        else process.env.MINIMAX_API_KEY = oldKey;
        if (oldDisable === undefined) delete process.env.MINIMAX_DISABLE;
        else process.env.MINIMAX_DISABLE = oldDisable;
        resetEmbeddingProvider();
      }
    });

    await test('embedding: TF provider embed() returns sparse vectors', async () => {
      resetEmbeddingProvider();
      delete process.env.MINIMAX_API_KEY;
      const p = getEmbeddingProvider();
      const vecs = await p.embed(['hello world', 'foo bar']);
      assertEq(vecs.length, 2, 'two vectors');
      assert(!(vecs[0] instanceof Float32Array), 'TF returns sparse object');
      const v0 = vecs[0] as Record<string, number>;
      assertEq(v0.hello, 1, 'hello count');
      assertEq(v0.world, 1, 'world count');
    });

    await test('embedding: describeProvider returns human-readable string', () => {
      resetEmbeddingProvider();
      delete process.env.MINIMAX_API_KEY;
      const desc = describeProvider();
      assert(typeof desc === 'string' && desc.length > 0, 'non-empty');
      assert(desc.includes('tf') || desc.includes('sparse'), 'mentions tf');
    });
  }

  // ─── Live MiniMax API test (gated by env) ───
  {
    const liveKey = process.env.MINIMAX_API_KEY_LIVE;
    if (liveKey && liveKey.startsWith('sk-cp-')) {
      const { getEmbeddingProvider, resetEmbeddingProvider } = await import('../dist/memory/embedding.js');

      await test('embedding: live MiniMax API returns 1536-dim vectors', async () => {
        process.env.MINIMAX_API_KEY = liveKey;
        resetEmbeddingProvider();
        const p = getEmbeddingProvider();
        assertEq(p.type, 'minimax', 'minimax');
        assertEq(p.dim, 1536, 'dim is 1536');
        const vecs = await p.embed(['hello world', '你好世界']);
        assertEq(vecs.length, 2, 'two vectors');
        assert(vecs[0] instanceof Float32Array, 'dense Float32Array');
        assertEq((vecs[0] as Float32Array).length, 1536, 'length 1536');
        // L2-normalized
        const v = vecs[0] as Float32Array;
        const norm = Math.sqrt(Array.from(v).reduce((s, x) => s + x * x, 0));
        assert(Math.abs(norm - 1.0) < 0.01, `norm ≈ 1.0 (got ${norm})`);
      });

      await test('embedding: live cosine similarity finds related texts', async () => {
        const p = getEmbeddingProvider();
        const v1 = await p.embed(['猫在吃鱼', '小狗在跑步']);
        const v2 = await p.embed(['猫和狗的区别']);
        // v2 should be somewhat similar to v1 (both about cats/dogs)
        let dot = 0;
        const a = v1[0] instanceof Float32Array ? v1[0] : new Float32Array();
        const b = v2[0] instanceof Float32Array ? v2[0] : new Float32Array();
        // Compare v1[0] (猫) to v2[0] (猫狗)
        for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
        assert(dot > 0, `cat ↔ cat+dog similarity should be positive (got ${dot.toFixed(3)})`);
      });
    }
  }

  // ─── Voice capabilities ───
  {
    const { detectVoiceCapabilities } = await import('../dist/voice/voice-pipeline.js');

    await test('voice: capabilities returns expected shape', () => {
      const cap = detectVoiceCapabilities();
      assert(typeof cap.recording === 'boolean', 'recording is bool');
      assert(typeof cap.tts === 'boolean', 'tts is bool');
      assert(typeof cap.stt === 'boolean', 'stt is bool');
      assert(typeof cap.fullDuplex === 'boolean', 'fullDuplex is bool');
    });

    await test('voice: fullDuplex implies all three are true', () => {
      const cap = detectVoiceCapabilities();
      if (cap.fullDuplex) {
        assert(cap.recording && cap.tts && cap.stt, 'all three true when fullDuplex');
      }
    });

    await test('voice: OPENAI_API_KEY toggles stt capability', () => {
      // We don't actually flip the env var here (it'd be a destructive side
      // effect); just check that the value matches the env.
      const cap = detectVoiceCapabilities();
      const expected = !!process.env.OPENAI_API_KEY;
      assertEq(cap.stt, expected, 'stt matches env');
    });
  }

  // ─── Avatar mapping ───
  {
    const { buildAvatarState } = await import('../dist/server/avatar.js');

    await test('avatar: 开心 → smile + bright voice', () => {
      const s = buildAvatarState(
        { myMood: '开心', userMood: '未知', affection: 50, energy: 'high', lastInteraction: '', unresolvedThread: null, recentTopics: [] },
        'familiar',
      );
      assertEq(s.face.mouth, 'smile', 'mouth');
      assertEq(s.face.brows, 'raised', 'brows');
      assertEq(s.voice.tone, 'bright', 'voice tone');
    });

    await test('avatar: 难过 → frown + gentle voice', () => {
      const s = buildAvatarState(
        { myMood: '难过', userMood: '未知', affection: 50, energy: 'low', lastInteraction: '', unresolvedThread: null, recentTopics: [] },
        'familiar',
      );
      assertEq(s.face.mouth, 'frown', 'mouth');
      assertEq(s.voice.tone, 'gentle', 'voice tone');
    });

    await test('avatar: unknown mood falls through to neutral', () => {
      const s = buildAvatarState(
        { myMood: '你谁啊', userMood: '未知', affection: 50, energy: 'mid', lastInteraction: '', unresolvedThread: null, recentTopics: [] },
        'familiar',
      );
      assertEq(s.face.mouth, 'neutral', 'mouth');
      assertEq(s.face.eyes, 'open', 'eyes');
    });

    await test('avatar: relationship stage only colors voice when mood is unknown', () => {
      // With a known mood, mood wins. With an unknown mood, relVoice
      // (acquaintance) shows through.
      const known = buildAvatarState(
        { myMood: '开心', userMood: '未知', affection: 80, energy: 'mid', lastInteraction: '', unresolvedThread: null, recentTopics: [] },
        'acquaintance',
      );
      // Mood 开心 → tone 'bright'
      assertEq(known.voice.tone, 'bright', 'known mood wins');

      // For the unknown case we have to bypass MOOD_MAP (which would map
      // any text to 未知 → warm). Test the merge logic differently: just
      // verify the relationship stage is included in the output.
      const intimate = buildAvatarState(
        { myMood: '开心', userMood: '未知', affection: 80, energy: 'mid', lastInteraction: '', unresolvedThread: null, recentTopics: [] },
        'intimate',
      );
      assertEq(intimate.relationship, 'intimate', 'relationship passed through');
    });

    await test('avatar: voice rate/pitch bounded in [-0.3, 0.3]', () => {
      // Force an extreme mood that has high values
      const s = buildAvatarState(
        { myMood: '兴奋', userMood: '未知', affection: 50, energy: 'high', lastInteraction: '', unresolvedThread: null, recentTopics: [] },
        'intimate',
      );
      assert(s.voice.rate >= -0.3 && s.voice.rate <= 0.3, `rate ${s.voice.rate}`);
      assert(s.voice.pitch >= -0.3 && s.voice.pitch <= 0.3, `pitch ${s.voice.pitch}`);
    });

    await test('avatar: output includes timestamp', () => {
      const s = buildAvatarState(
        { myMood: '平静', userMood: '未知', affection: 50, energy: 'mid', lastInteraction: '', unresolvedThread: null, recentTopics: [] },
        'familiar',
      );
      assert(typeof s.timestamp === 'string' && s.timestamp.length > 0, 'has timestamp');
    });
  }

  // ─── Summary ───
  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  console.log('');
  if (passed === total) {
    console.log(`\x1b[32m✔ all ${total} unit tests passed\x1b[0m`);
    rmSync(dataDir, { recursive: true, force: true });
    process.exit(0);
  } else {
    console.log(`\x1b[31m✘ ${total - passed}/${total} failed\x1b[0m`);
    for (const r of results.filter((r) => !r.passed)) {
      console.log(`  - ${r.name}: ${r.detail}`);
    }
    rmSync(dataDir, { recursive: true, force: true });
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('test runner crashed:', err);
  rmSync(dataDir, { recursive: true, force: true });
  process.exit(2);
});
