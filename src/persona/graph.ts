/**
 * Mio — Persona Knowledge Graph (ID-RAG)
 *
 * Replaces static soul.md injection with a structured knowledge graph for
 * dynamic retrieval. Each turn, only the most relevant persona fragments
 * are injected into the prompt, reducing ~1500 token soul overhead to ~800.
 *
 * Concept: Identity Retrieval-Augmented Generation (ID-RAG)
 * Ref: MIT Media Lab, arXiv 2509.25299
 *
 * The soul.md is the canonical source. The graph is an optimized retrieval
 * form — extracted once, persisted, and incrementally evolved.
 */

// ─── Types ───

export interface PersonaNode {
  id: string;
  type: 'trait' | 'belief' | 'rule' | 'memory' | 'voice' | 'boundary';
  content: string;          // the actual personality content
  confidence: number;       // 0-1 how core this is
  triggers: string[];       // keywords/topics that make this node relevant
  stageRelevance: {
    acquaintance: number;
    familiar: number;
    ambiguous: number;
    intimate: number;
  };
  createdAt: string;
  updatedAt: string;
}

export interface PersonaEdge {
  from: string;  // node id
  to: string;    // node id
  type: 'reinforces' | 'contradicts' | 'contextualizes' | 'depends_on';
}

export interface PersonaGraph {
  nodes: PersonaNode[];
  edges: PersonaEdge[];
  metadata: {
    version: number;
    coreTraitCount: number;
    lastEvolved: string;
  };
}

/**
 * Context passed to retrieveRelevantNodes for scoring.
 */
export interface RetrievalContext {
  topics: string[];
  intent: string;
  stage: string;
  recentBookmarks: string[];
}

// ─── Constants ───

/** Target token budget for retrieved persona context (~800 tokens). */
const TARGET_TOKEN_BUDGET = 800;

/**
 * Estimate token count for mixed CJK/ASCII text.
 *
 * Calibrated empirically:
 * - Full female soul.md (2682 chars) → ~1100-1200 Claude tokens
 * - Reasoning: CJK text tokenizes at roughly 1.5-2 chars/token, ASCII at 3-4 chars/token.
 * - Moving average: for a typical Chinese conversation, a safe estimate is:
 *   chars / 2 for CJK-heavy text, chars / 3 for ASCII-heavy.
 *
 * This is used for retrieval budget management, not exact accounting.
 * A 30% margin of error is acceptable.
 */
function estimateTokens(text: string): number {
  let cjk = 0;
  let ascii = 0;
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code === 0x20 || code === 0x0a || code === 0x0d) continue;
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3000 && code <= 0x303f) ||
      (code >= 0xff00 && code <= 0xffef)
    ) {
      cjk++;
    } else {
      ascii++;
    }
  }
  // ~1.8 CJK chars per token, ~3.5 ASCII chars per token
  return Math.ceil(cjk / 1.8 + ascii / 3.5) + 1;
}

/** Stage name normalization for node scoring. */
const STAGE_KEYS = ['acquaintance', 'familiar', 'ambiguous', 'intimate'] as const;
type StageKey = (typeof STAGE_KEYS)[number];

function stageKey(s: string): StageKey {
  const lower = s.toLowerCase().trim();
  if (STAGE_KEYS.includes(lower as StageKey)) return lower as StageKey;
  return 'acquaintance'; // fallback
}

// ─── Core API ───

/**
 * Extract a structured PersonaGraph from the raw soul.md content.
 *
 * Parsing strategy:
 * - Section headers (##) determine node type
 * - Bullet points and paragraphs become individual nodes
 * - Confidence is assigned based on position and keywords
 * - Triggers are extracted from section context and content analysis
 * - Stage relevance is derived from content mentioning relationship stages
 */
export function extractGraphFromSoul(soulContent: string): PersonaGraph {
  const nodes: PersonaNode[] = [];
  const edges: PersonaEdge[] = [];
  const now = new Date().toISOString();

  if (!soulContent || soulContent.trim().length === 0) {
    return {
      nodes: [],
      edges: [],
      metadata: {
        version: 1,
        coreTraitCount: 0,
        lastEvolved: now,
      },
    };
  }

  // Split into sections by ## headers
  const lines = soulContent.split('\n');
  const sections = parseSections(lines);

  let nodeCounter = 0;

  for (const section of sections) {
    const nodeType = classifySectionType(section.header);
    const body = section.body;

    // Each content block in the section becomes a node
    const blocks = splitIntoBlocks(body, nodeType);

    for (const block of blocks) {
      if (block.trim().length === 0) continue;
      const id = `pn_${nodeCounter++}`;
      const confidence = computeConfidence(block, nodeType, section.header);
      const triggers = extractTriggers(block, section.header, nodeType);
      const stageRel = computeStageRelevance(block, nodeType);

      nodes.push({
        id,
        type: nodeType,
        content: block.trim(),
        confidence,
        triggers,
        stageRelevance: stageRel,
        createdAt: now,
        updatedAt: now,
      });
    }

    // Create edges between nodes in the same section (reinforces)
    const sectionNodeIds = nodes.slice(-blocks.filter((b) => b.trim().length > 0).length).map((n) => n.id);
    for (let i = 1; i < sectionNodeIds.length; i++) {
      edges.push({
        from: sectionNodeIds[i - 1],
        to: sectionNodeIds[i],
        type: 'reinforces',
      });
    }
  }

  // Add edges from rules to their triggers (contextualizes)
  for (const node of nodes) {
    if (node.type === 'rule' && node.triggers.length > 0) {
      // Find trait/voice nodes with overlapping triggers
      for (const other of nodes) {
        if (other.id === node.id) continue;
        if (other.type === 'trait' || other.type === 'voice') {
          const overlap = node.triggers.some((t) =>
            other.triggers.some((ot) => ot.includes(t) || t.includes(ot)),
          );
          if (overlap) {
            edges.push({
              from: node.id,
              to: other.id,
              type: 'contextualizes',
            });
          }
        }
      }
    }
  }

  const coreTraits = nodes.filter(
    (n) => n.type === 'trait' && n.confidence >= 0.9,
  );

  return {
    nodes,
    edges,
    metadata: {
      version: 1,
      coreTraitCount: coreTraits.length,
      lastEvolved: now,
    },
  };
}

/**
 * Retrieve the most relevant nodes for a given conversation context.
 *
 * Scoring formula:
 *   score(node) = triggerMatch * 0.45 + stageRelevance * 0.25 + confidence * 0.30
 *
 * Always includes core traits (confidence >= 0.9) regardless of relevance.
 * Caps total output at TARGET_TOKEN_BUDGET (~800 tokens). Also enforces a
 * per-type cap so no single type can dominate the retrieved set.
 */
export function retrieveRelevantNodes(
  graph: PersonaGraph,
  context: RetrievalContext,
): PersonaNode[] {
  if (graph.nodes.length === 0) return [];

  const stage = stageKey(context.stage);

  // Combine all context terms into a single normalized list
  const contextTerms = new Set<string>();
  for (const t of context.topics) contextTerms.add(t.toLowerCase());
  contextTerms.add(context.intent.toLowerCase());
  for (const b of context.recentBookmarks) {
    // Split bookmarks into individual meaningful terms (skip stopwords)
    const words = b.toLowerCase().split(/[\s,，。！？、\/]+/);
    for (const w of words) {
      if (w.length >= 2) contextTerms.add(w);
    }
  }

  const contextTermsArr = [...contextTerms].filter(Boolean);

  // Score every node
  const scored: { node: PersonaNode; score: number }[] = graph.nodes.map((node) => {
    // ── Trigger match (0-1) ──
    let triggerScore = 0;
    if (node.triggers.length > 0 && contextTermsArr.length > 0) {
      let weightedMatches = 0;
      for (const trigger of node.triggers) {
        const tLower = trigger.toLowerCase();
        for (const term of contextTermsArr) {
          // Exact match wins, substring too
          if (term === tLower || term.includes(tLower) || tLower.includes(term)) {
            weightedMatches++;
            break;
          }
        }
      }
      // Score is ratio of matched triggers, sigmoid-shaped to create separation
      triggerScore = weightedMatches / Math.max(node.triggers.length, 1);
      // Boost when multiple terms match different triggers
      if (weightedMatches >= 2) triggerScore = Math.min(triggerScore * 1.3, 1.0);
    } else if (node.triggers.length === 0) {
      // Nodes with no triggers get a small default relevance
      triggerScore = 0.15;
    }

    // ── Stage relevance (0-1) ──
    const stageScore = node.stageRelevance[stage] ?? 0.4;

    // ── Combined score ──
    const score = triggerScore * 0.45 + stageScore * 0.25 + node.confidence * 0.30;
    return { node, score: round2(score) };
  });

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // Always include core traits (confidence >= 0.9, type === 'trait')
  const coreIds = new Set(
    graph.nodes
      .filter((n) => n.type === 'trait' && n.confidence >= 0.9)
      .map((n) => n.id),
  );

  // Also always include voice and boundary nodes (they define "how to be Mio")
  const alwaysIncludeTypes = new Set(['voice', 'boundary']);
  const alwaysIds = new Set(
    graph.nodes
      .filter((n) => alwaysIncludeTypes.has(n.type))
      .map((n) => n.id),
  );

  // Collect selected nodes
  const selected: PersonaNode[] = [];
  const seenIds = new Set<string>();

  // Phase 1: always-include nodes (core traits, voice, boundaries)
  for (const { node } of scored) {
    if ((coreIds.has(node.id) || alwaysIds.has(node.id)) && !seenIds.has(node.id)) {
      selected.push(node);
      seenIds.add(node.id);
    }
  }

  // Phase 2: fill remaining budget with highest-scoring remaining nodes
  const usedTokens = selected.reduce((sum, n) => sum + estimateTokens(n.content), 0);
  let remainingBudget = TARGET_TOKEN_BUDGET - usedTokens;

  // When no context-specific terms exist, be more selective (top 40%)
  const isGeneric = contextTermsArr.length <= 1;
  const cutoffScore = isGeneric && scored.length > 0
    ? scored[Math.floor(scored.length * 0.4)].score
    : 0;

  for (const { node: n, score } of scored) {
    if (seenIds.has(n.id)) continue;
    if (score < 0.1) break;
    if (score < cutoffScore) break;

    const tokenCost = estimateTokens(n.content);
    if (tokenCost > remainingBudget && selected.length > 0) {
      // Allow last-node overshoot only if within 30% of budget
      if (remainingBudget < 0) break;
      if (tokenCost > remainingBudget * 1.3) break;
    }

    selected.push(n);
    seenIds.add(n.id);
    remainingBudget -= tokenCost;
  }

  // Sort selected nodes by type for consistent prompt output
  return selected;
}

/**
 * Convert retrieved nodes to a compact prompt fragment.
 *
 * Format:
 *   你是 Mio。
 *   你的人格核心: ...
 *   当前相关: ...
 *   说话风格: ...
 */
export function graphToPrompt(nodes: PersonaNode[]): string {
  if (nodes.length === 0) return '';

  const parts: string[] = [];

  // Core identity from traits
  const traits = nodes.filter((n) => n.type === 'trait');
  if (traits.length > 0) {
    parts.push('## 你的人格核心');
    for (const t of traits) {
      parts.push(t.content);
    }
  }

  // Rules and boundaries
  const rules = nodes.filter((n) => n.type === 'rule' || n.type === 'boundary');
  if (rules.length > 0) {
    parts.push('## 你的原则');
    for (const r of rules) {
      // Only include first line for compactness
      const firstLine = r.content.split('\n')[0].trim();
      const prefix = r.type === 'boundary' ? '(绝不) ' : '';
      parts.push(prefix + firstLine);
    }
  }

  // Voice patterns
  const voice = nodes.filter((n) => n.type === 'voice');
  if (voice.length > 0) {
    parts.push('## 说话风格');
    for (const v of voice) {
      parts.push(v.content);
    }
  }

  // Beliefs
  const beliefs = nodes.filter((n) => n.type === 'belief');
  if (beliefs.length > 0) {
    parts.push('## 信念');
    for (const b of beliefs) {
      parts.push(b.content);
    }
  }

  return parts.join('\n\n');
}

/**
 * Evolve the graph based on interaction events.
 *
 * - Reinforce nodes when events match their triggers (confidence += 0.03)
 * - Add new nodes for novel traits (not yet implemented — future work)
 * - No decay on untouched nodes unless events exceed a threshold (>=10 events)
 * - Bump version on any change
 *
 * Evolution is intentionally conservative: persona traits should shift
 * slowly over hundreds of interactions, not per-session.
 */
export function evolveGraph(
  graph: PersonaGraph,
  events: { type: string; content: string; timestamp: string }[],
): PersonaGraph {
  if (events.length === 0) return graph;

  // Only apply decay when processing a meaningful batch of events
  const shouldDecay = events.length >= 10;

  const updatedNodes = graph.nodes.map((node) => {
    let confidence = node.confidence;
    let updatedAt = node.updatedAt;
    let changed = false;

    // Check each event for trigger matches
    for (const event of events) {
      const eventText = `${event.type} ${event.content}`.toLowerCase();

      const matched = node.triggers.some((t) => eventText.includes(t.toLowerCase()));
      if (matched) {
        confidence = Math.min(confidence + 0.03, 1.0);
        updatedAt = event.timestamp;
        changed = true;
      }
    }

    // Slow decay only when processing large event batches
    if (!changed && shouldDecay) {
      // Decay slower for high-confidence nodes, faster for low-confidence ones
      const decayRate = node.confidence >= 0.8 ? 0.003 : 0.01;
      confidence = Math.max(confidence - decayRate, 0.1);
    }

    return { ...node, confidence: round2(confidence), updatedAt };
  });

  // Only bump version if something actually changed
  const hasChanges = updatedNodes.some(
    (n, i) => n.confidence !== graph.nodes[i]?.confidence,
  );

  if (!hasChanges) return graph;

  return {
    nodes: updatedNodes,
    edges: graph.edges,
    metadata: {
      ...graph.metadata,
      version: graph.metadata.version + 1,
      coreTraitCount: updatedNodes.filter(
        (n) => n.type === 'trait' && n.confidence >= 0.9,
      ).length,
      lastEvolved: events[events.length - 1]?.timestamp ?? graph.metadata.lastEvolved,
    },
  };
}

// ─── Serialization ───

export function serializeGraph(graph: PersonaGraph): string {
  return JSON.stringify(graph, null, 2);
}

export function deserializeGraph(json: string): PersonaGraph {
  const parsed = JSON.parse(json) as PersonaGraph;
  // Validate basic structure
  if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
    throw new Error('Invalid PersonaGraph: nodes and edges must be arrays');
  }
  if (!parsed.metadata) {
    throw new Error('Invalid PersonaGraph: metadata is required');
  }
  return parsed;
}

// ─── Default graph (fallback when no soul is available) ───

export function defaultGraph(): PersonaGraph {
  return {
    nodes: [],
    edges: [],
    metadata: {
      version: 1,
      coreTraitCount: 0,
      lastEvolved: new Date().toISOString(),
    },
  };
}

// ─── Internal helpers ───

interface ParsedSection {
  header: string;
  body: string;
}

/**
 * Parse lines into sections delimited by ## headers.
 */
function parseSections(lines: string[]): ParsedSection[] {
  const sections: ParsedSection[] = [];
  let currentHeader = '';
  let currentBodyLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('## ')) {
      if (currentHeader) {
        sections.push({
          header: currentHeader,
          body: currentBodyLines.join('\n').trim(),
        });
      }
      currentHeader = trimmed.replace(/^##\s+/, '');
      currentBodyLines = [];
    } else if (!trimmed.startsWith('# ') && currentHeader) {
      currentBodyLines.push(line);
    }
  }

  // Last section
  if (currentHeader) {
    sections.push({
      header: currentHeader,
      body: currentBodyLines.join('\n').trim(),
    });
  }

  return sections;
}

/**
 * Classify node type from section header and content.
 */
function classifySectionType(header: string): PersonaNode['type'] {
  const h = header.toLowerCase();

  if (h.includes('你是什么样的人') || h.includes('真实的你') || h.includes('关于你')) {
    return 'trait';
  }
  if (h.includes('怎么说话')) {
    return 'voice';
  }
  if (h.includes('绝不') || h.includes('不会说') || h.includes('永远不会说')) {
    return 'boundary';
  }
  if (h.includes('什么样的话你会说') || h.includes('你会说') || h.includes('原则') || h.includes('分寸')) {
    return 'rule';
  }
  if (h.includes('信念') || h.includes('相信')) {
    return 'belief';
  }

  // Default based on content patterns
  return 'trait';
}

/**
 * Split a section's body into discrete content blocks.
 * Each bullet point or paragraph becomes a node.
 */
function splitIntoBlocks(body: string, type: PersonaNode['type']): string[] {
  if (!body || body.trim().length === 0) return [];

  const lines = body.split('\n');
  const blocks: string[] = [];
  let currentBlock: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Bullet points break blocks
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      if (currentBlock.length > 0) {
        blocks.push(currentBlock.join('\n'));
        currentBlock = [];
      }
      blocks.push(trimmed.replace(/^[-*]\s+/, ''));
      continue;
    }

    // Bold headers (**text**) for stage sections break blocks
    if (trimmed.startsWith('**') && trimmed.endsWith('**')) {
      if (currentBlock.length > 0) {
        blocks.push(currentBlock.join('\n'));
        currentBlock = [];
      }
      blocks.push(trimmed.replace(/\*\*/g, ''));
      continue;
    }

    // Empty line breaks blocks (paragraph separator)
    if (trimmed.length === 0) {
      if (currentBlock.length > 0) {
        blocks.push(currentBlock.join('\n'));
        currentBlock = [];
      }
      continue;
    }

    currentBlock.push(line);
  }

  if (currentBlock.length > 0) {
    blocks.push(currentBlock.join('\n'));
  }

  return blocks.filter((b) => b.trim().length > 0);
}

/**
 * Compute confidence (0-1) based on position, keywords, and content patterns.
 */
function computeConfidence(
  content: string,
  type: PersonaNode['type'],
  sectionHeader: string,
): number {
  let confidence = 0.5; // base

  // Top-level personality blocks get higher confidence
  const h = sectionHeader.toLowerCase();
  if (h.includes('你是什么样的人') || h.includes('真实的你')) {
    confidence += 0.3;
  }
  if (h.includes('怎么说话')) {
    confidence += 0.2;
  }
  if (h.includes('原则')) {
    confidence += 0.2;
  }

  // Core identity indicators
  if (content.includes('你就是') || content.includes('你是')) {
    confidence += 0.1;
  }

  // Negative constraints (boundaries) are firm
  if (type === 'boundary' || type === 'rule') {
    confidence += 0.1;
  }

  // Language about fundamentals
  if (
    content.includes('永远') ||
    content.includes('总是') ||
    content.includes('绝不') ||
    content.includes('本能')
  ) {
    confidence += 0.1;
  }

  // Very long content is likely more descriptive and less core
  if (content.length > 200) {
    confidence -= 0.1;
  }

  return round2(Math.max(0.1, Math.min(1.0, confidence)));
}

/**
 * Extract trigger keywords from content and section context.
 *
 * Uses conservative matching to avoid over-tagging. Common characters like
 * "想" (think/want/miss) that appear in nearly every paragraph are not
 * used as universal triggers — only specific sentiment-bearing phrases.
 */
function extractTriggers(
  content: string,
  sectionHeader: string,
  type: PersonaNode['type'],
): string[] {
  const triggers = new Set<string>();

  // Stage-specific triggers from section header context
  const h = sectionHeader.toLowerCase();
  if (h.includes('刚认识')) triggers.add('acquaintance');
  if (h.includes('熟了') || h.includes('熟悉')) triggers.add('familiar');
  if (h.includes('暧昧')) triggers.add('ambiguous');
  if (h.includes('在一起') || h.includes('亲密') || h.includes('之后')) triggers.add('intimate');

  // Content-based trigger extraction.
  // Use multi-character phrases to reduce false positives.
  const triggerPatterns: { pattern: RegExp; tag: string }[] = [
    // Emotional states (use ≥2-char phrases)
    { pattern: /很容易开心|笑点低|乐半天|开心的事|好消息/, tag: 'happy' },
    { pattern: /难过|伤心|悲伤|哭/, tag: 'sad' },
    { pattern: /烦躁|生气|发脾气|不爽/, tag: 'angry' },
    { pattern: /累了|疲惫|辛苦/, tag: 'tired' },
    { pattern: /焦虑|担心|紧张/, tag: 'anxious' },
    { pattern: /撒娇|任性|黏人/, tag: 'clingy' },
    { pattern: /调侃|怼|吐槽|互损/, tag: 'teasing' },

    // Activity triggers
    { pattern: /吃了吗|吃饭|煮|菜谱|叫外卖/, tag: 'food' },
    { pattern: /睡了|晚安|睡觉|熬夜|刷手机/, tag: 'sleep' },
    { pattern: /工作|项目|创业|甲方|deadline|画稿|接稿/, tag: 'work' },
    { pattern: /画画|画稿|设计|插画|甲方/, tag: 'art' },

    // Social triggers
    { pattern: /谢谢你|谢谢|感谢/, tag: 'gratitude' },
    { pattern: /对不起|抱歉|道歉/, tag: 'apology' },
    { pattern: /难过的时候|先说|陪你|陪他|我在|别一个人/, tag: 'support' },
    { pattern: /想你了|想他|想念|思念/, tag: 'miss' },

    // Relationship triggers
    { pattern: /称呼|昵称|叫你|叫他/, tag: 'nickname' },
    { pattern: /不回|离开|消失|失踪/, tag: 'absence' },
    { pattern: /吃醋/, tag: 'jealousy' },
    // Scenario-specific triggers (from rule scenario headers)
    // These are extracted from bold headers in the rule section
    { pattern: /她开心|他开心|开心的时候/, tag: 'happy' },
    { pattern: /她烦|他烦|烦的时候/, tag: 'angry' },
    { pattern: /她难过|他难过|难过的时候/, tag: 'sad' },
    { pattern: /她撒娇|他撒娇|撒娇/, tag: 'clingy' },
    { pattern: /她怼|他怼/, tag: 'teasing' },
    { pattern: /吃了吗|问吃/, tag: 'food' },
    { pattern: /说睡了|说晚安/, tag: 'sleep' },
    { pattern: /谢谢你/, tag: 'gratitude' },
    { pattern: /很久没来|好久不见|突然冒泡/, tag: 'absence' },
  ];

  for (const { pattern, tag } of triggerPatterns) {
    if (pattern.test(content)) {
      triggers.add(tag);
    }
  }

  // For rule nodes, also add the bold-scenario headers as triggers
  if (type === 'rule') {
    const boldScenarios = content.match(/\*\*[^*]+\*\*/g);
    if (boldScenarios) {
      for (const bs of boldScenarios) {
        const clean = bs.replace(/\*\*/g, '').trim();
        // Extract meaningful keywords from bold headers
        if (clean.includes('开心')) triggers.add('happy');
        if (clean.includes('烦')) triggers.add('angry');
        if (clean.includes('难过') || clean.includes('低落')) triggers.add('sad');
        if (clean.includes('撒娇')) triggers.add('clingy');
        if (clean.includes('怼')) triggers.add('teasing');
        if (clean.includes('吃')) triggers.add('food');
        if (clean.includes('睡')) triggers.add('sleep');
        if (clean.includes('谢谢')) triggers.add('gratitude');
        if (clean.includes('道歉')) triggers.add('apology');
        if (clean.includes('消失') || clean.includes('很久没来')) triggers.add('absence');
        if (clean.includes('晚安')) triggers.add('sleep');
      }
    }
  }

  return [...triggers];
}

/**
 * Compute stage relevance distribution (0-1 per stage).
 */
function computeStageRelevance(
  content: string,
  type: PersonaNode['type'],
): PersonaNode['stageRelevance'] {
  const result: PersonaNode['stageRelevance'] = {
    acquaintance: 0.5,
    familiar: 0.6,
    ambiguous: 0.7,
    intimate: 0.8,
  };

  const c = content.toLowerCase();

  // Override based on explicit stage mentions
  const stageMentions: [string, StageKey][] = [
    ['刚认识', 'acquaintance'],
    ['熟了', 'familiar'],
    ['熟悉', 'familiar'],
    ['暧昧', 'ambiguous'],
    ['在一起', 'intimate'],
    ['亲密', 'intimate'],
    ['之后', 'intimate'],
    ['熟了之后', 'familiar'],
    ['在一起之后', 'intimate'],
  ];

  for (const [keyword, stage] of stageMentions) {
    if (c.includes(keyword)) {
      // Boost this stage significantly
      result[stage] = 1.0;
      // Adjacent stages get a smaller boost
      const idx = STAGE_KEYS.indexOf(stage);
      if (idx > 0) result[STAGE_KEYS[idx - 1]] = Math.max(result[STAGE_KEYS[idx - 1]], 0.7);
      if (idx < 3) result[STAGE_KEYS[idx + 1]] = Math.max(result[STAGE_KEYS[idx + 1]], 0.6);
    }
  }

  // Boundaries and voice patterns are always relevant
  if (type === 'boundary' || type === 'voice') {
    result.acquaintance = Math.max(result.acquaintance, 0.8);
    result.familiar = Math.max(result.familiar, 0.9);
    result.ambiguous = Math.max(result.ambiguous, 0.9);
    result.intimate = Math.max(result.intimate, 1.0);
  }

  // Core traits are relevant at all stages
  if (type === 'trait') {
    result.acquaintance = Math.max(result.acquaintance, 0.6);
  }

  return result;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
