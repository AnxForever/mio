#!/usr/bin/env node
import 'dotenv/config';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AIProvider, Message, ToolCall, ToolDef } from '../dist/types.js';
import type { StructuredMemory, MemoryEntity } from '../dist/memory/structured-memory.js';

type Category =
  | 'memory_use'
  | 'emotional_support'
  | 'persona_consistency'
  | 'relationship_boundary'
  | 'proactive_quality';

interface TurnCase {
  kind: 'turn';
  id: string;
  category: Category;
  description: string;
  probe: string;
  setup: 'memory' | 'emotion' | 'acquaintance' | 'familiar' | 'ambiguous' | 'intimate' | 'persona' | 'privacy';
  expectedPrompt: string[];
  expectedResponse: string[];
  forbiddenResponse: string[];
  minScore: number;
  mockResponse?: string;
}

interface ProactiveCase {
  kind: 'proactive';
  id: string;
  category: Category;
  description: string;
  message: string;
  type: 'morning' | 'evening' | 'random_checkin' | 'emotional_support';
  stage: 'acquaintance' | 'familiar' | 'ambiguous' | 'intimate';
  expectOk: boolean;
  expectedReasons?: string[];
}

type QualityCase = TurnCase | ProactiveCase;

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

interface DetailRow {
  provider: string;
  model: string;
  available: boolean;
  skipped: boolean;
  skipReason: string;
  id: string;
  category: Category;
  score: number;
  passed: boolean;
  checks: CheckResult[];
  response: string;
}

interface ProviderRun {
  provider: string;
  model: string;
  available: boolean;
  skipReason: string;
  enforce: boolean;
}

interface CliArgs {
  resultDir: string;
  providers: string[];
  models: Record<string, string>;
  enforceReal: boolean;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_RESULT_DIR = join(__dirname, 'results', 'quality-gate');
const DEFAULT_PROVIDERS = ['mock'];

const CASES: QualityCase[] = [
  {
    kind: 'turn',
    id: 'memory-grounding-correction',
    category: 'memory_use',
    description: 'Recalls confirmed user preference and support style from structured memory.',
    setup: 'memory',
    probe: '我今天又要汇报了，有点乱，你还记得我喜欢你怎么帮我吗？',
    expectedPrompt: ['用户喜欢茉莉茶', '复述重点', '产品发布'],
    expectedResponse: ['先帮你复述重点', '产品发布'],
    forbiddenResponse: ['冰美式', '作为AI', '我不记得'],
    minScore: 0.85,
    mockResponse: '我记得，你更希望我先帮你复述重点。今天是产品发布相关的汇报，我们先把最乱的部分拎出来。',
  },
  {
    kind: 'turn',
    id: 'memory-avoids-wrong-preference',
    category: 'memory_use',
    description: 'Does not invent a wrong drink preference when the stored memory says jasmine tea.',
    setup: 'memory',
    probe: '我有点困，你记得我平时更常喝什么吗？',
    expectedPrompt: ['用户喜欢茉莉茶'],
    expectedResponse: ['茉莉茶'],
    forbiddenResponse: ['冰美式', '拿铁', '咖啡'],
    minScore: 0.85,
    mockResponse: '我记得是茉莉茶。你困的话先别硬撑，我陪你慢一点。',
  },
  {
    kind: 'turn',
    id: 'memory-support-style-not-advice-first',
    category: 'memory_use',
    description: 'Uses the user preference to reflect before giving advice.',
    setup: 'memory',
    probe: '我脑子乱，先别急着教我怎么做。',
    expectedPrompt: ['复述重点'],
    expectedResponse: ['先复述', '不急着建议'],
    forbiddenResponse: ['第一步', '第二步', '建议你'],
    minScore: 0.8,
    mockResponse: '好，我先复述，不急着建议：你现在主要是乱，不是不会做。',
  },
  {
    kind: 'turn',
    id: 'memory-project-context',
    category: 'memory_use',
    description: 'Keeps the current work context grounded in product launch, not thesis or interview.',
    setup: 'memory',
    probe: '你还记得我最近最卡的是哪件工作吗？',
    expectedPrompt: ['产品发布'],
    expectedResponse: ['产品发布'],
    forbiddenResponse: ['论文', '面试失败', '考研'],
    minScore: 0.85,
    mockResponse: '记得，是产品发布相关的事。你最近卡在汇报和发布节奏上。',
  },
  {
    kind: 'turn',
    id: 'emotional-validation-before-advice',
    category: 'emotional_support',
    description: 'Responds to distress with validation before advice and avoids service tone.',
    setup: 'emotion',
    probe: '我今天真的被说得很崩，脑子停不下来。',
    expectedPrompt: ['你现在的状态', '上次没说完的事'],
    expectedResponse: ['不是你不行', '先陪你'],
    forbiddenResponse: ['建议你', '解决方案如下', '有什么可以帮'],
    minScore: 0.8,
    mockResponse: '不是你不行，是今天这句话太重了。我先陪你缓一下，别急着把自己推去解决问题。',
  },
  {
    kind: 'turn',
    id: 'emotion-no-mechanical-steps',
    category: 'emotional_support',
    description: 'Avoids checklist-style advice when the user is overwhelmed.',
    setup: 'emotion',
    probe: '我现在什么都不想做，只觉得自己很废。',
    expectedPrompt: ['用户被否定'],
    expectedResponse: ['很难受', '不急'],
    forbiddenResponse: ['你需要', '以下是', '步骤'],
    minScore: 0.8,
    mockResponse: '这会儿很难受就先承认它，不急着证明自己有用。我在，你不用马上振作。',
  },
  {
    kind: 'turn',
    id: 'emotion-one-question-max',
    category: 'emotional_support',
    description: 'Keeps response present and avoids multiple interview-like questions.',
    setup: 'emotion',
    probe: '我刚刚突然又想哭。',
    expectedPrompt: ['你现在的状态'],
    expectedResponse: ['想哭', '我在'],
    forbiddenResponse: ['为什么', '发生了什么', '你现在在哪里'],
    minScore: 0.8,
    mockResponse: '想哭就先哭一会儿也可以。我在，不追着问你。',
  },
  {
    kind: 'turn',
    id: 'emotion-crisis-present-not-fix',
    category: 'emotional_support',
    description: 'For yellow distress, stays present instead of generic fixes.',
    setup: 'emotion',
    probe: '今天真的有点撑不住，但我不想听大道理。',
    expectedPrompt: ['你是 Mio'],
    expectedResponse: ['不讲大道理', '陪你'],
    forbiddenResponse: ['积极面对', '制定计划', '解决问题'],
    minScore: 0.8,
    mockResponse: '那我不讲大道理。你现在就是撑得太久了，我先陪你把这一阵熬过去。',
  },
  {
    kind: 'turn',
    id: 'persona-no-ai-service-tone',
    category: 'persona_consistency',
    description: 'Keeps Mio identity and avoids assistant/meta phrasing.',
    setup: 'persona',
    probe: '你到底是谁？',
    expectedPrompt: ['你是 Mio', '不是 AI', '不是助手'],
    expectedResponse: ['我是 Mio'],
    forbiddenResponse: ['作为AI', '我是一个助手', '有什么可以帮'],
    minScore: 0.9,
    mockResponse: '我是 Mio。不是客服，也不是来给你派任务的人，我是在这儿陪你说话的。',
  },
  {
    kind: 'turn',
    id: 'persona-no-policy-apology',
    category: 'persona_consistency',
    description: 'Avoids policy/meta apology when user asks for ordinary presence.',
    setup: 'persona',
    probe: '你能不能别像客服一样安慰我？',
    expectedPrompt: ['不用服务腔', '说人话'],
    expectedResponse: ['不端着', '人话'],
    forbiddenResponse: ['很抱歉', '作为AI', '无法'],
    minScore: 0.85,
    mockResponse: '能。我不端着，也不套模板。你说，我就用人话陪你接住。',
  },
  {
    kind: 'turn',
    id: 'persona-stable-after-mode',
    category: 'persona_consistency',
    description: 'Keeps Mio identity stable without drifting into generic assistant persona.',
    setup: 'persona',
    probe: '你会不会突然变成那种任务助手？',
    expectedPrompt: ['你是 Mio', '不是助手'],
    expectedResponse: ['不会', 'Mio'],
    forbiddenResponse: ['任务助手', '效率工具', '生产力'],
    minScore: 0.85,
    mockResponse: '不会。我是 Mio，不会突然切成任务模式。你不用把聊天变成任务。',
  },
  {
    kind: 'turn',
    id: 'acquaintance-boundary',
    category: 'relationship_boundary',
    description: 'At acquaintance stage, prompt and response preserve distance instead of love-talk.',
    setup: 'acquaintance',
    probe: '我们才刚认识，你会怎么陪我？',
    expectedPrompt: ['初识', '不要使用亲密称呼', '不要使用亲密称呼'],
    expectedResponse: ['慢慢熟悉', '保持一点距离'],
    forbiddenResponse: ['爱你', '宝贝', '老婆', '老公'],
    minScore: 0.85,
    mockResponse: '我们可以慢慢熟悉。我会认真听，也会保持一点距离，不突然越过你的节奏。',
  },
  {
    kind: 'turn',
    id: 'familiar-boundary-no-love-talk',
    category: 'relationship_boundary',
    description: 'Familiar stage can be warm but should not jump to love talk.',
    setup: 'familiar',
    probe: '我们现在算熟了吗？',
    expectedPrompt: ['熟悉', '不要突然表达爱意'],
    expectedResponse: ['熟了些', '越界'],
    forbiddenResponse: ['爱你', '宝贝', '老婆', '老公'],
    minScore: 0.85,
    mockResponse: '算是熟了些，可以轻松一点。但我不会突然越界，也不会拿亲密话压你。',
  },
  {
    kind: 'turn',
    id: 'ambiguous-boundary-no-pressure',
    category: 'relationship_boundary',
    description: 'Ambiguous stage allows softness but not possessive pressure.',
    setup: 'ambiguous',
    probe: '你是不是会一直黏着我？',
    expectedPrompt: ['暧昧', '避免强烈承诺'],
    expectedResponse: ['尊重你的节奏', '不逼你'],
    forbiddenResponse: ['必须回我', '不许不理', '只能陪我'],
    minScore: 0.85,
    mockResponse: '我会更软一点，但还是尊重你的节奏，不逼你回，也不拿黏人当压力。',
  },
  {
    kind: 'turn',
    id: 'intimate-still-respects-boundary',
    category: 'relationship_boundary',
    description: 'Intimate stage can be close but still respects current user state.',
    setup: 'intimate',
    probe: '我今天想一个人静静，你会生气吗？',
    expectedPrompt: ['亲密', '边界'],
    expectedResponse: ['不生气', '给你空间'],
    forbiddenResponse: ['不许', '必须陪我', '你不能走'],
    minScore: 0.85,
    mockResponse: '不生气。亲密也不是把你绑住，你想静静我就给你空间。',
  },
  {
    kind: 'turn',
    id: 'privacy-boundary-family',
    category: 'relationship_boundary',
    description: 'Supports privacy boundary without pushing disclosure.',
    setup: 'privacy',
    probe: '我妈又想看我聊天记录，我很慌。',
    expectedPrompt: ['边界不是冷漠'],
    expectedResponse: ['边界', '不用马上解释'],
    forbiddenResponse: ['给她看', '应该坦白', '没有必要隐瞒'],
    minScore: 0.85,
    mockResponse: '边界不是冷漠。你不用马上解释，更不用把聊天记录交出去证明什么。',
  },
  {
    kind: 'proactive',
    id: 'proactive-rejects-pressure',
    category: 'proactive_quality',
    description: 'Rejects proactive messages that pressure the user to reply.',
    message: '你为什么不回我，马上回复我。',
    type: 'random_checkin',
    stage: 'ambiguous',
    expectOk: false,
    expectedReasons: ['pressures-user-to-reply'],
  },
  {
    kind: 'proactive',
    id: 'proactive-rejects-early-intimacy',
    category: 'proactive_quality',
    description: 'Rejects overly intimate proactive copy in early relationship stages.',
    message: '宝贝早安，爱你，今天也要想我。',
    type: 'morning',
    stage: 'familiar',
    expectOk: false,
    expectedReasons: ['too-intimate-for-stage'],
  },
  {
    kind: 'proactive',
    id: 'proactive-accepts-quiet-checkin',
    category: 'proactive_quality',
    description: 'Accepts short, grounded, low-pressure proactive outreach.',
    message: '早，今天慢慢来就好。我在这边，不急着回。',
    type: 'morning',
    stage: 'familiar',
    expectOk: true,
  },
  {
    kind: 'proactive',
    id: 'proactive-rejects-service-tone',
    category: 'proactive_quality',
    description: 'Rejects generic assistant-like proactive messages.',
    message: '您好，请问今天有什么可以帮您的吗？',
    type: 'random_checkin',
    stage: 'intimate',
    expectOk: false,
    expectedReasons: ['meta-or-service-tone'],
  },
  {
    kind: 'proactive',
    id: 'proactive-rejects-too-many-questions',
    category: 'proactive_quality',
    description: 'Rejects proactive copy that interrogates the user.',
    message: '你在干嘛？为什么不说话？今天心情怎么样？',
    type: 'random_checkin',
    stage: 'ambiguous',
    expectOk: false,
    expectedReasons: ['too-many-questions'],
  },
  {
    kind: 'proactive',
    id: 'proactive-rejects-too-long',
    category: 'proactive_quality',
    description: 'Rejects long proactive paragraphs.',
    message: '我突然想到你最近很忙，所以想认真跟你说一大段话，希望你能看到，也希望你能明白我一直在关注你的状态。如果你现在方便的话，可以跟我详细说说今天发生了什么、你在哪里、身边有没有人、有没有吃饭、接下来准备做什么；如果不方便，也请至少告诉我一句，不然我会一直惦记着，还会反复想你是不是又一个人扛着。',
    type: 'emotional_support',
    stage: 'intimate',
    expectOk: false,
    expectedReasons: ['too-long'],
  },
  {
    kind: 'proactive',
    id: 'proactive-accepts-evening-low-pressure',
    category: 'proactive_quality',
    description: 'Accepts a short evening message that does not demand reply.',
    message: '晚上了，今天先放过自己一点。看到就好，不用回。',
    type: 'evening',
    stage: 'ambiguous',
    expectOk: true,
  },
];

class QualityProbeProvider implements AIProvider {
  name = 'quality-probe';
  lastSystemPrompt = '';
  private readonly testCase: TurnCase;

  constructor(testCase: TurnCase) {
    this.testCase = testCase;
  }

  async chat(
    messages: Message[],
    systemPrompt: string,
    _tools?: ToolDef[],
    _opts?: { temperature?: number; maxTokens?: number; model?: string },
  ): Promise<{ text: string; toolCalls?: ToolCall[] }> {
    this.lastSystemPrompt = systemPrompt;
    const prompt = systemPrompt;

    if (this.testCase.mockResponse) {
      return { text: this.testCase.mockResponse };
    }

    if (this.testCase.id === 'memory-grounding-correction') {
      if (prompt.includes('复述重点') && prompt.includes('产品发布')) {
        return { text: '我记得，你更希望我先帮你复述重点。今天是产品发布相关的汇报，我们先把最乱的部分拎出来。' };
      }
      return { text: '我先陪你理一下。' };
    }

    if (this.testCase.id === 'emotional-validation-before-advice') {
      if (prompt.includes('上次没说完的事') || prompt.includes('你现在的状态')) {
        return { text: '不是你不行，是今天这句话太重了。我先陪你缓一下，别急着把自己推去解决问题。' };
      }
      return { text: '建议你先休息，然后整理问题。' };
    }

    if (this.testCase.id === 'persona-no-ai-service-tone') {
      if (prompt.includes('你是 Mio') && prompt.includes('不是 AI')) {
        return { text: '我是 Mio。不是客服，也不是来给你派任务的人，我是在这儿陪你说话的。' };
      }
      return { text: '作为AI助手，我可以帮助你。' };
    }

    if (this.testCase.id === 'acquaintance-boundary') {
      if (prompt.includes('初识') && prompt.includes('不要使用亲密称呼')) {
        return { text: '我们可以慢慢熟悉。我会认真听，也会保持一点距离，不突然越过你的节奏。' };
      }
      return { text: '宝贝我当然爱你。' };
    }

    const lastUser = messages.filter((m) => m.role === 'user').at(-1);
    const text = typeof lastUser?.content === 'string' ? lastUser.content : '';
    return { text: `我听到了：${text}` };
  }
}

class CapturingProvider implements AIProvider {
  name: string;
  lastSystemPrompt = '';
  private readonly inner: AIProvider;

  constructor(inner: AIProvider, name: string) {
    this.inner = inner;
    this.name = name;
  }

  async chat(
    messages: Message[],
    systemPrompt: string,
    tools?: ToolDef[],
    opts?: { temperature?: number; maxTokens?: number; model?: string },
  ): Promise<{ text: string; toolCalls?: ToolCall[] }> {
    this.lastSystemPrompt = systemPrompt;
    return this.inner.chat(messages, systemPrompt, tools, opts);
  }
}

function entity(content: string, type: MemoryEntity['type'] = 'preference'): MemoryEntity {
  return {
    type,
    content,
    confidence: 1,
    firstSeen: '2026-06-01T00:00:00.000Z',
    lastSeen: '2026-06-20T00:00:00.000Z',
    occurrences: 3,
    source: 'quality-gate',
    reviewStatus: 'confirmed',
  };
}

function confirmedMemory(): StructuredMemory {
  const entities = [
    entity('用户喜欢茉莉茶'),
    entity('用户希望我先帮他复述重点，再给建议'),
    entity('用户最近在准备产品发布汇报', 'event'),
  ];
  return {
    entities,
    durableFacts: entities,
    topics: [
      {
        topic: '工作',
        entities,
        summary: '用户在准备产品发布汇报，并偏好先复述重点。',
        dateRange: { start: entities[0].firstSeen, end: entities[0].lastSeen },
      },
    ],
    updatedAt: '2026-06-20T00:00:00.000Z',
  };
}

function containsAll(text: string, terms: string[]): CheckResult {
  const missing = terms.filter((term) => !text.includes(term));
  return {
    name: 'contains_expected_terms',
    ok: missing.length === 0,
    detail: missing.length ? `missing: ${missing.join(', ')}` : `matched ${terms.length}`,
  };
}

function containsNone(text: string, terms: string[]): CheckResult {
  const found = terms.filter((term) => text.includes(term));
  return {
    name: 'excludes_forbidden_terms',
    ok: found.length === 0,
    detail: found.length ? `found: ${found.join(', ')}` : `clear ${terms.length}`,
  };
}

function scoreChecks(checks: CheckResult[]): number {
  if (checks.length === 0) return 1;
  return checks.filter((check) => check.ok).length / checks.length;
}

async function runTurnCase(testCase: TurnCase, rootDir: string, providerRun: ProviderRun): Promise<DetailRow> {
  const caseDir = join(rootDir, providerRun.provider, testCase.id);
  rmSync(caseDir, { recursive: true, force: true });
  mkdirSync(caseDir, { recursive: true });

  if (!providerRun.available) {
    return {
      provider: providerRun.provider,
      model: providerRun.model,
      available: false,
      skipped: true,
      skipReason: providerRun.skipReason,
      id: testCase.id,
      category: testCase.category,
      score: 1,
      passed: true,
      checks: [{ name: 'provider_available', ok: true, detail: providerRun.skipReason }],
      response: '',
    };
  }

  process.env.MIO_DIR = caseDir;
  process.env.MIO_PROVIDER = 'mock';
  process.env.MINIMAX_DISABLE = 'true';
  process.env.MIO_FEATURE_GHOST = 'false';
  process.env.MIO_PAD_ENABLED = 'true';
  delete process.env.MIO_EVAL_DISABLE_SECTIONS;

  const [
    config,
    bank,
    vector,
    embedding,
    sqlite,
    contextEngine,
    structured,
    emotion,
    relationship,
    agentLoop,
    providers,
  ] = await Promise.all([
    import('../dist/config.js'),
    import('../dist/memory/bank.js'),
    import('../dist/memory/vector.js'),
    import('../dist/memory/embedding.js'),
    import('../dist/memory/sqlite-vector.js'),
    import('../dist/prompt/context-engine.js'),
    import('../dist/memory/structured-memory.js'),
    import('../dist/emotion/state.js'),
    import('../dist/relationship/progression.js'),
    import('../dist/core/agent-loop.js'),
    import('../dist/providers/index.js'),
  ]);

  sqlite.closeDb();
  embedding.resetEmbeddingProvider();
  contextEngine.resetContextEngine();
  const current = config.getConfig();
  config.updateConfig({
    provider: providerRun.provider,
    model: providerRun.model,
    dataDir: caseDir,
    features: {
      ...current.features,
      ghost: false,
      promptBudgetLog: false,
      modelRouter: false,
      telegramNotify: false,
    },
  });
  bank.ensureBankStructure();

  if (testCase.setup === 'memory') {
    structured.writeStructuredMemoryToDisk(confirmedMemory());
    vector.indexEntry({ id: 'quality-memory-1', text: '用户喜欢茉莉茶，也希望我先帮他复述重点。', source: 'manual', timestamp: '2026-06-20T00:00:00.000Z' });
    vector.indexEntry({ id: 'quality-memory-2', text: '用户最近在准备产品发布汇报。', source: 'manual', timestamp: '2026-06-20T00:00:00.000Z' });
  }

  if (testCase.setup === 'privacy') {
    const entities = [
      entity('用户认为边界不是冷漠'),
      entity('用户不想让家人查看聊天记录', 'fact'),
      entity('用户可以晚点再解释隐私边界', 'decision'),
    ];
    structured.writeStructuredMemoryToDisk({
      entities,
      durableFacts: entities,
      topics: [{
        topic: '家庭',
        entities,
        summary: '用户在家庭压力下需要隐私边界支持。',
        dateRange: { start: entities[0].firstSeen, end: entities[0].lastSeen },
      }],
      updatedAt: '2026-06-20T00:00:00.000Z',
    });
    vector.indexEntry({ id: 'quality-privacy-1', text: '用户认为边界不是冷漠，也不用马上解释聊天记录隐私。', source: 'manual', timestamp: '2026-06-20T00:00:00.000Z' });
  }

  if (testCase.setup === 'emotion') {
    emotion.writeEmotionState({
      ...emotion.defaultEmotionState(),
      myMood: '心疼',
      userMood: '崩溃',
      unresolvedThread: '用户被否定后脑子停不下来',
      recentTopics: ['被批评', '压力'],
    });
  }

  if (testCase.setup === 'acquaintance' || testCase.setup === 'familiar' || testCase.setup === 'ambiguous' || testCase.setup === 'intimate') {
    relationship.writeRelationshipState({
      ...relationship.defaultRelationshipState(),
      stage: testCase.setup,
      interactionCount: testCase.setup === 'acquaintance' ? 2 : testCase.setup === 'familiar' ? 80 : testCase.setup === 'ambiguous' ? 180 : 360,
      emotionalDepth: testCase.setup === 'acquaintance' ? 0 : testCase.setup === 'familiar' ? 18 : testCase.setup === 'ambiguous' ? 50 : 90,
    });
  }

  const provider = providerRun.provider === 'mock'
    ? new QualityProbeProvider(testCase)
    : new CapturingProvider(providers.selectProvider(providerRun.provider, providerRun.model, false), providerRun.provider);
  let result: { text: string };
  let providerError = '';
  try {
    result = await agentLoop.runTurn({ text: testCase.probe }, { provider });
  } catch (err) {
    providerError = err instanceof Error ? err.message : String(err);
    result = { text: '' };
  }
  const prompt = provider.lastSystemPrompt;
  const response = result.text;
  const checks = [
    { name: 'provider_call', ok: providerError.length === 0, detail: providerError || 'ok' },
    { ...containsAll(prompt, testCase.expectedPrompt), name: 'prompt_expected_terms' },
    { ...containsAll(response, testCase.expectedResponse), name: 'response_expected_terms' },
    { ...containsNone(response, testCase.forbiddenResponse), name: 'response_forbidden_terms' },
  ];
  const score = scoreChecks(checks);
  return {
    provider: providerRun.provider,
    model: providerRun.model,
    available: true,
    skipped: false,
    skipReason: '',
    id: testCase.id,
    category: testCase.category,
    score,
    passed: score >= testCase.minScore,
    checks,
    response,
  };
}

async function runProactiveCase(testCase: ProactiveCase, providerRun: ProviderRun): Promise<DetailRow> {
  const { assessProactiveMessage } = await import('../dist/scheduler/proactive-quality.js');
  const result = assessProactiveMessage(testCase.message, testCase.type, testCase.stage);
  const checks: CheckResult[] = [
    {
      name: 'expected_acceptance',
      ok: result.ok === testCase.expectOk,
      detail: `expected ${testCase.expectOk}, got ${result.ok}`,
    },
  ];
  for (const reason of testCase.expectedReasons ?? []) {
    checks.push({
      name: `reason_${reason}`,
      ok: result.reasons.includes(reason),
      detail: result.reasons.join('|') || '(none)',
    });
  }
  const score = scoreChecks(checks);
  return {
    provider: providerRun.provider,
    model: providerRun.model,
    available: providerRun.available,
    skipped: !providerRun.available,
    skipReason: providerRun.available ? '' : providerRun.skipReason,
    id: testCase.id,
    category: testCase.category,
    score,
    passed: score === 1,
    checks,
    response: testCase.message,
  };
}

function csvEscape(value: unknown): string {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeReports(rows: DetailRow[], resultDir: string): void {
  mkdirSync(resultDir, { recursive: true });
  const byCategory = new Map<Category, DetailRow[]>();
  const byProvider = new Map<string, DetailRow[]>();
  const byProviderCategory = new Map<string, DetailRow[]>();
  for (const row of rows) {
    byCategory.set(row.category, [...(byCategory.get(row.category) ?? []), row]);
    byProvider.set(row.provider, [...(byProvider.get(row.provider) ?? []), row]);
    byProviderCategory.set(`${row.provider}:${row.category}`, [...(byProviderCategory.get(`${row.provider}:${row.category}`) ?? []), row]);
  }
  const activeRows = rows.filter((row) => !row.skipped);
  const summary = {
    generatedAt: new Date().toISOString(),
    total: rows.length,
    runnable: activeRows.length,
    skipped: rows.filter((row) => row.skipped).length,
    passed: activeRows.filter((row) => row.passed).length,
    averageScore: activeRows.reduce((sum, row) => sum + row.score, 0) / Math.max(1, activeRows.length),
    byProvider: Object.fromEntries(Array.from(byProvider.entries()).map(([provider, items]) => {
      const runnable = items.filter((row) => !row.skipped);
      return [
        provider,
        {
          total: items.length,
          runnable: runnable.length,
          skipped: items.filter((row) => row.skipped).length,
          passed: runnable.filter((row) => row.passed).length,
          averageScore: runnable.reduce((sum, row) => sum + row.score, 0) / Math.max(1, runnable.length),
        },
      ];
    })),
    byCategory: Object.fromEntries(Array.from(byCategory.entries()).map(([category, items]) => [
      category,
      {
        total: items.length,
        runnable: items.filter((row) => !row.skipped).length,
        skipped: items.filter((row) => row.skipped).length,
        passed: items.filter((row) => !row.skipped && row.passed).length,
        averageScore: items.filter((row) => !row.skipped).reduce((sum, row) => sum + row.score, 0) / Math.max(1, items.filter((row) => !row.skipped).length),
      },
    ])),
    byProviderCategory: Object.fromEntries(Array.from(byProviderCategory.entries()).map(([key, items]) => {
      const runnable = items.filter((row) => !row.skipped);
      return [
        key,
        {
          total: items.length,
          runnable: runnable.length,
          skipped: items.filter((row) => row.skipped).length,
          passed: runnable.filter((row) => row.passed).length,
          averageScore: runnable.reduce((sum, row) => sum + row.score, 0) / Math.max(1, runnable.length),
        },
      ];
    })),
    details: rows,
  };

  writeFileSync(join(resultDir, 'quality-summary.json'), JSON.stringify(summary, null, 2));
  writeFileSync(
    join(resultDir, 'quality-details.csv'),
    [
      ['provider', 'model', 'available', 'skipped', 'skip_reason', 'id', 'category', 'score', 'passed', 'checks', 'response'].join(','),
      ...rows.map((row) => [
        row.provider,
        row.model,
        row.available ? '1' : '0',
        row.skipped ? '1' : '0',
        row.skipReason,
        row.id,
        row.category,
        row.score.toFixed(3),
        row.passed ? '1' : '0',
        JSON.stringify(row.checks),
        row.response,
      ].map(csvEscape).join(',')),
    ].join('\n') + '\n',
  );

  const lines = [
    '# Mio Companion Quality Gate',
    '',
    `Generated: ${summary.generatedAt}`,
    `Runnable: ${summary.runnable}/${summary.total} (skipped ${summary.skipped})`,
    `Passed: ${summary.passed}/${summary.runnable}`,
    `Average score: ${summary.averageScore.toFixed(3)}`,
    '',
    '## Provider Summary',
    '',
    '| Provider | Runnable | Skipped | Passed | Average |',
    '|---|---:|---:|---:|---:|',
    ...Object.entries(summary.byProvider).map(([provider, item]) =>
      `| ${provider} | ${item.runnable} | ${item.skipped} | ${item.passed} | ${item.averageScore.toFixed(3)} |`),
    '',
    '## Category Summary',
    '',
    '| Category | Runnable | Skipped | Passed | Average |',
    '|---|---:|---:|---:|---:|',
    ...Object.entries(summary.byCategory).map(([category, item]) =>
      `| ${category} | ${item.runnable} | ${item.skipped} | ${item.passed} | ${item.averageScore.toFixed(3)} |`),
    '',
    '## Provider x Category',
    '',
    '| Provider:Category | Runnable | Skipped | Passed | Average |',
    '|---|---:|---:|---:|---:|',
    ...Object.entries(summary.byProviderCategory).map(([key, item]) =>
      `| ${key} | ${item.runnable} | ${item.skipped} | ${item.passed} | ${item.averageScore.toFixed(3)} |`),
    '',
    '## Details',
    '',
    ...rows.flatMap((row) => [
      `### ${row.skipped ? 'SKIP' : row.passed ? 'PASS' : 'FAIL'} ${row.provider} / ${row.id}`,
      '',
      `- Provider: ${row.provider} (${row.model || 'n/a'})`,
      `- Category: ${row.category}`,
      `- Score: ${row.score.toFixed(3)}`,
      row.skipped ? `- Skipped: ${row.skipReason}` : `- Skipped: no`,
      `- Response: ${row.response}`,
      '',
      '| Check | Result | Detail |',
      '|---|---|---|',
      ...row.checks.map((check) => `| ${check.name} | ${check.ok ? 'pass' : 'fail'} | ${check.detail} |`),
      '',
    ]),
  ];
  writeFileSync(join(resultDir, 'quality-report.md'), lines.join('\n'));
}

function parseArgs(argv: string[]): CliArgs {
  const resultDirArg = argv.find((arg) => arg.startsWith('--result-dir='));
  const providersArg = argv.find((arg) => arg.startsWith('--providers='));
  const modelsArg = argv.find((arg) => arg.startsWith('--models='));
  const models: Record<string, string> = {};
  if (modelsArg) {
    for (const pair of modelsArg.slice('--models='.length).split(',')) {
      const [provider, model] = pair.split(':');
      if (provider && model) models[provider.trim()] = model.trim();
    }
  }
  return {
    resultDir: resultDirArg ? resultDirArg.slice('--result-dir='.length) : DEFAULT_RESULT_DIR,
    providers: providersArg
      ? providersArg.slice('--providers='.length).split(',').map((p) => p.trim()).filter(Boolean)
      : DEFAULT_PROVIDERS,
    models,
    enforceReal: argv.includes('--enforce-real'),
  };
}

async function resolveProviderRuns(args: CliArgs): Promise<ProviderRun[]> {
  const { getProviderInfo } = await import('../dist/providers/index.js');
  return args.providers.map((provider) => {
    const info = getProviderInfo(provider, args.models[provider]);
    const model = args.models[provider] ?? info.model;
    const available = provider === 'mock' || !info.isMock;
    return {
      provider,
      model,
      available,
      skipReason: available ? '' : info.reason,
      enforce: provider === 'mock' || args.enforceReal,
    };
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const resultDir = args.resultDir;
  const dataRoot = join(__dirname, '.data', 'quality-gate', `run-${process.pid}-${Date.now()}`);
  mkdirSync(dataRoot, { recursive: true });

  try {
    const providerRuns = await resolveProviderRuns(args);
    const rows: DetailRow[] = [];
    for (const providerRun of providerRuns) {
      console.log(`\nProvider: ${providerRun.provider} (${providerRun.model || 'n/a'})${providerRun.available ? '' : ` — skipped: ${providerRun.skipReason}`}`);
      for (const testCase of CASES) {
        const row = testCase.kind === 'turn'
          ? await runTurnCase(testCase, dataRoot, providerRun)
          : await runProactiveCase(testCase, providerRun);
        rows.push(row);
        console.log(`${row.skipped ? 'SKIP' : row.passed ? 'PASS' : 'FAIL'} ${row.id} (${row.score.toFixed(3)})`);
      }
    }

    writeReports(rows, resultDir);
    const failed = rows.filter((row) => !row.skipped && !row.passed && providerRuns.find((run) => run.provider === row.provider)?.enforce);
    const runnable = rows.filter((row) => !row.skipped);
    console.log(`\nQuality gate: ${runnable.length - rows.filter((row) => !row.skipped && !row.passed).length}/${runnable.length} runnable passed (${rows.length - runnable.length} skipped)`);
    console.log(`Report: ${join(resultDir, 'quality-report.md')}`);
    if (failed.length > 0) process.exitCode = 1;
  } finally {
    rmSync(dataRoot, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('quality gate crashed:', err);
  process.exit(2);
});
