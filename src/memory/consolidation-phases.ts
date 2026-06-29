/**
 * Mio — 3-Phase Nightly Consolidation (三阶段夜间记忆整合)
 *
 * Replaces the single-pass nightly consolidation with a structured 3-phase pipeline:
 *
 * Phase 1 - LIGHT (排序筛选):
 *   Score each bookmark by importance and select top 30% for deep processing.
 *
 * Phase 2 - DEEP (写入更新):
 *   Process top 30%: decide target file, extract entities, run ACE reflector,
 *   write changes, produce change log.
 *
 * Phase 3 - REM (模式提取):
 *   Scan ALL bookmarks for cross-session patterns, generate procedural memory
 *   candidates, append to procedural-memory.json.
 *
 * Backward compatible — works alongside existing runConsolidation() when
 * feature flag `threePhaseConsolidation` is enabled.
 */

import { readFileSync, existsSync } from 'node:fs';
import { getConfig } from '../config.js';
import { join } from 'node:path';
import {
  readBookmarks,
  readFileSyncSafe,
  writeFileSyncSafe,
  appendFileSyncSafe,
  readUserProfile,
  readRelationship,
  readBankSoul,
} from './bank.js';
import { memoryBankDir, selfRefDir } from './paths.js';
import {
  ensureProceduralMemory,
  readProceduralMemory,
  writeProceduralMemory,
  prioritizeBookmarks,
  extractProceduralRules,
  mergeRules,
  decayRules,
  parseBookmarks,
  getProceduralContext,
} from './procedural-memory.js';
import { extractStructuredMemoryLLM, readStructuredMemoryFromDisk, writeStructuredMemoryToDisk, createEmptyMemory } from './structured-memory.js';
import { reflectOnMemory, curateMemory, runReflectionCycle } from './reflector.js';
import { getFeedbackState } from '../learning/feedback.js';
import { extractUserSaidText, hasDurableUserProfileSignal, isSyntheticProfileSignal } from './profile-governance.js';
import type { ProceduralRule } from './procedural-memory.js';
import { logger } from '../utils/logger.js';

// ─── Types ───

export interface PrioritizedBookmark {
  raw: string;
  time: string;
  what: string;
  evidence: string;
  score: number;
}

export interface ChangeLog {
  target: string;          // target file path (relative to memory-bank)
  action: 'append' | 'update' | 'create' | 'none';
  summary: string;         // what changed
  entitiesAdded: number;
  timestamp: string;
}

export interface PatternReport {
  totalBookmarks: number;
  patternsFound: number;
  rulesGenerated: number;
  rulesAdded: number;
  crossSessionTopics: string[];
  recurringEmotions: string[];
  behavioralInsights: string[];
  generatedAt: string;
}

export interface ConsolidationReport {
  phase1: {
    totalBookmarks: number;
    selectedCount: number;
    topScore: number;
    minScore: number;
  };
  phase2: {
    changes: ChangeLog[];
    aceQualityScore: number | null;
  };
  phase3: PatternReport;
  performedAt: string;
}

// ─── Helpers ───

/**
 * Get the feedback state from disk, returning null if unavailable.
 */
function safeGetFeedbackState() {
  try {
    return getFeedbackState();
  } catch {
    return null;
  }
}

/**
 * Determine target bank file for a bookmark entry.
 */
export function decideTargetFile(
  entry: { what: string; evidence: string },
): 'user-profile' | 'relationship' | 'soul' | 'notes' | 'none' {
  const what = entry.what.toLowerCase();
  const evidence = entry.evidence.toLowerCase();
  const userText = extractUserSaidText(entry.what);

  // Crisis entries usually don't produce durable facts
  if (what.includes('[crisis]') || what.includes('[ghost]')) return 'none';
  if (isSyntheticProfileSignal({ text: userText, what: entry.what, evidence: entry.evidence })) return 'none';

  // Relationship / communication style
  const relationshipKeywords = [
    '他叫我', '他让', '我们的', '共同', '之间',
    '叫他', '叫法', '称呼', '昵称',
  ];
  if (relationshipKeywords.some((kw) => what.includes(kw) || evidence.includes(kw))) {
    return 'relationship';
  }

  // Soul / persona evolution
  const soulKeywords = [
    '你做得', '你刚才', '你的语气', '你说话',
    '做得好', '说得好', '感觉你',
  ];
  if (soulKeywords.some((kw) => what.includes(kw) || evidence.includes(kw))) {
    return 'soul';
  }

  // Facts about the user. Keep this narrow: raw "user said" exchanges are not
  // durable profile facts unless the quoted text contains a stable signal.
  const userProfileKeywords = [
    '他喜欢', '她喜欢', '用户喜欢', '他讨厌', '她讨厌', '用户讨厌',
    '他的工作', '她的工作', '用户的工作', '他的职业', '她的职业',
    '年龄', '职业', '公司', '城市', '学校', '专业', '爱好', '习惯',
    'he likes', 'she likes', 'he dislikes', 'she dislikes', 'he works', 'she works',
  ];
  if (userProfileKeywords.some((kw) => what.includes(kw) || evidence.includes(kw))) {
    return 'user-profile';
  }
  if (userText && hasDurableUserProfileSignal(userText)) {
    return 'user-profile';
  }

  // Working notes (topics, domain insights, multi-day threads)
  const notesKeywords = [
    '关于', '话题', '笔记', '记下', 'thread', 'work',
    '项目', '计划', '打算', '准备',
  ];
  if (notesKeywords.some((kw) => what.includes(kw) || evidence.includes(kw))) {
    return 'notes';
  }

  return 'none';
}

/**
 * Score a single entry on emotional weight.
 */
function computeEntryDepth(entry: { what: string; evidence: string }): number {
  const text = `${entry.what} ${entry.evidence}`;
  // Longer evidence = more depth
  const lengthScore = Math.min(1, text.length / 200);
  // Has emotional keywords
  const emotionalKeywords = [
    '开心', '难过', '哭', '累', '疲惫', '焦虑', '不安', '孤独', '崩溃',
    '生气', '愤怒', '害怕', '担心', '想', '爱', '喜欢',
  ];
  const emotionScore = emotionalKeywords.some((kw) => text.includes(kw)) ? 0.5 : 0;
  return Math.min(1, lengthScore + emotionScore);
}

// ─── Phase 1: LIGHT ───

/**
 * Run Phase 1 — LIGHT: scan bookmarks, score by importance, select top 30%.
 *
 * Scoring formula: importance = freq * 0.3 + recency * 0.4 + emotionalWeight * 0.3
 *
 * @returns Prioritized bookmarks sorted by score descending.
 */
export function runPhase1_Light(): PrioritizedBookmark[] {
  const bookmarksContent = readBookmarks();
  if (!bookmarksContent || bookmarksContent.trim().length === 0) return [];

  const scored = prioritizeBookmarks(bookmarksContent);

  // Select top 30%
  const top30Count = Math.max(1, Math.ceil(scored.length * 0.3));
  const selected = scored.slice(0, top30Count);

  logger.info(
    `[consolidation] Phase 1: ${scored.length} bookmarks scored, top ${top30Count} selected (${(top30Count / scored.length * 100).toFixed(0)}%)`,
  );

  if (selected.length > 0) {
    logger.info(
      `[consolidation] Top score: ${selected[0].score.toFixed(3)}, Min score: ${selected[selected.length - 1].score.toFixed(3)}`,
    );
  }

  return selected.map((s) => ({
    ...s.entry,
    score: s.score,
  }));
}

// ─── Phase 2: DEEP ───

/**
 * Run Phase 2 — DEEP: process prioritized bookmarks, decide targets,
 * extract entities, run ACE reflector, write changes.
 *
 * @param bookmarks  Prioritized bookmarks from Phase 1.
 * @returns          Array of ChangeLog entries.
 */
export async function runPhase2_Deep(bookmarks: PrioritizedBookmark[]): Promise<ChangeLog[]> {
  if (bookmarks.length === 0) {
    logger.info('[consolidation] Phase 2: no bookmarks to process');
    return [];
  }

  logger.info(`[consolidation] Phase 2: processing ${bookmarks.length} bookmarks`);
  const changes: ChangeLog[] = [];

  // 1. Extract structured memory from all selected bookmarks
  const bookmarksText = bookmarks
    .map((b) => `- <time=${b.time}> ${b.what}. ${b.evidence}`)
    .join('\n');

  const existingMemory = readStructuredMemoryFromDisk() ?? createEmptyMemory();
  const newMemory = await extractStructuredMemoryLLM(bookmarksText, existingMemory);

  // 2. Run ACE reflector if feature is enabled
  let aceQualityScore: number | null = null;
  if (getConfig().features.aceReflector) {
    try {
      const curated = runReflectionCycle(newMemory);
      writeStructuredMemoryToDisk(curated);
      aceQualityScore = Math.round(
        reflectOnMemory(curated).qualityScore * 100,
      ) / 100;
      logger.info(`[consolidation] ACE reflector quality score: ${aceQualityScore}`);
    } catch (err) {
      logger.warn('[consolidation] ACE reflector failed, writing raw structured memory');
      writeStructuredMemoryToDisk(newMemory);
    }
  } else {
    writeStructuredMemoryToDisk(newMemory);
  }

  // 3. For each bookmark, decide target and log the change
  for (const bm of bookmarks) {
    const target = decideTargetFile(bm);
    if (target === 'none') continue;

    const depth = computeEntryDepth(bm);
    const targetPath = getTargetFilePath(target);

    // Read existing content to decide if append is needed
    const existingContent = readFileSyncSafe(targetPath);
    const entityCount = estimateEntityCount(bm);
    const isNewContent = !existingContent.includes(bm.what.slice(0, 30));

    if (isNewContent && depth >= 0.3) {
      // Append a structured note derived from this bookmark
      const appendLine = `\n- [${bm.time.slice(0, 10)}] ${bm.what.slice(0, 80)} (${bm.evidence.slice(0, 120)})`;
      appendFileSyncSafe(targetPath, appendLine);

      changes.push({
        target: getTargetRelPath(target),
        action: 'append',
        summary: `Added note from: ${bm.what.slice(0, 60)}`,
        entitiesAdded: entityCount,
        timestamp: new Date().toISOString(),
      });
    } else {
      changes.push({
        target: getTargetRelPath(target),
        action: 'none',
        summary: `Skipped (already recorded or insufficient depth): ${bm.what.slice(0, 60)}`,
        entitiesAdded: 0,
        timestamp: new Date().toISOString(),
      });
    }
  }

  logger.info(`[consolidation] Phase 2 complete: ${changes.length} change entries`);

  return changes;
}

/**
 * Get the absolute path for a target file name.
 */
function getTargetFilePath(target: string): string {
  switch (target) {
    case 'user-profile': return join(selfRefDir(), 'user-profile.md');
    case 'relationship': return join(selfRefDir(), 'relationship.md');
    case 'soul': return join(selfRefDir(), 'soul.md');
    case 'notes': {
      const date = new Date().toISOString().slice(0, 10);
      return join(memoryBankDir(), 'notes', `consolidated-${date}.md`);
    }
    default: return '';
  }
}

/**
 * Get a relative path for logging purposes.
 */
function getTargetRelPath(target: string): string {
  switch (target) {
    case 'user-profile': return 'cola-self-reference/user-profile.md';
    case 'relationship': return 'cola-self-reference/relationship.md';
    case 'soul': return 'cola-self-reference/soul.md';
    case 'notes': {
      const date = new Date().toISOString().slice(0, 10);
      return `notes/consolidated-${date}.md`;
    }
    default: return target;
  }
}

/**
 * Roughly estimate how many entities a bookmark might produce.
 */
function estimateEntityCount(entry: { what: string; evidence: string }): number {
  const text = `${entry.what} ${entry.evidence}`;
  let count = 0;
  if (text.includes('喜欢') || text.includes('讨厌') || text.includes('爱吃')) count++;
  if (text.includes('工作') || text.includes('公司') || text.includes('职业')) count++;
  if (text.includes('累') || text.includes('疲惫') || text.includes('开心') || text.includes('难过')) count++;
  if (text.length > 50) count++;
  return Math.max(1, count);
}

// ─── Phase 3: REM ───

/**
 * Run Phase 3 — REM: scan ALL bookmarks for cross-session patterns,
 * generate procedural memory rules, append to procedural-memory.md.
 *
 * Phase 3 processes ALL bookmarks (not just the top 30%) to find
 * recurring topics, behavioral patterns, and emotional cycles.
 *
 * @returns PatternReport detailing what was found and generated.
 */
export function runPhase3_REM(): PatternReport {
  const bookmarksContent = readBookmarks();
  const allEntries = parseBookmarks(bookmarksContent);
  const totalBookmarks = allEntries.length;

  logger.info(`[consolidation] Phase 3: scanning ${totalBookmarks} bookmarks for patterns`);

  // 1. Detect recurring topics across sessions
  const topicMap = new Map<string, number>();
  for (const entry of allEntries) {
    const topics = extractTopics(entry);
    for (const topic of topics) {
      topicMap.set(topic, (topicMap.get(topic) ?? 0) + 1);
    }
  }

  // Sort topics by frequency, filter for cross-session (>= 2 occurrences)
  const crossSessionTopics = [...topicMap.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([topic]) => topic);

  // 2. Detect recurring emotional patterns
  const emotionCounts = new Map<string, number>();
  for (const entry of allEntries) {
    const emotions = extractEmotions(entry);
    for (const em of emotions) {
      emotionCounts.set(em, (emotionCounts.get(em) ?? 0) + 1);
    }
  }

  const recurringEmotions = [...emotionCounts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([emotion]) => emotion);

  // 3. Generate behavioral insights from patterns
  const behavioralInsights: string[] = [];

  // Check for emotional need pattern
  const fatigueCount = allEntries.filter(
    (e) => e.what.includes('累') || e.what.includes('疲惫') || e.evidence.includes('累'),
  ).length;
  if (fatigueCount >= 2) {
    behavioralInsights.push(
      `用户近期提及疲惫/疲劳 ${fatigueCount} 次，可能存在持续压力源`,
    );
  }

  // Check for time-based patterns
  const nightEntries = allEntries.filter((e) => {
    const h = new Date(e.time).getHours();
    return h >= 22 || h <= 5;
  }).length;
  if (nightEntries >= 3) {
    behavioralInsights.push(
      `用户有${nightEntries}条深夜对话记录，倾向夜间深度交流`,
    );
  }

  // Check for ghost/silence pattern
  const ghostCount = allEntries.filter((e) => e.what.includes('[ghost]')).length;
  if (ghostCount >= 3) {
    behavioralInsights.push(
      `出现 ${ghostCount} 次 ghost 静默，注意用户可能在非活跃时段发消息`,
    );
  }

  // Check for crisis recurrence
  const crisisCount = allEntries.filter((e) => e.what.includes('[crisis]')).length;
  if (crisisCount >= 3) {
    behavioralInsights.push(
      `危机触发 ${crisisCount} 次，需关注用户心理状态变化趋势`,
    );
  }

  // 4. Generate procedural rules from ALL bookmarks
  const feedbackState = safeGetFeedbackState();
  const newRules = extractProceduralRules(bookmarksContent, feedbackState);

  // Merge with existing procedural memory
  const existingMemory = readProceduralMemory();
  const merged = mergeRules(existingMemory, newRules);
  const decayed = decayRules(merged);
  writeProceduralMemory(decayed);

  // Count what was actually added (new vs existing)
  const existingPatterns = new Set(existingMemory.rules.map((r) => r.pattern));
  const rulesAdded = newRules.filter((r) => !existingPatterns.has(r.pattern)).length;

  logger.info(
    `[consolidation] Phase 3: ${newRules.length} rules extracted, ${rulesAdded} new, ${decayed.rules.length} total after decay`,
  );

  // 5. Log cross-session topics
  if (crossSessionTopics.length > 0) {
    logger.info(`[consolidation] Cross-session topics: ${crossSessionTopics.join(', ')}`);
  }
  if (recurringEmotions.length > 0) {
    logger.info(`[consolidation] Recurring emotions: ${recurringEmotions.join(', ')}`);
  }

  return {
    totalBookmarks,
    patternsFound: crossSessionTopics.length + recurringEmotions.length,
    rulesGenerated: newRules.length,
    rulesAdded,
    crossSessionTopics,
    recurringEmotions,
    behavioralInsights,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Extract topic keywords from a bookmark entry.
 */
function extractTopics(entry: { what: string; evidence: string }): string[] {
  const text = `${entry.what} ${entry.evidence}`;
  const topics: string[] = [];

  const topicKeywords: Record<string, string[]> = {
    '工作': ['工作', '上班', '公司', '同事', '项目', '加班', '辞职', '面试', '升职', '工资', '客户', '会议', '报告', 'Deadline', 'KPI', '绩效', '出差'],
    '家庭': ['家', '父母', '爸爸', '妈妈', '爷爷', '奶奶', '哥哥', '姐姐', '弟弟', '妹妹', '结婚', '婚礼', '孩子', '宝宝', '亲戚'],
    '感情': ['感情', '喜欢', '爱', '想念', '想你', '恋爱', '分手', '暧昧', '关系', '男朋友', '女朋友', '对象', '约会', '吃醋', '表白', '陪伴'],
    '健康': ['健康', '生病', '医院', '医生', '药', '运动', '健身', '失眠', '熬夜', '头痛', '发烧', '感冒', '体检', '焦虑', '压力', '疲惫', '累', '休息', '饮食', '减肥'],
    '学习': ['学习', '考试', '读书', '看书', '论文', '研究', '课程', '上课', '作业', '毕业', '考研', '留学', '英语'],
    '兴趣': ['游戏', '电影', '音乐', '旅行', '摄影', '画画', '烹饪', '美食', '咖啡', '酒', '动漫', '小说', '写作', '手工', '宠物', '猫', '狗'],
    '日常': ['今天', '昨天', '明天', '吃饭', '外卖', '逛街', '购物', '快递', '搬家', '打扫', '出门', '回家', '地铁', '打车'],
  };

  for (const [topic, keywords] of Object.entries(topicKeywords)) {
    if (keywords.some((kw) => text.includes(kw))) {
      topics.push(topic);
    }
  }

  return topics;
}

/**
 * Extract emotional keywords from a bookmark entry.
 */
function extractEmotions(entry: { what: string; evidence: string }): string[] {
  const text = `${entry.what} ${entry.evidence}`;
  const emotions: string[] = [];

  const emotionMap: Record<string, string[]> = {
    '开心': ['开心', '快乐', '高兴', '幸福', '兴奋', '激动', '愉快'],
    '难过': ['难过', '伤心', '悲伤', '沮丧', '失落', '失望', '心累'],
    '焦虑': ['焦虑', '紧张', '不安', '担心', '害怕', '恐惧'],
    '愤怒': ['生气', '愤怒', '烦躁', '烦', '恼火'],
    '疲惫': ['累', '疲惫', '疲劳', '困', '乏力', '疲倦'],
    '孤独': ['孤独', '寂寞', '孤单', '一个人'],
  };

  for (const [emotion, keywords] of Object.entries(emotionMap)) {
    if (keywords.some((kw) => text.includes(kw))) {
      emotions.push(emotion);
    }
  }

  return emotions;
}

// ─── Orchestrator ───

/**
 * Run the full 3-phase consolidation pipeline.
 *
 * @returns Detailed consolidation report.
 */
export async function runFullConsolidation(): Promise<ConsolidationReport> {
  const startTime = Date.now();
  logger.info('[consolidation] Starting 3-phase consolidation');

  // ─── Phase 1 ───
  const phase1Start = Date.now();
  const prioritized = runPhase1_Light();
  const phase1Duration = Date.now() - phase1Start;

  const selectedCount = prioritized.length;
  const totalBookmarks = parseBookmarks(readBookmarks()).length;
  const phase1Result = {
    totalBookmarks,
    selectedCount,
    topScore: prioritized[0]?.score ?? 0,
    minScore: prioritized[prioritized.length - 1]?.score ?? 0,
  };

  logger.info(
    `[consolidation] Phase 1 done: ${selectedCount}/${totalBookmarks} in ${phase1Duration}ms`,
  );

  // ─── Phase 2 ───
  const phase2Start = Date.now();
  const changes = await runPhase2_Deep(prioritized);
  const phase2Duration = Date.now() - phase2Start;

  let aceQualityScore: number | null = null;
  if (getConfig().features.aceReflector) {
    try {
      const memory = readStructuredMemoryFromDisk();
      if (memory) {
        const reflection = reflectOnMemory(memory);
        aceQualityScore = reflection.qualityScore;
      }
    } catch {
      // Best-effort
    }
  }

  logger.info(`[consolidation] Phase 2 done: ${changes.length} changes in ${phase2Duration}ms`);

  // ─── Phase 3 ───
  const phase3Start = Date.now();
  const patternReport = runPhase3_REM();
  const phase3Duration = Date.now() - phase3Start;

  logger.info(`[consolidation] Phase 3 done: ${patternReport.rulesGenerated} rules in ${phase3Duration}ms`);

  const totalDuration = Date.now() - startTime;
  logger.info(`[consolidation] 3-phase complete in ${totalDuration}ms`);

  return {
    phase1: phase1Result,
    phase2: {
      changes,
      aceQualityScore,
    },
    phase3: patternReport,
    performedAt: new Date().toISOString(),
  };
}
