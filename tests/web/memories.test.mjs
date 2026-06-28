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
} = await import('../../web/js/views/memories.js');

assert.equal(memoryStatusLabel('confirmed'), '已确认');
assert.equal(memoryStatusLabel('ignored'), '已忽略');
assert.equal(memoryStatusLabel('inferred'), '待确认');
assert.equal(memoryStatusLabel(undefined), '待确认');

const inferredActions = memoryReviewActions({ status: 'inferred' });
assert.deepEqual(
  inferredActions.map((action) => [action.kind, action.label, action.patch]),
  [
    ['confirm', '确认', { reviewStatus: 'confirmed' }],
    ['ignore', '忽略', { reviewStatus: 'ignored' }],
  ],
);

const confirmedActions = memoryReviewActions({ status: 'confirmed' });
assert.deepEqual(
  confirmedActions.map((action) => action.kind),
  ['ignore'],
);

const ignoredActions = memoryReviewActions({ status: 'ignored' });
assert.deepEqual(
  ignoredActions.map((action) => action.kind),
  ['confirm'],
);

assert.equal(memoryCardClass({ status: 'inferred' }), 'memory-card');
assert.equal(memoryCardClass({ status: 'ignored' }), 'memory-card memory-card--ignored');

console.log('✓ memories review view-models');
