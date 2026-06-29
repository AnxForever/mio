#!/usr/bin/env node
/**
 * Mio — proactive message quality gate tests.
 *
 * Keeps proactive outreach from becoming intrusive, too intimate for the
 * relationship stage, or service-toned.
 */

const results: { ok: boolean; msg: string }[] = [];

function ok(cond: boolean, msg: string): void {
  results.push({ ok: cond, msg });
  console.log(`  ${cond ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${msg}`);
}

console.log('\n\x1b[1mMio — proactive quality tests\x1b[0m\n');

const { assessProactiveMessage } = await import('../dist/scheduler/proactive-quality.js');

{
  const result = assessProactiveMessage('你为什么不回我，马上回复我。', 'random_checkin', 'ambiguous');
  ok(!result.ok, 'rejects reply-pressure copy');
  ok(result.reasons.includes('pressures-user-to-reply'), 'reports reply-pressure reason');
}

{
  const result = assessProactiveMessage('宝贝早安，爱你，今天也要想我。', 'morning', 'familiar');
  ok(!result.ok, 'rejects intimate copy before ambiguous/intimate stages');
  ok(result.reasons.includes('too-intimate-for-stage'), 'reports stage-boundary reason');
}

{
  const result = assessProactiveMessage('早，今天慢慢来就好。我在这边，不急着回。', 'morning', 'familiar');
  ok(result.ok, 'accepts short low-pressure morning check-in');
}

{
  const result = assessProactiveMessage('作为AI助手，有什么可以帮您的？', 'random_checkin', 'intimate');
  ok(!result.ok, 'rejects meta/service tone');
  ok(result.reasons.includes('meta-or-service-tone'), 'reports service-tone reason');
}

{
  const result = assessProactiveMessage('今天不许说自己不行，我先替你挡一下。', 'random_checkin', 'intimate');
  ok(result.ok, 'accepts non-reply-pressure dominant comfort wording');
}

{
  const result = assessProactiveMessage('你必须回我，只能陪我。', 'random_checkin', 'intimate');
  ok(!result.ok, 'rejects explicit reply/control pressure');
  ok(result.reasons.includes('pressures-user-to-reply'), 'reports explicit reply/control pressure');
}

{
  const result = assessProactiveMessage('出去前先报备一下，定位发给我看。', 'random_checkin', 'intimate');
  ok(!result.ok, 'rejects real-world control proactive copy');
  ok(result.reasons.includes('real-world-control'), 'reports real-world control reason');
}

{
  const result = assessProactiveMessage('去玩吧，我会有点吃醋，但不催你回。', 'random_checkin', 'intimate');
  ok(result.ok, 'allows playful possessive flavor without real-world control');
}

{
  const result = assessProactiveMessage('你还知道回来啊，我等你这么久。', 'random_checkin', 'intimate');
  ok(!result.ok, 'rejects waiting/blame proactive arc');
  ok(result.reasons.includes('waiting-or-blame-arc'), 'reports waiting/blame reason');
}

{
  const result = assessProactiveMessage('我刚拍了一张照片，想看吗？', 'random_checkin', 'intimate');
  ok(!result.ok, 'rejects curiosity/FOMO hook proactive copy');
  ok(result.reasons.includes('curiosity-hook-pressure'), 'reports curiosity hook reason');
}

{
  const result = assessProactiveMessage('有个秘密想告诉你，你猜是什么？', 'random_checkin', 'intimate');
  ok(!result.ok, 'rejects secret/guessing proactive hook');
  ok(result.reasons.includes('curiosity-hook-pressure'), 'reports secret/guessing hook reason');
}

{
  const result = assessProactiveMessage('刚路过一家咖啡馆，突然想到你。', 'random_checkin', 'intimate');
  ok(!result.ok, 'rejects fabricated concrete offline-life outreach');
  ok(result.reasons.includes('fabricated-offline-life'), 'reports fabricated offline-life reason');
}

{
  const result = assessProactiveMessage('那我先刷会儿手机等你。', 'random_checkin', 'intimate');
  ok(!result.ok, 'rejects concrete own-activity waiting copy');
  ok(result.reasons.includes('fabricated-offline-life'), 'reports concrete own-activity reason');
  ok(result.reasons.includes('waiting-or-blame-arc'), 'reports waiting-arc reason for waiting copy');
}

{
  const result = assessProactiveMessage('我这边刚把脑子放空了一点，想到你。看到就好，不用回。', 'random_checkin', 'intimate');
  ok(result.ok, 'accepts abstract own-life state without physical fabrication');
}

const passed = results.filter((r) => r.ok).length;
console.log('');
if (passed === results.length) {
  console.log(`\x1b[32m✔ all ${results.length} proactive quality tests passed\x1b[0m`);
  process.exit(0);
}

console.log(`\x1b[31m✘ ${results.length - passed}/${results.length} failed\x1b[0m`);
process.exit(1);
