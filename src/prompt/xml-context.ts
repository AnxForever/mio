/**
 * Mio — XML Context Tags
 *
 * Replaces Markdown `## Section` headers with semantic XML tags for clearer
 * boundary signals. Anthropic documentation shows models follow XML-tagged
 * instructions better than Markdown headers — the explicit open/close tags
 * give the model a stronger structural signal about where one context block
 * ends and the next begins.
 *
 * This module is purely a *serialization layer*. It takes the same structured
 * data that the Markdown builders use and produces equivalent XML-wrapped
 * output. The actual data fetching (readUserProfile, readRecentBookmarks, etc.)
 * happens in the callers, not here.
 *
 * Usage:
 *   const xml = buildXmlContext({
 *     identity: '你是 Mio...',
 *     soul: soulContent,
 *     relationship: { stage: 'familiar', interactionCount: 47, ... },
 *     user: { profile: '...', recentTopics: ['工作', '游戏'] },
 *     currentState: { mood: '开心', energy: 'high', affection: 67, pad: { ... } },
 *     time: { now: new Date(), lastInteraction: '...' },
 *     recentMemory: { bookmarks: [...] },
 *     instructions: ['- 接情绪不接话术', '- 做反应不做分析'],
 *   });
 */

import type { RelationshipState, EmotionState } from '../types.js';
import { getStageConfig } from '../relationship/stages.js';
import type { PADState } from '../emotion/pad.js';

// ─── Types ───

export interface RelationshipCtx {
  stage: string;
  stageLabel: string;
  stageDescription: string;
  interactionCount: number;
  emotionalDepth: number;
  userCallsAgent: string | null;
  agentCallsUser: string | null;
  sharedMemories: string[];
}

export interface UserCtx {
  profile: string;
  recentTopics: string[];
}

export interface CurrentStateCtx {
  mood: string;
  energy: 'high' | 'mid' | 'low';
  affection: number;
  pad?: PADState | null;
  unresolvedThread?: string | null;
}

export interface TimeCtx {
  now: Date;
  lastInteraction: string | null;
}

export interface BookmarkCtx {
  time: string;
  what: string;
}

/**
 * All possible context sections that can be passed to buildXmlContext.
 * Every field is optional — only provided sections are rendered.
 */
export interface ContextSections {
  /** Core identity string (e.g. CORE_IDENTITY) */
  identity?: string;
  /** Full soul.md content from the active mod */
  soul?: string;
  /** Relationship context data */
  relationship?: RelationshipCtx | RelationshipState;
  /** User profile + recent topics */
  user?: UserCtx;
  /** Mio's current mood/energy/affection + optional PAD */
  currentState?: CurrentStateCtx | EmotionState;
  /** Time-of-day context */
  time?: TimeCtx;
  /** Recent bookmarks/memories */
  recentMemory?: { bookmarks: BookmarkCtx[] };
  /** Lorebook triggered memory context (pre-formatted string) */
  lorebook?: string;
  /** Behavioral instructions (array of lines) */
  instructions?: string[];
}

// ─── XML escaping ───

/**
 * Escape XML special characters in text content.
 * This ensures content with <, >, & is safe to embed in XML tags.
 * Single and double quotes are escaped for attribute safety even though
 * we only use text nodes (defense in depth).
 */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Escape only the characters that would break XML parsing inside a text node.
 * Less aggressive than full escapeXml — preserves quotes and apostrophes.
 * Use for short, controlled values like nicknames or stage labels.
 */
function escapeXmlText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ─── Helpers ───

function isRelationshipState(v: unknown): v is RelationshipState {
  return (
    typeof v === 'object' &&
    v !== null &&
    'stage' in v &&
    'interactionCount' in v &&
    'emotionalDepth' in v &&
    'nicknames' in v &&
    'sharedMemories' in v
  );
}

function isEmotionState(v: unknown): v is EmotionState {
  return (
    typeof v === 'object' &&
    v !== null &&
    'myMood' in v &&
    'energy' in v &&
    'affection' in v
  );
}

// ─── Section builders ───

/**
 * Build the <persona> section containing identity + soul.
 */
function buildPersonaSection(identity: string, soul: string | undefined): string {
  const parts: string[] = ['<persona>'];

  parts.push(`  <identity>${escapeXmlText(identity)}</identity>`);

  if (soul && soul.trim().length > 0) {
    parts.push(`  <soul>${escapeXmlText(soul)}</soul>`);
  }

  parts.push('</persona>');
  return parts.join('\n');
}

/**
 * Build the <relationship> section.
 */
function buildRelationshipSection(rel: RelationshipCtx | RelationshipState): string {
  const parts: string[] = ['<relationship>'];

  if (isRelationshipState(rel)) {
    const cfg = getStageConfig(rel.stage);
    parts.push(`  <stage>${escapeXmlText(cfg.label)}</stage>`);
    parts.push(`  <interactions>${rel.interactionCount}</interactions>`);
    parts.push(`  <depth>${rel.emotionalDepth}</depth>`);
    if (rel.nicknames.userCallsAgent) {
      parts.push(`  <userCallsYou>${escapeXmlText(rel.nicknames.userCallsAgent)}</userCallsYou>`);
    }
    if (rel.nicknames.agentCallsUser) {
      parts.push(`  <youCallUser>${escapeXmlText(rel.nicknames.agentCallsUser)}</youCallUser>`);
    }
    if (rel.sharedMemories.length > 0) {
      parts.push('  <memories>');
      for (const m of rel.sharedMemories.slice(-5)) {
        parts.push(`    <memory>${escapeXmlText(m)}</memory>`);
      }
      parts.push('  </memories>');
    }
  } else {
    parts.push(`  <stage>${escapeXmlText(rel.stageLabel)}</stage>`);
    parts.push(`  <interactions>${rel.interactionCount}</interactions>`);
    parts.push(`  <depth>${rel.emotionalDepth}</depth>`);
    if (rel.userCallsAgent) {
      parts.push(`  <userCallsYou>${escapeXmlText(rel.userCallsAgent)}</userCallsYou>`);
    }
    if (rel.agentCallsUser) {
      parts.push(`  <youCallUser>${escapeXmlText(rel.agentCallsUser)}</youCallUser>`);
    }
    if (rel.sharedMemories.length > 0) {
      parts.push('  <memories>');
      for (const m of rel.sharedMemories.slice(-5)) {
        parts.push(`    <memory>${escapeXmlText(m)}</memory>`);
      }
      parts.push('  </memories>');
    }
  }

  parts.push('</relationship>');
  return parts.join('\n');
}

/**
 * Build the <user> section.
 */
function buildUserSection(user: UserCtx): string {
  const parts: string[] = ['<user>'];

  if (user.profile && user.profile.trim().length > 0) {
    const truncated = user.profile.length > 800
      ? user.profile.slice(0, 800) + '\n…(more in memory bank)'
      : user.profile;
    parts.push(`  <profile>${escapeXmlText(truncated)}</profile>`);
  }

  if (user.recentTopics.length > 0) {
    parts.push(`  <recentTopics>${escapeXmlText(user.recentTopics.join('、'))}</recentTopics>`);
  }

  parts.push('</user>');
  return parts.join('\n');
}

/**
 * Build the <current_state> section.
 */
function buildCurrentStateSection(state: CurrentStateCtx | EmotionState): string {
  const parts: string[] = ['<current_state>'];

  if (isEmotionState(state)) {
    parts.push(`  <mood>${escapeXmlText(state.myMood || '平静')}</mood>`);
    const energyText = state.energy === 'high' ? '充沛'
      : state.energy === 'low' ? '低落' : '一般';
    parts.push(`  <energy>${energyText}</energy>`);
    parts.push(`  <affection>${state.affection}</affection>`);

    if (state.unresolvedThread) {
      parts.push(`  <unresolved>${escapeXmlText(state.unresolvedThread)}</unresolved>`);
    }
  } else {
    parts.push(`  <mood>${escapeXmlText(state.mood || '平静')}</mood>`);
    const energyText = state.energy === 'high' ? '充沛'
      : state.energy === 'low' ? '低落' : '一般';
    parts.push(`  <energy>${energyText}</energy>`);
    parts.push(`  <affection>${state.affection}</affection>`);

    if (state.unresolvedThread) {
      parts.push(`  <unresolved>${escapeXmlText(state.unresolvedThread)}</unresolved>`);
    }

    if (state.pad) {
      parts.push(`  <pad pleasure="${state.pad.pleasure.toFixed(2)}" arousal="${state.pad.arousal.toFixed(2)}" dominance="${state.pad.dominance.toFixed(2)}"/>`);
    }
  }

  parts.push('</current_state>');
  return parts.join('\n');
}

/**
 * Build the <time> section.
 */
function buildTimeSection(time: TimeCtx): string {
  const parts: string[] = ['<time>'];
  const now = time.now;
  const dayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const dayName = dayNames[now.getDay()];
  const timeStr = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 ${dayName} ${now.getHours()}点`;

  parts.push(`  <now>${escapeXmlText(timeStr)}</now>`);

  // Time-of-day hint
  const hour = now.getHours();
  let period: string;
  if (hour >= 0 && hour < 6) period = '深夜';
  else if (hour >= 6 && hour < 9) period = '清晨';
  else if (hour >= 9 && hour < 12) period = '上午';
  else if (hour >= 12 && hour < 14) period = '中午';
  else if (hour >= 14 && hour < 18) period = '下午';
  else if (hour >= 18 && hour < 22) period = '晚上';
  else period = '深夜';
  parts.push(`  <period>${period}</period>`);

  if (time.lastInteraction) {
    const last = new Date(time.lastInteraction).getTime();
    const diffMinutes = Math.floor((now.getTime() - last) / 60000);
    if (diffMinutes >= 5 && diffMinutes < 60) {
      parts.push(`  <last_chat>${diffMinutes}分钟前</last_chat>`);
    } else if (diffMinutes >= 60 && diffMinutes < 1440) {
      const hours = Math.floor(diffMinutes / 60);
      parts.push(`  <last_chat>${hours}小时前</last_chat>`);
    } else if (diffMinutes >= 1440) {
      const days = Math.floor(diffMinutes / 1440);
      parts.push(`  <last_chat>${days}天前</last_chat>`);
    }
    // If less than 5 minutes, omit the tag entirely (just now)
  }

  parts.push('</time>');
  return parts.join('\n');
}

/**
 * Build the <recent_memory> section from bookmarks.
 */
function buildMemorySection(bookmarks: BookmarkCtx[]): string | null {
  if (bookmarks.length === 0) return null;

  const parts: string[] = ['<recent_memory>'];
  for (const bm of bookmarks.slice(-8)) {
    const timeTag = bm.time.length > 16 ? bm.time.slice(0, 16) : bm.time;
    parts.push(`  <bookmark time="${escapeXmlText(timeTag)}">${escapeXmlText(bm.what)}</bookmark>`);
  }
  parts.push('</recent_memory>');
  return parts.join('\n');
}

/**
 * Build the <instructions> section.
 */
function buildInstructionsSection(instructions: string[]): string {
  const parts: string[] = ['<instructions>'];
  for (const line of instructions) {
    parts.push(`  ${escapeXmlText(line)}`);
  }
  parts.push('</instructions>');
  return parts.join('\n');
}

// ─── Main builder ───

/**
 * Assemble all provided context sections into XML-wrapped output.
 *
 * Each section is wrapped in semantic XML tags. Sections are assembled in
 * a logical order (persona → relationship → user → state → time → memory → instructions).
 * Only sections with data are rendered — empty/undefined fields are skipped.
 *
 * The output is valid XML-ish content suitable for embedding in a system prompt.
 * All text content is XML-escaped to avoid parsing ambiguity.
 *
 * @param sections  Partial ContextSections — only provided fields are rendered.
 * @returns         XML-wrapped context string, or empty string if no sections provided.
 */
export function buildXmlContext(sections: ContextSections): string {
  const parts: string[] = [];

  // <persona> — identity + soul
  if (sections.identity || sections.soul) {
    parts.push(buildPersonaSection(sections.identity ?? '', sections.soul));
  }

  // <relationship>
  if (sections.relationship) {
    parts.push(buildRelationshipSection(sections.relationship));
  }

  // <user>
  if (sections.user) {
    parts.push(buildUserSection(sections.user));
  }

  // <current_state>
  if (sections.currentState) {
    parts.push(buildCurrentStateSection(sections.currentState));
  }

  // <time>
  if (sections.time) {
    parts.push(buildTimeSection(sections.time));
  }

  // <recent_memory>
  if (sections.recentMemory && sections.recentMemory.bookmarks.length > 0) {
    const memSection = buildMemorySection(sections.recentMemory.bookmarks);
    if (memSection) parts.push(memSection);
  }

  // <lorebook>
  if (sections.lorebook) {
    parts.push(`<lorebook>\n  ${escapeXmlText(sections.lorebook)}\n</lorebook>`);
  }

  // <instructions>
  if (sections.instructions && sections.instructions.length > 0) {
    parts.push(buildInstructionsSection(sections.instructions));
  }

  return parts.join('\n\n');
}
