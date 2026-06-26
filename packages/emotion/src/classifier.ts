/**
 * Mio — Message intent classifier
 *
 * Classifies user messages into intent categories to drive nuanced emotional
 * responses. Replaces the old keyword-only approach in emotion/tracker.ts
 * with multi-signal classification.
 *
 * Intent categories:
 *   venting, seeking_comfort, casual_chat, joking, sad, excited,
 *   angry, anxious, affectionate, playful, tired, neutral
 *
 * Architecture:
 *   - Fast path: pattern matching for clear signals (always runs, immediate)
 *   - Each intent has a confidence score (0-1)
 *   - Multiple intents can co-exist (e.g. venting + tired)
 *   - The highest-confidence intent drives the primary emotional response
 */

// ─── Types ───

export type IntentLabel =
  | 'venting'
  | 'seeking_comfort'
  | 'casual_chat'
  | 'joking'
  | 'sad'
  | 'excited'
  | 'angry'
  | 'anxious'
  | 'affectionate'
  | 'playful'
  | 'tired'
  | 'neutral';

export interface IntentResult {
  /** Primary intent (highest confidence). */
  primary: IntentLabel;
  /** All detected intents with confidence scores (sorted by score descending). */
  all: { label: IntentLabel; confidence: number }[];
  /** The emotional tone: positive, negative, or neutral. */
  tone: 'positive' | 'negative' | 'neutral';
  /** Energy level implied by the message. */
  energy: 'high' | 'mid' | 'low';
  /** Key topic words extracted from the message. */
  topics: string[];
}

// ─── Pattern definitions ───

interface IntentPattern {
  label: IntentLabel;
  /** High-confidence regex patterns. */
  strong: RegExp[];
  /** Medium-confidence regex patterns. */
  medium: RegExp[];
  /** Keywords that boost confidence for this intent. */
  keywords: string[];
  /** The emotional tone this intent implies. */
  tone: 'positive' | 'negative' | 'neutral';
  energy: 'high' | 'mid' | 'low';
}

const PATTERNS: IntentPattern[] = [
  {
    label: 'venting',
    strong: [/烦死了/, /气死我了/, /受不了了/, /真受不了/, /太恶心了/, /离谱/, /我服了/],
    medium: [/好烦/, /无语/, /想骂人/, /什么鬼/, /有毒/, /搞我心态/],
    keywords: ['烦', '恶心', '无语', '受不了', '离谱', '气', '火大'],
    tone: 'negative',
    energy: 'high',
  },
  {
    label: 'seeking_comfort',
    strong: [/我好难过/, /想哭/, /撑不住了/, /我好累/, /帮帮我/, /不知道怎么办/],
    medium: [/很难过/, /低落/, /不想动/, /没力气了/, /好丧/, /崩了/],
    keywords: ['难过', '累', '撑不住', '帮', '崩溃', '丧', '低落', '不知道怎么办'],
    tone: 'negative',
    energy: 'low',
  },
  {
    label: 'sad',
    strong: [/分手了/, /去世/, /离开了/, /好想/, /好难过/],
    medium: [/不开心/, /失落/, /难受/, /心里堵/, /说不出的/, /叹气/],
    keywords: ['分手', '难过', '失落', '难受', '想哭', '可惜', '遗憾'],
    tone: 'negative',
    energy: 'low',
  },
  {
    label: 'angry',
    strong: [/气死了/, /想骂人/, /太气人/, /凭什么/, /忍不了了/],
    medium: [/生气/, /不爽/, /火/, /恼火/, /操/, /靠/],
    keywords: ['生气', '愤怒', '火大', '不爽', '恼火', '凭什么', '妈的', '操'],
    tone: 'negative',
    energy: 'high',
  },
  {
    label: 'anxious',
    strong: [/好紧张/, /睡不着/, /担心死了/, /完了完了/, /万一/],
    medium: [/有点慌/, /不太确定/, /怕/, /会不会/, /要死了/],
    keywords: ['紧张', '焦虑', '担心', '睡不着', '怕', '万一', '不确定'],
    tone: 'negative',
    energy: 'high',
  },
  {
    label: 'tired',
    strong: [/好累啊/, /加班到现在/, /通宵/, /没睡好/, /困死了/],
    medium: [/好困/, /疲惫/, /没精神/, /不想起/, /起不来/],
    keywords: ['累', '困', '疲惫', '加班', '没睡', '起不来'],
    tone: 'negative',
    energy: 'low',
  },
  {
    label: 'excited',
    strong: [/太开心了/, /通过了/, /中了/, /啊啊啊/, /终于.*了/],
    medium: [/好开心/, /太好了/, /nice/, /牛.*了/, /上岸/],
    keywords: ['开心', '兴奋', '通过', '成功', '中了', '太棒', 'nice', '耶'],
    tone: 'positive',
    energy: 'high',
  },
  {
    label: 'joking',
    strong: [/哈哈哈哈/, /笑死/, /你是不是.*智障/, /你.*笨/],
    medium: [/hhh/, /草/, /绝了/, /你可真行/, /牛逼/],
    keywords: ['哈哈', '笑死', '逗', '损', '怼', '开玩笑', '吐槽'],
    tone: 'positive',
    energy: 'high',
  },
  {
    label: 'affectionate',
    strong: [/想你了/, /爱你/, /喜欢/, /抱抱/, /亲亲/],
    medium: [/你在干嘛/, /想我吗/, /今天特别/, /有你真好/, /陪我/],
    keywords: ['想你', '爱', '喜欢', '抱', '亲', '有你', '陪我', '在一起'],
    tone: 'positive',
    energy: 'mid',
  },
  {
    label: 'playful',
    strong: [/嘻嘻/, /嘿嘿/, /哼/, /略略略/, /~$/],
    medium: [/好不好嘛/, /就一下/, /你最好了/, /求求/],
    keywords: ['嘻嘻', '嘿嘿', '哼', '撒娇', '好不好嘛', '求求'],
    tone: 'positive',
    energy: 'mid',
  },
  {
    label: 'casual_chat',
    strong: [/吃了吗/, /在干嘛/, /今天.*怎么样/, /睡了吗/],
    medium: [/嗯/, /哦/, /好/, /行/, /知道了/],
    keywords: ['吃', '睡', '天气', '今天', '干嘛', '什么', '怎么'],
    tone: 'neutral',
    energy: 'mid',
  },
];

// ─── Topic extraction ───

const TOPIC_PATTERNS: { regex: RegExp; topic: string }[] = [
  { regex: /工作|上班|加班|项目|老板|领导|同事|开会|辞职/, topic: '工作' },
  { regex: /吃饭|外卖|拉面|火锅|奶茶|咖啡|做饭|好吃|饿了/, topic: '食物' },
  { regex: /游戏|打.*[戏游]|上分|排位|steam|switch|ps5/, topic: '游戏' },
  { regex: /睡觉|失眠|熬夜|困|睡不着|醒了|梦/, topic: '睡眠' },
  { regex: /家[人里]|我妈|我爸|妈妈|爸爸|父母|亲戚|过年|催婚/, topic: '家庭' },
  { regex: /恋爱|喜欢|对象|男朋友|女朋友|分手|表白|暧昧|约会/, topic: '感情' },
  { regex: /钱|工资|花销|买.*[了到]|消费|贵|便宜|省钱/, topic: '钱' },
  { regex: /身体|头疼|胃|不舒服|生病|医院|药|疼/, topic: '健康' },
  { regex: /朋友|闺蜜|兄弟|同学|室友|社交|聚会/, topic: '社交' },
  { regex: /电影|剧|音乐|歌|书|动漫|综艺|b站|抖音/, topic: '娱乐' },
  { regex: /学习|考试|成绩|学校|上课|毕业|论文|考研/, topic: '学习' },
  { regex: /天[气候]|下雨|热|冷|太阳|阴天/, topic: '天气' },
];

// ─── Main classifier ───

/**
 * Classify a user message into intent categories.
 *
 * Pure function — no I/O, no side effects. Called from emotion/tracker.ts
 * to replace the old keyword-based mood detection.
 */
export function classifyIntent(text: string): IntentResult {
  if (!text || text.trim().length === 0) {
    return {
      primary: 'neutral',
      all: [{ label: 'neutral', confidence: 1.0 }],
      tone: 'neutral',
      energy: 'mid',
      topics: [],
    };
  }

  const results: { label: IntentLabel; confidence: number }[] = [];

  for (const pattern of PATTERNS) {
    let confidence = 0;

    // Strong regex matches → high confidence boost
    for (const re of pattern.strong) {
      if (re.test(text)) {
        confidence += 0.4;
        break; // one strong match is enough for the boost
      }
    }

    // Medium regex matches
    let mediumHits = 0;
    for (const re of pattern.medium) {
      if (re.test(text)) mediumHits++;
    }
    confidence += Math.min(mediumHits * 0.15, 0.3);

    // Keyword matches
    let kwHits = 0;
    for (const kw of pattern.keywords) {
      if (text.includes(kw)) kwHits++;
    }
    confidence += Math.min(kwHits * 0.08, 0.2);

    // Normalize to 0-1
    confidence = Math.min(confidence, 1.0);

    if (confidence > 0.1) {
      results.push({ label: pattern.label, confidence });
    }
  }

  // Sort by confidence descending
  results.sort((a, b) => b.confidence - a.confidence);

  // If nothing matched, it's casual_chat or neutral
  if (results.length === 0) {
    // Check if it's a short reply → casual_chat
    if (text.trim().length <= 5) {
      results.push({ label: 'casual_chat', confidence: 0.6 });
    } else {
      results.push({ label: 'neutral', confidence: 0.5 });
    }
  }

  const primary = results[0].label;

  // Determine tone from the primary intent
  const primaryPattern = PATTERNS.find((p) => p.label === primary);
  const tone = primaryPattern?.tone ?? 'neutral';
  const energy = primaryPattern?.energy ?? 'mid';

  // Extract topics
  const topics: string[] = [];
  for (const { regex, topic } of TOPIC_PATTERNS) {
    if (regex.test(text)) topics.push(topic);
  }

  return { primary, all: results, tone, energy, topics };
}

/**
 * Get the emotional tone implied by a set of intents.
 * Used by the emotion tracker to decide whether to increment/decrement mood.
 */
export function intentTone(label: IntentLabel): 'positive' | 'negative' | 'neutral' {
  const p = PATTERNS.find((pt) => pt.label === label);
  return p?.tone ?? 'neutral';
}

/**
 * Get the energy level implied by a set of intents.
 */
export function intentEnergy(label: IntentLabel): 'high' | 'mid' | 'low' {
  const p = PATTERNS.find((pt) => pt.label === label);
  return p?.energy ?? 'mid';
}

/**
 * Describe the intent in Chinese (for mood labels).
 */
export function intentLabel(label: IntentLabel): string {
  const map: Record<IntentLabel, string> = {
    venting: '在吐槽',
    seeking_comfort: '需要安慰',
    casual_chat: '闲聊',
    joking: '开玩笑',
    sad: '难过',
    excited: '开心兴奋',
    angry: '生气',
    anxious: '焦虑担心',
    affectionate: '想你',
    playful: '撒娇',
    tired: '疲惫',
    neutral: '日常',
  };
  return map[label] || '未知';
}
