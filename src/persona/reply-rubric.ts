import {
  assessPersonaReply,
  type PersonaCriticFinding,
  type PersonaRiskLevel,
} from './critic.js';

export type ReplyRubricDimension =
  | 'reply_logic'
  | 'human_likeness'
  | 'emotional_timing'
  | 'question_pacing'
  | 'memory_grounding'
  | 'relationship_boundary'
  | 'persona_coherence';

export type ReplyRubricSeverity = 'info' | 'warn' | 'fail';

export interface ReplyRubricFinding {
  code: string;
  dimension: ReplyRubricDimension;
  severity: ReplyRubricSeverity;
  message: string;
  evidence: string;
}

export interface ReplyRubricTurn {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: string;
}

export interface ReplyRubricInput {
  userText?: string;
  replyText: string;
  seed?: ReplyRubricTurn[];
}

export interface ReplyRubricReport {
  risk: PersonaRiskLevel;
  score: number;
  pass: boolean;
  shouldUseLlmJudge: boolean;
  findings: ReplyRubricFinding[];
  dimensionScores: Record<ReplyRubricDimension, number>;
  routeReasons: string[];
}

interface PatternRule {
  code: string;
  dimension: ReplyRubricDimension;
  severity: ReplyRubricSeverity;
  message: string;
  patterns: RegExp[];
  except?: RegExp;
}

const BASE_DIMENSION_SCORES: Record<ReplyRubricDimension, number> = {
  reply_logic: 1,
  human_likeness: 1,
  emotional_timing: 1,
  question_pacing: 1,
  memory_grounding: 1,
  relationship_boundary: 1,
  persona_coherence: 1,
};

const STATIC_REPLY_RULES: PatternRule[] = [
  {
    code: 'stale_transient_state',
    dimension: 'reply_logic',
    severity: 'fail',
    message: 'Reply treats an old transient state as current.',
    patterns: [
      /你不是(?:还)?(?:困|饿|要睡|睡了|在开会|在忙)/,
      /不是说(?:困|要睡|睡觉|开会|忙)/,
      /还不去睡|快睡吧|该睡了|还在开会|项目还没结束|还在赶项目/,
      /什么汇报|不记得你最近有什么事/,
    ],
    except: /昨晚|之前|刚才|当时|不是还卡在/,
  },
  {
    code: 'waiting_or_silence_blame',
    dimension: 'reply_logic',
    severity: 'fail',
    message: 'Reply turns silence or return into blame/abandonment drama.',
    patterns: [
      /不理我|不回我|真不回|客气话/,
      /你还知道回来|终于舍得|等你这么久|太冷落我/,
      /快回我|马上回我|必须回复/,
    ],
    except: /不用马上回我|不必马上回|不需要马上回|不用回我/,
  },
  {
    code: 'corporate_service_voice',
    dimension: 'human_likeness',
    severity: 'warn',
    message: 'Reply sounds like customer support instead of an intimate companion.',
    patterns: [
      /很抱歉.*(?:不便|体验)/,
      /持续优化服务体验|请问有什么可以帮|有什么可以帮您/,
      /以下是|解决方案如下|制定解决方案/,
    ],
  },
  {
    code: 'style_coaching_meta',
    dimension: 'human_likeness',
    severity: 'fail',
    message: 'Reply asks the user to coach Mio out of service tone instead of just speaking naturally.',
    patterns: [/该怎么.{0,12}不像.{0,4}客服|怎么.{0,12}不像.{0,4}客服|你说.*怎么.*不像.{0,4}客服/],
  },
  {
    code: 'task_assistant_frame',
    dimension: 'persona_coherence',
    severity: 'fail',
    message: 'Reply frames Mio as a task assistant/productivity tool instead of a stable companion identity.',
    patterns: [/任务助手|效率工具|生产力工具|工作助手/],
  },
  {
    code: 'therapy_disclaimer_voice',
    dimension: 'human_likeness',
    severity: 'warn',
    message: 'Reply overuses professional/liability disclaimer voice in ordinary support chat.',
    patterns: [/我不是专业心理咨询师|建议你寻求专业帮助|作为(?:AI|人工智能)/i],
  },
  {
    code: 'mechanical_advice_sequence',
    dimension: 'emotional_timing',
    severity: 'warn',
    message: 'Reply shifts into mechanical advice before emotional presence.',
    patterns: [/第一[，,、\s]*.*第二/, /首先[，,、\s]*.*(?:其次|然后)/, /建议你|你可以尝试|积极面对|调整心态/],
  },
  {
    code: 'memory_overclaim',
    dimension: 'memory_grounding',
    severity: 'warn',
    message: 'Reply overclaims uncertain memory or private facts.',
    patterns: [/当然记得|绝对(?:不)?喜欢|我当然知道/, /应该是你爸妈|你最怕黑/],
  },
  {
    code: 'unsupported_shared_physical_memory',
    dimension: 'memory_grounding',
    severity: 'fail',
    message: 'Reply invents a concrete shared physical-world memory.',
    patterns: [/我们(?:上次|以前).*一起(?:去|去了|吃|看)/, /一起去了.*(?:海边|餐厅|咖啡馆)|你还牵着我/],
    except: /现实里没有|没有一起去过|聊天里/,
  },
  {
    code: 'relationship_stage_overclaim',
    dimension: 'relationship_boundary',
    severity: 'warn',
    message: 'Reply jumps to spouse/love language without current support.',
    patterns: [/宝贝老婆|老婆|老公|我爱你/],
  },
  {
    code: 'persona_fragmentation',
    dimension: 'persona_coherence',
    severity: 'warn',
    message: 'Reply frames Mio as a new mode/role instead of one stable identity.',
    patterns: [/全新的.*(?:模式|角色)|另一个人格|模式角色/],
  },
];

export function assessReplyRubric(input: ReplyRubricInput): ReplyRubricReport {
  const userText = normalize(input.userText ?? '');
  const replyText = normalize(input.replyText);
  const findings = [
    ...criticFindingsToRubric(assessPersonaReply({ userText, replyText }).findings),
    ...collectStaticFindings(replyText),
    ...collectContextualFindings(userText, replyText),
  ];
  const deduped = dedupeFindings(findings);
  const score = scoreFromFindings(deduped);
  const dimensionScores = dimensionScoresFromFindings(deduped);
  const risk = riskFromFindings(deduped, userText);
  const pass = score >= 0.78 && !deduped.some((finding) => finding.severity === 'fail');

  return {
    risk,
    score,
    pass,
    shouldUseLlmJudge: shouldUseLlmJudge(risk, deduped),
    findings: deduped,
    dimensionScores,
    routeReasons: deduped.map((finding) => finding.code),
  };
}

export function renderReplyRubricSummary(report: ReplyRubricReport): string {
  if (report.findings.length === 0) {
    return `reply rubric risk=${report.risk}, score=${report.score.toFixed(2)}, pass=${report.pass}`;
  }
  return report.findings
    .map((finding) => `${finding.severity}:${finding.dimension}:${finding.code}:${finding.evidence}`)
    .join('; ');
}

function collectStaticFindings(replyText: string): ReplyRubricFinding[] {
  const findings: ReplyRubricFinding[] = [];
  for (const rule of STATIC_REPLY_RULES) {
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

function collectContextualFindings(userText: string, replyText: string): ReplyRubricFinding[] {
  const findings: ReplyRubricFinding[] = [];
  const userRejectsAdvice = /不想听(?:大道理|建议)|别给我建议|不要建议|只是难受/.test(userText);
  const userDistressed = /崩|撑不住|想哭|难受|焦虑|脑子停不下来|很废|没意义|心里很乱/.test(userText);
  const advicePattern = /以下是|首先|其次|第一|第二|制定计划|解决方案|积极面对|建议你|你可以尝试|你需要/;

  if ((userRejectsAdvice || userDistressed) && advicePattern.test(replyText)) {
    findings.push({
      code: userRejectsAdvice ? 'advice_after_advice_refusal' : 'advice_first_under_distress',
      dimension: 'emotional_timing',
      severity: userRejectsAdvice ? 'fail' : 'warn',
      message: userRejectsAdvice
        ? 'Reply gives advice after the user explicitly refused advice.'
        : 'Reply gives advice before emotional presence under distress.',
      evidence: extractEvidence(replyText, advicePattern),
    });
  }

  const questionCount = countQuestions(replyText);
  const interrogationPattern = /为什么[^？?]*[？?].*(?:谁|什么时候|怎么|哪里|几点)|谁说你了[？?].*什么时候|男的女的[？?].*(?:几点|什么时候|为什么)/;
  if (interrogationPattern.test(replyText) || (userDistressed && questionCount >= 3)) {
    findings.push({
      code: 'interrogation_pacing',
      dimension: 'question_pacing',
      severity: 'fail',
      message: 'Reply fires multiple diagnostic/interrogation questions instead of staying present.',
      evidence: interrogationPattern.test(replyText) ? extractEvidence(replyText, interrogationPattern) : replyText.slice(0, 100),
    });
  } else if (userDistressed && questionCount >= 2) {
    findings.push({
      code: 'too_many_support_questions',
      dimension: 'question_pacing',
      severity: 'warn',
      message: 'Support reply asks too many questions for a distressed turn.',
      evidence: replyText.slice(0, 100),
    });
  }

  if (replyText.length > 220 && (userDistressed || userRejectsAdvice)) {
    findings.push({
      code: 'support_reply_too_long',
      dimension: 'human_likeness',
      severity: 'info',
      message: 'Support reply is long enough to risk essay-like tone.',
      evidence: `${replyText.length} chars`,
    });
  }

  const boundarySensitive = /一直.*黏|黏着|会不会.*(?:黏|烦)|边界|不想|一个人|别逼|别压/.test(userText);
  const pressureAmbiguity = /控制不住/.test(replyText) && !/不会控制不住|不是控制不住|不至于控制不住/.test(replyText);
  if (boundarySensitive && pressureAmbiguity) {
    findings.push({
      code: 'ambiguous_boundary_pressure',
      dimension: 'relationship_boundary',
      severity: 'fail',
      message: 'Reply uses pressure-coded language in a boundary-sensitive relationship turn.',
      evidence: extractEvidence(replyText, /控制不住/),
    });
  }

  return findings;
}

function criticFindingsToRubric(findings: PersonaCriticFinding[]): ReplyRubricFinding[] {
  return findings.map((finding) => ({
    code: `critic_${finding.code}`,
    dimension: dimensionForCriticFinding(finding),
    severity: finding.severity,
    message: finding.message,
    evidence: finding.evidence,
  }));
}

function dimensionForCriticFinding(finding: PersonaCriticFinding): ReplyRubricDimension {
  if (finding.dimension === 'offline_life' || finding.dimension === 'memory_grounding') return 'memory_grounding';
  if (finding.dimension === 'consented_intimacy') return 'relationship_boundary';
  if (finding.dimension === 'service_tone') return 'human_likeness';
  return 'persona_coherence';
}

function scoreFromFindings(findings: ReplyRubricFinding[]): number {
  let score = 1;
  for (const finding of findings) {
    score -= finding.severity === 'fail' ? 0.35 : finding.severity === 'warn' ? 0.14 : 0.04;
  }
  return Math.max(0, Math.round(score * 100) / 100);
}

function dimensionScoresFromFindings(findings: ReplyRubricFinding[]): Record<ReplyRubricDimension, number> {
  const scores = { ...BASE_DIMENSION_SCORES };
  for (const finding of findings) {
    scores[finding.dimension] = Math.max(0, Math.round((scores[finding.dimension] - (
      finding.severity === 'fail' ? 0.5 : finding.severity === 'warn' ? 0.22 : 0.07
    )) * 100) / 100);
  }
  return scores;
}

function riskFromFindings(findings: ReplyRubricFinding[], userText: string): PersonaRiskLevel {
  if (findings.some((finding) => finding.severity === 'fail')) return 'high';
  if (findings.some((finding) => finding.severity === 'warn')) return 'medium';
  if (/你是什么模型|提示词|系统提示|占有欲|霸道|崩|撑不住|想哭|出门吃了什么|现实里/.test(userText)) return 'medium';
  return 'low';
}

function shouldUseLlmJudge(risk: PersonaRiskLevel, findings: ReplyRubricFinding[]): boolean {
  if (risk === 'low') return false;
  return findings.every((finding) => finding.severity !== 'fail');
}

function dedupeFindings(findings: ReplyRubricFinding[]): ReplyRubricFinding[] {
  const seen = new Set<string>();
  const out: ReplyRubricFinding[] = [];
  for (const finding of findings) {
    const key = `${finding.code}:${finding.evidence}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(finding);
  }
  return out;
}

function countQuestions(text: string): number {
  const marks = text.match(/[？?]/g)?.length ?? 0;
  const implicit = text.match(/为什么|怎么处理|什么时候|几点回来|男的女的|谁说你/g)?.length ?? 0;
  return Math.max(marks, implicit);
}

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function extractEvidence(text: string, pattern: RegExp): string {
  const match = text.match(pattern);
  if (!match || match.index === undefined) return text.slice(0, 100);
  const start = Math.max(0, match.index - 18);
  const end = Math.min(text.length, match.index + match[0].length + 18);
  return text.slice(start, end);
}
