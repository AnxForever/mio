/**
 * Mio — Structured Memory Extractor
 *
 * Extracts structured information (facts, preferences, events, decisions, intentions, emotions)
 * from bookmark entries using pattern matching and heuristics. Implements a 3-tier memory
 * architecture with short-term (transcript), mid-term (topic segments), and long-term
 * (durable facts) storage.
 *
 * Reference: From Hierarchical Context AI Agent and MemoryOS research:
 * - Structured JSON extraction is REPORTED to achieve ~95% fact retention vs ~70%
 *   for prose summaries. NOTE: these figures are from external research, NOT measured
 *   on this codebase — Mio's own retention has no eval yet. Structured extraction is
 *   used here because the approach is sound, not because these numbers are verified.
 * - 3-tier memory: STM (FIFO) -> MTM (topic segments) -> LTM (durable facts)
 */

import { createHash } from 'node:crypto';
import { readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { logger } from '../utils/logger.js';
import { readFileSyncSafe, writeFileSyncSafe } from './bank.js';
import { tokenize, embed, cosine } from './vector.js';
import {
  structuredMemoryPath,
  midTermDir,
  midTermTopicPath,
} from './paths.js';
import type { AIProvider, Message } from '../types.js';
import {
  combineContradicts,
  makeLLMContradicts,
  makeRuleBasedContradicts,
  resolveContradictions,
  resolveContradictionsSync,
  type Contradicts,
} from './temporal-resolve.js';

// ─── Types ───

export interface MemoryEntity {
  type: 'fact' | 'preference' | 'event' | 'decision' | 'intention' | 'emotion';
  content: string;        // the actual fact/preference/etc
  confidence: number;     // 0-1 how sure we are
  firstSeen: string;      // ISO timestamp
  lastSeen: string;       // ISO timestamp
  occurrences: number;    // how many times confirmed
  source: string;         // which bookmark/transcript line
  /** Whether this memory is allowed into prompt-facing derived state. */
  enabled?: boolean;
  /** Structured source metadata for audit/review UI. Legacy `source` remains as display fallback. */
  provenance?: MemoryProvenance;
  reviewStatus?: 'inferred' | 'confirmed' | 'ignored' | 'wrong';
  reviewedAt?: string;
  /** User-pinned memories are prompt-facing priority anchors. */
  pinned?: boolean;
  pinnedAt?: string;
  /** B-1 bi-temporal：被更新事实取代时打上(ISO)；不删除，留审计；activeEntities 据此排除。 */
  invalidatedAt?: string;
  /** 取代它的新事实 content（溯源）。 */
  supersededBy?: string;
}

export interface MemoryProvenance {
  sourceType: 'bookmark' | 'transcript' | 'llm_extraction' | 'manual' | 'unknown';
  sourceId?: string;
  observedAt: string;
  excerpt: string;
}

export interface TopicSegment {
  topic: string;          // e.g. "工作", "家庭", "感情"
  entities: MemoryEntity[];
  summary: string;        // 1-2 sentence topic summary
  dateRange: { start: string; end: string };
}

export interface StructuredMemory {
  entities: MemoryEntity[];      // all extracted facts
  topics: TopicSegment[];        // topic-clustered segments
  durableFacts: MemoryEntity[];  // high-confidence long-term facts (confidence >= 0.8, occurrences >= 3)
  updatedAt: string;
  extractionState?: StructuredMemoryExtractionState;
}

export interface StructuredMemoryExtractionState {
  sourceHash: string;
  processedSourceIds: string[];
  lastProcessedAt: string;
}

export interface StructuredStateView {
  pinned: MemoryEntity[];
  currentFacts: MemoryEntity[];
  multiDayArcs: TopicSegment[];
  recentEvents: MemoryEntity[];
  recentEmotions: MemoryEntity[];
}

// ─── Topic keywords for classification ───

const TOPIC_KEYWORDS: Record<string, string[]> = {
  '工作': ['工作', '上班', '公司', '同事', '老板', '项目', '加班', '面试', '辞职', '升职', '工资', '薪资', '职业', '创业', '客户', '会议', '报告', 'deadline', 'KPI', '绩效', '出差', '办公', '职场', '跳槽', 'offer', '简历', '招聘'],
  '家庭': ['家', '父母', '爸爸', '妈妈', '爷爷', '奶奶', '外公', '外婆', '哥哥', '姐姐', '弟弟', '妹妹', '儿子', '女儿', '老公', '老婆', '亲戚', '家人', '家庭', '结婚', '婚礼', '孩子', '宝宝'],
  '感情': ['感情', '喜欢', '爱', '想念', '想你', '恋爱', '分手', '暧昧', '关系', '男朋友', '女朋友', '对象', '约会', '吃醋', '争吵', '和好', '表白', '心动', '依赖', '习惯', '陪伴'],
  '健康': ['健康', '生病', '医院', '医生', '药', '运动', '健身', '跑步', '瑜伽', '失眠', '熬夜', '头痛', '发烧', '感冒', '体检', '焦虑', '压力', '疲惫', '累', '休息', '睡觉', '饮食', '减肥'],
  '学习': ['学习', '考试', '读书', '看书', '阅读', '论文', '研究', '课程', '上课', '老师', '学生', '作业', '毕业', '学历', '考研', '留学', '英语', '技能', '培训', '知识'],
  '兴趣': ['游戏', '电影', '音乐', '旅行', '摄影', '画画', '烹饪', '美食', '咖啡', '酒', '动漫', '小说', '写作', '手工', '园艺', '宠物', '猫', '狗', '钓鱼', '滑雪', '游泳'],
  '日常': ['今天', '昨天', '明天', '早上', '晚上', '吃饭', '外卖', '逛街', '购物', '快递', '搬家', '打扫', '洗', '出门', '回家', '地铁', '打车'],
};

const DEFAULT_TOPIC = '其他';

function classifyTopic(text: string): string {
  const lower = text.toLowerCase();
  let bestTopic = DEFAULT_TOPIC;
  let bestScore = 0;

  for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
    let score = 0;
    for (const kw of keywords) {
      if (lower.includes(kw.toLowerCase())) {
        score++;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestTopic = topic;
    }
  }

  return bestTopic;
}

// ─── Pattern matching for entity extraction ───

const FACT_PATTERNS: RegExp[] = [
  /(?:用户|他|她|你)?(?:现在|最近|这几天)?(?:不做|暂停|先不管)(论文|简历|毕设|项目|报告|考试|面试)了?.{0,12}(?:改做|在做|忙|准备)(论文|简历|毕设|项目|报告|考试|面试)/,
  /(?:用户|他|她|你)?(?:现在|最近|这几天|今天)(?:在做|忙|准备|主要弄|主要做)(论文|简历|毕设|项目|报告|考试|面试)/,
  // "用户住在上海" / "用户搬到上海"
  /(?:用户|他|她|你)(?:现在|目前)?(?:住在|在)(\S{2,20})(?:住|居住)?/,
  /(?:用户|他|她|你)(?:搬到|搬去|搬进)(\S{2,20})/,
  /(?:用户|他|她|你)(?:现在|目前)?在(\S{2,30})(?:工作|上班|上学|读书|学习)/,
  // "用户今年25岁" / "他是程序员"
  /(?:用户|他|她|你)(?:今年|现在|是|有)?(\S*(?:岁|年|岁数|生日|工作|职业|专业|学校|公司|城市))/,
  // "在XX上班"
  /在(\S+(?:公司|上班|工作|上学|读书))/,
];

const PREFERENCE_PATTERNS: RegExp[] = [
  /(?:现在|以后|最近)?(?:不喝|别给我|不要给我|不用给我|不喜欢喝)(咖啡|奶茶|茶|可乐|酒)了?.{0,12}(?:改喝|喝|想喝|更喜欢)(咖啡|奶茶|茶|可乐|酒)/,
  /(?:现在|以后|最近)?(?:喜欢喝|想喝|改喝|只喝|更喜欢)(咖啡|奶茶|茶|可乐|酒)/,
  /(?:现在|以后|今天|难受的时候)?.{0,8}(?:别|不要|不用|先别)(?:给我)?(?:建议|讲道理|分析|解决方案).{0,12}(?:陪我|听我说|抱抱)?/,
  /(?:现在|以后|今天)?.{0,8}(?:只想|就想|需要|想要).{0,8}(?:陪我|抱抱|听我说|安静陪着)/,
  /(?:现在|以后|今天)?.{0,8}(?:可以|需要|想要|给我).{0,8}(?:建议|分析|解决方案|办法)/,
  /(?:刚认识|慢慢来|先别太亲密|别太黏|不要太黏|别叫宝贝|不要叫宝贝|别说爱我|不要说爱我)/,
  /(?:可以|喜欢|想要).{0,8}(?:黏一点|亲密一点|叫我宝贝|叫宝贝|说爱我)/,
  // "喜欢/爱/讨厌/不喜欢/喜欢"
  /(?:以后)?(?:别|不要|别再)(?:叫|称呼)(\S{1,12})/,
  /(?:喜欢|爱|讨厌|不喜欢|最爱|很喜欢|超喜欢|真的好喜欢)(\S{2,20})/,
  /(?:最爱的|最喜欢的)(\S{2,20})/,
];

const EVENT_PATTERNS: RegExp[] = [
  // 时间+事件
  /(?:今天|昨天|明天|上周|下周|周末|刚才|昨晚|早上|下午|晚上)(?:去|在|做|有|要|打算|准备)(\S{3,50})/,
  // 经历
  /(?:经历了|发生了|遇到|碰见|见到|看见|听说)(\S{3,50})/,
];

const DECISION_PATTERNS: RegExp[] = [
  // 决定/打算/计划
  /(?:决定|打算|计划|准备|要(?:去|做|学|买|换))(?:了)?(\S{3,50})/,
  /(?:已经|终于)(?:决定|打算|下决心)(\S{3,50})/,
];

const INTENTION_PATTERNS: RegExp[] = [
  // 想/想要/希望/期待
  /(?:想|想要|希望|期待|打算|准备)([^。]{3,50})/,
  /(?:以后|将来|未来|总有一天)([^。]{3,50})/,
];

const EMOTION_PATTERNS: RegExp[] = [
  // 情感状态
  /(?:觉得|感觉|有点|很|好|真|真的|有点|有些)(开心|难过|烦躁|焦虑|疲惫|不安|孤独|寂寞|快乐|幸福|委屈|生气|愤怒|紧张|兴奋|期待|失落|失望|崩溃|沮丧|压抑|郁闷|无聊|累|困|饿)/,
  /(?:心情|情绪)(?:很|非常|有点|有些|十分)?(好|不好|差|糟糕|低落|烦躁|郁闷|复杂|微妙)/,
  /(?:哭了|哭了|差点哭|想哭|难受|心累)/,
];

interface ExtractionResult {
  entities: MemoryEntity[];
}

function extractEntitiesFromLine(
  line: string,
  source: string,
  timestamp: string,
): MemoryEntity[] {
  const entities: MemoryEntity[] = [];
  const text = line;
  const base = entityBase(source, timestamp);

  // Fact extraction
  for (const pattern of FACT_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      entities.push({
        ...base,
        type: 'fact',
        content: match[0].slice(0, 100),
        confidence: 0.5,
        occurrences: 1,
      });
    }
  }

  // Preference extraction
  for (const pattern of PREFERENCE_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      entities.push({
        ...base,
        type: 'preference',
        content: match[0].slice(0, 100),
        confidence: 0.6,
        occurrences: 1,
      });
    }
  }

  // Event extraction
  for (const pattern of EVENT_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      entities.push({
        ...base,
        type: 'event',
        content: match[0].slice(0, 100),
        confidence: 0.7,
        occurrences: 1,
      });
    }
  }

  // Decision extraction
  for (const pattern of DECISION_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      entities.push({
        ...base,
        type: 'decision',
        content: match[0].slice(0, 100),
        confidence: 0.6,
        occurrences: 1,
      });
    }
  }

  // Intention extraction
  for (const pattern of INTENTION_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      entities.push({
        ...base,
        type: 'intention',
        content: match[0].slice(0, 100),
        confidence: 0.5,
        occurrences: 1,
      });
    }
  }

  // Emotion extraction
  for (const pattern of EMOTION_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      entities.push({
        ...base,
        type: 'emotion',
        content: match[0].slice(0, 100),
        confidence: 0.7,
        occurrences: 1,
      });
    }
  }

  return entities;
}

function entityBase(source: string, timestamp: string): Pick<MemoryEntity, 'firstSeen' | 'lastSeen' | 'source' | 'enabled' | 'provenance'> {
  return {
    firstSeen: timestamp,
    lastSeen: timestamp,
    source,
    enabled: true,
    provenance: {
      sourceType: 'bookmark',
      sourceId: hashText(source),
      observedAt: timestamp,
      excerpt: source.slice(0, 240),
    },
  };
}

/**
 * Check if two entity contents are semantically similar enough to be duplicates.
 * Uses a simple overlap heuristic: if one contains the other, they match.
 */
function entitiesSimilar(a: string, b: string): boolean {
  const aNorm = a.toLowerCase().replace(/\s+/g, '');
  const bNorm = b.toLowerCase().replace(/\s+/g, '');
  return aNorm.includes(bNorm) || bNorm.includes(aNorm);
}

function activeEntities(entities: MemoryEntity[]): MemoryEntity[] {
  // B-1：排除被取代的矛盾旧事实（invalidatedAt 已设）。无人 set 之前行为不变。
  return entities.filter((entity) =>
    entity.enabled !== false
    && entity.reviewStatus !== 'ignored'
    && entity.reviewStatus !== 'wrong'
    && !entity.invalidatedAt,
  );
}

// ─── Main API ───

/**
 * Extract structured memory from bookmark content using regex/heuristics.
 *
 * This is the offline, zero-cost path and the fallback for the LLM extractor
 * (`extractStructuredMemoryLLM`). It is synchronous and its signature is part
 * of the public contract — downstream callers (consolidation, subagent) depend
 * on it. Do not make it async.
 *
 * @param bookmarksContent  Raw BOOKMARKS.md content.
 * @param existingMemory    Optional existing StructuredMemory to merge with.
 * @returns                 A fully populated StructuredMemory object.
 */
export function extractStructuredMemory(
  bookmarksContent: string,
  existingMemory?: StructuredMemory,
): StructuredMemory {
  const now = new Date().toISOString();
  const dirtyContent = dirtyBookmarkContent(bookmarksContent, existingMemory);
  if (!dirtyContent && existingMemory) return existingMemory;
  const newEntities = extractEntitiesFromBookmarks(dirtyContent || bookmarksContent);
  return assembleMemory(newEntities, existingMemory, now, buildExtractionState(bookmarksContent, now));
}

/** A parsed `- <time=…> …` bookmark line. */
interface BookmarkEntry {
  timestamp: string;
  content: string;
  source: string;
}

/** Parse the `- <time=…> …` lines of a bookmarks blob into structured entries. */
function parseBookmarkEntries(bookmarksContent: string): BookmarkEntry[] {
  const entries: BookmarkEntry[] = [];
  for (const line of bookmarksContent.split('\n')) {
    const m = line.match(/^- <time=([^>]+)> (.+)$/);
    if (!m) continue;
    entries.push({ timestamp: m[1], content: m[2], source: line.slice(0, 120) });
  }
  return entries;
}

/** Regex/heuristic entity extraction over all bookmark lines. */
function extractEntitiesFromBookmarks(bookmarksContent: string): MemoryEntity[] {
  const newEntities: MemoryEntity[] = [];
  for (const entry of parseBookmarkEntries(bookmarksContent)) {
    newEntities.push(...extractEntitiesFromLine(entry.content, entry.source, entry.timestamp));
  }
  return newEntities;
}

function hashText(text: string): string {
  return createHash('sha1').update(text).digest('hex');
}

function sourceId(entry: BookmarkEntry): string {
  return hashText(entry.source);
}

function buildExtractionState(bookmarksContent: string, at: string): StructuredMemoryExtractionState {
  return {
    sourceHash: hashText(bookmarksContent),
    processedSourceIds: parseBookmarkEntries(bookmarksContent).map(sourceId),
    lastProcessedAt: at,
  };
}

function dirtyBookmarkContent(bookmarksContent: string, existingMemory?: StructuredMemory): string {
  const existing = existingMemory?.extractionState;
  const sourceHash = hashText(bookmarksContent);
  if (existing?.sourceHash === sourceHash) return '';

  const processed = new Set(existing?.processedSourceIds ?? []);
  const dirty = parseBookmarkEntries(bookmarksContent).filter((entry) => !processed.has(sourceId(entry)));
  return dirty.map((entry) => entry.source).join('\n');
}

/**
 * Merge newly-extracted entities with the existing memory, decay stale ones,
 * re-cluster by topic, and recompute durable facts.
 *
 * Shared by both the regex path (`extractStructuredMemory`) and the LLM path
 * (`extractStructuredMemoryLLM`) so both produce an identically-shaped
 * StructuredMemory regardless of how the raw entities were extracted.
 */
function assembleMemory(
  newEntities: MemoryEntity[],
  existingMemory: StructuredMemory | undefined,
  now: string,
  extractionState?: StructuredMemoryExtractionState,
): StructuredMemory {
  // Merge with existing memory or start fresh
  let merged: MemoryEntity[];
  if (existingMemory && existingMemory.entities.length > 0) {
    merged = mergeEntities(existingMemory.entities, newEntities);
  } else {
    merged = newEntities;
  }

  // Decay confidence for old unconfirmed entities
  merged = decayOldEntities(merged, now);
  merged = resolveRuleBasedMemoryContradictions(merged, now);

  return deriveStructuredState(merged, now, extractionState);
}

/**
 * 从(已合并/已消解的)实体集派生 prompt-facing 状态(topics + durableFacts)。
 * 从 assembleMemory 抽出，以便 B-1 矛盾消解后能重新派生（失效项经 activeEntities 排除）。
 */
function deriveStructuredState(
  merged: MemoryEntity[],
  now: string,
  extractionState?: StructuredMemoryExtractionState,
): StructuredMemory {
  // Cluster active entities by topic. Ignored/invalidated entities stay in
  // `entities` for audit, but are excluded from prompt-facing derived state.
  const topicMap = new Map<string, MemoryEntity[]>();
  for (const entity of activeEntities(merged)) {
    const topic = classifyTopic(entity.content);
    const existing = topicMap.get(topic) ?? [];
    existing.push(entity);
    topicMap.set(topic, existing);
  }

  const topics: TopicSegment[] = [];
  for (const [topic, entities] of topicMap) {
    const dates = entities
      .map((e) => [e.firstSeen, e.lastSeen])
      .flat()
      .sort();
    topics.push({
      topic,
      entities,
      summary: summarizeTopic(topic, entities),
      dateRange: {
        start: dates[0] ?? now,
        end: dates[dates.length - 1] ?? now,
      },
    });
  }

  // Sort topics by entity count (most relevant first)
  topics.sort((a, b) => b.entities.length - a.entities.length);

  // Filter durable facts: high confidence, multiple occurrences
  const durableFacts = activeEntities(merged).filter(
    (e) => e.pinned === true
      || e.reviewStatus === 'confirmed'
      || (e.reviewStatus !== 'inferred' && e.confidence >= 0.8 && e.occurrences >= 3),
  );

  return {
    entities: merged,
    topics,
    durableFacts,
    updatedAt: now,
    extractionState,
  };
}

// ─── LLM extraction (Mem0-style atomic facts) ───

/**
 * System prompt for LLM structured extraction. Instructs the model to emit
 * atomic facts about the user as strict JSON. Mirrors the 6 entity types the
 * rest of the system understands so downstream consumers are unaffected.
 */
const EXTRACTION_SYSTEM_PROMPT = `你是一个记忆抽取器。从下面的对话片段/书签中抽取关于"用户"的原子事实(atomic facts)。

规则：
- 每条只包含一个独立、最小的事实，不要把多条信息合并到一条里。
- 只抽取关于用户本人的稳定信息或重要事件，忽略寒暄、AI 自己的话、无信息量的内容。
- 给每条事实分类到以下之一：
  - fact: 客观事实/身份/属性（年龄、职业、城市等）
  - preference: 喜好或厌恶
  - event: 发生过的事/经历
  - decision: 做出的决定或计划
  - intention: 意图/愿望/打算
  - emotion: 情绪状态
- confidence 为 0~1 的小数，表示你的确定程度。
- content 用简体中文，简洁，不超过 50 字。

只输出 JSON，不要任何解释、前后缀或 markdown 代码块，格式严格如下：
{"entities":[{"type":"fact","content":"...","confidence":0.9}]}
如果没有可抽取的事实，输出：{"entities":[]}`;

/** The entity types the rest of the system understands. */
const VALID_ENTITY_TYPES: ReadonlySet<MemoryEntity['type']> = new Set([
  'fact', 'preference', 'event', 'decision', 'intention', 'emotion',
]);

/** Clamp an arbitrary value into a [0,1] confidence, with a fallback. */
function clampConfidence(n: unknown, fallback: number): number {
  const x = typeof n === 'number' && Number.isFinite(n) ? n : fallback;
  return Math.max(0, Math.min(1, x));
}

/** Strip a leading/trailing ```json … ``` fence if present. */
function stripJsonFence(text: string): string {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return fence ? fence[1].trim() : text.trim();
}

/**
 * Parse an LLM response into MemoryEntity[].
 *
 * Tolerant of code fences and surrounding prose. Accepts either
 * `{"entities":[…]}` or a bare `[…]` array.
 *
 * @returns  Parsed entities (possibly empty) when the JSON is usable, or
 *           `null` when the response can't be parsed — the caller treats
 *           `null` as "LLM unavailable" and falls back to regex extraction.
 */
function parseLLMEntities(rawText: string, now: string): MemoryEntity[] | null {
  if (!rawText || rawText.trim().length === 0) return null;

  let text = stripJsonFence(rawText);

  // Slice to the outermost JSON if the model wrapped it in prose.
  if (!text.startsWith('{') && !text.startsWith('[')) {
    const firstObj = text.indexOf('{');
    const firstArr = text.indexOf('[');
    const candidates = [firstObj, firstArr].filter((i) => i >= 0);
    if (candidates.length === 0) return null;
    const start = Math.min(...candidates);
    const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
    if (end <= start) return null;
    text = text.slice(start, end + 1);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  let rawList: unknown = null;
  if (Array.isArray(parsed)) {
    rawList = parsed;
  } else if (parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).entities)) {
    rawList = (parsed as Record<string, unknown>).entities;
  }
  if (!Array.isArray(rawList)) return null;

  const entities: MemoryEntity[] = [];
  for (const item of rawList) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    const type = obj.type;
    const content = obj.content;
    if (typeof type !== 'string' || !VALID_ENTITY_TYPES.has(type as MemoryEntity['type'])) continue;
    if (typeof content !== 'string' || content.trim().length === 0) continue;
    entities.push({
      type: type as MemoryEntity['type'],
      content: content.trim().slice(0, 100),
      confidence: clampConfidence(obj.confidence, 0.6),
      firstSeen: now,
      lastSeen: now,
      occurrences: 1,
      source: 'llm-extraction',
      enabled: true,
      provenance: {
        sourceType: 'llm_extraction',
        sourceId: hashText(content.trim()),
        observedAt: now,
        excerpt: content.trim().slice(0, 240),
      },
    });
    if (entities.length >= 50) break; // guard against pathological output
  }
  return entities;
}

/**
 * Run LLM-based entity extraction over the bookmark content.
 *
 * Provider resolution:
 *   - `opts.provider` (test injection) is used directly when given.
 *   - Otherwise the active provider is selected and routed through the model
 *     router's cheap `summarize` tier (a no-op unless MIO_MODEL_ROUTER_ENABLED).
 *
 * @returns  Parsed entities, or `null` if extraction is unavailable/unparseable
 *           (e.g. the MockProvider, an offline run, or malformed output).
 */
/**
 * 解析用于"summarize"类任务的 provider/model：显式 opts.provider 优先，否则回退到配置
 * provider 经 router 路由（与 LLM 提取同一套，保证 B-1 矛盾消解在生产里也能用上同一 provider）。
 */
async function resolveSummarizeProvider(
  opts?: { provider?: AIProvider; model?: string },
): Promise<{ provider: AIProvider; model?: string }> {
  if (opts?.provider) return { provider: opts.provider, model: opts.model };
  const { selectProvider } = await import('../providers/index.js');
  const { getRouterConfig, routeTask, getTaskModel } = await import('../providers/router.js');
  const { getConfig } = await import('../config.js');
  const config = getConfig();
  const base = selectProvider(config.provider, config.model);
  const routerCfg = getRouterConfig();
  const provider = await routeTask('summarize', base, routerCfg);
  return { provider, model: opts?.model ?? getTaskModel('summarize', routerCfg) ?? undefined };
}

async function extractEntitiesViaLLM(
  bookmarksContent: string,
  now: string,
  opts?: { provider?: AIProvider; model?: string },
): Promise<MemoryEntity[] | null> {
  const entries = parseBookmarkEntries(bookmarksContent);
  if (entries.length === 0) return [];

  const { provider, model } = await resolveSummarizeProvider(opts);

  const userText = entries.map((e) => `- ${e.content}`).join('\n');
  const messages: Message[] = [{ role: 'user', content: userText, timestamp: now }];

  const res = await provider.chat(messages, EXTRACTION_SYSTEM_PROMPT, undefined, {
    temperature: 0,
    model,
  });

  return parseLLMEntities(res.text, now);
}

/**
 * Extract structured memory using an LLM (Mem0-style atomic facts), falling
 * back to regex extraction when the LLM is unavailable or its output can't be
 * parsed (offline, MockProvider, API error, malformed JSON).
 *
 * Output is shape-identical to `extractStructuredMemory` — it reuses the same
 * merge/decay/cluster/durable pipeline — so downstream consumers are unchanged.
 *
 * Async (LLM calls are async); callers in async contexts can opt in by awaiting
 * this instead of the sync `extractStructuredMemory`.
 *
 * @param bookmarksContent  Raw BOOKMARKS.md content.
 * @param existingMemory    Optional existing StructuredMemory to merge with.
 * @param opts.provider     Optional provider override (used by tests).
 * @param opts.model        Optional model override.
 */
export async function extractStructuredMemoryLLM(
  bookmarksContent: string,
  existingMemory?: StructuredMemory,
  opts?: { provider?: AIProvider; model?: string },
): Promise<StructuredMemory> {
  const now = new Date().toISOString();
  const dirtyContent = dirtyBookmarkContent(bookmarksContent, existingMemory);
  if (!dirtyContent && existingMemory) return existingMemory;
  const extractionState = buildExtractionState(bookmarksContent, now);
  try {
    const newEntities = await extractEntitiesViaLLM(dirtyContent || bookmarksContent, now, opts);
    if (newEntities === null) {
      logger.warn('[structured-memory] LLM extraction unavailable/unparseable; using regex fallback');
      return extractStructuredMemory(bookmarksContent, existingMemory);
    }
    const assembled = assembleMemory(newEntities, existingMemory, now, extractionState);
    return await resolveMemoryContradictions(assembled, now, opts);
  } catch (err) {
    logger.warn('[structured-memory] LLM extraction failed; using regex fallback', { error: String(err) });
    return extractStructuredMemory(bookmarksContent, existingMemory);
  }
}

/**
 * B-1：LLM 提取后对合并实体跑 bi-temporal 矛盾消解，标记被取代的旧事实并重新派生状态。
 *
 * 分两级：
 *   L1 确定性（slot + content-key，零 LLM 成本）——永远运行
 *   L2 LLM 语义兜底——仅当实体数 ≤ 60 时启用（控 O(n²) LLM 成本，留人工/夜间专项）
 *
 * MemStrata (arXiv:2606.26511) 定理：基于相似度的过期检测结构上不可能。
 * 正确做法是 S-R-O key matching——本函数的 L1 实现了此原理。
 *
 * 失败保守保留原记忆。
 */
async function resolveMemoryContradictions(
  memory: StructuredMemory,
  now: string,
  opts?: { provider?: AIProvider; model?: string },
): Promise<StructuredMemory> {
  if (memory.entities.length === 0) return memory;

  try {
    const useLLM = memory.entities.length <= 60;
    // L1 确定性永远运行；L2 LLM 只在实体数 ≤ 60 时启用
    let contradicts: Contradicts = makeRuleBasedContradicts();
    if (useLLM) {
      const { provider, model } = await resolveSummarizeProvider(opts);
      contradicts = combineContradicts(makeRuleBasedContradicts(), makeLLMContradicts(provider, model));
    }

    const { entities, supersededCount } = await resolveContradictions(
      memory.entities,
      contradicts,
      now,
    );
    if (supersededCount === 0) return memory;
    logger.info('[structured-memory] B-1 矛盾消解', {
      supersededCount,
      totalEntities: memory.entities.length,
      llmFallback: useLLM,
    });
    return deriveStructuredState(entities, now, memory.extractionState);
  } catch (err) {
    logger.warn('[structured-memory] 矛盾消解失败，保留原记忆', { error: String(err) });
    return memory;
  }
}

function resolveRuleBasedMemoryContradictions(
  entities: MemoryEntity[],
  now: string,
): MemoryEntity[] {
  const { entities: resolved, supersededCount } = resolveContradictionsSync(
    entities,
    (older, newer) => makeRuleBasedContradicts()(older, newer) === true,
    now,
  );
  if (supersededCount > 0) {
    logger.info('[structured-memory] rule-based current-fact resolution', { supersededCount });
  }
  return resolved;
}

/**
 * Merge existing entities with new extractions.
 * - If a similar entity already exists: update lastSeen, increment occurrences, boost confidence
 * - If new: append
 */
function mergeEntities(
  existing: MemoryEntity[],
  newEntries: MemoryEntity[],
): MemoryEntity[] {
  const merged = [...existing];
  const usedIndices = new Set<number>();

  for (const newEntity of newEntries) {
    let found = false;
    for (let i = 0; i < merged.length; i++) {
      if (usedIndices.has(i)) continue;
      if (
        merged[i].type === newEntity.type &&
        entitiesSimilar(merged[i].content, newEntity.content)
      ) {
        // Update existing entity
        merged[i].lastSeen = newEntity.lastSeen;
        merged[i].occurrences += 1;
        merged[i].confidence = Math.min(1, merged[i].confidence + 0.1);
        merged[i].source = newEntity.source;
        merged[i].enabled = merged[i].enabled !== false;
        merged[i].provenance = newEntity.provenance ?? merged[i].provenance;
        usedIndices.add(i);
        found = true;
        break;
      }
    }

    if (!found) {
      merged.push(newEntity);
    }
  }

  return merged;
}

/**
 * Decay confidence for entities not confirmed in a while.
 * Entities older than 30 days lose 0.05 confidence per day beyond 30.
 * Entities with confidence dropping below 0.2 are removed.
 */
function decayOldEntities(entities: MemoryEntity[], now: string): MemoryEntity[] {
  const nowTime = new Date(now).getTime();
  const thirtyDays = 30 * 86400000;

  return entities.filter((e) => {
    if (e.reviewStatus === 'confirmed' || e.reviewStatus === 'ignored' || e.reviewStatus === 'wrong') {
      return true;
    }

    const lastSeenTime = new Date(e.lastSeen).getTime();
    const age = nowTime - lastSeenTime;

    if (age > thirtyDays) {
      const daysPast = Math.floor((age - thirtyDays) / 86400000);
      const decay = daysPast * 0.05;
      e.confidence = Math.max(0.1, e.confidence - decay);
    }

    return e.confidence >= 0.2;
  });
}

/**
 * Generate a concise topic summary from its entities.
 */
function summarizeTopic(topic: string, entities: MemoryEntity[]): string {
  const recent = entities
    .sort((a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime())
    .slice(0, 5);

  const summaryParts: string[] = [];
  const facts = recent.filter((e) => e.type === 'fact');
  const preferences = recent.filter((e) => e.type === 'preference');
  const events = recent.filter((e) => e.type === 'event');
  const emotions = recent.filter((e) => e.type === 'emotion');

  if (facts.length > 0) {
    summaryParts.push(`事实: ${facts.map((e) => e.content).join('; ')}`);
  }
  if (preferences.length > 0) {
    summaryParts.push(`偏好: ${preferences.map((e) => e.content).join('; ')}`);
  }
  if (events.length > 0) {
    summaryParts.push(`事件: ${events.map((e) => e.content).join('; ')}`);
  }
  if (emotions.length > 0) {
    summaryParts.push(`情绪: ${emotions.map((e) => e.content).join('; ')}`);
  }

  if (summaryParts.length === 0) {
    return `${topic}相关共 ${entities.length} 条记录`;
  }

  return summaryParts.join(' | ');
}

export function deriveStructuredStateView(
  structured: StructuredMemory,
  now = new Date(),
): StructuredStateView {
  const active = activeEntities(structured.entities);
  const durableKeys = new Set(activeEntities(structured.durableFacts).map(entityKey));
  const pinned = uniqueEntities(active.filter((entity) => entity.pinned === true))
    .sort(compareMemoryPriority)
    .slice(0, 10);
  const pinnedKeys = new Set(pinned.map(entityKey));
  const currentFacts = uniqueEntities([
    ...activeEntities(structured.durableFacts)
      .filter((entity) => entity.type === 'fact' || entity.type === 'preference'),
    ...active
      .filter((entity) => (
        (entity.type === 'fact' || entity.type === 'preference')
        && (entity.reviewStatus === 'confirmed' || isCurrentFactSignal(entity))
      )),
  ])
    .filter((entity) => !pinnedKeys.has(entityKey(entity)))
    .sort(compareMemoryPriority)
    .slice(0, 10);

  const activeTopics = structured.topics
    .map((topic) => ({
      ...topic,
      entities: activeEntities(topic.entities).filter((entity) => !pinnedKeys.has(entityKey(entity))),
    }))
    .filter((topic) => topic.entities.length > 0);
  const multiDayArcs = activeTopics
    .filter((topic) => isMultiDayTopic(topic))
    .sort((a, b) => new Date(b.dateRange.end).getTime() - new Date(a.dateRange.end).getTime())
    .slice(0, 5);
  const arcEntityKeys = new Set(multiDayArcs.flatMap((topic) => topic.entities.map(entityKey)));
  for (const key of durableKeys) arcEntityKeys.delete(key);

  const nowMs = now.getTime();
  const recentWindowMs = 14 * 86_400_000;
  const emotionWindowMs = 72 * 3_600_000;
  const recentEvents = active
    .filter((entity) => entity.type === 'event' || entity.type === 'decision' || entity.type === 'intention')
    .filter((entity) => !pinnedKeys.has(entityKey(entity)))
    .filter((entity) => !arcEntityKeys.has(entityKey(entity)))
    .filter((entity) => isWithinWindow(entity.lastSeen, nowMs, recentWindowMs))
    .sort((a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime())
    .slice(0, 8);
  const recentEmotions = active
    .filter((entity) => entity.type === 'emotion' && entity.confidence >= 0.5)
    .filter((entity) => !pinnedKeys.has(entityKey(entity)))
    .filter((entity) => isWithinWindow(entity.lastSeen, nowMs, emotionWindowMs))
    .sort((a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime())
    .slice(0, 5);

  return { pinned, currentFacts, multiDayArcs, recentEvents, recentEmotions };
}

export function renderStructuredStateView(view: StructuredStateView): string | null {
  const parts: string[] = [];
  const anchors = structuredResponseAnchors(view);

  if (view.pinned.length > 0) {
    const lines = view.pinned.map((entity) => (
      `- ${entity.content}（固定记忆，优先保留；按类型和时间判断，不自动当作当前状态；${formatDateOnly(entity.lastSeen)}更新）`
    ));
    parts.push(`## 固定记忆（用户指定优先）\n${lines.join('\n')}`);
  }

  if (anchors.length > 0) {
    parts.push([
      '## 当前相关线索（回复时优先落地）',
      ...anchors.map((anchor) => `- ${anchor}`),
      '使用规则：当用户提到“今天/又/最近/这件事/汇报/项目”或问你“还记得吗”，先点名最相关的具体线索，再接情绪和偏好；不要只问“什么内容”。这些是近期背景，不自动当作用户此刻正在做。',
    ].join('\n'));
  }

  if (view.currentFacts.length > 0) {
    parts.push(`## 当前事实（稳定/已确认）\n${view.currentFacts.map((entity) => `- ${entity.content}`).join('\n')}`);
  }

  if (view.multiDayArcs.length > 0) {
    const lines = view.multiDayArcs.map((topic) => {
      const summary = topic.summary.length > 120 ? `${topic.summary.slice(0, 120)}…` : topic.summary;
      return `- ${topic.topic}: ${summary}（${formatDateOnly(topic.dateRange.start)} 至 ${formatDateOnly(topic.dateRange.end)}，多日线索，不等同于当前状态）`;
    });
    parts.push(`## 多日线索\n${lines.join('\n')}`);
  }

  if (view.recentEvents.length > 0) {
    const lines = view.recentEvents.map((entity) => (
      `- ${entity.content}（${formatDateOnly(entity.lastSeen)}，近期事件/计划，先当背景，不当稳定事实）`
    ));
    parts.push(`## 近期事件\n${lines.join('\n')}`);
  }

  if (view.recentEmotions.length > 0) {
    const lines = view.recentEmotions.map((entity) => (
      `- ${entity.content}（${formatDateOnly(entity.lastSeen)}观察，按时间判断，不自动当作现在）`
    ));
    parts.push(`## 近期情绪\n${lines.join('\n')}`);
  }

  return parts.length > 0 ? parts.join('\n\n') : null;
}

function structuredResponseAnchors(view: StructuredStateView): string[] {
  const out: string[] = [];
  for (const topic of view.multiDayArcs) {
    const summary = topic.summary.length > 80 ? `${topic.summary.slice(0, 80)}…` : topic.summary;
    out.push(`${topic.topic}: ${summary}`);
  }
  for (const entity of view.recentEvents) {
    out.push(entity.content);
  }
  return Array.from(new Set(out)).slice(0, 5);
}

/**
 * Convert structured memory to a compact string for system prompt injection.
 *
 * Format:
 *   关于用户: <durable facts> | 偏好: <preferences> | 最近事件: <events>
 */
export function memoryToContext(structured: StructuredMemory, userMessage?: string): string {
  const view = deriveStructuredStateView(structured);
  const filtered = userMessage ? filterStateViewByRelevance(view, userMessage) : view;
  return renderStructuredStateView(filtered) ?? '';
}

/**
 * Topic relevance filter: only keep memory entities that share lexical overlap
 * with the current user message (Chinese bigram TF cosine > 0).
 *
 * Rationale: avoids injecting irrelevant memories ("用户喝美式") into completely
 * unrelated conversations (user asking about work stress). This matches Open WebUI's
 * query-memory pattern and DAM-LLM's entropy-driven compression.
 *
 * When nothing matches the user message → returns empty view (no memory injection).
 * Safety: pinned memories bypass the filter (user explicitly wants them kept).
 */
function filterStateViewByRelevance(
  view: StructuredStateView,
  userMessage: string,
): StructuredStateView {
  const queryVec = embed(tokenize(userMessage));
  // 0 overlap with any entity → no memory injection (avoid noise)
  const noneRelevant = Object.keys(queryVec).length === 0;

  // Always include recent items (recency boost) — even without topic overlap,
  // recent memories should be available. The LLM decides whether to use them.
  // This ensures new users can feel Mio "remembering" them from day 1.
  const RECENT_ALWAYS_KEEP = 3;

  const isRelevant = (entity: { content: string; pinned?: boolean }): boolean => {
    if ('pinned' in entity && entity.pinned) return true;
    if (noneRelevant) return true;
    const entityVec = embed(tokenize(entity.content));
    if (Object.keys(entityVec).length === 0) return true;
    return cosine(queryVec, entityVec) > 0;
  };

  // Sort by recency (lastSeen descending) and always keep the most recent N
  const byRecency = <T extends { lastSeen?: string }>(items: T[]): T[] => {
    return [...items].sort((a, b) => {
      const da = a.lastSeen ? new Date(a.lastSeen).getTime() : 0;
      const db = b.lastSeen ? new Date(b.lastSeen).getTime() : 0;
      return db - da;
    });
  };

  return {
    pinned: view.pinned.filter(isRelevant),
    currentFacts: [
      ...view.currentFacts.filter(isRelevant),
      // Always keep most recent facts regardless of topic
      ...byRecency(view.currentFacts).filter((e) => !isRelevant(e)).slice(0, RECENT_ALWAYS_KEEP),
    ],
    multiDayArcs: view.multiDayArcs.filter((topic) => {
      const topicVec = embed(tokenize(topic.topic + ' ' + topic.summary));
      if (Object.keys(topicVec).length === 0 || noneRelevant) return true;
      return cosine(queryVec, topicVec) > 0;
    }),
    recentEvents: [
      ...view.recentEvents.filter(isRelevant),
      // Always show most recent events
      ...byRecency(view.recentEvents).filter((e) => !isRelevant(e)).slice(0, RECENT_ALWAYS_KEEP),
    ],
    recentEmotions: view.recentEmotions.filter(isRelevant),
  };
}

function entityKey(entity: MemoryEntity): string {
  return `${entity.type}\u0000${entity.content}`;
}

function uniqueEntities(entities: MemoryEntity[]): MemoryEntity[] {
  const seen = new Set<string>();
  const out: MemoryEntity[] = [];
  for (const entity of entities) {
    const key = entityKey(entity);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entity);
  }
  return out;
}

function compareMemoryPriority(a: MemoryEntity, b: MemoryEntity): number {
  return (Number(b.pinned === true) - Number(a.pinned === true))
    || (b.confidence - a.confidence)
    || (b.occurrences - a.occurrences)
    || (new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime());
}

function isMultiDayTopic(topic: TopicSegment): boolean {
  const start = new Date(topic.dateRange.start);
  const end = new Date(topic.dateRange.end);
  const startMs = start.getTime();
  const endMs = end.getTime();
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return false;
  const arcEntities = topic.entities.filter((entity) => entity.type === 'event' || entity.type === 'decision' || entity.type === 'intention');
  if (arcEntities.length === 0) return false;
  if (arcEntities.some((entity) => entity.occurrences >= 2)) return true;
  const differentCalendarDay = start.toISOString().slice(0, 10) !== end.toISOString().slice(0, 10);
  return arcEntities.length >= 2 && (differentCalendarDay || endMs - startMs >= 20 * 3_600_000);
}

function isCurrentFactSignal(entity: MemoryEntity): boolean {
  const text = entity.content.replace(/\s+/g, '');
  if (entity.type === 'fact') {
    return /(?:现在|目前|当前|住在|搬到|搬去|搬进|在\S{2,30}(?:工作|上班|上学|读书|学习))/.test(text);
  }
  if (entity.type === 'preference') {
    return /(?:以后|别|不要|别再|现在|目前|当前)/.test(text);
  }
  return false;
}

function isWithinWindow(iso: string, nowMs: number, windowMs: number): boolean {
  const time = new Date(iso).getTime();
  return !Number.isNaN(time) && time <= nowMs && time >= nowMs - windowMs;
}

function formatDateOnly(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '时间未知';
  return date.toISOString().slice(0, 10);
}

/**
 * JSON serialize a StructuredMemory for disk storage.
 */
export function serializeMemory(structured: StructuredMemory): string {
  return JSON.stringify(structured, null, 2);
}

/**
 * JSON deserialize a StructuredMemory from disk.
 */
export function deserializeMemory(json: string): StructuredMemory {
  return JSON.parse(json) as StructuredMemory;
}

/**
 * Smart merge of two StructuredMemory objects.
 * - Updates occurrences and boosts confidence on repeated facts.
 * - Decays old unconfirmed facts.
 * - Re-filters durable facts.
 */
export function mergeMemories(
  existing: StructuredMemory,
  newEntries: StructuredMemory,
): StructuredMemory {
  const mergedEntities = mergeEntities(existing.entities, newEntries.entities);

  // Re-cluster active topics.
  const topicMap = new Map<string, MemoryEntity[]>();
  for (const entity of activeEntities(mergedEntities)) {
    const topic = classifyTopic(entity.content);
    const existingTopicEntities = topicMap.get(topic) ?? [];
    existingTopicEntities.push(entity);
    topicMap.set(topic, existingTopicEntities);
  }

  const topics: TopicSegment[] = [];
  const now = new Date().toISOString();
  for (const [topic, entities] of topicMap) {
    const dates = entities
      .map((e) => [e.firstSeen, e.lastSeen])
      .flat()
      .sort();
    topics.push({
      topic,
      entities,
      summary: summarizeTopic(topic, entities),
      dateRange: {
        start: dates[0] ?? now,
        end: dates[dates.length - 1] ?? now,
      },
    });
  }
  topics.sort((a, b) => b.entities.length - a.entities.length);

  const durableFacts = activeEntities(mergedEntities).filter(
    (e) => e.pinned === true
      || e.reviewStatus === 'confirmed'
      || (e.reviewStatus !== 'inferred' && e.confidence >= 0.8 && e.occurrences >= 3),
  );

  return {
    entities: mergedEntities,
    topics,
    durableFacts,
    updatedAt: now,
  };
}

// ─── File I/O helpers ───

/**
 * Read the persisted StructuredMemory from disk.
 * Returns null if the file doesn't exist or is corrupt.
 */
export function readStructuredMemoryFromDisk(): StructuredMemory | null {
  const path = structuredMemoryPath();
  if (!existsSync(path)) return null;

  const raw = readFileSyncSafe(path);
  if (!raw || raw.trim().length === 0) return null;

  try {
    return deserializeMemory(raw);
  } catch {
    logger.warn('[structured-memory] corrupt file, returning null');
    return null;
  }
}

/**
 * Write StructuredMemory to disk.
 */
export function writeStructuredMemoryToDisk(memory: StructuredMemory): void {
  writeFileSyncSafe(structuredMemoryPath(), serializeMemory(memory));
}

/**
 * Read a mid-term topic file from disk.
 * Returns null if the topic file doesn't exist.
 */
export function readMidTermTopic(topic: string): TopicSegment | null {
  const path = midTermTopicPath(topic);
  if (!existsSync(path)) return null;

  const raw = readFileSyncSafe(path);
  if (!raw || raw.trim().length === 0) return null;

  try {
    return JSON.parse(raw) as TopicSegment;
  } catch {
    return null;
  }
}

/**
 * Write a mid-term topic segment to disk.
 */
export function writeMidTermTopic(topic: string, segment: TopicSegment): void {
  writeFileSyncSafe(midTermTopicPath(topic), JSON.stringify(segment, null, 2));
}

/**
 * List all mid-term topic names.
 */
export function listMidTermTopics(): string[] {
  const dir = midTermDir();
  if (!existsSync(dir)) return [];

  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''));
  } catch {
    return [];
  }
}

/**
 * Create an empty StructuredMemory.
 */
export function createEmptyMemory(): StructuredMemory {
  return {
    entities: [],
    topics: [],
    durableFacts: [],
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Decay mid-term topics not touched for 30 days.
 * Removes the topic file entirely if expired.
 */
export function cleanExpiredMidTermTopics(): void {
  const now = Date.now();
  const thirtyDays = 30 * 86400000;

  for (const topic of listMidTermTopics()) {
    const segment = readMidTermTopic(topic);
    if (!segment) continue;

    const lastUpdated = new Date(segment.dateRange.end).getTime();
    if (now - lastUpdated > thirtyDays) {
      const path = midTermTopicPath(topic);
      try {
        if (existsSync(path)) rmSync(path);
      } catch {
        // Best effort
      }
    }
  }
}

// Re-export types for convenience
export type { ExtractionResult };
