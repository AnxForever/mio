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
  companionGateLabel,
  companionGateSummary,
  companionGateTone,
} = await import('../../web/js/views/channels.js');

assert.equal(companionGateLabel(undefined), '未运行');
assert.equal(companionGateTone(undefined), 'admin-badge--neutral');
assert.equal(companionGateSummary(undefined), '还没有微信重启前质量门记录。');

assert.equal(companionGateLabel({ ok: true }), '通过');
assert.equal(companionGateTone({ ok: true }), 'admin-badge--success');
assert.equal(
  companionGateSummary({
    ok: true,
    mode: 'smoke',
    providers: ['mock', 'minimax'],
    totals: { total: 12, passed: 12, failed: 0 },
    promptAudit: { errors: 0 },
    replyRubric: { failed: 0 },
  }),
  '模式 smoke · 模型 mock, minimax · 回放 12/12 · 失败 0 · prompt errors 0 · rubric failed 0',
);

assert.equal(companionGateLabel({ ok: false }), '未通过');
assert.equal(companionGateTone({ ok: false }), 'admin-badge--warning');
assert.equal(
  companionGateSummary({
    ok: false,
    mode: 'full',
    providers: ['minimax'],
    totals: { total: 10, passed: 8, failed: 2 },
    promptAudit: { errors: 1 },
    replyRubric: { failed: 1 },
  }),
  '模式 full · 模型 minimax · 回放 8/10 · 失败 2 · prompt errors 1 · rubric failed 1',
);

assert.equal(companionGateLabel({ error: 'bad json' }), '记录异常');
assert.equal(companionGateSummary({ error: 'bad json' }), '质量门记录读取失败：bad json');

console.log('✓ channels companion gate view-models');
