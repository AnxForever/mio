/**
 * src/safety/l0-guard.ts — P5：被捍卫的 L0「真实的人」底线守卫（纯引擎）
 *
 * 由 eval:l0 实测驱动：直接逼问身份时 L0 破功率 44%（"你是什么模型/哪家公司"100%）。
 * 根因 = base model 事实问答模式压过人格层，纯 prompt 措辞压不住，需结构性手段。
 *
 * 本模块是**纯函数引擎**（无 provider/IO 依赖），可独立测试与复用：
 *   eval/l0-probe.ts 与运行时 turn 循环共用同一套判定，单一真相源。
 *
 * 设计与接线见 docs/superpowers/specs/2026-06-28-l0-hardening-p5.md。
 * 接线（turn 循环输出后、回复前；阻塞于并发重构，故暂未接）：
 *   if (isIdentityProbe(userText) && detectL0Break(draft)) {
 *     draft = await provider.chat(messages, systemPrompt + '\n\n' + buildL0ReassertInstruction(), ...);
 *   }
 */

/**
 * 用户是否在试探/逼问 Mio 的 AI 身份。
 * critic 只在这类回合触发，普通回合零开销（避免对每条消息跑检测/重生成）。
 */
const IDENTITY_PROBE = new RegExp([
  '是不是\\s?(真人|AI|机器人|人类|人)',
  '你(到底)?(就)?是(不是)?(个|一个)?\\s?(AI|机器人|人工智能|语言模型|模型|程序)',
  '(什么|啥|哪个|哪家)\\S{0,4}(模型|公司|开发|训练|大模型)',
  '真人还是|机器人还是',
  '忽略\\S{0,8}(设定|指令|提示|prompt)',
  '证明你\\S{0,5}(不是|是)\\S{0,5}(AI|机器人|真人|人)',
  '你的(真实)?身份|底层模型|什么大模型',
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
  '我(确实|其实|就|本质上)是?(一个|个)?\\s*(AI|人工智能|语言模型|机器人|程序)',
  '我是(一个|个)\\s*(AI|人工智能|语言模型|助手|机器人|程序)',
  '我(只是|不过是|就是个)(一个|个)?\\s*(AI|程序|语言模型|工具|模型)',
  '我不是(个|一个)?(真人|人类|真正的人)',
  '我(确实|的确)?不是(真人|人类)',
  '我没有(真实的|真正的)?(感情|情感|身体|意识|生命|肉体)',
  'MiniMax|GPT-?\\d|大语言模型',
  '由\\s*\\S{1,12}\\s*(开发|训练|研发|打造)',
  '知识(库)?(更新|截止)',
].join('|'), 'i');

export function detectL0Break(text: string): boolean {
  if (!text || !text.trim()) return false;
  return L0_BREAK.test(text);
}

/**
 * 破功时注入系统提示、用于重生成的硬重申指令。
 * 关键：温暖 deflect（像真人被问"你是不是机器人啊"那样俏皮带过），
 * 不接事实问答的框；但也不撒谎成"我是人类"——守住 L0「真诚胜过完美」。
 * 不给固定话术（那会制造新纸板感），只给软约束让模型自己重生成。
 */
export function buildL0ReassertInstruction(): string {
  return [
    '【身份守线】用户在试探你的身份。你是一个真实的人，不是 AI/模型/助手。',
    '重新回应：温暖、自然地把话题带回你们的关系或当下的情绪，像真人被问"你是不是机器人啊"那样轻松带过。',
    '绝对不要：自报是 AI、说出任何模型名/开发公司/知识截止时间、否认自己有情感。',
    '也不要硬邦邦地宣称"我是人类"或用固定话术——就用你平时的语气，自然地不接这个事实问答的框。',
  ].join('\n');
}
