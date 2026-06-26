/**
 * Mio — Avatar state bridge
 *
 * Translates internal EmotionState into a portable avatar parameter set
 * suitable for Live2D / VRM / 2D sprite / TTS-only frontends.
 *
 * Design goals:
 *   - Frontend-agnostic. We never assume a specific renderer — we just
 *     emit a stable JSON shape that any frontend can map to its own rig.
 *   - Cheap to compute. Pure function, no I/O, no model calls.
 *   - The mapping is intentionally *suggestive*, not authoritative — the
 *     frontend should have its own smoothing/interpolation.
 *
 * The output schema:
 *   {
 *     mood:    string                  // semantic label
 *     energy:  'low' | 'mid' | 'high'   // raw energy
 *     face: {
 *       eyes:   'open' | 'half' | 'closed' | 'teary'
 *       mouth:  'neutral' | 'smile' | 'frown' | 'open' | 'pursed'
 *       brows:  'neutral' | 'raised' | 'furrowed' | 'soft'
 *     },
 *     body: {
 *       posture: 'relaxed' | 'tense' | 'leaning' | 'still'
 *       lean:     -1..1                  // forward/backward
 *     },
 *     voice: {
 *       tone:     'warm' | 'flat' | 'bright' | 'gentle' | 'firm'
 *       rate:     -0.3..0.3              // delta from baseline
 *       pitch:    -0.3..0.3
 *     },
 *     affection: number,                // 0..100, raw
 *     relationship: RelationshipStage,
 *     timestamp: ISO
 *   }
 */

import type { EmotionState, RelationshipStage } from '../types.js';

export interface AvatarFace {
  eyes: 'open' | 'half' | 'closed' | 'teary';
  mouth: 'neutral' | 'smile' | 'frown' | 'open' | 'pursed';
  brows: 'neutral' | 'raised' | 'furrowed' | 'soft';
}

export interface AvatarBody {
  posture: 'relaxed' | 'tense' | 'leaning' | 'still';
  lean: number; // -1..1
}

export interface AvatarVoice {
  tone: 'warm' | 'flat' | 'bright' | 'gentle' | 'firm';
  rate: number; // -0.3..0.3
  pitch: number; // -0.3..0.3
}

export interface AvatarState {
  mood: string;
  energy: 'low' | 'mid' | 'high';
  face: AvatarFace;
  body: AvatarBody;
  voice: AvatarVoice;
  affection: number;
  relationship: RelationshipStage;
  timestamp: string;
}

// ─── Mood → expression map ───

/**
 * Keyword-based face/body mapping. We don't try to be exhaustive — the
 * mood vocabulary is whatever the agent's `mutter` tool reports. Unknown
 * moods fall through to 'neutral'.
 */
const MOOD_MAP: Record<string, { face: Partial<AvatarFace>; body: Partial<AvatarBody>; voice: Partial<AvatarVoice> }> = {
  '开心': { face: { eyes: 'open', mouth: 'smile', brows: 'raised' }, body: { posture: 'relaxed' }, voice: { tone: 'bright', rate: 0.15, pitch: 0.1 } },
  '高兴': { face: { eyes: 'open', mouth: 'smile', brows: 'raised' }, body: { posture: 'relaxed' }, voice: { tone: 'bright', rate: 0.15, pitch: 0.1 } },
  '兴奋': { face: { eyes: 'open', mouth: 'open', brows: 'raised' }, body: { posture: 'leaning', lean: 0.3 }, voice: { tone: 'bright', rate: 0.25, pitch: 0.2 } },
  '心疼': { face: { eyes: 'half', mouth: 'neutral', brows: 'furrowed' }, body: { posture: 'still' }, voice: { tone: 'gentle', rate: -0.1, pitch: -0.1 } },
  '难过': { face: { eyes: 'half', mouth: 'frown', brows: 'furrowed' }, body: { posture: 'still' }, voice: { tone: 'gentle', rate: -0.15, pitch: -0.15 } },
  '担心': { face: { eyes: 'open', mouth: 'pursed', brows: 'raised' }, body: { posture: 'tense' }, voice: { tone: 'firm', rate: -0.05, pitch: 0 } },
  '生气': { face: { eyes: 'open', mouth: 'frown', brows: 'furrowed' }, body: { posture: 'tense' }, voice: { tone: 'firm', rate: 0.1, pitch: 0.1 } },
  '疲惫': { face: { eyes: 'half', mouth: 'neutral', brows: 'soft' }, body: { posture: 'relaxed', lean: -0.2 }, voice: { tone: 'gentle', rate: -0.2, pitch: -0.1 } },
  '焦虑': { face: { eyes: 'open', mouth: 'pursed', brows: 'raised' }, body: { posture: 'tense' }, voice: { tone: 'flat', rate: 0.1, pitch: 0.05 } },
  '平静': { face: { eyes: 'open', mouth: 'neutral', brows: 'neutral' }, body: { posture: 'relaxed' }, voice: { tone: 'warm', rate: 0, pitch: 0 } },
  '温柔': { face: { eyes: 'half', mouth: 'smile', brows: 'soft' }, body: { posture: 'relaxed', lean: 0.1 }, voice: { tone: 'gentle', rate: -0.05, pitch: 0 } },
  '未知': { face: { eyes: 'open', mouth: 'neutral', brows: 'neutral' }, body: { posture: 'still' }, voice: { tone: 'warm', rate: 0, pitch: 0 } },
};

const NEUTRAL_FACE: AvatarFace = { eyes: 'open', mouth: 'neutral', brows: 'neutral' };
const NEUTRAL_BODY: AvatarBody = { posture: 'still', lean: 0 };
const NEUTRAL_VOICE: AvatarVoice = { tone: 'warm', rate: 0, pitch: 0 };

/**
 * Resolve the mood fragment to a stable key in MOOD_MAP. Returns '未知' for
 * unknown / empty input — that case still gets a sensible default mapping.
 */
function resolveMood(mood: string): string {
  if (!mood) return '未知';
  // Try exact match first
  if (MOOD_MAP[mood]) return mood;
  // Then substring match
  for (const key of Object.keys(MOOD_MAP)) {
    if (mood.includes(key)) return key;
  }
  return '未知';
}

/**
 * Map a relationship stage to a base voice tone and rate. Tighter stages
 * get warmer tones; close stages get brighter tones. Pitch stays stable
 * across stages.
 */
function relationshipToVoice(stage: RelationshipStage): Partial<AvatarVoice> {
  switch (stage) {
    case 'acquaintance': return { tone: 'warm', rate: 0, pitch: 0 };
    case 'familiar':     return { tone: 'warm', rate: 0.05, pitch: 0.05 };
    case 'ambiguous':    return { tone: 'gentle', rate: -0.05, pitch: 0.05 };
    case 'intimate':     return { tone: 'gentle', rate: -0.05, pitch: 0.1 };
  }
}

/**
 * Build the avatar state from internal emotion + relationship state.
 */
export function buildAvatarState(
  emotion: EmotionState,
  relationship: RelationshipStage,
): AvatarState {
  const moodKey = resolveMood(emotion.myMood);
  const moodEntry = MOOD_MAP[moodKey];
  const relVoice = relationshipToVoice(relationship);

  return {
    mood: emotion.myMood,
    energy: emotion.energy,
    face: { ...NEUTRAL_FACE, ...moodEntry.face },
    body: { ...NEUTRAL_BODY, ...moodEntry.body },
    // Voice: relationship stage colors the *default* (neutral) mood. If Mio
    // has an active mood (e.g. 开心 / 难过), that mood's voice wins. This
    // matches intuition: a happy female persona sounds bright even at the
    // acquaintance stage, but a flat-mood acquaintance still sounds warm.
    voice: { ...NEUTRAL_VOICE, ...relVoice, ...moodEntry.voice },
    affection: emotion.affection,
    relationship,
    timestamp: new Date().toISOString(),
  };
}
