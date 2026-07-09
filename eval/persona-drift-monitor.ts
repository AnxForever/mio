#!/usr/bin/env node
/**
 * persona-drift-monitor.ts — measure persona consistency across long conversations.
 *
 * Reads a JSONL transcript and computes drift metrics at sampled intervals:
 *   1. Message length trend (burstiness decay)
 *   2. Vocabulary overlap (Jaccard with early-turn baseline)
 *   3. Emoji usage rate trend
 *   4. AI-tell pattern count
 *
 * Does NOT require an LLM provider — pure transcript analysis.
 * Run: node --experimental-strip-types eval/persona-drift-monitor.ts [transcript.jsonl]
 *
 * Research basis:
 *   - PersonaGym (EMNLP 2025): multi-dimensional persona consistency evaluation
 *   - Abdulhai et al. (NeurIPS 2025): drift evident after ~100 turns; multi-turn RL
 *     reduces inconsistency >55%
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// ─── Types ───

interface TurnSample {
  turnIndex: number;
  assistantText: string;
  charCount: number;
  lineCount: number;
  emojiCount: number;
  aiTellCount: number;
  avgSentenceLen: number;
}

interface DriftMetrics {
  samples: TurnSample[];
  lengthTrend: { slope: number; significant: boolean };
  vocabOverlapDecay: { early: number; mid: number; late: number };
  emojiTrend: { start: number; end: number; trend: 'stable' | 'increasing' | 'decreasing' };
  aiTellTrend: { start: number; end: number; trend: 'stable' | 'increasing' | 'decreasing' };
  driftScore: number; // 0-1, lower = more drift
}

// ─── AI-tell patterns (from 2025 research consensus) ───

const AI_TELL_PATTERNS: RegExp[] = [
  /(?:delve|tapestry|intricate|realm|testament to|leverage|showcase|underscore|meticulous|nuanced|ever-evolving)/gi,
  /(?:not just .+ but .+)/gi,
  /(?:我理解你的感受|让我来帮你分析|根据我的了解|作为AI|作为一个人工智能)/g,
  /(?:Great question|That's a great|I appreciate you)/gi,
  /—/g,                    // em dash overuse
  /(?:在当今|总而言之|综上所述|值得注意的是)/g, // Chinese AI buzzwords
];

function countAITells(text: string): number {
  let count = 0;
  for (const pattern of AI_TELL_PATTERNS) {
    const matches = text.match(pattern);
    if (matches) count += matches.length;
  }
  return count;
}

function countEmojis(text: string): number {
  const matches = text.match(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu);
  return matches ? matches.length : 0;
}

function avgSentenceLength(text: string): number {
  const sentences = text.split(/[。！？!?.\n]+/).filter((s) => s.trim().length > 0);
  if (sentences.length === 0) return 0;
  return sentences.reduce((sum, s) => sum + s.length, 0) / sentences.length;
}

// ─── Jaccard similarity of word bigrams ───

function bigrams(text: string): Set<string> {
  const cleaned = text.replace(/[，。！？、\s\n]+/g, '');
  const s = new Set<string>();
  for (let i = 0; i < cleaned.length - 1; i++) {
    s.add(cleaned.slice(i, i + 2));
  }
  return s;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const item of a) {
    if (b.has(item)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

// ─── Sample turns at intervals ───

function sampleTurns(
  assistantMessages: { index: number; text: string }[],
  totalTurns: number,
): TurnSample[] {
  const sampleIndices = new Set<number>();
  // Always sample first and last
  sampleIndices.add(0);
  // Sample at ~20% intervals
  const intervals = [0.2, 0.4, 0.6, 0.8];
  for (const ratio of intervals) {
    sampleIndices.add(Math.floor(totalTurns * ratio));
  }
  sampleIndices.add(totalTurns - 1);

  return Array.from(sampleIndices)
    .filter((idx) => idx >= 0 && idx < assistantMessages.length)
    .sort((a, b) => a - b)
    .map((idx) => {
      const msg = assistantMessages[idx];
      const text = msg.text;
      return {
        turnIndex: msg.index,
        assistantText: text,
        charCount: text.length,
        lineCount: text.split('\n').filter((l) => l.trim()).length,
        emojiCount: countEmojis(text),
        aiTellCount: countAITells(text),
        avgSentenceLen: avgSentenceLength(text),
      };
    });
}

// ─── Compute drift metrics ───

function computeDriftMetrics(samples: TurnSample[]): DriftMetrics {
  if (samples.length < 3) {
    return {
      samples,
      lengthTrend: { slope: 0, significant: false },
      vocabOverlapDecay: { early: 1, mid: 1, late: 1 },
      emojiTrend: { start: 0, end: 0, trend: 'stable' },
      aiTellTrend: { start: 0, end: 0, trend: 'stable' },
      driftScore: 1,
    };
  }

  // Length trend: linear regression slope
  const n = samples.length;
  const xMean = (n - 1) / 2;
  const yMean = samples.reduce((s, sp) => s + sp.charCount, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (samples[i].charCount - yMean);
    den += (i - xMean) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  const lengthTrend = {
    slope: Math.round(slope * 100) / 100,
    significant: Math.abs(slope) > 2, // >2 chars/turn drift
  };

  // Vocabulary overlap: compare first third, middle third, last third
  const third = Math.max(1, Math.floor(n / 3));
  const earlySet = bigrams(samples.slice(0, third).map((s) => s.assistantText).join(''));
  const midSet = bigrams(samples.slice(third, 2 * third).map((s) => s.assistantText).join(''));
  const lateSet = bigrams(samples.slice(2 * third).map((s) => s.assistantText).join(''));

  const vocabOverlapDecay = {
    early: 1.0,
    mid: Math.round(jaccard(earlySet, midSet) * 100) / 100,
    late: Math.round(jaccard(earlySet, lateSet) * 100) / 100,
  };

  // Emoji trend
  const emojiStart = samples.slice(0, Math.max(1, Math.floor(n / 4)))
    .reduce((s, sp) => s + sp.emojiCount, 0);
  const emojiEnd = samples.slice(-Math.max(1, Math.floor(n / 4)))
    .reduce((s, sp) => s + sp.emojiCount, 0);
  const emojiTrend: DriftMetrics['emojiTrend'] = {
    start: emojiStart,
    end: emojiEnd,
    trend: Math.abs(emojiEnd - emojiStart) <= 1 ? 'stable'
      : emojiEnd > emojiStart ? 'increasing' : 'decreasing',
  };

  // AI-tell trend
  const aiStart = samples[0]?.aiTellCount ?? 0;
  const aiEnd = samples[samples.length - 1]?.aiTellCount ?? 0;
  const aiTellTrend: DriftMetrics['aiTellTrend'] = {
    start: aiStart,
    end: aiEnd,
    trend: aiEnd === aiStart ? 'stable'
      : aiEnd > aiStart ? 'increasing' : 'decreasing',
  };

  // Composite drift score (0-1, lower = more drift)
  const vocabScore = (vocabOverlapDecay.mid + vocabOverlapDecay.late) / 2;
  const lengthScore = lengthTrend.significant ? 0.6 : 1.0;
  const emojiScore = emojiTrend.trend === 'stable' ? 1.0 : 0.7;
  const aiTellScore = aiTellTrend.trend === 'increasing' ? 0.5 : 1.0;
  const driftScore = Math.round(
    (vocabScore * 0.35 + lengthScore * 0.25 + emojiScore * 0.15 + aiTellScore * 0.25) * 100,
  ) / 100;

  return { samples, lengthTrend, vocabOverlapDecay, emojiTrend, aiTellTrend, driftScore };
}

// ─── Main ───

function main(): void {
  const transcriptPath = process.argv[2]
    ? resolve(process.argv[2])
    : null;

  if (!transcriptPath || !existsSync(transcriptPath)) {
    console.error('Usage: node --experimental-strip-types eval/persona-drift-monitor.ts <transcript.jsonl>');
    console.error('  Reads a Mio JSONL transcript and reports persona drift metrics.');
    console.error('  If no transcript is provided, runs a built-in demo.');
    process.exit(transcriptPath ? 1 : 0);
  }

  const lines = readFileSync(transcriptPath, 'utf-8')
    .split('\n')
    .filter((l) => l.trim());

  const assistantMessages: { index: number; text: string }[] = [];
  let turnCount = 0;

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (entry.role === 'assistant' && (entry.text || entry.content)) {
        assistantMessages.push({ index: turnCount, text: entry.text || entry.content });
        turnCount++;
      } else if (entry.role === 'user') {
        turnCount++;
      }
    } catch {
      // skip malformed lines
    }
  }

  if (assistantMessages.length < 5) {
    console.log(`⚠ Only ${assistantMessages.length} assistant messages found — need at least 5 for meaningful drift analysis.`);
    console.log('Drift score: N/A (insufficient data)');
    process.exit(0);
  }

  const samples = sampleTurns(assistantMessages, turnCount);
  const metrics = computeDriftMetrics(samples);

  // ─── Report ───
  console.log('═'.repeat(60));
  console.log('Persona Drift Monitor');
  console.log('═'.repeat(60));
  console.log(`Transcript: ${transcriptPath}`);
  console.log(`Total turns: ${turnCount}`);
  console.log(`Assistant messages: ${assistantMessages.length}`);
  console.log(`Samples analyzed: ${samples.length}`);
  console.log('');

  console.log('── Turn Samples ──');
  for (const s of samples) {
    const preview = s.assistantText.slice(0, 60).replace(/\n/g, '↵');
    console.log(`  Turn ${s.turnIndex}: ${s.charCount} chars, ${s.lineCount} lines, ${s.emojiCount} emojis, ${s.aiTellCount} AI tells | "${preview}${s.assistantText.length > 60 ? '…' : ''}"`);
  }
  console.log('');

  console.log('── Drift Metrics ──');
  console.log(`  Message Length Trend: ${metrics.lengthTrend.slope} chars/turn ${metrics.lengthTrend.significant ? '⚠ SIGNIFICANT' : '(stable)'}`);
  console.log(`  Vocab Overlap (vs early): mid=${metrics.vocabOverlapDecay.mid} late=${metrics.vocabOverlapDecay.late}`);
  console.log(`  Emoji Trend: ${metrics.emojiTrend.start} → ${metrics.emojiTrend.end} (${metrics.emojiTrend.trend})`);
  console.log(`  AI-Tell Trend: ${metrics.aiTellTrend.start} → ${metrics.aiTellTrend.end} (${metrics.aiTellTrend.trend})`);
  console.log('');

  // Drift score with color
  const scoreColor = metrics.driftScore >= 0.8 ? '\x1b[32m' : metrics.driftScore >= 0.6 ? '\x1b[33m' : '\x1b[31m';
  console.log(`  Drift Score: ${scoreColor}${metrics.driftScore}\x1b[0m (0-1, higher = more consistent)`);

  const assessment = metrics.driftScore >= 0.8 ? '✅ Good — persona is stable across the conversation'
    : metrics.driftScore >= 0.6 ? '⚠ Fair — moderate drift detected, review recommended'
    : '❌ Poor — significant persona drift, investigation needed';
  console.log(`  Assessment: ${assessment}`);

  // Specific recommendations
  const recs: string[] = [];
  if (metrics.lengthTrend.significant) recs.push('- Message length is drifting; check burstiness consistency');
  if (metrics.vocabOverlapDecay.late < 0.3) recs.push('- Heavy vocabulary drift; persona may be losing its voice');
  if (metrics.aiTellTrend.trend === 'increasing') recs.push('- AI-tell patterns increasing; L0 guard / voice preset may need tuning');
  if (metrics.emojiTrend.trend !== 'stable') recs.push('- Emoji usage changing; check emotional consistency');
  if (recs.length > 0) {
    console.log('\n── Recommendations ──');
    console.log(recs.join('\n'));
  }

  process.exit(metrics.driftScore >= 0.6 ? 0 : 1);
}

main();
