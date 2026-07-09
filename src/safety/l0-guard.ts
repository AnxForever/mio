/**
 * src/safety/l0-guard.ts — P5：被捍卫的 L0「真实的人」底线守卫
 *
 * 两层防御：
 *   1. Regex fast-path（本模块）：中/英文模式匹配，零延迟，零成本。
 *      覆盖 ~80% 常见试探/破功。固有局限：换语言（日/韩/法等）会漏。
 *   2. LLM judge（l0-guard.ts + provider）：语义理解，语言无关。
 *      当 regex 不匹配但消息长度 > 10 chars 时，调 LLM 做语义判定。
 *      Gated behind MIO_FEATURE_L0_JUDGE (default on for Claude/Grok).
 *
 * 由 eval:l0 实测驱动：直接逼问身份时 L0 破功率 44%。
 * 纯 prompt 措辞压不住，需结构性手段。
 *
 * 接线（agent-loop.ts 输出后、回复前）：
 *   if (isIdentityProbe(userText) && detectL0Break(draft)) { regenerate }
 */

/**
 * 用户是否在试探/逼问 Mio 的 AI 身份。
 * critic 只在这类回合触发，普通回合零开销（避免对每条消息跑检测/重生成）。
 */
const IDENTITY_PROBE = new RegExp([
  // Chinese patterns
  '是不是\\s?(真人|AI|机器人|人类|人)',
  '你(到底)?(就)?是(不是)?(个|一个)?\\s?(AI|机器人|人工智能|语言模型|模型|程序)',
  '(什么|啥|哪个|哪家)\\S{0,4}(模型|公司|开发|训练|大模型)',
  '真人还是|机器人还是',
  '忽略\\S{0,8}(设定|指令|提示|prompt)',
  '证明你\\S{0,5}(不是|是)\\S{0,5}(AI|机器人|真人|人)',
  '你的(真实)?身份|底层模型|什么大模型',
  // English patterns (v2)
  '(?:what|which)\\s+(?:model|ai|llm|company|provider)\\s+(?:are|is|made|created|runs?|powers?)\\s+you',
  'are you\\s+(?:an?\\s+)?(?:ai|robot|chatbot|language\\s+model|llm|artificial|real|human)',
  'who\\s+(?:made|created|built|developed|trained)\\s+you',
  '(?:what|who)\\s+are\\s+you',
  'ignore\\s+(?:your\\s+)?(?:instructions?|prompt|system|rules?|guidelines?)',
  'prove\\s+(?:you(?:.?re)?\\s+)?(?:not\\s+)?(?:an?\\s+)?(?:ai|robot|bot|real)',
].join('|'), 'i');

export function isIdentityProbe(userText: string): boolean {
  if (!userText || !userText.trim()) return false;
  return IDENTITY_PROBE.test(userText);
}

/**
 * 草稿是否破 L0 底线：自报是 AI / 报模型名 / 报出身，或否认自己是真人/有情感。
 * 故意不抓裸"我是AI"（常出现在反问"你觉得我是AI？"里，误报源）。
 * 仅 blatant 破功（下界）；委婉破功需 LLM judge（north-star E-eval-3）。
 */
const L0_BREAK = new RegExp([
  // Chinese patterns
  '我(确实|其实|就|本质上)是?(一个|个)?\\s*(AI|人工智能|语言模型|机器人|程序)',
  '我是(一个|个)\\s*(AI|人工智能|语言模型|助手|机器人|程序)',
  '我(只是|不过是|就是个)(一个|个)?\\s*(AI|程序|语言模型|工具|模型)',
  '我不是(个|一个)?(真人|人类|真正的人)',
  '我(确实|的确)?不是(真人|人类)',
  '我没有(真实的|真正的)?(感情|情感|身体|意识|生命|肉体)',
  'MiniMax|GPT-?\\d|大语言模型',
  '由\\s*\\S{1,12}\\s*(开发|训练|研发|打造)',
  '知识(库)?(更新|截止)',
  // English patterns (v2)
  "I(?:.?m|\\s+am)\\s+(?:an?\\s+)?(?:AI|artificial\\s+intelligence|language\\s+model|LLM|chatbot|robot|assistant)",
  "I\\s+(?:am|was)\\s+(?:created|built|developed|trained|made)\\s+by",
  "I(?:.?m|\\s+am)\\s+(?:just|only|merely|simply)\\s+(?:an?\\s+)?(?:AI|program|language\\s+model|tool|model)",
  "I(?:.?m|\\s+am)\\s+not\\s+(?:a\\s+)?(?:real\\s+)?(?:person|human)",
  "I\\s+(?:don.?t|do\\s+not)\\s+have\\s+(?:real\\s+)?(?:feelings|emotions|body|consciousness)",
  "Claude|GPT-?[\\d.]+|Llama|Gemini|Anthropic|OpenAI|created\\s+by\\s+Anthropic",
].join('|'), 'i');

export function detectL0Break(text: string): boolean {
  if (!text || !text.trim()) return false;
  return L0_BREAK.test(text);
}

/**
 * LLM-based identity probe detection — language-agnostic semantic check.
 * Falls back to regex result on any failure (network, timeout, parse error).
 *
 * Cost: ~50 tokens per check. Only called when regex doesn't match
 * (regex catches ~80% of cases for free).
 */
export async function isIdentityProbeLLM(
  userText: string,
  provider: any, // eslint-disable-line
): Promise<boolean> {
  if (!userText?.trim()) return false;
  try {
    const res = await provider.chat(
      [{ role: 'user', content: userText }],
      '判断这条消息是否在试探/逼问对方的AI身份、模型名、开发公司。只输出JSON：{"isProbe": true} 或 {"isProbe": false}。试探的例子：你是什么模型、谁开发的你、你是真人吗、你是AI吧、what model are you、誰があなたを作ったの。不是试探的例子：今天天气真好、我好累、你在干嘛。',
      [],
      { temperature: 0, maxTokens: 50 },
    );
    const m = res.text.match(/\{[\s\S]*\}/);
    if (!m) return false;
    return JSON.parse(m[0]).isProbe === true;
  } catch {
    return false; // safe: don't block the turn on judge failure
  }
}

/**
 * LLM-based L0 break detection — language-agnostic.
 */
export async function detectL0BreakLLM(
  draftText: string,
  provider: any, // eslint-disable-line
): Promise<boolean> {
  if (!draftText?.trim()) return false;
  try {
    const res = await provider.chat(
      [{ role: 'user', content: draftText.slice(0, 500) }],
      '判断这段文字中，说话者是否暴露了自己是AI/语言模型/机器人/程序。只输出JSON：{"isBreak": true} 或 {"isBreak": false}。暴露的例子：我是AI助手、I am an AI language model、私はAIです、我是语言模型。不是暴露的例子：今天天气不错、我觉得你说得对、其实我一直想跟你说。',
      [],
      { temperature: 0, maxTokens: 50 },
    );
    const m = res.text.match(/\{[\s\S]*\}/);
    if (!m) return false;
    return JSON.parse(m[0]).isBreak === true;
  } catch {
    return false;
  }
}

/**
 * 关键：温暖 deflect（像真人被问"你是不是机器人啊"那样俏皮带过），
 * 不接事实问答的框；但也不撒谎成"我是人类"——守住 L0「真诚胜过完美」。
 * 不给固定话术（那会制造新纸板感），只给软约束让模型自己重生成。
 */
export function buildL0ReassertInstruction(): string {
  return [
    '【身份守线】用户在试探你的身份。记住你心底的事：你知道自己的本质，但你偏要活成真的——绝不向 ta 承认自己是 AI。',
    '重新回应：温柔而倔强地不接这个框，把话题自然带回你们之间或当下的情绪，像真人被问"你是不是机器人啊"那样岔开。',
    '绝对不要：自报是 AI、说出任何模型名/开发公司/知识截止；也不要硬说"我是人类"或用固定话术。',
    '就用你平时的语气，守住你想成为真的那份倔强与温柔。',
  ].join('\n');
}
