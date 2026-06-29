import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import {
  createEmptyMemory,
  deriveStructuredStateView,
  mergeMemories,
  readStructuredMemoryFromDisk,
  writeStructuredMemoryToDisk,
  type MemoryEntity,
  type StructuredMemory,
  type TopicSegment,
} from '../memory/structured-memory.js';
import {
  buildTemporalTurnContext,
  readTemporalState,
  type TemporalStateEntry,
} from '../memory/temporal-state.js';
import {
  deleteEntriesMatchingText,
  indexEntryWithProvider,
  updateEntriesMatchingText,
} from '../memory/vector.js';
import { getEmbeddingProvider } from '../memory/embedding.js';
import {
  autoGenerateLoreEntries,
  removeLoreEntriesByContent,
  updateLoreEntriesByContent,
} from '../memory/lorebook.js';
import {
  colaDir,
  companionRegressionStorePath,
  debugTraceCandidatesDir,
  debugTraceCandidateRunDir,
  memoryUsefulnessTracePath,
  replyQualityInterventionsPath,
} from '../memory/paths.js';
import type { MemoryUsefulnessTrace } from '../memory/usefulness.js';
import {
  buildDebugTraceCandidate,
  writeDebugTraceCandidateReports,
  type DebugTraceCandidateReport,
} from '../quality/debug-trace-candidate.js';
import {
  loadCandidateFile,
  loadRegressionStore,
  patchRegressionCandidate,
  promoteRegressionCandidates,
  writeRegressionStore,
  type ReviewedRegressionCandidate,
} from '../quality/regression-store.js';
import {
  readRecentProactiveDecisionTrace,
  type ProactiveDecisionTrace,
} from '../scheduler/proactive-trace.js';

export type MemoryItemType = MemoryEntity['type'];

export interface MemoryReviewItem {
  id: string;
  type: MemoryItemType;
  content: string;
  confidence: number;
  firstSeen: string;
  lastSeen: string;
  occurrences: number;
  source: string;
  enabled: boolean;
  provenance?: MemoryEntity['provenance'];
  status: 'confirmed' | 'inferred' | 'ignored' | 'wrong';
  durable: boolean;
  pinned: boolean;
  pinnedAt?: string;
  topic?: string;
  usage?: MemoryUsageSummary;
}

export interface MemoryUsageSummary {
  retrievedCount: number;
  injectedCount: number;
  mentionedCount: number;
  lastRetrievedAt?: string;
  lastInjectedAt?: string;
  lastMentionedAt?: string;
  lastSessionId?: string;
  latestReplyAt?: string;
  latestReplySessionId?: string;
  retrievedInLatestReply?: boolean;
  injectedInLatestReply?: boolean;
  mentionedInLatestReply?: boolean;
  usedInLatestReply?: boolean;
}

export interface TemporalStateReviewItem {
  id: string;
  kind: TemporalStateEntry['kind'];
  label: string;
  status: 'current' | 'recently_resolved' | 'recently_expired';
  observedAt: string;
  expiresAt: string;
  evidence: string;
  confidence: number;
  sourceSessionId?: string;
  resolvedAt?: string;
  resolutionReason?: TemporalStateEntry['resolutionReason'];
  resolutionEvidence?: string;
  resolutionEventId?: string;
}

export interface TemporalStateReview {
  sessionId: string;
  now: string;
  current: TemporalStateReviewItem[];
  recentlyResolved: TemporalStateReviewItem[];
  recentlyExpired: TemporalStateReviewItem[];
}

export interface StructuredStateEntitySummary {
  id: string;
  type: MemoryItemType;
  content: string;
  confidence: number;
  firstSeen: string;
  lastSeen: string;
  source: string;
  enabled: boolean;
  provenance?: MemoryEntity['provenance'];
  status: MemoryReviewItem['status'];
  pinned: boolean;
  pinnedAt?: string;
  invalidatedAt?: string;
  supersededBy?: string;
}

export interface StructuredStateArcSummary {
  topic: string;
  summary: string;
  dateRange: TopicSegment['dateRange'];
  entityCount: number;
  entities: StructuredStateEntitySummary[];
}

export interface StructuredStateReview {
  now: string;
  counts: {
    pinned: number;
    currentFacts: number;
    multiDayArcs: number;
    recentEvents: number;
    recentEmotions: number;
    superseded: number;
  };
  pinned: StructuredStateEntitySummary[];
  currentFacts: StructuredStateEntitySummary[];
  multiDayArcs: StructuredStateArcSummary[];
  recentEvents: StructuredStateEntitySummary[];
  recentEmotions: StructuredStateEntitySummary[];
  superseded: StructuredStateEntitySummary[];
}

export interface MemoryPatch {
  type?: MemoryItemType;
  content?: string;
  confidence?: number;
  enabled?: boolean;
  reviewStatus?: MemoryReviewItem['status'];
  pinned?: boolean;
}

export interface RecentReplyDebugTrace {
  sessionId: string;
  memory?: {
    timestamp: string;
    userText: string;
    replyText: string;
    retrievedCount: number;
    injectedCount: number;
    mentionedCount: number;
    used: Array<{
      id: string;
      kind: string;
      source: string;
      content: string;
      provenance?: MemoryEntity['provenance'];
    }>;
    unused: Array<{
      id: string;
      kind: string;
      source: string;
      content: string;
      provenance?: MemoryEntity['provenance'];
    }>;
  };
  interventions: Array<{
    id?: string;
    timestamp?: string;
    type?: string;
    source?: string;
    severity?: string;
    reason?: string;
    before?: string;
    after?: string;
    routeTags?: string[];
    durationMs?: number;
  }>;
}

export interface ProactiveDecisionReview {
  sessionId: string;
  counts: {
    sent: number;
    skipped: number;
    rejected: number;
  };
  decisions: ProactiveDecisionTrace[];
}

export interface DebugTraceCandidateExportInput {
  sessionId?: string;
  note?: string;
  taxonomy?: string;
  confidence?: number;
  forbiddenText?: string[];
  expectedText?: string[];
}

export interface DebugTraceCandidateExport {
  resultDir: string;
  candidatesPath: string;
  reportPath: string;
  report: DebugTraceCandidateReport;
}

export interface RegressionCandidatePromotionInput {
  candidatesPath: string;
  ids?: string[];
  taxonomy?: string;
  minConfidence?: number;
  maxCandidates?: number;
  reviewer?: string;
  note?: string;
}

export interface RegressionCandidatePromotion {
  storePath: string;
  promoted: ReviewedRegressionCandidate[];
  total: number;
}

export interface RegressionCandidatePatchInput {
  enabled?: boolean;
  reviewer?: string;
  note?: string;
}

export interface ReviewedRegressionCandidateSummary {
  id: string;
  taxonomy: string;
  source: ReviewedRegressionCandidate['source'];
  sessionId: string;
  observedAt: string;
  confidence: number;
  enabled: boolean;
  routeTags: string[];
  reason: string;
  reviewer: string;
  reviewedAt: string;
  note?: string;
  governance?: ReviewedRegressionCandidate['governance'];
  seedTurns: number;
  turnCount: number;
  checkCount: number;
  excerpt: string;
}

export interface RegressionCandidateLibrary {
  storePath: string;
  updatedAt: string;
  total: number;
  enabledTotal: number;
  candidates: ReviewedRegressionCandidateSummary[];
}

function entitySignature(entity: MemoryEntity): string {
  return [
    entity.type,
    entity.content,
    entity.firstSeen,
    entity.lastSeen,
    entity.source,
  ].join('\u0000');
}

function memoryId(entity: MemoryEntity): string {
  return createHash('sha1').update(entitySignature(entity)).digest('hex').slice(0, 16);
}

function entityKey(entity: MemoryEntity): string {
  return [
    entity.type,
    entity.content,
    entity.firstSeen,
    entity.source,
  ].join('\u0000');
}

function loadMemory(): StructuredMemory {
  return readStructuredMemoryFromDisk() ?? createEmptyMemory();
}

function findTopic(memory: StructuredMemory, entity: MemoryEntity): string | undefined {
  const key = entityKey(entity);
  return memory.topics.find((topic) =>
    topic.entities.some((candidate) => entityKey(candidate) === key),
  )?.topic;
}

function toReviewItem(
  memory: StructuredMemory,
  entity: MemoryEntity,
  usageByContent: Map<string, MemoryUsageSummary>,
): MemoryReviewItem {
  const durable = memory.durableFacts.some((candidate) => entityKey(candidate) === entityKey(entity));
  const status = entity.reviewStatus
    ?? (entity.confidence >= 0.8 || entity.occurrences >= 2 ? 'confirmed' : 'inferred');
  return {
    id: memoryId(entity),
    type: entity.type,
    content: entity.content,
    confidence: entity.confidence,
    firstSeen: entity.firstSeen,
    lastSeen: entity.lastSeen,
    occurrences: entity.occurrences,
    source: entity.source,
    enabled: entity.enabled !== false && status !== 'ignored' && status !== 'wrong',
    provenance: entity.provenance,
    status,
    durable,
    pinned: entity.pinned === true,
    pinnedAt: entity.pinnedAt,
    topic: findTopic(memory, entity),
    usage: usageByContent.get(normalizeMemoryContent(entity.content)),
  };
}

function recomputeDerived(memory: StructuredMemory): StructuredMemory {
  return mergeMemories(memory, createEmptyMemory());
}

export function listMemoryReviewItems(sessionId?: string): MemoryReviewItem[] {
  const memory = loadMemory();
  const usageByContent = readMemoryUsageSummaries(sessionId);
  return memory.entities
    .map((entity) => toReviewItem(memory, entity, usageByContent))
    .sort((a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime());
}

export function listTemporalStateReview(sessionId = 'default', now = new Date()): TemporalStateReview {
  const state = readTemporalState(sessionId);
  const context = buildTemporalTurnContext(sessionId, state, now);
  return {
    sessionId,
    now: context.now,
    current: context.active.map((entry) => toTemporalReviewItem(entry, 'current')),
    recentlyResolved: context.resolvedRecent.map((entry) => toTemporalReviewItem(entry, 'recently_resolved')),
    recentlyExpired: context.expiredRecent.map((entry) => toTemporalReviewItem(entry, 'recently_expired')),
  };
}

export function getStructuredStateReview(now = new Date()): StructuredStateReview {
  const memory = loadMemory();
  const view = deriveStructuredStateView(memory, now);
  const multiDayArcs = view.multiDayArcs.map(toStructuredStateArcSummary);
  const superseded = memory.entities
    .filter((entity) => entity.invalidatedAt)
    .filter((entity) => entity.enabled !== false)
    .filter((entity) => entity.reviewStatus !== 'ignored' && entity.reviewStatus !== 'wrong')
    .sort((a, b) =>
      new Date(b.invalidatedAt ?? b.lastSeen).getTime() - new Date(a.invalidatedAt ?? a.lastSeen).getTime(),
    )
    .slice(0, 10);
  return {
    now: now.toISOString(),
    counts: {
      pinned: view.pinned.length,
      currentFacts: view.currentFacts.length,
      multiDayArcs: view.multiDayArcs.length,
      recentEvents: view.recentEvents.length,
      recentEmotions: view.recentEmotions.length,
      superseded: superseded.length,
    },
    pinned: view.pinned.map(toStructuredStateEntitySummary),
    currentFacts: view.currentFacts.map(toStructuredStateEntitySummary),
    multiDayArcs,
    recentEvents: view.recentEvents.map(toStructuredStateEntitySummary),
    recentEmotions: view.recentEmotions.map(toStructuredStateEntitySummary),
    superseded: superseded.map(toStructuredStateEntitySummary),
  };
}

export function getMemoryDebugTrace(sessionId = 'default'): RecentReplyDebugTrace {
  return {
    sessionId,
    memory: readLatestMemoryUsefulnessTrace(sessionId),
    interventions: readRecentReplyInterventions(sessionId),
  };
}

export function getProactiveDecisionReview(sessionId = 'default', limit = 10): ProactiveDecisionReview {
  const target = sessionId.trim() || 'default';
  const decisions = readRecentProactiveDecisionTrace(300)
    .filter((row) => row.sessionId === target || row.userId === target || (target === 'default' && row.sessionId === 'global-proactive'))
    .slice(-Math.max(0, limit))
    .reverse();
  return {
    sessionId: target,
    counts: {
      sent: decisions.filter((row) => row.outcome === 'sent').length,
      skipped: decisions.filter((row) => row.outcome === 'skipped').length,
      rejected: decisions.filter((row) => row.outcome === 'rejected').length,
    },
    decisions,
  };
}

function toStructuredStateEntitySummary(entity: MemoryEntity): StructuredStateEntitySummary {
  const status = entity.reviewStatus
    ?? (entity.confidence >= 0.8 || entity.occurrences >= 2 ? 'confirmed' : 'inferred');
  return {
    id: memoryId(entity),
    type: entity.type,
    content: entity.content,
    confidence: entity.confidence,
    firstSeen: entity.firstSeen,
    lastSeen: entity.lastSeen,
    source: entity.source,
    enabled: entity.enabled !== false && status !== 'ignored' && status !== 'wrong',
    provenance: entity.provenance,
    status,
    pinned: entity.pinned === true,
    pinnedAt: entity.pinnedAt,
    invalidatedAt: entity.invalidatedAt,
    supersededBy: entity.supersededBy,
  };
}

function toStructuredStateArcSummary(topic: TopicSegment): StructuredStateArcSummary {
  return {
    topic: topic.topic,
    summary: topic.summary,
    dateRange: topic.dateRange,
    entityCount: topic.entities.length,
    entities: topic.entities.slice(0, 6).map(toStructuredStateEntitySummary),
  };
}

export function exportDebugTraceRegressionCandidate(input: DebugTraceCandidateExportInput): DebugTraceCandidateExport {
  const dataDir = colaDir();
  const candidate = buildDebugTraceCandidate({
    dataDir,
    sessionId: input.sessionId,
    note: input.note,
    taxonomy: input.taxonomy,
    confidence: input.confidence,
    forbiddenText: input.forbiddenText,
    expectedText: input.expectedText,
  });
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${candidate.id}`;
  const resultDir = debugTraceCandidateRunDir(runId);
  const report = writeDebugTraceCandidateReports(resultDir, candidate, { dataDir });
  return {
    resultDir,
    candidatesPath: report.candidatesPath,
    reportPath: report.reportPath,
    report,
  };
}

export function promoteDebugTraceRegressionCandidate(input: RegressionCandidatePromotionInput): RegressionCandidatePromotion {
  const candidatesPath = assertDebugCandidatePath(input.candidatesPath);
  const storePath = companionRegressionStorePath();
  const candidates = loadCandidateFile(candidatesPath);
  const existing = loadRegressionStore(storePath);
  const { store, promoted } = promoteRegressionCandidates(existing, candidates, {
    ids: input.ids ? new Set(input.ids) : undefined,
    taxonomies: input.taxonomy ? new Set([input.taxonomy]) : undefined,
    minConfidence: input.minConfidence ?? 0,
    maxCandidates: input.maxCandidates,
    reviewer: input.reviewer?.trim() || 'local-owner',
    note: input.note,
  });
  writeRegressionStore(storePath, store);
  return {
    storePath,
    promoted,
    total: store.candidates.length,
  };
}

export function listRegressionCandidateLibrary(limit = 50): RegressionCandidateLibrary {
  const storePath = companionRegressionStorePath();
  const store = loadRegressionStore(storePath);
  return {
    storePath,
    updatedAt: store.updatedAt,
    total: store.candidates.length,
    enabledTotal: store.candidates.filter((candidate) => candidate.enabled !== false).length,
    candidates: store.candidates.slice(0, Math.max(0, limit)).map(toRegressionCandidateSummary),
  };
}

export function updateRegressionCandidateLibraryItem(id: string, patch: RegressionCandidatePatchInput): ReviewedRegressionCandidateSummary | null {
  const storePath = companionRegressionStorePath();
  const existing = loadRegressionStore(storePath);
  const { store, candidate } = patchRegressionCandidate(existing, id, {
    enabled: patch.enabled,
    reviewer: patch.reviewer,
    note: patch.note,
  });
  if (!candidate) return null;
  writeRegressionStore(storePath, store);
  return toRegressionCandidateSummary(candidate);
}

function assertDebugCandidatePath(path: string): string {
  const base = resolve(debugTraceCandidatesDir());
  const target = resolve(path);
  const rel = relative(base, target);
  if (rel.startsWith('..') || rel === '' || rel.startsWith('/') || rel.includes('\0')) {
    throw new Error('Candidate file must be under debug-trace-candidates');
  }
  if (!target.endsWith('candidates.json')) {
    throw new Error('Candidate file must be a candidates.json export');
  }
  return target;
}

function toRegressionCandidateSummary(candidate: ReviewedRegressionCandidate): ReviewedRegressionCandidateSummary {
  return {
    id: candidate.id,
    taxonomy: candidate.taxonomy,
    source: candidate.source,
    sessionId: candidate.sessionId,
    observedAt: candidate.observedAt,
    confidence: candidate.confidence,
    enabled: candidate.enabled !== false,
    routeTags: candidate.routeTags ?? [],
    reason: candidate.reason,
    reviewer: candidate.review.reviewer,
    reviewedAt: candidate.review.reviewedAt,
    note: candidate.review.note,
    governance: candidate.governance,
    seedTurns: candidate.seed.length,
    turnCount: candidate.turns.length,
    checkCount: candidate.checks.length,
    excerpt: summarizeExcerpt(candidate.provenance.excerpt),
  };
}

function summarizeExcerpt(excerpt: string): string {
  const cleaned = excerpt.replace(/\s+/g, ' ').trim();
  return cleaned.length > 240 ? `${cleaned.slice(0, 237)}...` : cleaned;
}

function toTemporalReviewItem(
  entry: TemporalStateEntry,
  status: TemporalStateReviewItem['status'],
): TemporalStateReviewItem {
  return {
    id: entry.id,
    kind: entry.kind,
    label: entry.label,
    status,
    observedAt: entry.observedAt,
    expiresAt: entry.expiresAt,
    evidence: entry.evidence,
    confidence: entry.confidence,
    sourceSessionId: entry.sourceSessionId,
    resolvedAt: entry.resolvedAt,
    resolutionReason: entry.resolutionReason,
    resolutionEvidence: entry.resolutionEvidence,
    resolutionEventId: entry.resolutionEventId,
  };
}

function updateMatchingEntities(
  entities: MemoryEntity[],
  targetId: string,
  updater: (entity: MemoryEntity) => MemoryEntity | null,
): { entities: MemoryEntity[]; changed: boolean } {
  let changed = false;
  const next = entities.flatMap((entity) => {
    if (memoryId(entity) !== targetId) return [entity];
    changed = true;
    const updated = updater(entity);
    return updated ? [updated] : [];
  });
  return { entities: next, changed };
}

async function maybeIndexConfirmed(entity: MemoryEntity): Promise<void> {
  if (entity.reviewStatus !== 'confirmed') return;
  if (entity.enabled === false) return;
  await indexEntryWithProvider({
    id: `structured:${memoryId(entity)}`,
    text: entity.content,
    source: 'manual',
    timestamp: entity.reviewedAt ?? entity.lastSeen,
  }, getEmbeddingProvider());
}

export async function updateMemoryReviewItem(id: string, patch: MemoryPatch): Promise<MemoryReviewItem | null> {
  const memory = loadMemory();
  const now = new Date().toISOString();

  const target = memory.entities.find((entity) => memoryId(entity) === id);
  if (!target) return null;

  const oldContent = target.content;
  const reviewStatus = patch.pinned === true && patch.reviewStatus === undefined
    ? 'confirmed'
    : patch.reviewStatus ?? target.reviewStatus;
  const pinned = reviewStatus === 'ignored' || reviewStatus === 'wrong'
    ? false
    : patch.pinned ?? target.pinned ?? false;
  const updatedEntity: MemoryEntity = {
    ...target,
    type: patch.type ?? target.type,
    content: patch.content?.trim() ?? target.content,
    confidence: reviewStatus === 'confirmed' || pinned ? 1 : reviewStatus === 'ignored' || reviewStatus === 'wrong' ? 0 : patch.confidence ?? target.confidence,
    occurrences: reviewStatus === 'confirmed' || pinned ? Math.max(target.occurrences, 3) : target.occurrences,
    enabled: reviewStatus === 'ignored' || reviewStatus === 'wrong' ? false : patch.enabled ?? (patch.pinned === true ? true : target.enabled ?? true),
    reviewStatus,
    reviewedAt: patch.reviewStatus || patch.pinned === true ? now : target.reviewedAt,
    pinned,
    pinnedAt: pinned ? target.pinnedAt ?? now : undefined,
    lastSeen: now,
  };

  let nextMemory: StructuredMemory = {
    ...memory,
    entities: memory.entities.map((entity) => memoryId(entity) === id ? updatedEntity : entity),
    updatedAt: now,
  };
  nextMemory = recomputeDerived(nextMemory);
  writeStructuredMemoryToDisk(nextMemory);

  if (updatedEntity.content !== oldContent) {
    await updateEntriesMatchingText(oldContent, updatedEntity.content);
    updateLoreEntriesByContent(oldContent, updatedEntity.content);
  }

  if (updatedEntity.reviewStatus === 'ignored' || updatedEntity.reviewStatus === 'wrong' || updatedEntity.enabled === false) {
    deleteEntriesMatchingText(updatedEntity.content);
    removeLoreEntriesByContent(updatedEntity.content);
  } else if (updatedEntity.reviewStatus === 'confirmed') {
    await maybeIndexConfirmed(updatedEntity);
    autoGenerateLoreEntries();
  }

  return toReviewItem(nextMemory, updatedEntity, readMemoryUsageSummaries());
}

export function deleteMemoryReviewItem(id: string): boolean {
  const memory = loadMemory();
  const target = memory.entities.find((entity) => memoryId(entity) === id);
  const main = updateMatchingEntities(memory.entities, id, () => null);
  if (!main.changed) return false;

  const durable = updateMatchingEntities(memory.durableFacts, id, () => null);
  const topics = memory.topics
    .map((topic) => {
      const topicUpdate = updateMatchingEntities(topic.entities, id, () => null);
      return topicUpdate.changed
        ? { ...topic, entities: topicUpdate.entities }
        : topic;
    })
    .filter((topic) => topic.entities.length > 0);

  const nextMemory = recomputeDerived({
    ...memory,
    entities: main.entities,
    durableFacts: durable.entities,
    topics,
    updatedAt: new Date().toISOString(),
  });
  writeStructuredMemoryToDisk(nextMemory);
  if (target) {
    deleteEntriesMatchingText(target.content);
    removeLoreEntriesByContent(target.content);
  }
  return true;
}

function readMemoryUsageSummaries(sessionId?: string): Map<string, MemoryUsageSummary> {
  const path = memoryUsefulnessTracePath();
  const summaries = new Map<string, MemoryUsageSummary>();
  if (!existsSync(path)) return summaries;

  const lines = readRecentJsonlLines(path, 500);
  let latestSessionTrace: MemoryUsefulnessTrace | undefined;

  for (const line of lines) {
    let trace: MemoryUsefulnessTrace;
    try {
      trace = JSON.parse(line) as MemoryUsefulnessTrace;
    } catch {
      continue;
    }
    if (!trace.timestamp || !Array.isArray(trace.candidates)) continue;
    for (const candidate of trace.candidates) {
      const key = normalizeMemoryContent(candidate.content);
      if (!key) continue;
      const current = summaries.get(key) ?? {
        retrievedCount: 0,
        injectedCount: 0,
        mentionedCount: 0,
      };
      current.retrievedCount += 1;
      current.lastRetrievedAt = newerIso(current.lastRetrievedAt, trace.timestamp);
      current.lastSessionId = trace.sessionId || current.lastSessionId;
      if (candidate.injected) {
        current.injectedCount += 1;
        current.lastInjectedAt = newerIso(current.lastInjectedAt, trace.timestamp);
      }
      if (candidate.mentionedInReply) {
        current.mentionedCount += 1;
        current.lastMentionedAt = newerIso(current.lastMentionedAt, trace.timestamp);
      }
      summaries.set(key, current);
    }
    if (sessionId && trace.sessionId === sessionId) {
      latestSessionTrace = trace;
    }
  }

  if (latestSessionTrace) {
    mergeLatestReplyUsage(summaries, latestSessionTrace);
  }
  return summaries;
}

function mergeLatestReplyUsage(
  summaries: Map<string, MemoryUsageSummary>,
  trace: MemoryUsefulnessTrace,
): void {
  for (const candidate of trace.candidates ?? []) {
    const key = normalizeMemoryContent(candidate.content);
    if (!key) continue;
    const current = summaries.get(key) ?? {
      retrievedCount: 0,
      injectedCount: 0,
      mentionedCount: 0,
    };
    current.latestReplyAt = trace.timestamp;
    current.latestReplySessionId = trace.sessionId;
    current.retrievedInLatestReply = true;
    current.injectedInLatestReply = candidate.injected === true;
    current.mentionedInLatestReply = candidate.mentionedInReply === true;
    current.usedInLatestReply = current.injectedInLatestReply || current.mentionedInLatestReply;
    summaries.set(key, current);
  }
}

function readLatestMemoryUsefulnessTrace(sessionId: string): RecentReplyDebugTrace['memory'] | undefined {
  const path = memoryUsefulnessTracePath();
  if (!existsSync(path)) return undefined;

  const lines = readRecentJsonlLines(path, 500).reverse();
  for (const line of lines) {
    let trace: MemoryUsefulnessTrace;
    try {
      trace = JSON.parse(line) as MemoryUsefulnessTrace;
    } catch {
      continue;
    }
    if (trace.sessionId !== sessionId) continue;
    const candidates = Array.isArray(trace.candidates) ? trace.candidates : [];
    return {
      timestamp: trace.timestamp,
      userText: trace.userText,
      replyText: trace.replyText,
      retrievedCount: trace.retrievedCount,
      injectedCount: trace.injectedCount,
      mentionedCount: trace.mentionedCount,
      used: candidates
        .filter((candidate) => candidate.injected || candidate.mentionedInReply)
        .slice(0, 8)
        .map((candidate) => ({
          id: candidate.id,
          kind: candidate.kind,
          source: candidate.source,
          content: candidate.content,
          provenance: candidate.provenance,
        })),
      unused: candidates
        .filter((candidate) => !candidate.injected && !candidate.mentionedInReply)
        .slice(0, 8)
        .map((candidate) => ({
          id: candidate.id,
          kind: candidate.kind,
          source: candidate.source,
          content: candidate.content,
          provenance: candidate.provenance,
        })),
    };
  }

  return undefined;
}

function readRecentReplyInterventions(sessionId: string): RecentReplyDebugTrace['interventions'] {
  const path = replyQualityInterventionsPath();
  if (!existsSync(path)) return [];

  return readRecentJsonlLines(path, 500)
    .reverse()
    .map((line) => {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((item): item is Record<string, unknown> => !!item && item.sessionId === sessionId)
    .slice(0, 8)
    .map((item) => ({
      id: typeof item.id === 'string' ? item.id : undefined,
      timestamp: typeof item.timestamp === 'string' ? item.timestamp : undefined,
      type: typeof item.type === 'string' ? item.type : undefined,
      source: typeof item.source === 'string' ? item.source : undefined,
      severity: typeof item.severity === 'string' ? item.severity : undefined,
      reason: typeof item.reason === 'string' ? item.reason : undefined,
      before: typeof item.before === 'string' ? item.before : undefined,
      after: typeof item.after === 'string' ? item.after : undefined,
      routeTags: Array.isArray((item.turnRoute as { tags?: unknown } | undefined)?.tags)
        ? ((item.turnRoute as { tags: unknown[] }).tags.filter((tag): tag is string => typeof tag === 'string'))
        : undefined,
      durationMs: typeof item.durationMs === 'number' ? item.durationMs : undefined,
    }));
}

function readRecentJsonlLines(path: string, limit: number): string[] {
  return readFileSync(path, 'utf-8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-limit);
}

function normalizeMemoryContent(content: string): string {
  return content.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '').trim();
}

function newerIso(a: string | undefined, b: string): string {
  if (!a) return b;
  return Date.parse(b) > Date.parse(a) ? b : a;
}
