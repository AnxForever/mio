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
  characterDisplayName,
  characterMetaLine,
  characterTags,
  resolveActiveCharacterId,
} = await import('../../web/js/views/console.js');

const character = {
  id: 'linxia',
  config: {
    name: '林夏',
    gender: 'female',
    age: 24,
    occupation: '自由插画师',
    traits: ['温柔', '慢热', '有边界感'],
    interests: ['插画', '散步', '独立音乐'],
  },
};

assert.equal(characterDisplayName(character), '林夏');
assert.equal(characterDisplayName({ id: 'unknown' }), 'unknown');
assert.equal(characterMetaLine(character), '女 · 24岁 · 自由插画师');
assert.deepEqual(characterTags(character, 4), ['温柔', '慢热', '有边界感', '插画']);
assert.equal(
  resolveActiveCharacterId({ config: { activeMod: 'shenlan' } }, [
    character,
    { id: 'shenlan', active: false, config: { name: '沈岚' } },
  ]),
  'shenlan',
);
assert.equal(
  resolveActiveCharacterId({ config: { activeMod: 'missing' } }, [
    { id: 'zhouhe', active: true, config: { name: '周和' } },
  ]),
  'zhouhe',
);

console.log('✓ console character view-models');
