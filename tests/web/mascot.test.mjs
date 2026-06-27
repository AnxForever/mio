import assert from 'node:assert';
import { padToExpression } from '../../web/js/mascot.js';

// gentle = 默认温柔态(高P低A)
assert.equal(padToExpression({ pleasure: 0.6, arousal: 0.2, dominance: 0.5 }), 'gentle');
// 高P高A → happy
assert.equal(padToExpression({ pleasure: 0.8, arousal: 0.8 }), 'happy');
// 低P → worried
assert.equal(padToExpression({ pleasure: -0.5, arousal: 0.3 }), 'worried');
// 久未互动(daysSince>=2) → longing,优先
assert.equal(padToExpression({ pleasure: 0.5, arousal: 0.3 }, { daysSince: 3 }), 'longing');
// 害羞触发
assert.equal(padToExpression({ pleasure: 0.5, arousal: 0.3 }, { shy: true }), 'shy');
console.log('✓ mascot mapping');
