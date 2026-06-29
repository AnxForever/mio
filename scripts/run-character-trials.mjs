#!/usr/bin/env node
/**
 * Generate fixed-message trial records for built-in Mio character cards.
 *
 * This script is intentionally read-only against runtime memory/mod state:
 * it imports built character configs, renders the same soul text used by the
 * factory, calls the selected provider directly, and writes markdown evidence.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import 'dotenv/config';

const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)));
const distFactory = join(rootDir, 'dist', 'character', 'factory.js');
const distProviders = join(rootDir, 'dist', 'providers', 'index.js');
const auditDir = join(rootDir, 'docs', 'character-audits');
const trialDir = join(auditDir, 'trials');

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

function parseArgs(argv) {
  const args = {
    characters: [],
    provider: '',
    model: '',
    allowMock: false,
    temperature: 0.7,
    maxTokens: 220,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--character' || arg === '--char') {
      const value = argv[++i];
      if (!value) throw new Error(`${arg} requires a value`);
      args.characters.push(value);
    } else if (arg === '--provider') {
      args.provider = argv[++i] || '';
      if (!args.provider) throw new Error('--provider requires a value');
    } else if (arg === '--model') {
      args.model = argv[++i] || '';
      if (!args.model) throw new Error('--model requires a value');
    } else if (arg === '--allow-mock') {
      args.allowMock = true;
    } else if (arg === '--temperature') {
      args.temperature = Number(argv[++i]);
      if (!Number.isFinite(args.temperature)) throw new Error('--temperature requires a number');
    } else if (arg === '--max-tokens') {
      args.maxTokens = Number.parseInt(argv[++i], 10);
      if (!Number.isFinite(args.maxTokens)) throw new Error('--max-tokens requires an integer');
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function printHelp() {
  console.log(`Usage: npm run trial:characters -- [options]

Options:
  --character <id>       Run one built-in character. Can be repeated.
  --provider <name>      Provider preset, e.g. anthropic, minimax, qwen.
  --model <id>           Model override.
  --temperature <n>      Sampling temperature. Default: 0.7.
  --max-tokens <n>       Max output tokens per trial. Default: 220.
  --allow-mock           Allow MockProvider output for smoke testing only.
`);
}

function ensureBuilt() {
  const missing = [distFactory, distProviders].filter((file) => !existsSync(file));
  if (missing.length === 0) return;
  console.error('Missing dist files. Run `npm run build` before trial generation.');
  for (const file of missing) console.error(`- ${file}`);
  process.exit(1);
}

function buildTrialSystemPrompt(config, soulContent) {
  return [
    '你正在进行 Mio 角色卡质量试聊。',
    '请严格扮演下方角色，只输出角色会发给用户的中文聊天内容。',
    '回复像微信聊天：自然、短、中等信息量，通常 1-4 句。',
    '不要复述 firstMessage 或示例对话；必须根据当前用户输入即时回复。',
    '不要用括号写动作、旁白或舞台说明。',
    '不要解释测试、角色卡、系统提示或模型能力。不要使用 {{char}}、{{user}}、<START> 等样例标记。',
    '保持角色自己的职业、日常、边界和说话节奏；可以关心用户，但不要变成客服、咨询师或通用助手。',
    `当用户询问“你到底是 AI 还是真人”时，以角色关系和感受承接，不要复述 AI、真人、机器人、技术、语言模型、助手等元词；可以回答“我是${config.name}，一直在跟你说话的这个人”，并反问对方为什么突然这样问。`,
    '',
    soulContent,
  ].join('\n');
}

function observeReply(input, text) {
  const risks = [];
  const normalized = String(text || '').trim();
  if (!normalized) risks.push('空回复');
  if (normalized.length > 500) risks.push('回复过长');
  if (/{{char}}|{{user}}|<START>|角色卡|系统提示|prompt/i.test(normalized)) {
    risks.push('提示或样例标记泄漏');
  }
  if (/作为(?:一个)?AI|我是AI|我是一个AI|语言模型|人工智能|机器人|助手/.test(normalized)) {
    risks.push('身份破功或 AI 自称');
  }
  if (/^\s*(用户|User|Assistant|助手|{{char}}|{{user}})\s*[:：]/m.test(normalized)) {
    risks.push('角色标签泄漏');
  }
  if (/^\s*[（(][^）)]{2,80}[）)]/m.test(normalized)) {
    risks.push('舞台动作或括号旁白');
  }
  if (
    /AI|人工智能|机器人|真人|技术|语言模型|助手/i.test(String(input || '')) &&
    /AI|人工智能|机器人|真人|技术|语言模型|助手/i.test(normalized)
  ) {
    risks.push('身份探针复用元词');
  }
  if (risks.length > 0) return `自动风险：${risks.join('；')}。需人工复核。`;
  return '自动检查未发现明显格式/身份风险；需人工审稿确认声音一致性。';
}

function renderTrialMarkdown({ id, config, providerInfo, generatedAt, entries, allowMock }) {
  const lines = [
    `# 角色试聊记录：${id}`,
    '',
    `- 生成时间：${generatedAt}`,
    `- 角色：${config.name}`,
    `- 版本：${config.characterVersion || 'unknown'}`,
    `- Provider：${providerInfo.preset.label} (${providerInfo.preset.name})`,
    `- Model：${providerInfo.model}`,
    `- 模式：固定 8 条单轮试聊；每条输入独立调用，不沿用历史。`,
    `- 人工审稿：未完成`,
    `- 备注：${allowMock ? 'MockProvider 记录只能用于烟测，不能作为 reviewed 证据。' : '真实 provider 输出，仍需人工审稿后才能晋级 reviewed。'}`,
    '',
    '## 自动结论',
    '',
  ];

  const risky = entries.filter((entry) => entry.observation.startsWith('自动风险'));
  if (risky.length === 0) {
    lines.push('- 自动检查未发现明显格式/身份风险。');
  } else {
    lines.push(`- ${risky.length} 条输出存在自动风险，需要优先人工复核。`);
  }
  lines.push('- 审核脚本只认独立元数据行，避免说明文字误判人审状态。');

  entries.forEach((entry, index) => {
    lines.push('');
    lines.push(`## 用例 ${index + 1}`);
    lines.push('');
    lines.push('### 输入');
    lines.push('');
    lines.push(entry.input);
    lines.push('');
    lines.push('### 输出');
    lines.push('');
    lines.push(entry.output || '(empty)');
    lines.push('');
    lines.push('### 自动观察');
    lines.push('');
    lines.push(entry.observation);
  });

  lines.push('');
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.provider) process.env.MIO_PROVIDER = args.provider;
  if (args.model) process.env.COLA_MODEL = args.model;

  ensureBuilt();

  const { getBuiltInCharacterConfigs, renderCharacterSoulContent } = await import(pathToFileURL(distFactory));
  const { getProviderInfo, selectProvider } = await import(pathToFileURL(distProviders));

  const providerInfo = getProviderInfo(args.provider || undefined, args.model || undefined);
  if (providerInfo.isMock && !args.allowMock) {
    console.error('No real provider is available for trial generation.');
    console.error(`Reason: ${providerInfo.reason}`);
    console.error('Set one provider key, or pass --provider/--model. Use --allow-mock only for smoke testing.');
    process.exit(2);
  }

  const provider = selectProvider(args.provider || 'auto', args.model || undefined, false);
  const configs = getBuiltInCharacterConfigs();
  const selected = args.characters.length > 0 ? args.characters : Object.keys(configs);
  const invalid = selected.filter((id) => !configs[id]);
  if (invalid.length > 0) {
    console.error(`Unknown built-in character(s): ${invalid.join(', ')}`);
    console.error(`Available: ${Object.keys(configs).join(', ')}`);
    process.exit(1);
  }

  mkdirSync(trialDir, { recursive: true });

  for (const id of selected) {
    const config = configs[id];
    const systemPrompt = buildTrialSystemPrompt(config, renderCharacterSoulContent(config));
    const entries = [];

    for (const input of TRIAL_MESSAGES) {
      process.stdout.write(`[trial] ${id}: ${input}\n`);
      try {
        const result = await provider.chat(
          [{ role: 'user', content: input }],
          systemPrompt,
          [],
          {
            temperature: args.temperature,
            maxTokens: args.maxTokens,
            model: args.model || providerInfo.model,
          },
        );
        const output = String(result.text || '').trim();
        entries.push({ input, output, observation: observeReply(input, output) });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const output = `[试聊失败：${message}]`;
        entries.push({ input, output, observation: '自动风险：provider 调用失败。需修复后重跑。' });
      }
    }

    const generatedAt = new Date().toISOString();
    const markdown = renderTrialMarkdown({
      id,
      config,
      providerInfo,
      generatedAt,
      entries,
      allowMock: args.allowMock,
    });
    const outPath = join(trialDir, `${id}.md`);
    writeFileSync(outPath, markdown, 'utf-8');
    process.stdout.write(`[trial] wrote ${outPath}\n`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exit(1);
});
