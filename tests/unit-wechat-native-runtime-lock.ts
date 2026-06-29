import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'mio-wechat-runtime-lock-'));
process.env.MIO_DIR = dir;
process.env.MIO_PROVIDER = 'mock';

type TestResult = {
  name: string;
  ok: boolean;
  detail?: string;
};

const results: TestResult[] = [];

function ok(cond: boolean, name: string, detail?: string): void {
  results.push({ name, ok: cond, detail });
  console.log(`  ${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${name}${detail && !cond ? ` — ${detail}` : ''}`);
}

console.log('\n\x1b[1mMio — WeChat native runtime lock tests\x1b[0m\n');

const wechatNative = await import('../dist/server/wechat-native.js');
const paths = await import('../dist/memory/paths.js');

const accountId = 'unit-lock-account';
const lockPath = paths.wechatNativeRuntimeLockPath(accountId);

const first = wechatNative.tryAcquireWechatNativeRuntimeLock(accountId);
ok(first !== null, 'first runtime acquires lock');
ok(existsSync(lockPath), 'lock file is created');

const second = wechatNative.tryAcquireWechatNativeRuntimeLock(accountId);
ok(second === null, 'second runtime in same process is blocked by live lock');

if (first) wechatNative.releaseWechatNativeRuntimeLock(first);
ok(!existsSync(lockPath), 'release removes owned lock file');

mkdirSync(dirname(lockPath), { recursive: true });
writeFileSync(lockPath, `${JSON.stringify({
  accountId,
  pid: -1,
  token: 'stale-token',
  acquiredAt: '2026-01-01T00:00:00.000Z',
})}\n`, 'utf-8');

const afterStale = wechatNative.tryAcquireWechatNativeRuntimeLock(accountId);
ok(afterStale !== null, 'stale lock from dead pid is replaced');
if (afterStale) wechatNative.releaseWechatNativeRuntimeLock(afterStale);

const passed = results.filter((result) => result.ok).length;
console.log('');
if (passed === results.length) {
  console.log(`\x1b[32m✔ all ${passed} WeChat runtime lock tests passed\x1b[0m`);
} else {
  console.error(`\x1b[31m✘ ${results.length - passed}/${results.length} WeChat runtime lock tests failed\x1b[0m`);
  for (const result of results.filter((item) => !item.ok)) {
    console.error(` - ${result.name}${result.detail ? `: ${result.detail}` : ''}`);
  }
  process.exit(1);
}
