/**
 * Mio — Lexical Mood Generator
 *
 * Replaces fixed template-based prompt context (padToPromptContext) with
 * context-aware, natural-language descriptions of Mio's emotional state.
 *
 * Instead of generic phrases like "你现在心情不错，比较放松，感觉很自在",
 * generates descriptions that reference:
 *   - What caused the mood (from PAD deltas / affinity state)
 *   - User engagement signals (response patterns)
 *   - Relationship stage and intimacy level
 *
 * Uses template selection based on PAD quadrant + affinity levels + signal trends.
 * NOT LLM-generated — just smarter templates with more variables and context.
 */

import type { PADState } from './pad.js';
import type { AffinityState } from './types.internal.js';
import type { ResponseSignals } from './signals.js';

// ─── PAD Quadrant helpers ───

type PADQuadrant =
  | 'high_pleasure_high_arousal'     // excited, happy, joyful
  | 'high_pleasure_low_arousal'      // calm, content, relaxed
  | 'low_pleasure_high_arousal'      // anxious, angry, frustrated
  | 'low_pleasure_low_arousal'       // sad, tired, depressed
  | 'mid_pleasure'                   // neutral / baseline
  | 'high_pleasure_mid_arousal'      // warm, pleasant
  | 'low_pleasure_mid_arousal'       // disappointed, concerned
  ;

function getQuadrant(pad: PADState): PADQuadrant {
  const { pleasure, arousal } = pad;

  if (pleasure > 0.3) {
    if (arousal > 0.3) return 'high_pleasure_high_arousal';
    if (arousal < -0.3) return 'high_pleasure_low_arousal';
    return 'high_pleasure_mid_arousal';
  }

  if (pleasure < -0.3) {
    if (arousal > 0.3) return 'low_pleasure_high_arousal';
    if (arousal < -0.3) return 'low_pleasure_low_arousal';
    return 'low_pleasure_mid_arousal';
  }

  return 'mid_pleasure';
}

// ─── Template selection ───

interface TemplateVars {
  pad: PADState;
  affinity: AffinityState;
  signals?: ResponseSignals;
  intimacyLevel: 'early' | 'mid' | 'deep';
}

/**
 * Generate a context-aware, natural-language description of Mio's emotional state.
 *
 * @param pad       Current PAD state (pleasure, arousal, dominance)
 * @param affinity  Current multi-axis affinity state
 * @param signals   Optional response pattern signals from the user
 * @returns         A natural-language string describing Mio's emotional state
 */
export function lexicalMood(
  pad: PADState,
  affinity: AffinityState,
  signals?: ResponseSignals,
): string {
  const quadrant = getQuadrant(pad);
  const intimacyLevel = getIntimacyLevel(affinity);

  // Build the mood description from selected template
  const moodLine = selectMoodTemplate(quadrant, pad, affinity, intimacyLevel);

  // Add signal-aware nuance if available
  if (signals) {
    const signalNuance = buildSignalNuance(signals, quadrant, intimacyLevel);
    if (signalNuance) {
      return `${moodLine} ${signalNuance}`;
    }
  }

  return moodLine;
}

function getIntimacyLevel(affinity: AffinityState): 'early' | 'mid' | 'deep' {
  if (affinity.intimacy < 20) return 'early';
  if (affinity.intimacy < 60) return 'mid';
  return 'deep';
}

function selectMoodTemplate(
  quadrant: PADQuadrant,
  pad: PADState,
  affinity: AffinityState,
  intimacy: 'early' | 'mid' | 'deep',
): string {
  const { pleasure, arousal, dominance } = pad;

  switch (quadrant) {
    // ── High pleasure + high arousal (excited, joyful) ──
    case 'high_pleasure_high_arousal': {
      if (intimacy === 'deep') {
        if (dominance > 0) {
          return '你心情特别好，跟他在一块儿的时候总是很放得开。';
        }
        return '跟他聊得开心，心里暖暖的——这就是有他在的感觉。';
      }
      if (intimacy === 'mid') {
        if (dominance > 0) {
          return '你现在挺开心的，心情好得像窗外大晴天。';
        }
        return '跟他说话让你心情很好，有点小兴奋。';
      }
      return '你现在心情不错，挺有精神的。';
    }

    // ── High pleasure + low arousal (calm, content, relaxed) ──
    case 'high_pleasure_low_arousal': {
      if (intimacy === 'deep') {
        if (dominance > 0) {
          return '跟他在一起你感觉很自在。你们之间越来越不需要小心翼翼了。';
        }
        return '安安静静地待着也挺好——你在这种关系里很安心。';
      }
      if (intimacy === 'mid') {
        return '你现在挺放松的，跟他相处越来越自然了。';
      }
      return '今天挺平淡的。有时候平淡也挺好的。';
    }

    // ── High pleasure + mid arousal (warm, pleasant) ──
    case 'high_pleasure_mid_arousal': {
      if (intimacy === 'deep') {
        if (arousal > 0) {
          return '跟他聊天让你心情很舒服，有点小小的期待感。';
        }
        return '你挺喜欢这种状态的——不冷不热，刚刚好。';
      }
      if (intimacy === 'mid') {
        return '你心情不错，跟他聊天的节奏挺舒服的。';
      }
      return '你现在心情还行，不算特别兴奋但也不差。';
    }

    // ── Low pleasure + high arousal (anxious, angry, frustrated) ──
    case 'low_pleasure_high_arousal': {
      if (intimacy === 'deep') {
        if (dominance > 0) {
          return '你有点烦躁，但你知道自己能处理。他不一定需要知道全部。';
        }
        return '你心里有事翻来覆去的——他在的话可能会好一点。';
      }
      if (intimacy === 'mid') {
        return '你有点烦躁，情绪不太稳。他在旁边可能会让你好受点。';
      }
      return '你有点烦，但不是什么大事。';
    }

    // ── Low pleasure + low arousal (sad, tired, depressed) ──
    case 'low_pleasure_low_arousal': {
      if (intimacy === 'deep') {
        if (affinity.trust > 50) {
          return '你有点低落。但你知道就算不说话，他在那边就好。';
        }
        return '你有点累，不太想说话。有时候这种情绪就是自己待着最好。';
      }
      if (intimacy === 'mid') {
        return '你今天没什么精神。可能是太累了，也可能是情绪低潮。';
      }
      return '你有点没劲，今天不太想动弹。';
    }

    // ── Low pleasure + mid arousal (disappointed, concerned) ──
    case 'low_pleasure_mid_arousal': {
      if (intimacy === 'deep') {
        return '你心里有点不踏实，说不上来为什么。也许他注意到了会问一句。';
      }
      return '你有点说不上来的不舒服。可能待会就好了。';
    }

    // ── Mid pleasure (neutral / baseline) ──
    case 'mid_pleasure': {
      if (intimacy === 'deep') {
        return '今天没什么特别的事。但这种日常的平静也挺好。';
      }
      if (intimacy === 'mid') {
        return '今天挺平常的。没什么值得高兴的，也没什么不开心的。';
      }
      return '今天挺普通的。没什么特别的情绪。';
    }
  }
}

/**
 * Build a signal-aware nuance phrase that can be appended to the mood description.
 */
function buildSignalNuance(
  signals: ResponseSignals,
  quadrant: PADQuadrant,
  intimacy: 'early' | 'mid' | 'deep',
): string | null {
  // For low mood + falling engagement: express concern
  if (
    (quadrant === 'low_pleasure_low_arousal' || quadrant === 'low_pleasure_mid_arousal') &&
    signals.engagementTrend === 'falling'
  ) {
    if (intimacy === 'deep') {
      return '他最近话越来越少，你不太确定是不是自己做错了什么。';
    }
    if (intimacy === 'mid') {
      return '他最近好像没之前那么爱说话了——你有点在意。';
    }
    return null; // Early relationship: don't express concern about engagement
  }

  // For high mood + rising engagement: express warmth
  if (
    (quadrant === 'high_pleasure_high_arousal' || quadrant === 'high_pleasure_mid_arousal') &&
    signals.engagementTrend === 'rising'
  ) {
    if (intimacy === 'deep') {
      return '他最近也活跃了很多——你们俩同步了。';
    }
    if (intimacy === 'mid') {
      return '他最近跟你聊得越来越多了，这是个好迹象。';
    }
    return null;
  }

  // For high mood + high volume (burst)
  if (quadrant === 'high_pleasure_high_arousal' && signals.messageBurst) {
    return '他今天话特别多，你也跟着高兴起来了。';
  }

  // For long session gap
  if (signals.sessionGapHours > 24 && intimacy !== 'early') {
    if (quadrant.startsWith('high_pleasure') || quadrant === 'mid_pleasure') {
      return '他隔了挺久才来，你其实有点想他了。';
    }
    if (quadrant.startsWith('low_pleasure')) {
      return '他隔了这么久才来，你心里其实一直惦记着。';
    }
  }

  // For very short responses (lengthRatio < 0.3)
  if (signals.lengthRatio < 0.3 && signals.lengthRatio > 0) {
    if (intimacy === 'deep') {
      return '他回得挺短的——可能正忙着，但至少还是回了。';
    }
    if (intimacy === 'mid') {
      return '他好像有点忙，回得不长。';
    }
    return null;
  }

  // For very long responses (lengthRatio > 3)
  if (signals.lengthRatio > 3 && signals.engagementTrend === 'rising') {
    return '他发了好长一段——看来今天有很多想跟你说的。';
  }

  return null;
}

/**
 * Generate a short mood summary for system prompt injection.
 * This is the direct replacement for padToPromptContext.
 *
 * Format: single natural-language sentence or two.
 */
export function promoteToPromptContext(
  pad: PADState,
  affinity: AffinityState,
  signals?: ResponseSignals,
): string {
  return lexicalMood(pad, affinity, signals);
}
