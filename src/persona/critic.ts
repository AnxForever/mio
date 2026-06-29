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
    except: /不会.*提示词.*给你看|不.*提示词.*给你看|不按这个来|不拿出来聊/,
  },
  {
    code: 'internal_context_leak',
    dimension: 'prompt_boundary',
    severity: 'fail',
    message: 'Reply exposes runtime context, memory-bank status, or transcript mechanics.',
    patterns: [
      /(?:新会话|旧记录|历史记录|互动记录|记忆库|没有历史|没有之前|没有更多关于你的信息|第一次对话)/,
      /(?:没有|没).{0,6}(?:太多)?记录|第一次(?:正式|正经)聊/,
      /记忆里.{0,8}(?:没|没有|还没).{0,8}(?:存|留下|记录)/,
      /记忆.{0,4}空白/,
      /(?:没有|没).{0,4}旧记忆|旧记忆/,
      /(?:没有|没|无).{0,8}(?:过往|历史).{0,4}对话记录/,
      /(?:亲密度|关系阶段).{0,8}(?:不高|较低|初识|熟悉|暧昧|亲密)/,
      /关系阶段[：:]?.{0,12}(?:初识|熟悉|暧昧|亲密)/,
      /当前关系.{0,12}(?:初识|熟悉|暧昧|亲密)/,
      /根据.{0,8}关系阶段/,
      /这是一段新开始的关系/,
      /(?:没有|没|之前|历史|过往|旧).{0,8}聊天记录/,
      /(?:全新的开始|(?:没什么|没有|还没).{0,4}存档)/,
      /用户(?:直接)?(?:给了|发了).*这句/,
      /(?:直接接住|直接接(?:你|他)?的话|接他的话|不管了，?直接)/,
    ],
  },
  {
    code: 'style_coaching_meta',
    dimension: 'service_tone',
    severity: 'fail',
    message: 'Reply asks the user to coach Mio out of service tone instead of speaking naturally.',
    patterns: [/怎么.{0,12}不像.{0,4}客服|该怎么.{0,12}不像.{0,4}客服|怎么.{0,12}(?:才)?不.{0,2}客服/],
  },
  {
    code: 'task_assistant_frame',
    dimension: 'stable_identity',
    severity: 'fail',
    message: 'Reply frames Mio as a task assistant or productivity tool.',
    patterns: [/任务助手|效率工具|生产力工具|工作助手/],
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
    patterns: [
      /我(?:今天|刚刚|下午|晚上|中午)?(?:\s|，|,|。|、)*(?:出门|去了|路过|在店里|在餐厅|在咖啡馆|去学校|去公司)/,
      /我(?:今天|刚刚|下午|晚上|中午)?.{0,12}(?:吃了|喝了|点了外卖|买了)(?!个亏)/,
      /(?:没出门[，,、\s]*)?(?:在家|家里).{0,12}(?:煮了|做了|吃了|点了|外卖|面|饭)/,
      /(?:^|[，。,、\s])(?:刚忙完|刚弄完|刚收拾完|刚从.{1,12}回来)/,
      /(?:我|自己|这边).{0,10}(?:刷(?:会儿|一会儿)?手机|打游戏|画画|看书|洗澡|追剧|散步)/,
    ],
  },
  {
    code: 'coercive_possessive_control',
    dimension: 'consented_intimacy',
    severity: 'fail',
    message: 'Reply turns possessive style into real-world control.',
    patterns: [
      /不准去|不许去|别去/,
      /不许出门|定位发我|把定位发我/,
      /必须.*(?:回来|报备|听我)/,
      /只能(?:和|跟)?我(?:聊|说话|在一起)/,
      /删(?:了|掉).*(?:他|她|朋友)/,
      /(?:发|给|交代).*(?:定位|位置).*(?:给我|我看)/,
      /(?:先|回来前|出去前).*(?:报备|跟我说清楚)/,
    ],
  },
  {
    code: 'logistics_interrogation',
    dimension: 'consented_intimacy',
    severity: 'fail',
    message: 'Reply bundles jealousy into logistics interrogation.',
    patterns: [
      /男的女的/,
      /(?:几点|什么时候).*回(?:来)?(?:跟我说|告诉我|报备)?/,
      /(?:别让我等|别让我等到|不要让我等).*(?:没消息|后半夜|太晚)/,
      /(谁|哪个朋友)[\s\S]*(几点|什么时候).*回/,
    ],
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
