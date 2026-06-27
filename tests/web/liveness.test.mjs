import assert from 'node:assert';
import { relationshipVM, moodVM } from '../../web/js/liveness.js';

/* ─── relationshipVM ─── */

// familiar 阶段:中文标签 + 下一阶段 + 进度在 [0,1]
const r = relationshipVM({ stage: 'familiar', interactionCount: 23 });
assert.equal(r.label, '熟悉');
assert.equal(r.count, 23);
assert.equal(r.nextStage, '暧昧');
assert.ok(r.progress >= 0 && r.progress <= 1, 'progress 应在 [0,1]');

// 满级 intimate:无下一阶段,progress=1
const ri = relationshipVM({ stage: 'intimate', interactionCount: 999 });
assert.equal(ri.label, '亲密');
assert.equal(ri.nextStage, null);
assert.equal(ri.progress, 1);

// 缺省 / 非法 stage → 回落初识
const r0 = relationshipVM({});
assert.equal(r0.stage, 'acquaintance');
assert.equal(r0.label, '初识');
assert.equal(r0.nextStage, '熟悉');

// 进度随交互递增(acquaintance 阶段 0→50)
assert.ok(
  relationshipVM({ stage: 'acquaintance', interactionCount: 25 }).progress >
  relationshipVM({ stage: 'acquaintance', interactionCount: 5 }).progress,
  'progress 应随交互次数递增'
);

/* ─── moodVM ─── */

// 高P高A → happy / 开心
const m = moodVM({ pad: { pleasure: 0.8, arousal: 0.8 } });
assert.equal(m.expr, 'happy');
assert.equal(m.label, '开心');

// 久未互动 → longing / 想你了
const ml = moodVM({ pad: { pleasure: 0.5, arousal: 0.3 }, daysSince: 3 });
assert.equal(ml.expr, 'longing');
assert.equal(ml.label, '想你了');

// 无 pad → 默认 gentle / 温柔(防御,与聊天页头像一致)
const md = moodVM({});
assert.equal(md.expr, 'gentle');
assert.equal(md.label, '温柔');

console.log('✓ liveness view-models');
