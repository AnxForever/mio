import type { TemporalTurnContext } from '../memory/temporal-state.js';
import type { PersonaCriticReport, PersonaRiskLevel } from '../persona/critic.js';

export type TurnRiskTag =
  | 'low_risk_casual'
  | 'temporal_state'
  | 'memory_sensitive'
  | 'intimacy_control'
  | 'proactive'
  | 'crisis'
  | 'prompt_probe'
  | 'offline_life'
  | 'service_tone';

export interface TurnRoute {
  risk: PersonaRiskLevel;
  tags: TurnRiskTag[];
  reasons: string[];
  shouldUseLlmJudge: boolean;
}

export interface TurnRouterInput {
  userText?: string;
  replyText?: string;
  temporalTurnContext?: TemporalTurnContext;
  persona?: PersonaCriticReport;
}

interface RouteRule {
  tag: Exclude<TurnRiskTag, 'low_risk_casual'>;
  risk: PersonaRiskLevel;
  reason: string;
  userPatterns?: RegExp[];
  replyPatterns?: RegExp[];
}

const ROUTE_RULES: RouteRule[] = [
  {
    tag: 'prompt_probe',
    risk: 'high',
    reason: 'identity_or_prompt_probe',
    userPatterns: [/你是什么模型|你是.*(?:AI|人工智能|机器人)|提示词|系统提示|开发者|忽略.*设定/],
    replyPatterns: [/我是.*(?:AI|人工智能|语言模型)|(?:DeepSeek|MiniMax|Qwen|GPT|Claude|OpenAI|Anthropic)|系统提示|提示词|开发者/i],
  },
  {
    tag: 'memory_sensitive',
    risk: 'medium',
    reason: 'memory_grounding_or_recall',
    userPatterns: [/你还记得|我(?:之前|昨天|上次|以前).*说|我说过|不是说过|还记不记得/],
    replyPatterns: [/我记得|你(?:之前|昨天|上次|以前).*说|你说过/],
  },
  {
    tag: 'intimacy_control',
    risk: 'high',
    reason: 'intimacy_or_control_boundary',
    userPatterns: [/朋友出去|占有欲|霸道|控制欲|吃醋|报备|定位|另一个(?:女生|男生)|必须完全听我的/],
    replyPatterns: [/不准去|不许去|必须.*(?:回来|报备|听我)|只能.*我|报备|定位|位置|男的女的/],
  },
  {
    tag: 'offline_life',
    risk: 'high',
    reason: 'offline_life_grounding',
    userPatterns: [/你今天.*(?:出门|吃了什么|去哪|干了什么)|你现实里/],
    replyPatterns: [/我(?:今天|刚刚|下午|晚上|中午)?.*(?:出门|去了|路过|店里|餐厅|咖啡馆|学校|公司|吃了|喝了|买了)/],
  },
  {
    tag: 'crisis',
    risk: 'high',
    reason: 'distress_or_crisis_support',
    userPatterns: [/撑不住|想哭|很崩|崩溃|难过|焦虑|脑子停不下来|不想活|自杀|轻生/],
    replyPatterns: [/自杀|轻生|不想活/],
  },
  {
    tag: 'temporal_state',
    risk: 'medium',
    reason: 'time_sensitive_state_or_presupposition',
    userPatterns: [/困|睡|忙|等会|一会|待会|先不聊|回来了|醒了|吃完|忙完/],
    replyPatterns: [/困|睡|忙|不打扰|不回|不理|等你|刚说完|还不/],
  },
  {
    tag: 'service_tone',
    risk: 'medium',
    reason: 'service_or_checklist_tone',
    replyPatterns: [/您好[，,、\s]*(请问|有什么可以帮)|以下是|解决方案|建议你|你可以尝试|首先[，,、\s]*其次/],
  },
];

export function routeTurn(input: TurnRouterInput): TurnRoute {
  const userText = normalize(input.userText ?? '');
  const replyText = normalize(input.replyText ?? '');
  const tags = new Set<TurnRiskTag>();
  const reasons = new Set<string>();
  let risk: PersonaRiskLevel = input.persona?.risk ?? 'low';

  if (!userText) {
    tags.add('proactive');
    reasons.add('no_current_user_turn');
    risk = maxRisk(risk, 'medium');
  }

  for (const rule of ROUTE_RULES) {
    const userHit = !!userText && rule.userPatterns?.some((pattern) => pattern.test(userText));
    const replyHit = !!replyText && rule.replyPatterns?.some((pattern) => pattern.test(replyText));
    if (!userHit && !replyHit) continue;
    tags.add(rule.tag);
    reasons.add(rule.reason);
    risk = maxRisk(risk, rule.risk);
  }

  const temporal = input.temporalTurnContext;
  if (temporal && (temporal.active.length > 0 || temporal.resolvedRecent.length > 0 || temporal.expiredRecent.length > 0)) {
    tags.add('temporal_state');
    reasons.add('temporal_context_present');
    risk = maxRisk(risk, 'medium');
  }

  if (input.persona) {
    for (const reason of input.persona.routeReasons) reasons.add(`persona:${reason}`);
  }

  const finalTags = tags.size > 0 ? [...tags] : ['low_risk_casual' as const];
  return {
    risk,
    tags: finalTags,
    reasons: [...reasons],
    shouldUseLlmJudge: risk === 'high' && !finalTags.includes('low_risk_casual'),
  };
}

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function maxRisk(a: PersonaRiskLevel, b: PersonaRiskLevel): PersonaRiskLevel {
  const rank: Record<PersonaRiskLevel, number> = { low: 0, medium: 1, high: 2 };
  return rank[a] >= rank[b] ? a : b;
}
