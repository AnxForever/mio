import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { RegressionCandidate } from './regression-candidate.js';

export interface ReviewedRegressionCandidate extends RegressionCandidate {
  reviewed: true;
  enabled?: boolean;
  review: {
    reviewedAt: string;
    reviewer: string;
    sourceCandidateId: string;
    note?: string;
  };
  governance?: {
    updatedAt: string;
    updatedBy: string;
    note?: string;
  };
}

export interface RegressionStore {
  version: 1;
  updatedAt: string;
  candidates: ReviewedRegressionCandidate[];
}

interface CandidateFile {
  candidates?: RegressionCandidate[];
}

export interface RegressionCandidatePatch {
  enabled?: boolean;
  reviewer?: string;
  note?: string;
  now?: string;
}

export function loadRegressionStore(path: string): RegressionStore {
  if (!existsSync(path)) return { version: 1, updatedAt: new Date(0).toISOString(), candidates: [] };
  const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<RegressionStore>;
  return {
    version: 1,
    updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date(0).toISOString(),
    candidates: Array.isArray(parsed.candidates)
      ? parsed.candidates.filter(isReviewedRegressionCandidate)
      : [],
  };
}

export function loadCandidateFile(path: string): RegressionCandidate[] {
  if (!existsSync(path)) throw new Error(`Candidate file not found: ${path}`);
  const parsed = JSON.parse(readFileSync(path, 'utf-8')) as CandidateFile | RegressionCandidate[];
  const candidates = Array.isArray(parsed) ? parsed : parsed.candidates;
  if (!Array.isArray(candidates)) throw new Error(`Candidate file has no candidates array: ${path}`);
  return candidates.filter(isRegressionCandidate);
}

export function promoteRegressionCandidates(
  existing: RegressionStore,
  candidates: RegressionCandidate[],
  opts: {
    ids?: Set<string>;
    taxonomies?: Set<string>;
    minConfidence?: number;
    maxCandidates?: number;
    reviewer: string;
    note?: string;
    now?: string;
  },
): { store: RegressionStore; promoted: ReviewedRegressionCandidate[] } {
  const minConfidence = opts.minConfidence ?? 0;
  const selected = candidates
    .filter((candidate) => candidate.confidence >= minConfidence)
    .filter((candidate) => !opts.ids || opts.ids.has(candidate.id))
    .filter((candidate) => !opts.taxonomies || opts.taxonomies.has(candidate.taxonomy))
    .slice(0, opts.maxCandidates ?? candidates.length);
  const reviewedAt = opts.now ?? new Date().toISOString();
  const promoted = selected.map((candidate) => markReviewed(candidate, {
    reviewedAt,
    reviewer: opts.reviewer,
    note: opts.note,
  }));
  const byId = new Map<string, ReviewedRegressionCandidate>();
  for (const candidate of existing.candidates) byId.set(candidate.id, candidate);
  for (const candidate of promoted) byId.set(candidate.id, candidate);
  const store: RegressionStore = {
    version: 1,
    updatedAt: reviewedAt,
    candidates: [...byId.values()]
      .sort((a, b) => b.review.reviewedAt.localeCompare(a.review.reviewedAt) || a.id.localeCompare(b.id)),
  };
  return { store, promoted };
}

export function writeRegressionStore(path: string, store: RegressionStore): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(store, null, 2)}\n`, 'utf-8');
}

export function patchRegressionCandidate(
  existing: RegressionStore,
  id: string,
  patch: RegressionCandidatePatch,
): { store: RegressionStore; candidate?: ReviewedRegressionCandidate } {
  const now = patch.now ?? new Date().toISOString();
  let updated: ReviewedRegressionCandidate | undefined;
  const candidates = existing.candidates.map((candidate) => {
    if (candidate.id !== id) return candidate;
    updated = {
      ...candidate,
      ...(typeof patch.enabled === 'boolean' ? { enabled: patch.enabled } : {}),
      governance: {
        updatedAt: now,
        updatedBy: patch.reviewer?.trim() || 'local-owner',
        ...(patch.note?.trim() ? { note: patch.note.trim() } : {}),
      },
    };
    return updated;
  });
  if (!updated) return { store: existing };
  return {
    store: {
      version: 1,
      updatedAt: now,
      candidates,
    },
    candidate: updated,
  };
}

function markReviewed(
  candidate: RegressionCandidate,
  review: { reviewedAt: string; reviewer: string; note?: string },
): ReviewedRegressionCandidate {
  return {
    ...candidate,
    reviewed: true,
    enabled: candidateEnabled(candidate),
    review: {
      reviewedAt: review.reviewedAt,
      reviewer: review.reviewer,
      sourceCandidateId: candidate.id,
      ...(review.note ? { note: review.note } : {}),
    },
  };
}

function isRegressionCandidate(value: unknown): value is RegressionCandidate {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<RegressionCandidate>;
  return typeof item.id === 'string'
    && typeof item.taxonomy === 'string'
    && typeof item.sessionId === 'string'
    && typeof item.observedAt === 'string'
    && typeof item.confidence === 'number'
    && Array.isArray(item.seed)
    && Array.isArray(item.turns)
    && Array.isArray(item.checks)
    && !!item.provenance;
}

function isReviewedRegressionCandidate(value: unknown): value is ReviewedRegressionCandidate {
  return isRegressionCandidate(value)
    && (value as Partial<ReviewedRegressionCandidate>).reviewed === true
    && typeof (value as Partial<ReviewedRegressionCandidate>).review?.reviewedAt === 'string'
    && typeof (value as Partial<ReviewedRegressionCandidate>).review?.reviewer === 'string';
}

function candidateEnabled(candidate: RegressionCandidate): boolean {
  return (candidate as Partial<ReviewedRegressionCandidate>).enabled !== false;
}
