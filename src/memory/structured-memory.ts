/**
 * Mio — Structured Memory Extractor
 *
 * Extracts structured information (facts, preferences, events, decisions, intentions, emotions)
 * from bookmark entries using pattern matching and heuristics. Implements a 3-tier memory
 * architecture with short-term (transcript), mid-term (topic segments), and long-term
 * (durable facts) storage.
 *
 * Reference: From Hierarchical Context AI Agent and MemoryOS research:
 * - Structured JSON extraction achieves ~95% fact retention vs ~70% for prose summaries
 * - 3-tier memory: STM (FIFO) -> MTM (topic segments) -> LTM (durable facts)
 */

import { createHash } from 'node:crypto';
import { readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { logger } from '../utils/logger.js';
import { readFileSyncSafe, writeFileSyncSafe } from './bank.js';
import {
  structuredMemoryPath,
  midTermDir,
  midTermTopicPath,
} from './paths.js';
import type { AIProvider, Message } from '../types.js';

// ─── Types ───

export interface MemoryEntity {
  type: 'fact' | 'preference' | 'event' | 'decision' | 'intention' | 'emotion';
  content: string;        // the actual fact/preference/etc
  confidence: number;     // 0-1 how sure we are
  firstSeen: string;      // ISO timestamp
  lastSeen: string;       // ISO timestamp
  occurrences: number;    // how many times confirmed
  source: string;         // which bookmark/transcript line
  reviewStatus?: 'inferred' | 'confirmed' | 'ignored';
  reviewedAt?: string;
  /** B-1 bi-temporal：被更新事实取代时打上(ISO)；不删除，留审计；activeEntities 据此排除。 */
  invalidatedAt?: string;
  /** 取代它的新事实 content（溯源）。 */
  supersededBy?: string;
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
  // "用户今年25岁" / "他是程序员"
  /(?:用户|他|她|你)(?:今年|现在|是|有)?(\S*(?:岁|年|岁数|生日|工作|职业|专业|学校|公司|城市))/,
  // "在XX上班"
  /在(\S+(?:公司|上班|工作|上学|读书))/,
];

const PREFERENCE_PATTERNS: RegExp[] = [
  // "喜欢/爱/讨厌/不喜欢/喜欢"
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

  // Fact extraction
  for (const pattern of FACT_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      entities.push({
        type: 'fact',
        content: match[0].slice(0, 100),
        confidence: 0.5,
        firstSeen: timestamp,
        lastSeen: timestamp,
        occurrences: 1,
        source,
      });
    }
  }

  // Preference extraction
  for (const pattern of PREFERENCE_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      entities.push({
        type: 'preference',
        content: match[0].slice(0, 100),
        confidence: 0.6,
        firstSeen: timestamp,
        lastSeen: timestamp,
        occurrences: 1,
        source,
      });
    }
  }

  // Event extraction
  for (const pattern of EVENT_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      entities.push({
        type: 'event',
        content: match[0].slice(0, 100),
        confidence: 0.7,
        firstSeen: timestamp,
        lastSeen: timestamp,
        occurrences: 1,
        source,
      });
    }
  }

  // Decision extraction
  for (const pattern of DECISION_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      entities.push({
        type: 'decision',
        content: match[0].slice(0, 100),
        confidence: 0.6,
        firstSeen: timestamp,
        lastSeen: timestamp,
        occurrences: 1,
        source,
      });
    }
  }

  // Intention extraction
  for (const pattern of INTENTION_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      entities.push({
        type: 'intention',
        content: match[0].slice(0, 100),
        confidence: 0.5,
        firstSeen: timestamp,
        lastSeen: timestamp,
        occurrences: 1,
        source,
      });
    }
  }

  // Emotion extraction
  for (const pattern of EMOTION_PATTERNS) {
    const match = text.match(pattern);
    if (match) {
      entities.push({
        type: 'emotion',
        content: match[0].slice(0, 100),
        confidence: 0.7,
        firstSeen: timestamp,
        lastSeen: timestamp,
        occurrences: 1,
        source,
      });
    }
  }

  return entities;
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
  return entities.filter((entity) => entity.reviewStatus !== 'ignored' && !entity.invalidatedAt);
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

  // Cluster active entities by topic. Ignored entities stay in `entities` for
  // user review/audit, but are excluded from prompt-facing derived state.
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
    (e) => e.reviewStatus === 'confirmed'
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
async function extractEntitiesViaLLM(
  bookmarksContent: string,
  now: string,
  opts?: { provider?: AIProvider; model?: string },
): Promise<MemoryEntity[] | null> {
  const entries = parseBookmarkEntries(bookmarksContent);
  if (entries.length === 0) return [];

  let provider: AIProvider;
  let model: string | undefined = opts?.model;

  if (opts?.provider) {
    provider = opts.provider;
  } else {
    // Lazy-load the provider stack so this module stays lightweight in the
    // many sync contexts that import it (matches router.ts's dynamic-import
    // pattern and avoids any load-time cycle).
    const { selectProvider } = await import('../providers/index.js');
    const { getRouterConfig, routeTask, getTaskModel } = await import('../providers/router.js');
    const { getConfig } = await import('../config.js');
    const config = getConfig();
    const base = selectProvider(config.provider, config.model);
    const routerCfg = getRouterConfig();
    provider = await routeTask('summarize', base, routerCfg);
    if (!model) model = getTaskModel('summarize', routerCfg) || undefined;
  }

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
    return assembleMemory(newEntities, existingMemory, now, extractionState);
  } catch (err) {
    logger.warn('[structured-memory] LLM extraction failed; using regex fallback', { error: String(err) });
    return extractStructuredMemory(bookmarksContent, existingMemory);
  }
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
    if (e.reviewStatus === 'confirmed' || e.reviewStatus === 'ignored') {
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

/**
 * Convert structured memory to a compact string for system prompt injection.
 *
 * Format:
 *   关于用户: <durable facts> | 偏好: <preferences> | 最近事件: <events>
 */
export function memoryToContext(structured: StructuredMemory): string {
  const parts: string[] = [];
  const durableFacts = activeEntities(structured.durableFacts);
  const entities = activeEntities(structured.entities);
  const topics = structured.topics
    .map((topic) => ({ ...topic, entities: activeEntities(topic.entities) }))
    .filter((topic) => topic.entities.length > 0);

  // Durable facts first (most important)
  if (durableFacts.length > 0) {
    const factLines = durableFacts
      .map((f) => f.content)
      .slice(0, 10);
    parts.push(`## 关于用户(结构化记忆)\n${factLines.map((f) => `- ${f}`).join('\n')}`);
  }

  // Recent topics (top 3)
  const activeTopics = topics
    .filter((t) => t.entities.length >= 1)
    .slice(0, 3);

  if (activeTopics.length > 0) {
    const topicLines: string[] = [];
    for (const topic of activeTopics) {
      const recentFacts = topic.entities
        .filter((e) => e.type === 'fact' || e.type === 'preference' || e.type === 'event')
        .slice(0, 3)
        .map((e) => e.content);
      if (recentFacts.length > 0) {
        topicLines.push(`${topic.topic}: ${recentFacts.join(', ')}`);
      }
    }
    if (topicLines.length > 0) {
      parts.push(`## 话题\n${topicLines.join('\n')}`);
    }
  }

  // Recent emotions (top 5 high confidence)
  const recentEmotions = entities
    .filter((e) => e.type === 'emotion' && e.confidence >= 0.6)
    .sort((a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime())
    .slice(0, 5);

  if (recentEmotions.length > 0) {
    parts.push(`## 近期情绪\n${recentEmotions.map((e) => `- ${e.content}`).join('\n')}`);
  }

  return parts.join('\n\n');
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
    (e) => e.reviewStatus === 'confirmed'
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
