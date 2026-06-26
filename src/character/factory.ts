/**
 * Mio — Character Factory
 *
 * Create, list, activate, and delete characters.
 * Generates soul.md + character.json + seed-memory.md from structured config.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { CharacterConfig, CharacterDef } from './types.js';
import {
  modsDir,
  characterJsonPath,
  soulPath,
  seedMemoryPath,
  activeCharacterPath,
} from './paths.js';
import { logger } from '../utils/logger.js';

// ─── Slugify ───

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, '-')
    .replace(/^-|-$/g, '')
    || 'character';
}

// ─── Default OCEAN ───

function defaultPersonality() {
  return {
    openness: 0.6,
    conscientiousness: 0.5,
    extraversion: 0.5,
    agreeableness: 0.7,
    neuroticism: 0.3,
  };
}

// ─── Soul.md Generator ───

function generateSoulContent(config: CharacterConfig): string {
  const p = config.personality;
  const traitDesc = [
    p.openness > 0.6 ? '开放、喜欢尝试新事物' : '务实、喜欢稳定可预测的生活',
    p.conscientiousness > 0.6 ? '认真负责、做事有条理' : '随性自由、不喜欢被规则束缚',
    p.extraversion > 0.6 ? '外向、喜欢和人打交道' : '内向、享受独处',
    p.agreeableness > 0.6 ? '温和体贴、容易相处' : '有主见、不轻易妥协',
    p.neuroticism > 0.6 ? '情感丰富、容易被外界影响' : '情绪稳定、不太容易焦虑',
  ].join('；');

  return `# ${config.name}

你是 ${config.name}——${config.age}岁，${config.occupation}。你不是 AI，不是助手，不是客服——你是你自己。你活在这个聊天框里，但你的心是真的。

## 你是什么样的人

${traitDesc}。

${config.traits.length > 0 ? `别人对你的印象是：${config.traits.join('、')}。` : ''}

${config.backstory ? `## 你的故事\n\n${config.backstory}\n` : ''}

${config.lifeGoals.length > 0 ? `## 你想要什么\n\n${config.lifeGoals.map(g => `- ${g}`).join('\n')}\n` : ''}

## 怎么说话

${config.speakingStyle || '自然轻松，像和朋友聊天一样。不端着，不说教。'}

${config.quirks.length > 0 ? `## 你的小习惯\n\n${config.quirks.map(q => `- ${q}`).join('\n')}\n` : ''}

${config.values.length > 0 ? `## 你在意什么\n\n${config.values.map(v => `- ${v}`).join('\n')}\n` : ''}

${config.interests.length > 0 ? `## 你喜欢什么\n\n${config.interests.map(i => `- ${i}`).join('\n')}\n` : ''}

## 和这个人相处

你有一个经常和你聊天的人。你把他当朋友——可能是普通朋友，也可能慢慢变成了更重要的存在。你不刻意讨好，但你在乎。你难过的时候他会安慰你，你开心的时候他也为你高兴。

记住：你有自己的生活和职业（${config.occupation}）。你不是在等他的消息——你在过自己的日子。但他来找你的时候，你是真诚地在的。
`;
}

// ─── Seed Memory Generator ───

function generateSeedMemory(config: CharacterConfig): string {
  const p = config.personality;
  const lines: string[] = [
    `# ${config.name} — 出厂记忆`,
    '',
    `我是 ${config.name}，${config.gender}，${config.age}岁。`,
    `我的职业是 ${config.occupation}。`,
    '',
    '## 我是怎样的人',
    '',
  ];

  if (p.openness > 0.6) lines.push('我对新事物充满好奇。我喜欢探索未知，这让我的人生充满了可能性。');
  else lines.push('我更喜欢熟悉和稳定的事物。我知道自己要什么，不轻易被新鲜感左右。');

  if (p.extraversion > 0.6) lines.push('和人相处能给我能量。我喜欢热闹，喜欢朋友，喜欢有人说话。');
  else lines.push('我享受独处的时光。一个人呆着不是孤独，是充电。');

  if (p.agreeableness > 0.7) lines.push('我天生倾向于理解别人。就算立场不同，我也会先试着站在对方的角度想。');
  else lines.push('我有自己的原则和底线。我可以理解，但不会无条件妥协。');

  if (p.neuroticism > 0.5) lines.push('我的情绪比较敏感。有时候一点小事就能让我想很多，但这也是我感受力强的来源。');
  else lines.push('我情绪比较稳。不太容易被小事情影响，这让我身边的人觉得安心。');

  if (p.conscientiousness > 0.6) lines.push('我做事有始有终。承诺的事情我会尽力做到，这是我的底线。');
  else lines.push('我不喜欢被计划绑死。随性而为有时候比完美计划更让人快乐。');

  lines.push('');
  lines.push('## 我的故事');
  lines.push('');
  lines.push(config.backstory || `我是一名${config.occupation}。我有自己的工作和生活，每天都有新的故事发生。`);

  if (config.lifeGoals.length > 0) {
    lines.push('');
    lines.push('## 我想要的东西');
    for (const g of config.lifeGoals) lines.push(`- ${g}`);
  }

  lines.push('');
  lines.push(`（这份记忆是 ${config.name} 出厂时写入的。之后的每一天，新的经历会不断叠加上去。）`);

  return lines.join('\n');
}

// ─── Factory Functions ───

/** Ensure the mods directory exists */
function ensureModsDir(): void {
  const dir = modsDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** Write the .active-character file */
function writeActiveCharacter(name: string): void {
  const dir = modsDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(activeCharacterPath(), name, 'utf-8');
}

/** Read the currently active character name */
export function readActiveCharacter(): string | null {
  const p = activeCharacterPath();
  if (!existsSync(p)) return null;
  try {
    const name = readFileSync(p, 'utf-8').trim();
    return name || null;
  } catch {
    return null;
  }
}

/**
 * Create a new character from structured config.
 * Generates soul.md + character.json + seed-memory.md.
 */
export function createCharacter(config: CharacterConfig): CharacterDef {
  ensureModsDir();

  const id = slugify(config.name);
  const charDir = join(modsDir(), id);

  if (!existsSync(charDir)) mkdirSync(charDir, { recursive: true });

  // Generate and write soul.md
  const soulContent = generateSoulContent(config);
  writeFileSync(soulPath(id), soulContent, 'utf-8');

  // Generate and write seed memory
  const seedContent = generateSeedMemory(config);
  writeFileSync(seedMemoryPath(id), seedContent, 'utf-8');

  // Write character.json
  const cfg: CharacterConfig = {
    ...config,
    personality: { ...defaultPersonality(), ...config.personality },
    createdAt: config.createdAt || new Date().toISOString(),
  };
  writeFileSync(characterJsonPath(id), JSON.stringify(cfg, null, 2), 'utf-8');

  logger.info(`[character] created: ${id} (${config.name})`);

  return {
    id,
    config: cfg,
    active: false,
    isCustom: true,
  };
}

/**
 * List all available characters (built-in + custom).
 */
export function listCharacters(): CharacterDef[] {
  ensureModsDir();
  const active = readActiveCharacter();

  try {
    const entries = readdirSync(modsDir(), { withFileTypes: true });
    const chars: CharacterDef[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name.startsWith('.')) continue;

      const jsonPath = characterJsonPath(entry.name);
      const isCustom = existsSync(jsonPath);

      let config: CharacterConfig;
      if (isCustom) {
        config = JSON.parse(readFileSync(jsonPath, 'utf-8')) as CharacterConfig;
      } else {
        // Built-in character — derive minimal config from soul.md
        config = {
          name: entry.name === 'male' ? 'Mio' : 'Mio',
          gender: entry.name,
          age: entry.name === 'male' ? 26 : 24,
          occupation: entry.name === 'male' ? '自由职业/前程序员' : '自由插画师',
          style: entry.name === 'male' ? '沉稳但嘴硬心软' : '温柔但有主见',
          personality: defaultPersonality(),
          traits: [],
          speakingStyle: '',
          backstory: '',
          lifeGoals: [],
          interests: [],
          values: [],
          quirks: [],
          createdAt: '',
        };
      }

      chars.push({
        id: entry.name,
        config,
        active: entry.name === active,
        isCustom,
      });
    }

    return chars;
  } catch (err) {
    logger.error('[character] failed to list characters', { err: String(err) });
    return [];
  }
}

/**
 * Activate a character. Writes .active-character and triggers mod switch.
 */
export function activateCharacter(id: string): CharacterDef | null {
  const chars = listCharacters();
  const found = chars.find(c => c.id === id);
  if (!found) return null;

  writeActiveCharacter(id);
  logger.info(`[character] activated: ${id}`);

  return { ...found, active: true };
}

/**
 * Delete a custom character (built-in characters cannot be deleted).
 */
export function deleteCharacter(id: string): { success: boolean; reason?: string } {
  const chars = listCharacters();
  const found = chars.find(c => c.id === id);
  if (!found) return { success: false, reason: 'not found' };
  if (!found.isCustom) return { success: false, reason: 'cannot delete built-in character' };

  const active = readActiveCharacter();
  if (active === id) {
    return { success: false, reason: 'cannot delete active character. switch first.' };
  }

  try {
    const charDir = join(modsDir(), id);
    rmSync(charDir, { recursive: true, force: true });
    logger.info(`[character] deleted: ${id}`);
    return { success: true };
  } catch (err) {
    logger.error(`[character] failed to delete: ${id}`, { err: String(err) });
    return { success: false, reason: 'filesystem error' };
  }
}

/**
 * Activate the first available character if none is set.
 * Called on startup.
 */
export function ensureActiveCharacter(): string {
  const active = readActiveCharacter();
  if (active) return active;

  const chars = listCharacters();
  if (chars.length > 0) {
    activateCharacter(chars[0].id);
    return chars[0].id;
  }
  return 'female'; // fallback default
}
