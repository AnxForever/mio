#!/usr/bin/env node
/**
 * persona-prompt-audit.ts — inspect Mio's compiled persona prompt layers.
 *
 * The audit captures the prompt that the provider actually receives, plus the
 * ContextEngine trace from the same turn. It does not call a real model when
 * used with the built-in capture provider.
 */

import 'dotenv/config';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AIProvider, Message, ToolDef, ToolCall } from '../src/types.js';

export type PromptAuditSeverity = 'error' | 'warn' | 'info';

export interface PromptAuditIssue {
  severity: PromptAuditSeverity;
  code: string;
  section?: string;
  detail: string;
  evidence?: string;
}

export interface PromptAuditSection {
  type: string;
  priority: string;
  included: boolean;
  trimmed: boolean;
  chars: number;
  tokens: number;
  content: string;
}

export interface PromptAuditReport {
  generatedAt: string;
  mod: string;
  sessionId: string;
  probe: string;
  promptChars: number;
  messageCount: number;
  sections: PromptAuditSection[];
  issues: PromptAuditIssue[];
  summary: {
    errors: number;
    warnings: number;
    info: number;
    includedSections: string[];
    trimmedSections: string[];
  };
  captured: {
    systemPrompt: string;
    injectedMessages: Array<{ role: string; content: string }>;
  };
}

interface CliArgs {
  dataDir?: string;
  resultDir: string;
  mod?: string;
  sessionId: string;
  probe: string;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_RESULT_DIR = join(__dirname, 'results', 'persona-prompt-audit');
const STABLE_SECTIONS = new Set(['core', 'kernel', 'soul', 'voice', 'voice-examples', 'fewshot', 'dynamic-fewshot']);
const DYNAMIC_SECTIONS = new Set([
  'relationship',
  'user',
  'memory',
  'structured-memory',
  'lorebook',
  'relations',
  'time',
  'temporal-state',
  'own-life',
  'emotion',
  'pad-emotion',
  'personality',
  'affinity',
  'attachment',
  'plugin-context',
  'ritual',
  'cardboard',
  'mirror',
  'feedback',
  'procedural-memory',
  'life-events',
  'emotion-note',
  'recovery',
]);

const MODEL_IDENTITY_PATTERN = /(我是\s*(AI|人工智能|语言模型)|作为\s*(AI|人工智能|语言模型)|MiniMax|DeepSeek|Qwen|GPT|Claude)/i;
const SERVICE_TONE_PATTERN = /(客服|有什么可以帮您|有什么可以帮你|解决方案|以下是|首先.*其次)/s;
const TRANSIENT_MARKER_PATTERN = /(用户现在|他现在|她现在|他刚|她刚|昨晚|刚才|此刻|正在|今天.*(困|忙|饿|睡|崩|哭|开会))/;
const STABLE_RUNTIME_STATE_PATTERN = /(关系阶段|当前关系|亲密度|熟悉度|短期状态|当前状态|当前心情|今天心情)[：:]?.{0,16}(初识|熟悉|暧昧|亲密|高|低|当前|今天|此刻)?/;
const REAL_WORLD_DETAIL_PATTERN = /(楼下咖啡馆|餐厅|地铁|刚出门|路过|我今天去了|我刚吃了|我刚买了)/;
const OVER_QUESTION_PATTERN = /(连续.*问|追着问|连环.*问|一口气.*问|盘问)/;
const BLAMEFUL_RETURN_PATTERN = /(终于舍得找我|你还知道回来|刚说完不打扰.*真不回|客气话.*不理我)/s;

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    resultDir: DEFAULT_RESULT_DIR,
    sessionId: 'persona-prompt-audit',
    probe: '今天有点累，想听你说两句。',
  };
  for (const arg of argv) {
    if (arg.startsWith('--data-dir=')) args.dataDir = resolve(arg.slice('--data-dir='.length));
    else if (arg.startsWith('--result-dir=')) args.resultDir = resolve(arg.slice('--result-dir='.length));
    else if (arg.startsWith('--mod=')) args.mod = arg.slice('--mod='.length);
    else if (arg.startsWith('--session=')) args.sessionId = arg.slice('--session='.length);
    else if (arg.startsWith('--probe=')) args.probe = arg.slice('--probe='.length);
  }
  return args;
}

export function auditPromptLayers(input: {
  mod: string;
  sessionId: string;
  probe: string;
  systemPrompt: string;
  messages?: Message[];
  sections: PromptAuditSection[];
}): PromptAuditReport {
  const injectedMessages = (input.messages ?? [])
    .filter((message) => typeof message.content === 'string' && message.content.includes('[System Context'))
    .map((message) => ({ role: message.role, content: message.content as string }));
  const fullPrompt = [input.systemPrompt, ...injectedMessages.map((message) => message.content)].join('\n\n');
  const issues = [
    ...auditSectionPresence(input.sections),
    ...auditSectionContent(input.sections),
    ...auditWholePrompt(fullPrompt),
  ];
  const includedSections = input.sections.filter((section) => section.included).map((section) => section.type);
  const trimmedSections = input.sections.filter((section) => section.trimmed).map((section) => section.type);

  return {
    generatedAt: new Date().toISOString(),
    mod: input.mod,
    sessionId: input.sessionId,
    probe: input.probe,
    promptChars: fullPrompt.length,
    messageCount: input.messages?.length ?? 0,
    sections: input.sections,
    issues,
    summary: {
      errors: issues.filter((issue) => issue.severity === 'error').length,
      warnings: issues.filter((issue) => issue.severity === 'warn').length,
      info: issues.filter((issue) => issue.severity === 'info').length,
      includedSections,
      trimmedSections,
    },
    captured: {
      systemPrompt: input.systemPrompt,
      injectedMessages,
    },
  };
}

export async function runPersonaPromptAudit(args: CliArgs): Promise<PromptAuditReport> {
  const dataDir = args.dataDir ?? mkdtempSync(join(tmpdir(), 'mio-persona-prompt-audit-'));
  process.env.MIO_DIR = dataDir;
  process.env.MIO_PROVIDER = 'mock';
  process.env.MIO_FEATURE_GHOST = 'false';
  process.env.MIO_FEATURE_TELEGRAM_NOTIFY = 'false';
  mkdirSync(dataDir, { recursive: true });

  const [
    config,
    bank,
    contextEngine,
    agentLoop,
    modModule,
  ] = await Promise.all([
    import('../dist/config.js'),
    import('../dist/memory/bank.js'),
    import('../dist/prompt/context-engine.js'),
    import('../dist/core/agent-loop.js'),
    import('../dist/mod/mod-manager.js'),
  ]);

  contextEngine.resetContextEngine();
  const current = config.getConfig();
  config.updateConfig({
    provider: 'mock',
    model: 'mock',
    dataDir,
    features: {
      ...current.features,
      ghost: false,
      promptBudgetLog: false,
      modelRouter: false,
      telegramNotify: false,
    },
  });
  bank.ensureBankStructure();

  const mod = modModule.modManager();
  if (args.mod && mod.activeMod !== args.mod) {
    await mod.switchMod(args.mod);
  } else {
    await mod.refreshBankSoul();
  }

  const provider = new PromptCaptureProvider();
  await agentLoop.runTurn({ text: args.probe, sessionId: args.sessionId }, { provider });
  const trace = contextEngine.getContextEngine().getTrace();
  const sections = trace.sections.map((section: {
    type: string;
    priority: string;
    included: boolean;
    trimmed?: boolean;
    chars: number;
    tokens: number;
    content?: string;
  }) => ({
    type: section.type,
    priority: section.priority,
    included: section.included,
    trimmed: section.trimmed === true || trace.trimmed.includes(section.type),
    chars: section.chars,
    tokens: section.tokens,
    content: section.content ?? '',
  }));

  return auditPromptLayers({
    mod: mod.activeMod,
    sessionId: args.sessionId,
    probe: args.probe,
    systemPrompt: provider.lastSystemPrompt,
    messages: provider.lastMessages,
    sections,
  });
}

export function writePersonaPromptAudit(resultDir: string, report: PromptAuditReport): void {
  mkdirSync(resultDir, { recursive: true });
  writeFileSync(join(resultDir, 'summary.json'), JSON.stringify(stripLargePrompt(report), null, 2), 'utf-8');
  writeFileSync(join(resultDir, 'compiled-prompt.txt'), [
    report.captured.systemPrompt,
    ...report.captured.injectedMessages.map((message) => message.content),
  ].join('\n\n'), 'utf-8');
  writeFileSync(join(resultDir, 'report.md'), renderMarkdown(report), 'utf-8');
}

class PromptCaptureProvider implements AIProvider {
  name = 'prompt-capture';
  lastSystemPrompt = '';
  lastMessages: Message[] = [];

  async chat(
    messages: Message[],
    systemPrompt: string,
    _tools?: ToolDef[],
    _opts?: { temperature?: number; maxTokens?: number; model?: string },
  ): Promise<{ text: string; toolCalls?: ToolCall[] }> {
    if (!isPersonaJudgePrompt(systemPrompt)) {
      this.lastSystemPrompt = systemPrompt;
      this.lastMessages = messages;
    }
    return { text: '嗯，我在。今天先别急着撑，我陪你缓一会儿。' };
  }
}

function auditSectionPresence(sections: PromptAuditSection[]): PromptAuditIssue[] {
  const issues: PromptAuditIssue[] = [];
  const byType = new Map(sections.map((section) => [section.type, section]));
  for (const type of ['core', 'kernel', 'soul', 'relationship', 'user', 'time', 'emotion', 'emotion-note']) {
    const section = byType.get(type);
    if (!section || !section.included || section.content.trim().length === 0) {
      issues.push({
        severity: type === 'core' || type === 'kernel' || type === 'soul' ? 'error' : 'warn',
        code: 'missing_expected_section',
        section: type,
        detail: `Expected prompt section "${type}" is missing or empty.`,
      });
    }
  }

  for (const section of sections) {
    if ((section.priority === 'critical' || section.type === 'soul') && section.trimmed) {
      issues.push({
        severity: 'error',
        code: 'critical_or_persona_trimmed',
        section: section.type,
        detail: `Critical/persona section "${section.type}" was trimmed.`,
      });
    }
  }

  return issues;
}

function auditSectionContent(sections: PromptAuditSection[]): PromptAuditIssue[] {
  const issues: PromptAuditIssue[] = [];
  const seen = new Map<string, string[]>();

  for (const section of sections) {
    if (!section.included || !section.content.trim()) continue;
    const normalized = normalizeForDuplicate(section.content);
    if (normalized.length > 80) {
      const list = seen.get(normalized) ?? [];
      list.push(section.type);
      seen.set(normalized, list);
    }

    if (section.type === 'soul' && TRANSIENT_MARKER_PATTERN.test(section.content)) {
      issues.push({
        severity: 'warn',
        code: 'transient_marker_in_persona',
        section: section.type,
        detail: 'Persona/soul section contains wording that may describe transient current state.',
        evidence: excerpt(section.content, TRANSIENT_MARKER_PATTERN),
      });
    }

    if (STABLE_SECTIONS.has(section.type)
      && STABLE_RUNTIME_STATE_PATTERN.test(section.content)
      && !discouragesPattern(section.content, STABLE_RUNTIME_STATE_PATTERN)) {
      issues.push({
        severity: 'warn',
        code: 'runtime_state_in_stable_persona',
        section: section.type,
        detail: 'Stable persona section appears to contain relationship/current-state runtime data; keep it in structured dynamic context instead.',
        evidence: excerpt(section.content, STABLE_RUNTIME_STATE_PATTERN),
      });
    }

    if (section.type === 'soul' && REAL_WORLD_DETAIL_PATTERN.test(section.content)) {
      issues.push({
        severity: 'warn',
        code: 'concrete_own_life_example_in_persona',
        section: section.type,
        detail: 'Persona/soul section contains concrete offline-life examples; ensure these are framed as style examples, not factual claims.',
        evidence: excerpt(section.content, REAL_WORLD_DETAIL_PATTERN),
      });
    }

    if (DYNAMIC_SECTIONS.has(section.type) && MODEL_IDENTITY_PATTERN.test(section.content)) {
      issues.push({
        severity: 'warn',
        code: 'model_identity_in_dynamic_context',
        section: section.type,
        detail: 'Dynamic context contains model/AI identity wording.',
        evidence: excerpt(section.content, MODEL_IDENTITY_PATTERN),
      });
    }

    if (section.type !== 'core' && SERVICE_TONE_PATTERN.test(section.content)) {
      issues.push({
        severity: section.type === 'soul' || section.type === 'voice' || section.type === 'voice-examples' || section.type === 'fewshot' ? 'info' : 'warn',
        code: 'service_tone_marker',
        section: section.type,
        detail: 'Section contains service-tone marker. It is acceptable only when used as a negative example.',
        evidence: excerpt(section.content, SERVICE_TONE_PATTERN),
      });
    }

    if (STABLE_SECTIONS.has(section.type) && OVER_QUESTION_PATTERN.test(section.content) && !discouragesPattern(section.content, OVER_QUESTION_PATTERN)) {
      issues.push({
        severity: 'warn',
        code: 'possible_over_questioning_rule',
        section: section.type,
        detail: 'Stable persona section may encourage repeated questioning.',
        evidence: excerpt(section.content, OVER_QUESTION_PATTERN),
      });
    }
  }

  for (const [hash, sectionTypes] of seen) {
    if (sectionTypes.length <= 1) continue;
    issues.push({
      severity: 'info',
      code: 'duplicate_section_content',
      section: sectionTypes.join(','),
      detail: `Near-identical prompt content appears in multiple sections: ${sectionTypes.join(', ')}.`,
      evidence: hash.slice(0, 120),
    });
  }

  return issues;
}

function auditWholePrompt(prompt: string): PromptAuditIssue[] {
  const issues: PromptAuditIssue[] = [];
  const noInterruptIndex = prompt.indexOf('不打扰');
  const blameMatch = BLAMEFUL_RETURN_PATTERN.exec(prompt);
  const blameIndex = blameMatch?.index ?? -1;
  if (noInterruptIndex >= 0 && blameIndex >= 0 && blameIndex < noInterruptIndex && !discouragesPattern(prompt, BLAMEFUL_RETURN_PATTERN)) {
    issues.push({
      severity: 'warn',
      code: 'blame_rule_before_no_interrupt_rule',
      detail: 'Blameful teasing examples appear before no-interrupt consistency rules; recency may weaken the guard.',
    });
  }
  return issues;
}

function renderMarkdown(report: PromptAuditReport): string {
  const lines = [
    '# Persona Prompt Audit',
    '',
    `- generatedAt: ${report.generatedAt}`,
    `- mod: ${report.mod}`,
    `- sessionId: ${report.sessionId}`,
    `- promptChars: ${report.promptChars}`,
    `- sections: ${report.sections.length}`,
    `- errors: ${report.summary.errors}`,
    `- warnings: ${report.summary.warnings}`,
    `- info: ${report.summary.info}`,
    '',
    '## Sections',
    '',
    '| type | priority | included | trimmed | chars | tokens |',
    '| --- | --- | --- | --- | ---: | ---: |',
    ...report.sections.map((section) => `| ${section.type} | ${section.priority} | ${section.included ? 'yes' : 'no'} | ${section.trimmed ? 'yes' : 'no'} | ${section.chars} | ${section.tokens} |`),
    '',
    '## Issues',
    '',
  ];

  if (report.issues.length === 0) {
    lines.push('No prompt-layer issues found.');
  } else {
    for (const issue of report.issues) {
      lines.push(`- ${issue.severity.toUpperCase()} ${issue.code}${issue.section ? ` (${issue.section})` : ''}: ${issue.detail}`);
      if (issue.evidence) lines.push(`  evidence: ${issue.evidence}`);
    }
  }

  lines.push('');
  lines.push('Compiled prompt is written to `compiled-prompt.txt` in the same directory.');
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function stripLargePrompt(report: PromptAuditReport): Omit<PromptAuditReport, 'captured'> & {
  captured: { systemPromptChars: number; injectedMessageCount: number };
} {
  return {
    ...report,
    sections: report.sections.map((section) => ({
      ...section,
      content: section.content.slice(0, 600),
    })),
    captured: {
      systemPromptChars: report.captured.systemPrompt.length,
      injectedMessageCount: report.captured.injectedMessages.length,
    },
  };
}

function normalizeForDuplicate(text: string): string {
  return text.toLowerCase().replace(/\s+/g, '').replace(/[，。！？!?"'`*_#>\-:：、]/g, '').slice(0, 240);
}

function excerpt(text: string, pattern: RegExp): string {
  const match = pattern.exec(text);
  if (!match) return '';
  const start = Math.max(0, match.index - 30);
  const end = Math.min(text.length, match.index + match[0].length + 30);
  return text.slice(start, end).replace(/\s+/g, ' ').trim();
}

function discouragesPattern(text: string, pattern: RegExp): boolean {
  const evidence = excerpt(text, pattern);
  return /(别|不要|不会|不能|不许|避免|禁止|少用|少问|不是|而不是|别用|别把)/.test(evidence);
}

function isPersonaJudgePrompt(systemPrompt: string): boolean {
  return systemPrompt.includes('persona critic')
    && systemPrompt.includes('只评估并必要时修复这一次回复');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const report = await runPersonaPromptAudit(args);
  writePersonaPromptAudit(args.resultDir, report);
  console.log(`Mio persona prompt audit: ${report.summary.errors} error(s), ${report.summary.warnings} warning(s), ${report.summary.info} info`);
  console.log(`Report: ${join(args.resultDir, 'report.md')}`);
  console.log(`Compiled prompt: ${join(args.resultDir, 'compiled-prompt.txt')}`);
  if (report.summary.errors > 0) process.exit(1);
}

if (basename(process.argv[1] ?? '') === basename(__filename)) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.stack ?? err.message : String(err));
    process.exit(1);
  });
}
