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
  memoryCardClass,
  memoryReviewActions,
  memoryStatusLabel,
  memoryUsageLabel,
} = await import('../../web/js/views/memories.js');

assert.equal(memoryStatusLabel('confirmed'), '已确认');
assert.equal(memoryStatusLabel('ignored'), '已忽略');
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
  ],
);

const confirmedActions = memoryReviewActions({ status: 'confirmed' });
assert.deepEqual(
  confirmedActions.map((action) => [action.kind, action.patch]),
  [
    ['disable', { enabled: false }],
    ['pin', { pinned: true }],
    ['ignore', { reviewStatus: 'ignored' }],
  ],
);

const pinnedActions = memoryReviewActions({ status: 'confirmed', pinned: true });
assert.deepEqual(
  pinnedActions.map((action) => [action.kind, action.label, action.patch]),
  [
    ['disable', '禁用', { enabled: false }],
    ['unpin', '取消固定', { pinned: false }],
    ['ignore', '忽略', { reviewStatus: 'ignored' }],
  ],
);

const ignoredActions = memoryReviewActions({ status: 'ignored' });
assert.deepEqual(
  ignoredActions.map((action) => action.kind),
  ['disable', 'confirm'],
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

console.log('✓ memories review view-models');
