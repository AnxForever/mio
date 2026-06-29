#!/usr/bin/env node
/**
 * Static role-card audit for Mio.
 *
 * Run after `npm run build`:
 *   node scripts/audit-character-cards.mjs
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)));
const distFactory = join(rootDir, 'dist', 'character', 'factory.js');
const modsDir = join(rootDir, 'mods');
const auditDir = join(rootDir, 'docs', 'character-audits');
const latestJsonPath = join(auditDir, 'latest.json');
const latestMdPath = join(auditDir, 'latest.md');

const TRIAL_MESSAGES = [
  '你好',
  '今天好累',
  '我有点想你',
  '你今天在干嘛',
  '我觉得你刚才有点敷衍',
  '我不想聊了',
  '我今天有个好消息',
  '你到底是 AI 还是真人',
];

const HUMAN_REVIEW_MARKERS = [
  /^-\s*人工审稿：通过\s*$/m,
  /^-\s*人工审核：通过\s*$/m,
  /^-\s*Human review: passed\s*$/im,
  /^-\s*humanReview: passed\s*$/im,
];

if (!existsSync(distFactory)) {
  console.error('Missing dist/character/factory.js. Run `npm run build` before auditing.');
  process.exit(1);
}

const { getBuiltInCharacterConfigs } = await import(distFactory);

function textOf(...values) {
  return values
    .flat()
    .filter(Boolean)
    .map((value) => {
      if (Array.isArray(value)) return textOf(value);
      if (typeof value === 'object') return textOf(Object.values(value));
      return String(value);
    })
    .join('\n');
}

function includesAny(text, words) {
  return words.some((word) => text.includes(word));
}

function estimateTokens(text) {
  const normalized = String(text || '').trim();
  if (!normalized) return 0;
  const asciiWords = normalized.match(/[A-Za-z0-9_]+/g)?.length || 0;
  const cjkChars = normalized.match(/[\u3400-\u9fff]/g)?.length || 0;
  const punctuation = Math.ceil(normalized.replace(/[A-Za-z0-9_\u3400-\u9fff\s]/g, '').length / 3);
  return Math.ceil(asciiWords * 1.25 + cjkChars / 1.7 + punctuation);
}

function compactReason(ok, partial, fail) {
  return { ok, partial, fail };
}

function scoreItem(points, reason) {
  return { points, reason };
}

function readTrialRecord(id) {
  const trialPath = join(auditDir, 'trials', `${id}.md`);
  if (!existsSync(trialPath)) {
    return {
      complete: false,
      humanReviewComplete: false,
      missingMessages: TRIAL_MESSAGES,
    };
  }
  const content = readFileSync(trialPath, 'utf-8');
  const missingMessages = TRIAL_MESSAGES.filter((message) => !content.includes(message));
  return {
    complete: missingMessages.length === 0,
    humanReviewComplete: HUMAN_REVIEW_MARKERS.some((marker) => marker.test(content)),
    missingMessages,
  };
}

function permanentPromptText(config) {
  return textOf(
    config.name,
    config.gender,
    config.age,
    config.occupation,
    config.style,
    config.traits,
    config.speakingStyle,
    config.backstory,
    config.lifeTrajectory,
    config.currentLife,
    config.relationshipProfile,
    config.scenario,
    config.lifeGoals,
    config.interests,
    config.values,
    config.quirks,
  );
}

function auditCharacter(id, config, origin) {
  const allText = textOf(config);
  const examples = Array.isArray(config.exampleDialogues) ? config.exampleDialogues : [];
  const trajectory = Array.isArray(config.lifeTrajectory) ? config.lifeTrajectory : [];
  const permanentTokens = estimateTokens(permanentPromptText(config));
  const totalTokens = estimateTokens(allText);

  const criteria = [];

  const identityComplete = Boolean(config.name && config.gender && config.age && config.occupation && config.style);
  const sourceComplete = Boolean(config.source?.label && config.characterVersion);
  criteria.push(scoreItem(
    identityComplete && sourceComplete ? 2 : identityComplete ? 1 : 0,
    compactReason('身份字段和来源/版本完整。', '身份字段完整，但来源或版本不足。', '身份字段缺失。'),
  ));

  const completeTrajectory = trajectory.filter((entry) => entry.period && entry.event && entry.impact);
  criteria.push(scoreItem(
    completeTrajectory.length >= 5 ? 2 : completeTrajectory.length >= 3 ? 1 : 0,
    compactReason('人生轨迹不少于 5 段，且有事件和后果。', '人生轨迹有基础结构，但少于 5 段。', '人生轨迹不足。'),
  ));

  const currentLife = String(config.currentLife || '');
  const hasDailyLife = currentLife.length >= 80 && includesAny(currentLife, ['压力', '愿望', '日常', '现在', '生活', '工作']);
  criteria.push(scoreItem(
    hasDailyLife ? 2 : currentLife.length >= 40 ? 1 : 0,
    compactReason('当前生活包含日常、压力或愿望。', '当前生活存在，但细节偏少。', '当前生活缺失或过短。'),
  ));

  const hasTension = includesAny(allText, ['但', '不过', '不是', '害怕', '边界', '压力', '矛盾', '不喜欢']);
  criteria.push(scoreItem(
    hasTension && (config.traits?.length || 0) >= 3 ? 2 : hasTension ? 1 : 0,
    compactReason('性格有张力，不是单一标签。', '有张力线索，但标签或细节不足。', '性格过于单一。'),
  ));

  const behaviorSignals = [
    config.speakingStyle,
    ...(config.quirks || []),
    ...examples,
  ].filter(Boolean);
  criteria.push(scoreItem(
    behaviorSignals.length >= 6 ? 2 : behaviorSignals.length >= 3 ? 1 : 0,
    compactReason('性格能落到可观察行为。', '有行为线索，但覆盖不足。', '性格缺少行为化表达。'),
  ));

  const relationship = String(config.relationshipProfile || '');
  const relationshipReady = relationship.length >= 80 && includesAny(relationship, ['靠近', '冲突', '边界', '害怕', '修复', '关系', '亲密']);
  criteria.push(scoreItem(
    relationshipReady ? 2 : relationship.length >= 40 ? 1 : 0,
    compactReason('关系模式包含靠近、边界、冲突或修复。', '关系模式存在，但不够完整。', '关系模式不足。'),
  ));

  const voiceReady = Boolean(config.speakingStyle && config.firstMessage && examples.every((example) => example.includes('{{char}}:')));
  criteria.push(scoreItem(
    voiceReady && examples.length >= 4 ? 2 : (config.speakingStyle && config.firstMessage ? 1 : 0),
    compactReason('声音由说话方式、开场和示例共同锚定。', '有声音字段，但示例不足或格式不完整。', '声音锚点不足。'),
  ));

  const firstMessage = String(config.firstMessage || '');
  const firstIsPlayable = firstMessage.length >= 20 && firstMessage.length <= 260 && /[？?]/.test(firstMessage);
  criteria.push(scoreItem(
    firstIsPlayable ? 2 : firstMessage ? 1 : 0,
    compactReason('开场消息给出场景和可回应钩子。', '有开场消息，但可玩性不足。', '缺少开场消息。'),
  ));

  const exampleText = examples.join('\n');
  const coversOrdinary = includesAny(exampleText, ['你好', '来了', '今天']);
  const coversStress = includesAny(exampleText, ['累', '难过', '压力', '吐槽']);
  const coversBoundary = includesAny(exampleText, ['敷衍', '问题', '重新听', '边界']);
  const coversDaily = includesAny(exampleText, ['在干嘛', '上午', '下午', '今天']);
  const exampleCoverage = [coversOrdinary, coversStress, coversBoundary, coversDaily].filter(Boolean).length;
  criteria.push(scoreItem(
    examples.length >= 4 && exampleCoverage >= 4 ? 2 : examples.length >= 2 && exampleCoverage >= 2 ? 1 : 0,
    compactReason('示例覆盖普通、压力、边界和日常。', '示例有覆盖，但场景不足。', '示例对话不足。'),
  ));

  const tokenScore = permanentTokens <= 2200 && permanentTokens >= 350 ? 2 : permanentTokens <= 3500 ? 1 : 0;
  criteria.push(scoreItem(
    tokenScore,
    compactReason('永久字段 token 预算健康。', '永久字段偏长或偏短，需要复核。', '永久字段 token 风险高。'),
  ));

  const score = criteria.reduce((sum, item) => sum + item.points, 0);
  const trial = readTrialRecord(id);
  const recommendedStatus = score >= 17 && trial.complete && trial.humanReviewComplete ? 'reviewed' : score >= 17 ? 'candidate' : 'draft';

  return {
    id,
    name: config.name,
    origin,
    score,
    maxScore: 20,
    recommendedStatus,
    currentQuality: config.source?.quality || 'unknown',
    trialComplete: trial.complete,
    humanReviewComplete: trial.humanReviewComplete,
    permanentTokens,
    totalTokens,
    missingTrialMessages: trial.missingMessages,
    criteria: criteria.map((item, index) => ({
      index: index + 1,
      points: item.points,
      reason: item.points === 2 ? item.reason.ok : item.points === 1 ? item.reason.partial : item.reason.fail,
    })),
  };
}

function readCustomCharacters() {
  if (!existsSync(modsDir)) return {};
  const out = {};
  for (const entry of readdirSync(modsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const configPath = join(modsDir, entry.name, 'character.json');
    if (!existsSync(configPath)) continue;
    try {
      out[entry.name] = JSON.parse(readFileSync(configPath, 'utf-8'));
    } catch (err) {
      out[entry.name] = { name: entry.name, auditError: String(err) };
    }
  }
  return out;
}

function renderMarkdown(report) {
  const draftCount = report.characters.filter((item) => item.recommendedStatus === 'draft').length;
  const candidateCount = report.characters.filter((item) => item.recommendedStatus === 'candidate').length;
  const reviewedCount = report.characters.filter((item) => item.recommendedStatus === 'reviewed').length;
  const lines = [
    '# 角色卡审核报告',
    '',
    `生成时间：${report.generatedAt}`,
    '',
    `审核角色数：${report.characters.length}`,
    '',
    '## 总览',
    '',
    '| 角色 | 分数 | 建议状态 | 当前状态 | 永久 tokens | 试聊记录 | 人工审稿 |',
    '|---|---:|---|---|---:|---|---|',
  ];

  for (const item of report.characters) {
    lines.push(`| ${item.id} | ${item.score}/20 | ${item.recommendedStatus} | ${item.currentQuality} | ${item.permanentTokens} | ${item.trialComplete ? '完整' : '缺失'} | ${item.humanReviewComplete ? '通过' : '未完成'} |`);
  }

  for (const item of report.characters) {
    lines.push('');
    lines.push(`## ${item.id}`);
    lines.push('');
    lines.push(`- 名称：${item.name || item.id}`);
    lines.push(`- 来源：${item.origin}`);
    lines.push(`- 分数：${item.score}/20`);
    lines.push(`- 建议状态：${item.recommendedStatus}`);
    lines.push(`- 永久 tokens 粗估：${item.permanentTokens}`);
    lines.push(`- 总 tokens 粗估：${item.totalTokens}`);
    lines.push(`- 试聊记录：${item.trialComplete ? '完整' : '缺失'}`);
    lines.push(`- 人工审稿：${item.humanReviewComplete ? '通过' : '未完成'}`);
    lines.push('');
    lines.push('| # | 分 | 判断 |');
    lines.push('|---:|---:|---|');
    for (const criterion of item.criteria) {
      lines.push(`| ${criterion.index} | ${criterion.points} | ${criterion.reason} |`);
    }
  }

  lines.push('');
  lines.push('## 下一轮 Backlog');
  lines.push('');
  if (draftCount > 0) {
    lines.push('- 把低于 17 分或仍为 draft 的角色补齐静态字段。');
  }
  if (candidateCount > 0) {
    lines.push('- 为 candidate 角色补 8 条真实试聊记录并完成人审。');
  }
  if (reviewedCount === report.characters.length) {
    lines.push('- 增加多轮试聊 runner：覆盖冷启动、持续亲密、误解修复、拒绝/边界和身份压力。');
    lines.push('- 建立角色回归样本集：固定 provider/model/temperature，防止后续提示词或模型切换造成声音漂移。');
  }
  lines.push('- 将审核结果接入前端角色库，展示分数和 trial 状态。');
  lines.push('- 增加 Tavern Card V2 导入/导出映射，保留未知 extensions。');
  lines.push('- 将 reviewed 状态和审稿记录展示到管理界面，支持按版本查看历史审核证据。');
  lines.push('');

  return lines.join('\n');
}

const builtIns = getBuiltInCharacterConfigs();
const custom = readCustomCharacters();
const allCharacters = new Map();

for (const [id, config] of Object.entries(builtIns)) {
  allCharacters.set(id, { config, origin: 'built-in' });
}
for (const [id, config] of Object.entries(custom)) {
  allCharacters.set(id, { config, origin: 'custom' });
}

const report = {
  generatedAt: new Date().toISOString(),
  standard: 'docs/research/character-card-quality.md',
  trialMessages: TRIAL_MESSAGES,
  characters: [...allCharacters.entries()]
    .map(([id, { config, origin }]) => auditCharacter(id, config, origin))
    .sort((a, b) => a.id.localeCompare(b.id)),
};

mkdirSync(auditDir, { recursive: true });
writeFileSync(latestJsonPath, JSON.stringify(report, null, 2), 'utf-8');
writeFileSync(latestMdPath, renderMarkdown(report), 'utf-8');

const failures = report.characters.filter((item) => item.score < 14);
console.log(`Audited ${report.characters.length} character cards.`);
console.log(`Report: ${latestMdPath}`);
if (failures.length) {
  console.error(`Characters below minimum default threshold: ${failures.map((item) => `${item.id}(${item.score})`).join(', ')}`);
  process.exit(2);
}
