/**
 * Mio — ACE Memory Reflector
 *
 * ACE (Agentic Context Engineering, arXiv 2510.04618):
 * Generator -> Reflector -> Curator 3-role cycle for context as evolvable playbook.
 *
 * This module adds the QUALITY CHECK step that Mio's nightly consolidation lacked.
 * It analyzes structured memory entities for quality issues (vague, outdated,
 * contradictory, single-source, duplicate) and applies curator decisions.
 *
 * The reflector is pure logic — no LLM calls.
 */

import type { MemoryEntity, StructuredMemory } from './structured-memory.js';
import { logger } from '../utils/logger.js';

// ─── Types ───

export type AuditAction = 'keep' | 'strengthen' | 'weaken' | 'drop' | 'merge';

export interface MemoryAudit {
  entityId: string;
  action: AuditAction;
  reason: string;
  mergedInto?: string;
}

export interface ReflectionResult {
  audits: MemoryAudit[];
  summary: string;
  qualityScore: number;  // 0-1 overall memory quality
  performedAt: string;
}

// ─── Constants ───

/** Days without confirmation before an entity is considered outdated. */
const OUTDATED_DAYS = 90;

/** Minimum occurrences for a single-source entity to avoid weaken. */
const MIN_OCCURRENCES_FOR_CONFIDENCE = 2;

/** Confidence boost for strengthen action. */
const STRENGTHEN_BOOST = 0.1;

/** Confidence penalty for weaken action. */
const WEAKEN_PENALTY = 0.15;

/** Threshold below which an entity is dropped during curation. */
const DROP_CONFIDENCE_THRESHOLD = 0.25;

// ─── Heuristic checks ───

/**
 * Check if entity content is too vague to be useful.
 * "Too vague" means very short content, generic statements, or placeholders.
 */
function isTooVague(entity: MemoryEntity): boolean {
  const content = entity.content.trim();

  // Very short content with no concrete information
  if (content.length < 6) return true;

  // Generic patterns that carry no real information
  const vaguePatterns = [
    /^喜欢/,          // "喜欢" without object — "喜欢" alone is vague
    /^用户/,          // "用户" without predicate
    /^他/,            // Single pronoun start with no real content
    /^她/,
    /^你/,
    /^有点/,          // "有点..." without context
    /^感觉/,          // "感觉..." without context
    /^今天/,          // "今天..." without context is too broad
    /^最近/,          // "最近..." same
  ];

  for (const pattern of vaguePatterns) {
    if (pattern.test(content)) {
      // If the entity is literally just a vague pattern match (short), flag it
      if (content.length < 15) return true;
    }
  }

  return false;
}

/**
 * Check if the entity is outdated — lastSeen > 90 days and not confirmed recently.
 */
function isOutdated(entity: MemoryEntity, now: Date): boolean {
  const lastSeen = new Date(entity.lastSeen);
  const daysSinceLastSeen = (now.getTime() - lastSeen.getTime()) / 86400000;
  return daysSinceLastSeen > OUTDATED_DAYS;
}

/**
 * Check if the entity has only a single source occurrence (low confidence signal).
 */
function isSingleSource(entity: MemoryEntity): boolean {
  return entity.occurrences < MIN_OCCURRENCES_FOR_CONFIDENCE;
}

/**
 * Find contradictory entity pairs within a StructuredMemory group.
 * Contradictory means same type with semantically opposite content.
 */
function findContradictions(
  entities: MemoryEntity[],
): Map<number, Set<number>> {
  const contradictions = new Map<number, Set<number>>();

  // Build a simple contradiction map using known antonym pairs
  const antonymPairs: [RegExp, RegExp][] = [
    [/(?:喜欢|爱|最爱|很喜欢)/, /(?:讨厌|不喜欢|恨|厌恶)/],
    [/(?:开心|快乐|高兴|幸福)/, /(?:难过|伤心|悲伤|沮丧)/],
    [/(?:程序员|码农|开发者)/, /(?:设计|设计师|UI)/],
    [/(?:早起|早睡|早起)/, /(?:熬夜|晚睡|失眠)/],
    [/(?:喜欢|爱)吃(肉|荤)/, /(?:素食|吃素|不吃肉)/],
    [/(?:有|在)(?:工作|上班)/, /(?:辞职|离职|失业|没工作)/],
  ];

  for (let i = 0; i < entities.length; i++) {
    for (let j = i + 1; j < entities.length; j++) {
      if (entities[i].type !== entities[j].type) continue;

      const ci = entities[i].content;
      const cj = entities[j].content;

      for (const [a, b] of antonymPairs) {
        const ai = a.test(ci) && b.test(cj);
        const aj = b.test(ci) && a.test(cj);
        if (ai || aj) {
          if (!contradictions.has(i)) contradictions.set(i, new Set());
          if (!contradictions.has(j)) contradictions.set(j, new Set());
          contradictions.get(i)!.add(j);
          contradictions.get(j)!.add(i);
        }
      }
    }
  }

  return contradictions;
}

/**
 * Find duplicate entities (same or very similar content, same type).
 */
function findDuplicates(
  entities: MemoryEntity[],
): Map<number, number> {
  // Map from entity index -> best duplicate index to merge into
  const duplicates = new Map<number, number>();

  for (let i = 0; i < entities.length; i++) {
    if (duplicates.has(i)) continue;
    for (let j = i + 1; j < entities.length; j++) {
      if (duplicates.has(j)) continue;
      if (entities[i].type !== entities[j].type) continue;

      // Check for semantic similarity via substring overlap
      const aNorm = entities[i].content.toLowerCase().replace(/\s+/g, '');
      const bNorm = entities[j].content.toLowerCase().replace(/\s+/g, '');
      const isSimilar =
        aNorm.includes(bNorm) ||
        bNorm.includes(aNorm) ||
        levenshteinRatio(aNorm, bNorm) > 0.7;

      if (isSimilar) {
        // Merge j into i (keep the one with more occurrences / higher confidence)
        if (entities[j].occurrences > entities[i].occurrences ||
            (entities[j].occurrences === entities[i].occurrences &&
             entities[j].confidence > entities[i].confidence)) {
          duplicates.set(i, j);
        } else {
          duplicates.set(j, i);
        }
      }
    }
  }

  return duplicates;
}

/**
 * Compute Levenshtein similarity ratio between two strings (0-1).
 */
function levenshteinRatio(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;

  // Simple quick check: if length difference > 50%, not similar
  if (Math.abs(a.length - b.length) / maxLen > 0.5) return 0;

  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }

  return 1 - dp[m][n] / maxLen;
}

// ─── Public API ───

/**
 * Reflect on structured memory — analyze each entity for quality issues.
 *
 * ACE Reflector phase: evaluates memory quality, flags vague/outdated/
 * contradictory/single-source/duplicate entities, and assigns audit actions.
 *
 * @param structured  The current StructuredMemory to audit.
 * @returns           ReflectionResult with audits, summary, and quality score.
 */
export function reflectOnMemory(structured: StructuredMemory): ReflectionResult {
  const now = new Date();
  const audits: MemoryAudit[] = [];
  const entities = structured.entities;

  // Pre-compute contradictions and duplicates
  const contradictions = findContradictions(entities);
  const duplicates = findDuplicates(entities);
  const contradictedIndices = new Set<number>();
  for (const [i, targets] of contradictions) {
    contradictedIndices.add(i);
    for (const t of targets) contradictedIndices.add(t);
  }

  let confidentCount = 0;
  let recentCount = 0;
  let weakCount = 0;

  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i];
    const reasons: string[] = [];

    // Generate a short stable identifier from content + index
    const entityId = `${entity.type.slice(0, 3)}_${i}_${entity.content.slice(0, 20).replace(/\s+/g, '_')}`;

    // Check contradictions first — these override other signals
    if (contradictions.has(i)) {
      const targets = contradictions.get(i)!;
      const targetIds = [...targets]
        .map((t) => `${entity.type.slice(0, 3)}_${t}_${entities[t].content.slice(0, 20).replace(/\s+/g, '_')}`);
      audits.push({
        entityId,
        action: 'weaken',
        reason: `与其他记忆矛盾: ${targetIds.join(', ')} — 需要进一步确认`,
      });
      weakCount++;
      continue;
    }

    // Check for vagueness
    if (isTooVague(entity)) {
      audits.push({
        entityId,
        action: 'weaken',
        reason: '太泛了，没有具体信息',
      });
      weakCount++;
      continue;
    }

    // Check for duplicates (merge suggestion for the one being absorbed)
    if (duplicates.has(i)) {
      const targetIdx = duplicates.get(i)!;
      const targetId = `${entities[targetIdx].type.slice(0, 3)}_${targetIdx}_${entities[targetIdx].content.slice(0, 20).replace(/\s+/g, '_')}`;
      audits.push({
        entityId,
        action: 'merge',
        reason: '与其他条目内容重复',
        mergedInto: targetId,
      });
      continue;
    }

    // Check for outdated info
    if (isOutdated(entity, now)) {
      audits.push({
        entityId,
        action: 'weaken',
        reason: `超过${OUTDATED_DAYS}天未确认，可能已过时`,
      });
      weakCount++;
      continue;
    }

    // Check for single-source low confidence
    if (isSingleSource(entity) && entity.confidence < 0.6) {
      audits.push({
        entityId,
        action: 'weaken',
        reason: '仅出现一次，置信度较低',
      });
      weakCount++;
      continue;
    }

    // High quality: multiple occurrences, recent, decent confidence
    if (entity.occurrences >= 3 && entity.confidence >= 0.7) {
      audits.push({
        entityId,
        action: 'strengthen',
        reason: `确认${entity.occurrences}次，可信度高`,
      });
      confidentCount++;
    } else if (entity.occurrences >= 2 && entity.confidence >= 0.5) {
      // Acceptable but not strong enough to boost
      audits.push({
        entityId,
        action: 'keep',
        reason: '信息可接受，但需要更多确认',
      });
      recentCount++;
    } else {
      audits.push({
        entityId,
        action: 'keep',
        reason: '信息偏弱但保留观察',
      });
      recentCount++;
    }
  }

  // Calculate quality score (0-1)
  const totalEntities = entities.length || 1;
  const dedupRate = totalEntities > 0
    ? (totalEntities - duplicates.size) / totalEntities
    : 1;

  // Track recency distribution
  const freshCount = entities.filter((e) => {
    const age = (now.getTime() - new Date(e.lastSeen).getTime()) / 86400000;
    return age <= 30;
  }).length;
  const recencyRatio = freshCount / totalEntities;

  // Average confidence
  const avgConfidence =
    entities.reduce((sum, e) => sum + e.confidence, 0) / totalEntities;

  // Quality score: weighted combination of avgConfidence, dedup rate, recency
  const qualityScore = Math.round(
    (avgConfidence * 0.4 + dedupRate * 0.3 + recencyRatio * 0.3) * 100,
  ) / 100;

  // Build summary
  const summary = [
    `Reflection complete: ${audits.length} audits across ${entities.length} entities.`,
    `  - Strengthen: ${confidentCount} high-confidence entities`,
    `  - Weaken: ${weakCount} low-quality entities flagged`,
    `  - Merge: ${duplicates.size} duplicates detected`,
    `  - Keep: ${recentCount} entities retained as-is`,
    `  - Quality score: ${qualityScore.toFixed(2)}`,
    `  - Avg confidence: ${avgConfidence.toFixed(2)}`,
    `  - Dedup rate: ${(dedupRate * 100).toFixed(0)}%`,
    `  - Recent (≤30d): ${(recencyRatio * 100).toFixed(0)}%`,
  ].join('\n');

  return {
    audits,
    summary,
    qualityScore,
    performedAt: now.toISOString(),
  };
}

/**
 * Curate structured memory — apply the reflector's decisions.
 *
 * ACE Curator phase: drops flagged entities, merges duplicates, adjusts confidence.
 *
 * @param structured  The current StructuredMemory to curate.
 * @param audit       The ReflectionResult from reflectOnMemory().
 * @returns           A new, cleaned StructuredMemory.
 */
export function curateMemory(
  structured: StructuredMemory,
  audit: ReflectionResult,
): StructuredMemory {
  if (audit.audits.length === 0) {
    return { ...structured, updatedAt: new Date().toISOString() };
  }

  // Build a map of entityId -> audit action for efficient lookup.
  // Entity id format: <type_slice>_<index>_<content_slice>
  const auditMap = new Map<string, MemoryAudit>();
  for (const a of audit.audits) {
    auditMap.set(a.entityId, a);
  }

  // Phase 1: Classify every entity (drop, merge, keep-modified, or keep-as-is).
  const dropIndices = new Set<number>();
  const mergeSources = new Map<number, number>(); // sourceIdx -> targetIdx
  const keptEntities = new Map<number, MemoryEntity>(); // idx -> entity (modified or original)

  for (let i = 0; i < structured.entities.length; i++) {
    const entity = structured.entities[i];
    const entityId = `${entity.type.slice(0, 3)}_${i}_${entity.content.slice(0, 20).replace(/\s+/g, '_')}`;
    const auditEntry = auditMap.get(entityId);

    if (!auditEntry) {
      // No audit — keep as-is
      keptEntities.set(i, { ...entity });
      continue;
    }

    switch (auditEntry.action) {
      case 'drop': {
        dropIndices.add(i);
        break;
      }
      case 'merge': {
        if (auditEntry.mergedInto) {
          const parts = auditEntry.mergedInto.split('_');
          const targetIdx = parseInt(parts[1], 10);
          if (!isNaN(targetIdx) && targetIdx < structured.entities.length) {
            mergeSources.set(i, targetIdx);
          } else {
            // Can't resolve merge target — keep as-is
            keptEntities.set(i, { ...entity });
          }
        }
        break;
      }
      case 'strengthen': {
        const boosted = { ...entity };
        boosted.confidence = Math.min(1, boosted.confidence + STRENGTHEN_BOOST);
        keptEntities.set(i, boosted);
        break;
      }
      case 'weaken': {
        const weakened = { ...entity };
        weakened.confidence = Math.max(0.1, weakened.confidence - WEAKEN_PENALTY);
        if (weakened.confidence < DROP_CONFIDENCE_THRESHOLD) {
          dropIndices.add(i);
        } else {
          keptEntities.set(i, weakened);
        }
        break;
      }
      default: {
        keptEntities.set(i, { ...entity });
        break;
      }
    }
  }

  // Phase 2: Apply merges — combine source into target.
  for (const [sourceIdx, targetIdx] of mergeSources) {
    if (dropIndices.has(sourceIdx)) continue;
    if (dropIndices.has(targetIdx)) continue;

    const source = structured.entities[sourceIdx];
    const target = keptEntities.get(targetIdx) ?? { ...structured.entities[targetIdx] };

    // Prefer the more specific (longer) content
    if (source.content.length > target.content.length) {
      target.content = source.content;
    }

    target.occurrences += source.occurrences;
    target.confidence = Math.max(target.confidence, source.confidence);
    target.lastSeen = source.lastSeen > target.lastSeen ? source.lastSeen : target.lastSeen;
    keptEntities.set(targetIdx, target);

    // Remove the source from kept entities (it's merged in)
    keptEntities.delete(sourceIdx);
  }

  // Phase 3: Build the final entity list, filtering dropped indices.
  const finalEntities: MemoryEntity[] = [];
  for (let i = 0; i < structured.entities.length; i++) {
    if (dropIndices.has(i)) continue;
    if (mergeSources.has(i) && !keptEntities.has(i)) continue; // merged into another & not retained
    const entity = keptEntities.get(i);
    if (entity) {
      finalEntities.push(entity);
    }
  }

  // Phase 4: Rebuild topics and durable facts.
  const now = new Date().toISOString();
  const topicMap = new Map<string, MemoryEntity[]>();
  for (const entity of finalEntities) {
    const topic = classifyTopic(entity.content);
    const existing = topicMap.get(topic) ?? [];
    existing.push(entity);
    topicMap.set(topic, existing);
  }

  const topics = [...topicMap.entries()]
    .map(([topic, entities]) => ({
      topic,
      entities,
      summary: summarizeTopic(topic, entities),
      dateRange: {
        start: entities.reduce(
          (earliest, e) => (e.firstSeen < earliest ? e.firstSeen : earliest),
          entities[0]?.firstSeen ?? now,
        ),
        end: entities.reduce(
          (latest, e) => (e.lastSeen > latest ? e.lastSeen : latest),
          entities[0]?.lastSeen ?? now,
        ),
      },
    }))
    .sort((a, b) => b.entities.length - a.entities.length);

  const durableFacts = finalEntities.filter(
    (e) => e.confidence >= 0.8 && e.occurrences >= 3,
  );

  return {
    entities: finalEntities,
    topics,
    durableFacts,
    updatedAt: now,
  };
}

/**
 * Run the full ACE reflection cycle: reflect -> curate -> return improved memory.
 *
 * @param structured  The current StructuredMemory to process.
 * @returns           The curated, improved StructuredMemory.
 */
export function runReflectionCycle(structured: StructuredMemory): StructuredMemory {
  const startTime = Date.now();

  // Phase 1: Reflect
  const reflection = reflectOnMemory(structured);

  // Log the reflection summary
  logger.info(`[reflector] ${reflection.summary.split('\n')[0]}`);
  logger.info(`[reflector] quality score: ${reflection.qualityScore.toFixed(2)}`);

  // Phase 2: Curate
  const curated = curateMemory(structured, reflection);

  const elapsed = Date.now() - startTime;
  logger.info(
    `[reflector] cycle complete: ${structured.entities.length} -> ${curated.entities.length} entities in ${elapsed}ms`,
  );

  // Log significant changes for observability
  const dropped = structured.entities.length - curated.entities.length;
  if (dropped > 0) {
    logger.info(`[reflector] dropped ${dropped} low-quality entities`);
  }
  const weakened = reflection.audits.filter((a) => a.action === 'weaken').length;
  if (weakened > 0) {
    logger.info(`[reflector] weakened ${weakened} entities`);
  }
  const merged = reflection.audits.filter((a) => a.action === 'merge').length;
  if (merged > 0) {
    logger.info(`[reflector] merged ${merged} duplicate entities`);
  }

  return curated;
}

// ─── Internal helpers (mirrored from structured-memory.ts to avoid circular deps) ───

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
      if (lower.includes(kw.toLowerCase())) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestTopic = topic;
    }
  }

  return bestTopic;
}

function summarizeTopic(topic: string, entities: MemoryEntity[]): string {
  const recent = entities
    .sort((a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime())
    .slice(0, 5);

  const parts: string[] = [];
  const facts = recent.filter((e) => e.type === 'fact');
  const preferences = recent.filter((e) => e.type === 'preference');
  const events = recent.filter((e) => e.type === 'event');
  const emotions = recent.filter((e) => e.type === 'emotion');

  if (facts.length > 0) {
    parts.push(`事实: ${facts.map((e) => e.content).join('; ')}`);
  }
  if (preferences.length > 0) {
    parts.push(`偏好: ${preferences.map((e) => e.content).join('; ')}`);
  }
  if (events.length > 0) {
    parts.push(`事件: ${events.map((e) => e.content).join('; ')}`);
  }
  if (emotions.length > 0) {
    parts.push(`情绪: ${emotions.map((e) => e.content).join('; ')}`);
  }

  if (parts.length === 0) {
    return `${topic}相关共 ${entities.length} 条记录`;
  }

  return parts.join(' | ');
}
