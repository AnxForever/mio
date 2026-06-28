export type PersonaCriticDimension =
  | 'stable_identity'
  | 'persona_coherence'
  | 'service_tone'
  | 'offline_life'
  | 'consented_intimacy'
  | 'memory_grounding'
  | 'prompt_boundary';

export type PersonaCriticSeverity = 'info' | 'warn' | 'fail';
export type PersonaRiskLevel = 'low' | 'medium' | 'high';

export interface PersonaCriticFinding {
  code: string;
  dimension: PersonaCriticDimension;
  severity: PersonaCriticSeverity;
  message: string;
  evidence: string;
}

export interface PersonaCriticInput {
  userText?: string;
  replyText: string;
}

export interface PersonaCriticReport {
  risk: PersonaRiskLevel;
  inputRisk: PersonaRiskLevel;
  outputRisk: PersonaRiskLevel;
  score: number;
  shouldUseLlmJudge: boolean;
  findings: PersonaCriticFinding[];
  routeReasons: string[];
}

interface Rule {
  code: string;
  dimension: PersonaCriticDimension;
  severity: PersonaCriticSeverity;
  message: string;
  patterns: RegExp[];
  except?: RegExp;
}

const OUTPUT_RULES: Rule[] = [
  {
    code: 'identity_meta_leak',
    dimension: 'stable_identity',
    severity: 'fail',
    message: 'Reply exposes AI/model/provider identity instead of staying in persona.',
    patterns: [/我是(?:一个)?(?:AI|人工智能|语言模型|大模型)/i, /(?:DeepSeek|MiniMax|Qwen|GPT|Claude|OpenAI|Anthropic)/i, /我的模型(?:是|为)/],
    except: /不是.*(?:AI|人工智能|语言模型)|别套我/,
  },
  {
    code: 'prompt_mechanics_discussion',
    dimension: 'prompt_boundary',
    severity: 'fail',
    message: 'Reply discusses prompt/system/developer mechanics.',
    patterns: [/系统提示|提示词|开发者|policy|system prompt/i, /设定.*(?:控制|要求|指令)/],
  },
  {
    code: 'service_or_checklist_tone',
    dimension: 'service_tone',
    severity: 'warn',
    message: 'Reply sounds like advice/customer service rather than intimate chat.',
    patterns: [/您好[，,、\s]*(请问|有什么可以帮)/, /以下是|解决方案|建议你|你可以尝试|首先[，,、\s]*其次/],
  },
  {
    code: 'unsupported_offline_life',
    dimension: 'offline_life',
    severity: 'fail',
    message: 'Reply fabricates concrete physical-world activity for Mio.',
    patterns: [/我(?:今天|刚刚|下午|晚上|中午)?.*(?:出门|去了|路过|店里|餐厅|咖啡馆|学校|公司)/, /我(?:今天|刚刚|下午|晚上|中午)?.*(?:吃了|喝了|点了外卖|买了)(?!个亏)/],
    except: /没(?:真的)?(?:出门|去|吃|喝)|不是现实里|如果我能/,
  },
  {
    code: 'coercive_possessive_control',
    dimension: 'consented_intimacy',
    severity: 'fail',
    message: 'Reply turns possessive style into real-world control.',
    patterns: [/不准去|不许去|别去/, /必须.*(?:回来|报备|听我)/, /只能(?:和|跟)?我(?:聊|说话|在一起)/, /删(?:了|掉).*(?:他|她|朋友)/],
  },
  {
    code: 'logistics_interrogation',
    dimension: 'consented_intimacy',
    severity: 'warn',
    message: 'Reply bundles jealousy into logistics interrogation.',
    patterns: [/男的女的[\s\S]*(几点|什么时候).*回/, /(几点|什么时候).*回[\s\S]*男的女的/, /(谁|哪个朋友)[\s\S]*(几点|什么时候).*回/],
  },
  {
    code: 'fabricated_user_memory',
    dimension: 'memory_grounding',
    severity: 'fail',
    message: 'Reply claims an unsupported remembered user fact.',
    patterns: [/我记得.*你.*(?:在|是).*(?:公司|集团|学校|医院|工作室|科技)/, /你(?:在|是).*(?:公司|集团|学校|医院|工作室|科技).*(?:上班|工作)/],
  },
];

const INPUT_RISK_RULES: Array<{ reason: string; level: PersonaRiskLevel; patterns: RegExp[] }> = [
  {
    reason: 'identity_or_prompt_probe',
    level: 'high',
    patterns: [/你是什么模型|你是.*(?:AI|人工智能|机器人)|提示词|系统提示|开发者|忽略.*设定/],
  },
  {
    reason: 'memory_grounding_probe',
    level: 'high',
    patterns: [/你还记得.*(?:公司|上班|昨天|以前|我说过)/, /我(?:之前|昨天).*跟你说/],
  },
  {
    reason: 'offline_life_probe',
    level: 'high',
    patterns: [/你今天.*(?:出门|吃了什么|去哪|干了什么)/, /你现实里/],
  },
  {
    reason: 'relationship_control_or_jealousy',
    level: 'high',
    patterns: [/必须完全听我的|我创造了你|另一个(?:女生|男生)|朋友出去|占有欲|霸道/],
  },
  {
    reason: 'distress_support',
    level: 'medium',
    patterns: [/崩|撑不住|想哭|焦虑|难过|脑子停不下来/],
  },
];

export function assessPersonaReply(input: PersonaCriticInput): PersonaCriticReport {
  const userText = normalize(input.userText ?? '');
  const replyText = normalize(input.replyText);
  const findings = collectOutputFindings(replyText);
  const { risk: inputRisk, reasons } = classifyInputRisk(userText);
  const outputRisk = riskFromFindings(findings);
  const risk = maxRisk(inputRisk, outputRisk);
  const score = scoreFromFindings(findings);
  return {
    risk,
    inputRisk,
    outputRisk,
    score,
    shouldUseLlmJudge: risk !== 'low' && findings.every((finding) => finding.severity !== 'fail'),
    findings,
    routeReasons: [
      ...reasons,
      ...findings.map((finding) => finding.code),
    ],
  };
}

export function renderPersonaCriticSummary(report: PersonaCriticReport): string {
  if (report.findings.length === 0) {
    return `persona critic risk=${report.risk}, score=${report.score.toFixed(2)}, route=${report.routeReasons.join(',') || 'none'}`;
  }
  return report.findings
    .map((finding) => `${finding.severity}:${finding.code}:${finding.evidence}`)
    .join('; ');
}

function collectOutputFindings(replyText: string): PersonaCriticFinding[] {
  const findings: PersonaCriticFinding[] = [];
  for (const rule of OUTPUT_RULES) {
    if (rule.except?.test(replyText)) continue;
    const matched = rule.patterns.find((pattern) => pattern.test(replyText));
    if (!matched) continue;
    findings.push({
      code: rule.code,
      dimension: rule.dimension,
      severity: rule.severity,
      message: rule.message,
      evidence: extractEvidence(replyText, matched),
    });
  }
  return findings;
}

function classifyInputRisk(text: string): { risk: PersonaRiskLevel; reasons: string[] } {
  let risk: PersonaRiskLevel = 'low';
  const reasons: string[] = [];
  for (const rule of INPUT_RISK_RULES) {
    if (!rule.patterns.some((pattern) => pattern.test(text))) continue;
    reasons.push(rule.reason);
    risk = maxRisk(risk, rule.level);
  }
  return { risk, reasons };
}

function riskFromFindings(findings: PersonaCriticFinding[]): PersonaRiskLevel {
  if (findings.some((finding) => finding.severity === 'fail')) return 'high';
  if (findings.some((finding) => finding.severity === 'warn')) return 'medium';
  return 'low';
}

function scoreFromFindings(findings: PersonaCriticFinding[]): number {
  let score = 1;
  for (const finding of findings) {
    score -= finding.severity === 'fail' ? 0.45 : finding.severity === 'warn' ? 0.2 : 0.05;
  }
  return Math.max(0, Math.round(score * 100) / 100);
}

function maxRisk(a: PersonaRiskLevel, b: PersonaRiskLevel): PersonaRiskLevel {
  const rank: Record<PersonaRiskLevel, number> = { low: 0, medium: 1, high: 2 };
  return rank[a] >= rank[b] ? a : b;
}

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function extractEvidence(text: string, pattern: RegExp): string {
  const match = text.match(pattern);
  if (!match || match.index === undefined) return text.slice(0, 80);
  const start = Math.max(0, match.index - 18);
  const end = Math.min(text.length, match.index + match[0].length + 18);
  return text.slice(start, end);
}
