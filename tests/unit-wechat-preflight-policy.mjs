import assert from 'node:assert';
import {
  diagnoseCompanionProviders,
  hasRealProvider,
  splitProviders,
  validateCompanionGatePolicy,
} from '../scripts/wechat-bridge/companion-gate-policy.mjs';

assert.deepEqual(splitProviders('mock, openai,, deepseek '), ['mock', 'openai', 'deepseek']);
assert.equal(hasRealProvider(['mock']), false);
assert.equal(hasRealProvider(['mock', 'openai']), true);
assert.equal(hasRealProvider(['MOCK', 'minimax']), true);
assert.deepEqual(
  diagnoseCompanionProviders('mock,openai,deepseek', { OPENAI_API_KEY: 'set' }).map((item) => ({
    provider: item.provider,
    envVar: item.envVar,
    credentialPresent: item.credentialPresent,
    usableForVerifiedRestart: item.usableForVerifiedRestart,
  })),
  [
    { provider: 'mock', envVar: '', credentialPresent: true, usableForVerifiedRestart: false },
    { provider: 'openai', envVar: 'OPENAI_API_KEY', credentialPresent: true, usableForVerifiedRestart: true },
    { provider: 'deepseek', envVar: 'DEEPSEEK_API_KEY', credentialPresent: false, usableForVerifiedRestart: false },
  ],
);

assert.equal(
  validateCompanionGatePolicy({ providers: 'mock', requireRealProvider: false }).ok,
  true,
);
assert.equal(
  validateCompanionGatePolicy({ providers: 'mock', requireRealProvider: true }).ok,
  false,
);
assert.equal(
  validateCompanionGatePolicy({ providers: 'mock,openai', requireRealProvider: true, env: {} }).ok,
  false,
);
assert.match(
  validateCompanionGatePolicy({ providers: 'mock,openai', requireRealProvider: true, env: {} }).reason,
  /Missing credentials: openai \(OPENAI_API_KEY\)/,
);
assert.equal(
  validateCompanionGatePolicy({ providers: 'mock,openai', requireRealProvider: true, env: { OPENAI_API_KEY: 'set' } }).ok,
  true,
);
assert.match(
  validateCompanionGatePolicy({ providers: 'mock', requireRealProvider: true }).reason,
  /requires at least one non-mock/,
);
assert.match(
  validateCompanionGatePolicy({ providers: 'unknown', requireRealProvider: true, env: {} }).reason,
  /Unknown providers: unknown/,
);
assert.equal(
  validateCompanionGatePolicy({ providers: 'lora', requireRealProvider: true, env: {} }).ok,
  true,
);

console.log('✓ wechat companion preflight policy');
