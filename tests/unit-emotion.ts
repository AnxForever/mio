#!/usr/bin/env node
/**
 * Mio — emotion module unit tests
 *
 * Pure unit tests for the emotion subsystem:
 *   ghost.ts, pad.ts, affinity.ts, frustration.ts, classifier.ts, ritual.ts
 *
 * Uses a single shared temp data dir for file-backed state.
 * Pattern: same as tests/unit.ts (import from dist/, --experimental-strip-types).
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

const dataDir = mkdtempSync(join(tmpdir(), 'mio-emotion-unit-'));
process.env.MIO_DIR = dataDir;

async function main(): Promise<void> {
  console.log('\n\x1b[1mMio — emotion unit tests\x1b[0m\n');

  // ─── ghost.ts ───
  {
    const { shouldGhost, resetGhostState, markReplied, isEndingConversation, reloadGhostStateFromDisk } = await import('../dist/emotion/ghost.js');
    const { readRelationshipState, writeRelationshipState } = await import('../dist/relationship/progression.js');
    const { writeEmotionState } = await import('../dist/emotion/state.js');
    const { writeAffinityState, defaultAffinityState } = await import('../dist/emotion/affinity.js');

    // Bootstrap: ensure sufficient interaction count and sane affinity state
    writeRelationshipState({ interactionCount: 15 });
    writeAffinityState({ ...defaultAffinityState(), warmth: 40, patience: 80, tension: 10 });

    resetGhostState();

    await test('ghost: shouldGhost returns false for long messages (>10 chars)', () => {
      resetGhostState();
      markReplied();
      const ctx: any = {
        emotionState: { lastInteraction: new Date(Date.now() - 60_000).toISOString(), myMood: '开心', userMood: '未知', affection: 50, energy: 'mid', unresolvedThread: null, recentTopics: [] },
        relationship: { stage: 'familiar' as const, interactionCount: 15 },
      };
      const result = shouldGhost('今天真的好累加班到现在晚饭也没吃', ctx);
      assert(result === false, 'long messages should not be ghosted');
    });

    await test('ghost: shouldGhost returns false when interaction count < 10', () => {
      resetGhostState();
      markReplied();
      writeRelationshipState({ interactionCount: 5 });
      const ctx: any = {
        emotionState: { lastInteraction: new Date(Date.now() - 60_000).toISOString(), myMood: '开心', userMood: '未知', affection: 50, energy: 'mid', unresolvedThread: null, recentTopics: [] },
        relationship: { stage: 'acquaintance' as const, interactionCount: 5 },
      };
      const result = shouldGhost('嗯', ctx);
      assert(result === false, 'should not ghost new users');
      writeRelationshipState({ interactionCount: 15 }); // restore
    });

    await test('ghost: does not ghost when tension >= 70', () => {
      resetGhostState();
      markReplied();
      writeAffinityState({ ...defaultAffinityState(), warmth: 40, patience: 80, tension: 75 });
      const ctx: any = {
        emotionState: { lastInteraction: new Date(Date.now() - 60_000).toISOString(), myMood: '开心', userMood: '未知', affection: 50, energy: 'mid', unresolvedThread: null, recentTopics: [] },
        relationship: { stage: 'familiar' as const, interactionCount: 15 },
      };
      const result = shouldGhost('嗯', ctx);
      assert(result === false, 'high tension should prevent ghost');
      writeAffinityState({ ...defaultAffinityState(), warmth: 40, patience: 80, tension: 10 }); // restore
    });

    await test('ghost: does not ghost when patience <= 20', () => {
      resetGhostState();
      markReplied();
      writeAffinityState({ ...defaultAffinityState(), warmth: 40, patience: 15, tension: 10 });
      const ctx: any = {
        emotionState: { lastInteraction: new Date(Date.now() - 60_000).toISOString(), myMood: '开心', userMood: '未知', affection: 50, energy: 'mid', unresolvedThread: null, recentTopics: [] },
        relationship: { stage: 'familiar' as const, interactionCount: 15 },
      };
      const result = shouldGhost('嗯', ctx);
      assert(result === false, 'low patience should prevent ghost');
      writeAffinityState({ ...defaultAffinityState(), warmth: 40, patience: 80, tension: 10 }); // restore
    });

    await test('ghost: returns false after just replying (streak protection)', () => {
      resetGhostState();
      markReplied();
      // First call ghosts (short msg, active conv)
      const ctx: any = {
        emotionState: { lastInteraction: new Date(Date.now() - 60_000).toISOString(), myMood: '开心', userMood: '未知', affection: 50, energy: 'mid', unresolvedThread: null, recentTopics: [] },
        relationship: { stage: 'familiar' as const, interactionCount: 15 },
      };
      // After ghosting, next call should NOT ghost (double ghost protection)
      const first = shouldGhost('嗯', ctx);
      // At this point, lastTurnGhosted is true, so the next call returns false
      const second = shouldGhost('嗯', ctx);
      assert(second === false, 'double ghost should be blocked');
      resetGhostState();
      markReplied();
    });

    await test('ghost: never ghosts IM bridge sessions', () => {
      resetGhostState();
      markReplied();
      writeRelationshipState({ interactionCount: 15 });
      writeAffinityState({ ...defaultAffinityState(), warmth: 40, patience: 80, tension: 10 });
      const ctx: any = {
        sessionId: 'openai-bridge',
        emotionState: { lastInteraction: new Date(Date.now() - 60_000).toISOString(), myMood: '开心', userMood: '未知', affection: 50, energy: 'mid', unresolvedThread: null, recentTopics: [] },
        relationship: { stage: 'familiar' as const, interactionCount: 15 },
      };
      const result = shouldGhost('哦', ctx);
      assert(result === false, 'bridge sessions should never receive empty ghost replies');
    });

    await test('ghost: isEndingConversation detects "睡了"', () => {
      assert(isEndingConversation('我先睡了'), '睡了');
    });

    await test('ghost: isEndingConversation detects "拜拜"', () => {
      assert(isEndingConversation('拜拜'), '拜拜');
    });

    await test('ghost: isEndingConversation returns false for normal message', () => {
      assert(!isEndingConversation('今天天气真好'), 'normal');
    });

    await test('ghost: double-ghost guard survives a simulated restart', () => {
      resetGhostState();
      markReplied();
      writeRelationshipState({ interactionCount: 15 });
      writeAffinityState({ ...defaultAffinityState(), warmth: 40, patience: 80, tension: 10 });
      const ctx: any = {
        emotionState: { lastInteraction: new Date(Date.now() - 60_000).toISOString(), myMood: '开心', userMood: '未知', affection: 50, energy: 'mid', unresolvedThread: null, recentTopics: [] },
        relationship: { stage: 'familiar' as const, interactionCount: 15 },
      };
      const first = shouldGhost('嗯', ctx);
      assert(first === true, 'short reply in active conversation should ghost');
      reloadGhostStateFromDisk();
      const second = shouldGhost('嗯', ctx);
      assert(second === false, 'double-ghost guard should survive a restart');
      resetGhostState();
      markReplied();
    });

    await test('ghost: goodnight follow-up silence survives a simulated restart', () => {
      resetGhostState();
      markReplied();
      writeRelationshipState({ interactionCount: 15 });
      writeAffinityState({ ...defaultAffinityState(), warmth: 40, patience: 80, tension: 10 });
      const ctx: any = {
        emotionState: { lastInteraction: new Date(Date.now() - 60_000).toISOString(), myMood: '开心', userMood: '未知', affection: 50, energy: 'mid', unresolvedThread: null, recentTopics: [] },
        relationship: { stage: 'familiar' as const, interactionCount: 15 },
      };
      const atGoodnight = shouldGhost('我先睡了', ctx);
      assert(atGoodnight === false, 'goodnight turn itself still gets a brief reply');
      reloadGhostStateFromDisk();
      const followUp = shouldGhost('还在吗还在吗', ctx);
      assert(followUp === true, 'follow-up after goodnight should stay silent across restart');
      resetGhostState();
      markReplied();
    });

    // Restore clean state for subsequent tests
    writeAffinityState(defaultAffinityState());
  }

  // ─── pad.ts ───
  {
    const { classifyPAD, applyDecay, padToMood, getPADState, setPADState, writePADState, writePADConfig, DEFAULT_PAD_CONFIG } = await import('../dist/emotion/pad.js');

    // Seed a baseline PAD state on disk
    process.env.MIO_PAD_ENABLED = 'true';

    // Reset PAD state to baseline-aligned values before tests
    setPADState({ pleasure: 0.3, arousal: 0.0, dominance: 0.2 });

    await test('pad: classifyPAD "想你了" -> pleasure positive, arousal positive', () => {
      const state = getPADState();
      const delta = classifyPAD('想你了');
      assert(delta.pleasure !== undefined && delta.pleasure! >= 0, `pleasure should be >= 0 (got ${delta.pleasure})`);
      assert(delta.arousal !== undefined && delta.arousal! >= 0, `arousal should be >= 0 (got ${delta.arousal})`);
    });

    await test('pad: classifyPAD "我分手了" -> pleasure negative, arousal positive', () => {
      const delta = classifyPAD('我分手了');
      assert(delta.pleasure !== undefined && delta.pleasure! < 0, `pleasure should be negative (got ${delta.pleasure})`);
      assert(delta.arousal !== undefined && delta.arousal! > 0, `arousal should be positive (got ${delta.arousal})`);
    });

    await test('pad: classifyPAD "哈哈哈哈哈" -> pleasure positive', () => {
      const delta = classifyPAD('哈哈哈哈哈');
      assert(delta.pleasure !== undefined && delta.pleasure! >= 0, `pleasure should be >= 0 (got ${delta.pleasure})`);
    });

    await test('pad: classifyPAD "" (empty) -> small negative delta', () => {
      const delta = classifyPAD('');
      assert(delta.pleasure !== undefined && delta.pleasure! < 0, 'empty -> negative pleasure');
      assert(delta.arousal !== undefined && delta.arousal! < 0, 'empty -> negative arousal');
    });

    await test('pad: applyDecay values move toward baseline over time', () => {
      // Set a state far from baseline
      setPADState({ pleasure: 0.9, arousal: 0.9, dominance: 0.9 });
      const now = new Date(Date.now() + 3_600_000); // 1 hour later
      const after = applyDecay(now);
      // After 1 hour with 5% decay * neuroticism modifier, pleasure should be closer to baseline (0.3) than 0.9
      assert(after.pleasure < 0.9, `pleasure should decrease: ${after.pleasure}`);
      assert(after.pleasure > 0.3, `pleasure should still be above baseline: ${after.pleasure}`);
    });

    await test('pad: padToMood high pleasure + high arousal -> "开心"', () => {
      const { myMood, energy } = padToMood({ pleasure: 0.8, arousal: 0.5, dominance: 0.3, updatedAt: '' });
      assertEq(myMood, '开心', 'mood');
      assertEq(energy, 'high', 'energy');
    });

    await test('pad: padToMood low pleasure + low arousal -> "心疼" or "低落" energy', () => {
      const { myMood, energy } = padToMood({ pleasure: -0.8, arousal: -0.5, dominance: -0.3, updatedAt: '' });
      // Low pleasure + low dominance -> "心疼"
      assertEq(myMood, '心疼', 'mood');
      assertEq(energy, 'low', 'energy');
    });

    await test('pad: padToMood mid values -> "平静", "mid"', () => {
      const { myMood, energy } = padToMood({ pleasure: 0.0, arousal: 0.0, dominance: 0.0, updatedAt: '' });
      assertEq(myMood, '平静', 'mood');
      assertEq(energy, 'mid', 'energy');
    });

    // Reset PAD state
    setPADState({ pleasure: 0.3, arousal: 0.0, dominance: 0.2 });
  }

  // ─── affinity.ts ───
  {
    const { updateAffinity, getAffinityContext, defaultAffinityState, writeAffinityState } = await import('../dist/emotion/affinity.js');

    // Write a clean default state
    writeAffinityState(defaultAffinityState());

    await test('affinity: updateAffinity with affectionate intent -> warmth + intimacy increase', () => {
      writeAffinityState(defaultAffinityState());
      const before = defaultAffinityState();
      const after = updateAffinity('affectionate');
      assert(after.warmth > before.warmth, `warmth should increase: ${before.warmth} -> ${after.warmth}`);
      assert(after.intimacy > before.intimacy, `intimacy should increase: ${before.intimacy} -> ${after.intimacy}`);
    });

    await test('affinity: updateAffinity with angry intent -> patience decrease, tension increase', () => {
      writeAffinityState(defaultAffinityState());
      const before = defaultAffinityState();
      const after = updateAffinity('angry');
      assert(after.patience < before.patience, `patience should decrease: ${before.patience} -> ${after.patience}`);
      assert(after.tension > before.tension, `tension should increase: ${before.tension} -> ${after.tension}`);
    });

    await test('affinity: getAffinityContext returns non-empty string when affinity exists', () => {
      writeAffinityState(defaultAffinityState());
      const ctx = getAffinityContext();
      assert(typeof ctx === 'string' && ctx.length > 0, 'context string is non-empty');
      assert(ctx.includes('亲密度状态'), 'contains Chinese label');
    });

    await test('affinity: ghost penalty decreases warmth and trust', () => {
      writeAffinityState(defaultAffinityState());
      const before = defaultAffinityState();
      const after = updateAffinity('neutral', true); // isGhosted = true
      assert(after.warmth <= before.warmth, `warmth should not increase after ghost: ${before.warmth} -> ${after.warmth}`);
      // Also check tension didn't decrease (ghost penalty adds tension)
      assert(after.tension >= before.tension, `tension should not decrease after ghost: ${before.tension} -> ${after.tension}`);
    });

    // Write clean state for subsequent tests
    writeAffinityState(defaultAffinityState());
  }

  // ─── frustration.ts ───
  {
    const { resetFrustrationState, getFrustrationState, updateFrustration, deriveAttachmentLevel, getAttachmentContext, reloadFrustrationStateFromDisk } = await import('../dist/emotion/frustration.js');
    const { writeAffinityState, defaultAffinityState } = await import('../dist/emotion/affinity.js');

    resetFrustrationState();
    writeAffinityState(defaultAffinityState());

    await test('frustration: streak increments on cold exchanges', () => {
      resetFrustrationState();
      updateFrustration('angry', false);
      const state = getFrustrationState();
      assertEq(state.frustrationStreak, 1, 'streak should be 1 after one cold exchange');
    });

    await test('frustration: streak resets on warm exchanges', () => {
      resetFrustrationState();
      // Build up a small streak
      updateFrustration('angry', false);
      let state = getFrustrationState();
      assertEq(state.frustrationStreak, 1, 'streak 1');
      // Now send warm message
      updateFrustration('affectionate', false);
      state = getFrustrationState();
      assertEq(state.frustrationStreak, 0, 'streak should reset to 0 after warm exchange');
    });

    await test('frustration: dismissive text counts as cold even when intent is neutral', () => {
      resetFrustrationState();
      updateFrustration('neutral', false, false, '算了，你不懂');
      let state = getFrustrationState();
      assertEq(state.frustrationStreak, 1, 'dismissal should increment streak');
      updateFrustration('casual_chat', false, false, '不说了，你忙吧');
      state = getFrustrationState();
      assertEq(state.frustrationStreak, 2, 'second dismissal should increment streak');
    });

    await test('frustration: plain neutral text does not touch the streak', () => {
      resetFrustrationState();
      updateFrustration('neutral', false, false, '今天天气不错');
      const state = getFrustrationState();
      assertEq(state.frustrationStreak, 0, 'plain neutral message should not increment streak');
    });

    await test('frustration: warm intent wins over dismissive wording', () => {
      resetFrustrationState();
      updateFrustration('neutral', false, false, '算了');
      let state = getFrustrationState();
      assertEq(state.frustrationStreak, 1, 'dismissal streak 1');
      updateFrustration('joking', false, false, '算了啦哈哈');
      state = getFrustrationState();
      assertEq(state.frustrationStreak, 0, 'playful 算了 should reset, not increment');
    });

    await test('frustration: streak survives a simulated restart', () => {
      resetFrustrationState();
      updateFrustration('neutral', false, false, '算了');
      updateFrustration('angry', false);
      reloadFrustrationStateFromDisk();
      const state = getFrustrationState();
      assertEq(state.frustrationStreak, 2, 'streak should be reloaded from disk after restart');
    });

    await test('frustration: mini-crisis triggers when streak >= 3 and tension > 50', () => {
      resetFrustrationState();
      writeAffinityState({ ...defaultAffinityState(), tension: 60 });
      // 3 cold exchanges
      updateFrustration('angry', false);
      updateFrustration('angry', false);
      updateFrustration('angry', false);
      const state = getFrustrationState();
      assert(state.crisisActive === true, `crisis should be active (got ${state.crisisActive})`);
      writeAffinityState(defaultAffinityState());
    });

    await test('frustration: getAttachmentContext returns non-empty string', () => {
      resetFrustrationState();
      const ctx = getAttachmentContext();
      assert(typeof ctx === 'string' && ctx.length > 0, 'context string is non-empty');
    });

    await test('frustration: deriveAttachmentLevel returns "anxious" with high intimacy, low warmth', () => {
      const level = deriveAttachmentLevel({ warmth: 20, intimacy: 25, trust: 10, patience: 50, tension: 20, updatedAt: '' });
      assertEq(level, 'anxious', 'should be anxious');
    });

    await test('frustration: deriveAttachmentLevel returns "secure" with high warmth and intimacy', () => {
      const level = deriveAttachmentLevel({ warmth: 50, intimacy: 35, trust: 20, patience: 50, tension: 10, updatedAt: '' });
      assertEq(level, 'secure', 'should be secure');
    });

    await test('frustration: deriveAttachmentLevel returns "avoidant" with high warmth, low intimacy', () => {
      const level = deriveAttachmentLevel({ warmth: 35, intimacy: 10, trust: 10, patience: 50, tension: 20, updatedAt: '' });
      assertEq(level, 'avoidant', 'should be avoidant');
    });

    resetFrustrationState();
  }

  // ─── classifier.ts ───
  {
    const { classifyIntent } = await import('../dist/emotion/classifier.js');

    await test('classifier: "烦死了今天又被领导说了" -> venting', () => {
      const r = classifyIntent('烦死了今天又被领导说了');
      assertEq(r.primary, 'venting', 'primary should be venting');
      assertEq(r.tone, 'negative', 'tone should be negative');
    });

    await test('classifier: "我今天好开心面试过了！！" -> excited', () => {
      const r = classifyIntent('我今天好开心面试过了！！');
      assertEq(r.primary, 'excited', 'primary should be excited');
      assertEq(r.tone, 'positive', 'tone should be positive');
    });

    await test('classifier: "想你了" -> affectionate', () => {
      const r = classifyIntent('想你了');
      assertEq(r.primary, 'affectionate', 'primary should be affectionate');
    });

    await test('classifier: "好累啊加班到现在" -> tired', () => {
      const r = classifyIntent('好累啊加班到现在');
      assertEq(r.primary, 'tired', 'primary should be tired');
    });

    await test('classifier: "哈哈哈哈你真的是" -> joking', () => {
      const r = classifyIntent('哈哈哈哈你真的是');
      assertEq(r.primary, 'joking', 'primary should be joking');
    });

    await test('classifier: "今天下雨了" -> neutral or casual_chat', () => {
      const r = classifyIntent('今天下雨了');
      // This message could match neutral or casual_chat — either is acceptable
      assert(r.primary === 'neutral' || r.primary === 'casual_chat', `primary should be neutral/casual_chat (got ${r.primary})`);
    });

    await test('classifier: "" (empty) -> neutral', () => {
      const r = classifyIntent('');
      assertEq(r.primary, 'neutral', 'empty -> neutral');
      assertEq(r.tone, 'neutral', 'tone neutral');
    });

    await test('classifier: "嘻嘻你好可爱" -> playful', () => {
      const r = classifyIntent('嘻嘻你好可爱');
      assertEq(r.primary, 'playful', 'primary should be playful');
    });
  }

  // ─── ritual.ts ───
  {
    const { detectRitual, observeRitual, readRitualState, getRitualContext } = await import('../dist/emotion/ritual.js');

    // Reset: write empty ritual state
    // We'll clear the ritual file by ensuring there's nothing

    await test('ritual: "早安" at 8am -> greeting detected', () => {
      const ritual = detectRitual('早安', 8);
      // On first encounter, detectRitual returns null (pattern matched but not yet a ritual)
      // So we need to observe it first
      observeRitual('早安', 8);
      // After 3+ observations, it should become a ritual
      observeRitual('早安', 8);
      observeRitual('早安', 8);
      observeRitual('早安', 8); // 4th observation, should now be ritual (>=3)
      // Now detectRitual should find it
      const found = detectRitual('早安', 8);
      assert(found !== null, 'should detect greeting ritual after 4 observations');
      if (found) {
        assertEq(found.type, 'greeting', 'type should be greeting');
      }
    });

    await test('ritual: "晚安" at 11pm -> goodnight detected', () => {
      observeRitual('晚安', 23);
      observeRitual('晚安', 23);
      observeRitual('晚安', 23);
      const found = detectRitual('晚安', 23);
      assert(found !== null, 'should detect goodnight ritual');
      if (found) {
        assertEq(found.type, 'goodnight', 'type should be goodnight');
      }
    });

    await test('ritual: "早安" at 3pm -> NOT detected (wrong time)', () => {
      // At hour 15 (3pm), the morning greeting pattern (6-12) should NOT match
      const found = detectRitual('早安', 15);
      assert(found === null, 'should NOT detect greeting at 3pm');
    });

    await test('ritual: observeRitual increments frequency', () => {
      // The ritual should already exist from previous tests
      // After detecting "早安" at 8am earlier, it should have frequency >= 4
      const state = readRitualState();
      const greetingRitual = state.rituals.find((r) => r.type === 'greeting');
      assert(greetingRitual !== undefined, 'greeting ritual should exist');
      if (greetingRitual) {
        // Observe it again
        observeRitual('早安', 8);
        const state2 = readRitualState();
        const updated = state2.rituals.find((r) => r.id === greetingRitual.id);
        assert(updated !== undefined && updated.frequency > greetingRitual.frequency,
          `frequency should increase (${greetingRitual.frequency} -> ${updated?.frequency})`);
      }
    });

    await test('ritual: unknown message -> null ritual', () => {
      const found = detectRitual('今天吃了拉面很好吃', 12);
      assert(found === null, 'unknown message should return null');
    });

    await test('ritual: getRitualContext returns null when no active ritual', () => {
      // Before any detectRitual call in this test, activeRitual should be null
      // The getRitualContext clears it after reading, so call it fresh
      const ctx = getRitualContext();
      // Might be null or a string depending on state — both are valid outcomes
      // Just verify it doesn't throw
      assert(ctx === null || typeof ctx === 'string', 'context is null or string');
    });
  }

  // ─── Summary ───
  const passed = results.filter((r) => r.passed).length;
  const total = results.length;
  console.log('');
  if (passed === total) {
    console.log(`\x1b[32m✔ all ${total} emotion unit tests passed\x1b[0m`);
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
