import assert from 'node:assert';

globalThis.window = {
  location: {
    origin: 'http://127.0.0.1:3000',
    hash: '',
  },
};
globalThis.localStorage = {
  getItem() { return null; },
  setItem() {},
};

const {
  buildDebugCandidateRequest,
  buildRegressionPromotionRequest,
  memoryCardClass,
  memoryDebugCounts,
  memoryDebugSummary,
  memoryReviewActions,
  memoryStatusLabel,
  memoryUsageLabel,
  proactiveDecisionOutcomeLabel,
  proactiveDecisionPhaseLabel,
  proactiveDecisionSummary,
  regressionCandidateActions,
  regressionLibrarySummary,
  regressionTaxonomyLabel,
  structuredStateCounts,
  structuredStateEntityActions,
  structuredStateSectionLabel,
  structuredStateSummary,
  temporalResolutionLabel,
  temporalStateCounts,
  temporalStatusLabel,
} = await import('../../web/js/views/memories.js');

assert.equal(memoryStatusLabel('confirmed'), '已确认');
assert.equal(memoryStatusLabel('ignored'), '已忽略');
assert.equal(memoryStatusLabel('wrong'), '已标错');
assert.equal(memoryStatusLabel('disabled'), '已禁用');
assert.equal(memoryStatusLabel('inferred'), '待确认');
assert.equal(memoryStatusLabel(undefined), '待确认');

const inferredActions = memoryReviewActions({ status: 'inferred' });
assert.deepEqual(
  inferredActions.map((action) => [action.kind, action.label, action.patch]),
  [
    ['disable', '禁用', { enabled: false }],
    ['pin', '固定', { pinned: true }],
    ['confirm', '确认', { reviewStatus: 'confirmed' }],
    ['ignore', '忽略', { reviewStatus: 'ignored' }],
    ['wrong', '标错', { reviewStatus: 'wrong' }],
  ],
);

const confirmedActions = memoryReviewActions({ status: 'confirmed' });
assert.deepEqual(
  confirmedActions.map((action) => [action.kind, action.patch]),
  [
    ['disable', { enabled: false }],
    ['pin', { pinned: true }],
    ['ignore', { reviewStatus: 'ignored' }],
    ['wrong', { reviewStatus: 'wrong' }],
  ],
);

const pinnedActions = memoryReviewActions({ status: 'confirmed', pinned: true });
assert.deepEqual(
  pinnedActions.map((action) => [action.kind, action.label, action.patch]),
  [
    ['disable', '禁用', { enabled: false }],
    ['unpin', '取消固定', { pinned: false }],
    ['ignore', '忽略', { reviewStatus: 'ignored' }],
    ['wrong', '标错', { reviewStatus: 'wrong' }],
  ],
);

const ignoredActions = memoryReviewActions({ status: 'ignored' });
assert.deepEqual(
  ignoredActions.map((action) => action.kind),
  ['disable', 'confirm', 'wrong'],
);

const wrongActions = memoryReviewActions({ status: 'wrong' });
assert.deepEqual(
  wrongActions.map((action) => action.kind),
  ['disable', 'confirm', 'ignore'],
);

const disabledActions = memoryReviewActions({ status: 'ignored', enabled: false });
assert.deepEqual(
  disabledActions.map((action) => [action.kind, action.label, action.patch]),
  [
    ['enable', '启用', { enabled: true, reviewStatus: 'inferred' }],
  ],
);

assert.equal(memoryCardClass({ status: 'inferred' }), 'memory-card');
assert.equal(memoryCardClass({ status: 'ignored' }), 'memory-card memory-card--ignored');
assert.equal(memoryCardClass({ status: 'wrong' }), 'memory-card memory-card--ignored');
assert.equal(memoryCardClass({ status: 'inferred', enabled: false }), 'memory-card memory-card--ignored');

assert.equal(memoryUsageLabel(undefined), '');
assert.equal(memoryUsageLabel({ retrievedCount: 0, injectedCount: 0, mentionedCount: 0 }), '');
assert.equal(
  memoryUsageLabel({
    retrievedCount: 2,
    injectedCount: 1,
    mentionedCount: 0,
    lastInjectedAt: '2026-06-28T12:00:00.000Z',
  }),
  '进过提示 1 次 · 未在回复中引用 · 最近 6月28日',
);
assert.equal(
  memoryUsageLabel({
    retrievedCount: 3,
    injectedCount: 2,
    mentionedCount: 1,
    lastMentionedAt: '2026-06-29T12:00:00.000Z',
  }),
  '进过提示 2 次 · 回复引用 1 次 · 最近 6月29日',
);
assert.equal(
  memoryUsageLabel({
    retrievedCount: 3,
    injectedCount: 2,
    mentionedCount: 1,
    lastMentionedAt: '2026-06-29T12:00:00.000Z',
    retrievedInLatestReply: true,
    injectedInLatestReply: true,
    mentionedInLatestReply: true,
  }),
  '最近回复引用 · 进过提示 2 次 · 回复引用 1 次 · 最近 6月29日',
);
assert.equal(
  memoryUsageLabel({
    retrievedCount: 1,
    injectedCount: 1,
    mentionedCount: 0,
    lastInjectedAt: '2026-06-29T12:00:00.000Z',
    retrievedInLatestReply: true,
    injectedInLatestReply: true,
    mentionedInLatestReply: false,
  }),
  '最近进过提示 · 进过提示 1 次 · 未在回复中引用 · 最近 6月29日',
);
assert.equal(
  memoryUsageLabel({
    retrievedCount: 1,
    injectedCount: 0,
    mentionedCount: 0,
    lastRetrievedAt: '2026-06-29T12:00:00.000Z',
    retrievedInLatestReply: true,
    injectedInLatestReply: false,
    mentionedInLatestReply: false,
  }),
  '最近检索未用 · 检索到 1 次 · 最近 6月29日',
);

assert.equal(temporalStatusLabel('current'), '当前有效');
assert.equal(temporalStatusLabel('recently_resolved'), '已解决');
assert.equal(temporalStatusLabel('recently_expired'), '已过期');
assert.equal(temporalResolutionLabel('user_reopened_chat'), '用户已重新打开聊天');
assert.equal(temporalResolutionLabel('explicit_user_resolution'), '用户明确表示已解决');
assert.deepEqual(
  temporalStateCounts({
    current: [{ id: 'a' }],
    recentlyResolved: [{ id: 'b' }, { id: 'c' }],
    recentlyExpired: [{ id: 'd' }],
  }),
  { current: 1, recentlyResolved: 2, recentlyExpired: 1 },
);
assert.deepEqual(temporalStateCounts(undefined), { current: 0, recentlyResolved: 0, recentlyExpired: 0 });

assert.deepEqual(
  structuredStateCounts({
    counts: {
      pinned: 1,
      currentFacts: 2,
      multiDayArcs: 3,
      recentEvents: 4,
      recentEmotions: 5,
      superseded: 6,
    },
  }),
  { pinned: 1, currentFacts: 2, multiDayArcs: 3, recentEvents: 4, recentEmotions: 5, superseded: 6 },
);
assert.deepEqual(
  structuredStateCounts({
    pinned: [{}],
    currentFacts: [{}, {}],
    multiDayArcs: [{}],
    recentEvents: [],
    recentEmotions: [{}],
    superseded: [{}, {}],
  }),
  { pinned: 1, currentFacts: 2, multiDayArcs: 1, recentEvents: 0, recentEmotions: 1, superseded: 2 },
);
assert.deepEqual(
  structuredStateCounts(undefined),
  { pinned: 0, currentFacts: 0, multiDayArcs: 0, recentEvents: 0, recentEmotions: 0, superseded: 0 },
);
assert.equal(structuredStateSummary(undefined), '');
assert.equal(
  structuredStateSummary({
    counts: {
      pinned: 1,
      currentFacts: 2,
      multiDayArcs: 1,
      recentEvents: 3,
      recentEmotions: 1,
      superseded: 2,
    },
  }),
  '固定 1 · 当前事实 2 · 多日线索 1 · 近期事件 3 · 近期情绪 1 · 已取代 2',
);
assert.equal(structuredStateSectionLabel('pinned'), '固定');
assert.equal(structuredStateSectionLabel('currentFacts'), '当前事实');
assert.equal(structuredStateSectionLabel('multiDayArcs'), '多日线索');
assert.equal(structuredStateSectionLabel('recentEvents'), '近期事件');
assert.equal(structuredStateSectionLabel('recentEmotions'), '近期情绪');
assert.equal(structuredStateSectionLabel('superseded'), '已取代');
assert.equal(structuredStateSectionLabel('custom'), 'custom');
assert.deepEqual(structuredStateEntityActions({ status: 'confirmed' }), []);
assert.deepEqual(
  structuredStateEntityActions({ id: 'state-fact-1', status: 'confirmed', enabled: true }).map((action) => [action.kind, action.patch]),
  [
    ['disable', { enabled: false }],
    ['pin', { pinned: true }],
    ['ignore', { reviewStatus: 'ignored' }],
    ['wrong', { reviewStatus: 'wrong' }],
  ],
);
assert.deepEqual(
  structuredStateEntityActions({ id: 'state-fact-2', status: 'confirmed', pinned: true, enabled: true }).map((action) => [action.kind, action.patch]),
  [
    ['disable', { enabled: false }],
    ['unpin', { pinned: false }],
    ['ignore', { reviewStatus: 'ignored' }],
    ['wrong', { reviewStatus: 'wrong' }],
  ],
);

assert.equal(proactiveDecisionOutcomeLabel('sent'), '已发送');
assert.equal(proactiveDecisionOutcomeLabel('skipped'), '已跳过');
assert.equal(proactiveDecisionOutcomeLabel('rejected'), '已拒绝');
assert.equal(proactiveDecisionPhaseLabel('temporal'), '时间/边界');
assert.equal(proactiveDecisionPhaseLabel('quality_gate'), '质量门');
assert.equal(proactiveDecisionSummary(undefined), '');
assert.equal(
  proactiveDecisionSummary({
    counts: { sent: 1, skipped: 2, rejected: 3 },
    decisions: [{ id: 'p' }],
  }),
  '发送 1 · 跳过 2 · 拒绝 3',
);

assert.deepEqual(memoryDebugCounts(undefined), { retrieved: 0, injected: 0, mentioned: 0, interventions: 0 });
assert.equal(memoryDebugSummary(undefined), '');
assert.deepEqual(
  memoryDebugCounts({
    memory: { retrievedCount: 3, injectedCount: 2, mentionedCount: 1 },
    interventions: [{ type: 'temporal_presupposition' }],
  }),
  { retrieved: 3, injected: 2, mentioned: 1, interventions: 1 },
);
assert.equal(
  memoryDebugSummary({
    memory: { retrievedCount: 3, injectedCount: 2, mentionedCount: 1 },
    interventions: [{ type: 'temporal_presupposition' }],
  }),
  '检索 3 · 进提示 2 · 回复引用 1 · 干预 1',
);
assert.equal(buildDebugCandidateRequest(undefined, 's1', '怪'), null);
assert.deepEqual(
  buildDebugCandidateRequest({
    sessionId: 'trace-session',
    memory: { retrievedCount: 1, injectedCount: 1, mentionedCount: 0 },
    interventions: [],
  }, 'active-session', '  这句怪怪的  '),
  { sessionId: 'active-session', note: '这句怪怪的' },
);
assert.deepEqual(
  buildDebugCandidateRequest({
    sessionId: 'trace-session',
    memory: { retrievedCount: 0, injectedCount: 0, mentionedCount: 0 },
    interventions: [{ type: 'reply_rubric_flag' }],
  }, '', ''),
  { sessionId: 'trace-session' },
);
assert.equal(buildRegressionPromotionRequest(undefined, 'review'), null);
assert.deepEqual(
  buildRegressionPromotionRequest({
    candidatesPath: '/tmp/mio/candidates.json',
    candidate: { id: 'debug-a' },
  }, '  收进回归库  '),
  {
    candidatesPath: '/tmp/mio/candidates.json',
    ids: ['debug-a'],
    reviewer: 'memory-ui',
    note: '收进回归库',
  },
);
assert.equal(regressionTaxonomyLabel('bad_proactive_or_reopened_chat_blame'), '等待/冷落');
assert.equal(regressionTaxonomyLabel('proactive_curiosity_hook'), '主动钩子');
assert.equal(regressionTaxonomyLabel('current_fact_conflict'), '当前事实');
assert.equal(regressionTaxonomyLabel('internal_context_leak'), '内部状态');
assert.equal(regressionTaxonomyLabel('persona_coherence'), '人格一致');
assert.equal(regressionTaxonomyLabel('persona_judge_repair'), '人格修复');
assert.equal(regressionTaxonomyLabel('custom_case'), 'custom_case');
assert.equal(regressionLibrarySummary(undefined), '');
assert.equal(regressionLibrarySummary({ total: 0, candidates: [] }), '');
assert.equal(
  regressionLibrarySummary({
    total: 2,
    enabledTotal: 1,
    candidates: [{ taxonomy: 'temporal_drift' }],
  }),
  '永久回归 1/2 · 最近 时间状态',
);
assert.equal(
  regressionLibrarySummary({
    total: 2,
    enabledTotal: 2,
    candidates: [{
      id: 'persona-case-proactive-without-phone-waiting-arc',
      taxonomy: 'bad_proactive_or_reopened_chat_blame',
      routeTags: ['proactive', 'temporal_state', 'offline_life'],
      excerpt: 'bad=那我先刷会儿手机等你。',
    }],
  }),
  '永久回归 2/2 · 最近 等待/冷落',
);
assert.deepEqual(
  regressionCandidateActions({ enabled: true }),
  [{ kind: 'disable', label: '禁用', patch: { enabled: false } }],
);
assert.deepEqual(
  regressionCandidateActions({ enabled: false }),
  [{ kind: 'enable', label: '启用', patch: { enabled: true } }],
);

console.log('✓ memories review view-models');
