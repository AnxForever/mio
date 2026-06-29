import { existsSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { temporalStatePath } from './paths.js';
import { readTranscript } from './transcript.js';
import { writeFileSyncSafe } from './bank.js';

export type TemporalStateKind =
  | 'sleepy'
  | 'going_to_sleep'
  | 'busy'
  | 'away'
  | 'ongoing_task'
  | 'multi_day_arc'
  | 'user_requested_space'
  | 'mio_promised_space'
  | 'hungry'
  | 'eating'
  | 'distressed';

export type TemporalResolutionReason =
  | 'explicit_user_resolution'
  | 'user_reopened_chat'
  | 'expired';

export interface TemporalStateEntry {
  id: string;
  kind: TemporalStateKind;
  label: string;
  observedAt: string;
  expiresAt: string;
  evidence: string;
  confidence: number;
  sourceSessionId?: string;
  resolvedAt?: string;
  resolutionReason?: TemporalResolutionReason;
  resolutionEvidence?: string;
  resolutionEventId?: string;
}

export type TemporalStateEventType = 'detected' | 'resolved' | 'assistant_commitment';

export interface TemporalStateEvent {
  id: string;
  timestamp: string;
  sessionId: string;
  type: TemporalStateEventType;
  kind: TemporalStateKind;
  entryId: string;
  evidence: string;
  reason?: TemporalResolutionReason;
}

export interface TemporalStateFile {
  version: 1;
  sessionId: string;
  updatedAt: string;
  entries: TemporalStateEntry[];
  events: TemporalStateEvent[];
}

export interface TemporalTurnContext {
  now: string;
  localTime: string;
  dayPart: string;
  lastUserGapMs: number | null;
  lastAssistantGapMs: number | null;
  active: TemporalStateEntry[];
  expiredRecent: TemporalStateEntry[];
  resolvedRecent: TemporalStateEntry[];
}

export type TemporalEntryStatus =
  | 'current'
  | 'recently_resolved'
  | 'historical_only'
  | 'future_or_invalid';

export interface TemporalStateQuery {
  current: TemporalStateEntry[];
  recentlyResolved: TemporalStateEntry[];
  historicalOnly: TemporalStateEntry[];
  futureOrInvalid: TemporalStateEntry[];
}

interface DetectionRule {
  kind: TemporalStateKind;
  label: string;
  ttlMs: number;
  confidence: number;
  patterns: RegExp[];
  suppress?: RegExp;
}

interface ResolutionRule {
  kinds: TemporalStateKind[];
  patterns: RegExp[];
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const RECENT_EXPIRED_WINDOW_MS = 36 * HOUR;
const MAX_ENTRIES = 80;

const RULES: DetectionRule[] = [
  {
    kind: 'going_to_sleep',
    label: '准备睡觉/结束当天对话',
    ttlMs: 10 * HOUR,
    confidence: 0.9,
    patterns: [/晚安/, /先睡[了啦]*/, /睡觉[了啦]*/, /去睡[了啦]*/, /想睡觉/, /困.*睡/],
  },
  {
    kind: 'sleepy',
    label: '困/想睡',
    ttlMs: 4 * HOUR,
    confidence: 0.85,
    patterns: [/好困/, /困[了啦]?/, /困死/, /犯困/, /没睡好/, /熬夜/, /通宵/],
    suppress: /不困|没困|不是困/,
  },
  {
    kind: 'busy',
    label: '正在忙',
    ttlMs: 4 * HOUR,
    confidence: 0.8,
    patterns: [/在忙/, /还在忙/, /忙着/, /忙死/, /赶(工|稿|进度|项目)/, /开会/, /加班/, /优化你/],
    suppress: /不忙|忙完/,
  },
  {
    kind: 'ongoing_task',
    label: '正在处理一件事/任务',
    ttlMs: 8 * HOUR,
    confidence: 0.72,
    patterns: [/在(写|做|弄|处理|改|调|测).*(稿|代码|项目|作业|论文|方案|需求)/, /这两天.*(项目|论文|稿|代码|需求)/],
    suppress: /做完|写完|弄完|处理完|改完|测完/,
  },
  {
    kind: 'multi_day_arc',
    label: '多日事件/持续任务',
    ttlMs: 7 * DAY,
    confidence: 0.76,
    patterns: [
      /这(?:几天|两天|周|星期).*(?:一直|都|在)?.*(?:忙|赶|准备|处理|写|做|改|调|测).*(?:项目|论文|稿|代码|需求|发布|汇报|考试|面试)/,
      /最近(?:一直|都|在)?.*(?:忙|赶|准备|处理|写|做|改|调|测).*(?:项目|论文|稿|代码|需求|发布|汇报|考试|面试)/,
      /接下来(?:几天|一周|这周).*(?:忙|赶|准备|处理|写|做|改|调|测).*(?:项目|论文|稿|代码|需求|发布|汇报|考试|面试)/,
    ],
    suppress: /结束|做完|写完|弄完|处理完|改完|测完|交了|发完|汇报完|考完|面完/,
  },
  {
    kind: 'away',
    label: '暂时离开/稍后再聊',
    ttlMs: 2 * HOUR,
    confidence: 0.75,
    patterns: [/我先(忙|走|去|下了)/, /等会[儿]?聊/, /一会[儿]?再说/, /待会[儿]?/, /先不聊/],
  },
  {
    kind: 'user_requested_space',
    label: '用户请求暂时留出空间/少打扰',
    ttlMs: 12 * HOUR,
    confidence: 0.9,
    patterns: [/想静静/, /让我(一个人|自己)(待|静)[一会儿下]*/, /别打扰我/, /不要打扰我/, /先别找我/, /先不聊/, /给我点空间/],
  },
  {
    kind: 'hungry',
    label: '饿/还没吃',
    ttlMs: 2 * HOUR,
    confidence: 0.75,
    patterns: [/饿[了啦]?/, /还没吃/, /没吃饭/, /外卖.*没到/, /饭还没到/],
    suppress: /不饿|吃饱/,
  },
  {
    kind: 'eating',
    label: '正在吃饭/刚点餐',
    ttlMs: 2 * HOUR,
    confidence: 0.7,
    patterns: [/在吃/, /吃饭/, /点了外卖/, /刚点/, /准备吃/],
    suppress: /吃完/,
  },
  {
    kind: 'distressed',
    label: '情绪低落/压力中',
    ttlMs: 6 * HOUR,
    confidence: 0.8,
    patterns: [/撑不住/, /想哭/, /很崩/, /崩溃/, /难过/, /焦虑/, /脑子停不下来/, /压力.*大/],
  },
];

const RESOLUTION_RULES: ResolutionRule[] = [
  {
    kinds: ['sleepy', 'going_to_sleep'],
    patterns: [/不困[了啦]?/, /没那么困/, /睡醒[了啦]?/, /醒[了啦]/, /起床[了啦]?/],
  },
  {
    kinds: ['busy', 'away', 'ongoing_task', 'multi_day_arc'],
    patterns: [/不忙[了啦]?/, /忙完[了啦]?/, /(弄|做|搞|处理|优化)完[了啦]?/, /回来了/, /我回来了/, /回到/],
  },
  {
    kinds: ['multi_day_arc'],
    patterns: [/项目结束[了啦]?/, /论文(?:写完|交了)[了啦]?/, /需求(?:做完|交付)[了啦]?/, /发布(?:结束|发完)[了啦]?/, /汇报完[了啦]?/, /考试结束[了啦]?/, /面试结束[了啦]?/],
  },
  {
    kinds: ['hungry', 'eating'],
    patterns: [/不饿[了啦]?/, /吃完[了啦]?/, /吃饱[了啦]?/, /刚吃过/, /已经吃/],
  },
  {
    kinds: ['distressed'],
    patterns: [/好多[了啦]?/, /缓过来[了啦]?/, /没事[了啦]?/, /不难过[了啦]?/, /不焦虑[了啦]?/],
  },
];

export function readTemporalState(sessionId = 'default'): TemporalStateFile {
  const path = temporalStatePath(sessionId);
  try {
    if (!existsSync(path)) return defaultTemporalState(sessionId);
  const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<TemporalStateFile>;
    return {
      version: 1,
      sessionId,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date(0).toISOString(),
      entries: Array.isArray(parsed.entries) ? parsed.entries.filter(isTemporalEntry) : [],
      events: Array.isArray(parsed.events) ? parsed.events.filter(isTemporalEvent) : [],
    };
  } catch {
    return defaultTemporalState(sessionId);
  }
}

export function updateTemporalStateForTurn(
  sessionId: string,
  userText: string | undefined,
  now = new Date(),
): TemporalTurnContext {
  const state = readTemporalState(sessionId);
  const transcriptEntries = deriveTemporalEntriesFromTranscript(sessionId, now);
  const detections = attachTemporalSource(detectTemporalStates(userText ?? '', now), sessionId);
  const nowMs = now.getTime();
  const oldEntries = mergeTemporalEntries([...state.entries, ...transcriptEntries])
    .filter((entry) => new Date(entry.expiresAt).getTime() > nowMs - 7 * DAY);
  const explicitlyResolved = applyTemporalResolutions(oldEntries, userText ?? '', now);
  const resolvedEntries = applyReopenedChatResolution(
    explicitlyResolved,
    userText ?? '',
    now,
    detections.some((entry) => entry.kind === 'user_requested_space'),
  );
  const entriesBeforeEventIds = upsertDetections(resolvedEntries, detections).slice(-MAX_ENTRIES);
  const { entries, resolutionEvents } = attachResolutionEventIds(sessionId, oldEntries, entriesBeforeEventIds, now);
  const next: TemporalStateFile = {
    version: 1,
    sessionId,
    updatedAt: now.toISOString(),
    entries,
    events: appendTemporalEvents(state.events, [
      ...buildDetectionEvents(sessionId, oldEntries, entries, detections, now),
      ...resolutionEvents,
    ]),
  };
  writeTemporalState(sessionId, next);
  return buildTemporalTurnContext(sessionId, next, now);
}

export function observeAssistantTemporalCommitments(
  sessionId: string,
  assistantText: string,
  now = new Date(),
): TemporalStateEntry[] {
  const detections = attachTemporalSource(detectAssistantTemporalCommitments(assistantText, now), sessionId);
  if (detections.length === 0) return [];
  const state = readTemporalState(sessionId);
  const entries = upsertDetections(state.entries, detections).slice(-MAX_ENTRIES);
  const next: TemporalStateFile = {
    version: 1,
    sessionId,
    updatedAt: now.toISOString(),
    entries,
    events: appendTemporalEvents(
      state.events,
      detections.map((entry) => temporalEvent(sessionId, 'assistant_commitment', entry, entry.evidence, undefined, now)),
    ),
  };
  writeTemporalState(sessionId, next);
  return detections;
}

export function buildTemporalTurnContext(
  sessionId: string,
  state = readTemporalState(sessionId),
  now = new Date(),
): TemporalTurnContext {
  const nowMs = now.getTime();
  const query = queryTemporalState(state, now);
  const active = query.current
    .sort((a, b) => a.expiresAt.localeCompare(b.expiresAt));
  const expiredRecent = query.historicalOnly
    .filter((entry) => {
      const expiresAt = new Date(entry.expiresAt).getTime();
      return expiresAt <= nowMs && expiresAt > nowMs - RECENT_EXPIRED_WINDOW_MS;
    })
    .sort((a, b) => b.expiresAt.localeCompare(a.expiresAt))
    .slice(0, 6);
  const resolvedRecent = query.recentlyResolved
    .filter((entry) => {
      if (!entry.resolvedAt) return false;
      const resolvedAt = new Date(entry.resolvedAt).getTime();
      return !Number.isNaN(resolvedAt) && resolvedAt > nowMs - RECENT_EXPIRED_WINDOW_MS;
    })
    .sort((a, b) => String(b.resolvedAt).localeCompare(String(a.resolvedAt)))
    .slice(0, 6);
  const gaps = readConversationGaps(sessionId, now);
  return {
    now: now.toISOString(),
    localTime: formatLocalTime(now),
    dayPart: dayPart(now),
    lastUserGapMs: gaps.lastUserGapMs,
    lastAssistantGapMs: gaps.lastAssistantGapMs,
    active,
    expiredRecent,
    resolvedRecent,
  };
}

export function queryTemporalState(state: TemporalStateFile, now = new Date()): TemporalStateQuery {
  const grouped: TemporalStateQuery = {
    current: [],
    recentlyResolved: [],
    historicalOnly: [],
    futureOrInvalid: [],
  };
  for (const entry of state.entries) {
    switch (classifyTemporalStateEntry(entry, now)) {
      case 'current':
        grouped.current.push(entry);
        break;
      case 'recently_resolved':
        grouped.recentlyResolved.push(entry);
        break;
      case 'historical_only':
        grouped.historicalOnly.push(entry);
        break;
      case 'future_or_invalid':
        grouped.futureOrInvalid.push(entry);
        break;
    }
  }
  return grouped;
}

export function classifyTemporalStateEntry(entry: TemporalStateEntry, now = new Date()): TemporalEntryStatus {
  const nowMs = now.getTime();
  const observedAt = new Date(entry.observedAt).getTime();
  const expiresAt = new Date(entry.expiresAt).getTime();
  if (
    Number.isNaN(nowMs)
    || Number.isNaN(observedAt)
    || Number.isNaN(expiresAt)
    || observedAt > nowMs
  ) {
    return 'future_or_invalid';
  }

  if (entry.resolvedAt) {
    const resolvedAt = new Date(entry.resolvedAt).getTime();
    if (Number.isNaN(resolvedAt) || resolvedAt > nowMs) return 'future_or_invalid';
    if (resolvedAt > nowMs - RECENT_EXPIRED_WINDOW_MS) return 'recently_resolved';
    return 'historical_only';
  }

  if (expiresAt > nowMs) return 'current';
  return 'historical_only';
}

export function renderTemporalAwarenessContext(ctx: TemporalTurnContext): string {
  const lines = [
    '## 时间感',
    `现在：${ctx.localTime}（${ctx.dayPart}）`,
    `距离上一条用户消息：${formatGap(ctx.lastUserGapMs)}`,
    `距离 Mio 上次回复：${formatGap(ctx.lastAssistantGapMs)}`,
    '本轮输入是刚收到的当前消息；旧消息和旧状态必须按时间判断是否仍然有效。',
  ];

  if (ctx.active.length > 0) {
    lines.push('当前仍有效的短期状态：');
    for (const entry of ctx.active) {
      lines.push(`- ${entry.label}：${entry.evidence}（${formatRelativeTime(entry.observedAt, ctx.now)}观察，约${formatGapFromIso(ctx.now, entry.expiresAt)}后过期）`);
    }
  } else {
    lines.push('当前仍有效的短期状态：无明确状态。不要把过去的困、忙、饿、难过等当成现在。');
  }

  if (ctx.expiredRecent.length > 0) {
    lines.push('最近已过期、只能当历史背景的状态：');
    for (const entry of ctx.expiredRecent) {
      lines.push(`- ${entry.label}：${entry.evidence}（${formatRelativeTime(entry.observedAt, ctx.now)}观察，已过期）`);
    }
  }

  if (ctx.resolvedRecent.length > 0) {
    lines.push('最近已解决的短期状态/承诺：');
    for (const entry of ctx.resolvedRecent) {
      const reason = entry.resolutionReason === 'user_reopened_chat'
        ? '用户已经主动重新打开聊天'
        : '用户明确表示状态已解决';
      lines.push(`- ${entry.label}：${reason}；原证据 ${entry.evidence}`);
    }
  }

  lines.push('回复规则：如果状态已过期，只能说“昨晚/之前你说过…”，不能说“你不是还困/还忙/还没吃吗”。');
  lines.push('如果 Mio 之前承诺“不打扰/先安静”，而用户现在又发来消息，视为用户主动重新打开聊天；不要抱怨“不理我/不回我/刚说不打扰你就真不回”。');
  lines.push('如果当前没有有效短期状态，也不要用“忙完了？”“忙啥呢？”“醒了？”“还困？”“吃了吗？”这类预设式追问；改用中性的“你呢”“你现在怎么样”。');
  return lines.join('\n');
}

export function detectTemporalStates(text: string, now = new Date()): TemporalStateEntry[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const entries: TemporalStateEntry[] = [];
  for (const rule of RULES) {
    if (rule.suppress?.test(trimmed)) continue;
    if (!rule.patterns.some((pattern) => pattern.test(trimmed))) continue;
    const observedAt = now.toISOString();
    entries.push({
      id: `${rule.kind}-${now.getTime()}`,
      kind: rule.kind,
      label: rule.label,
      observedAt,
      expiresAt: new Date(now.getTime() + rule.ttlMs).toISOString(),
      evidence: quoteEvidence(trimmed),
      confidence: rule.confidence,
    });
  }
  return dedupeByKind(entries);
}

export function detectAssistantTemporalCommitments(text: string, now = new Date()): TemporalStateEntry[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (!/(不打扰你|先不打扰|不吵你|我先安静|你慢慢(弄|忙|来)|忙完再聊|等你忙完)/.test(trimmed)) return [];
  const observedAt = now.toISOString();
  return [{
    id: `mio_promised_space-${now.getTime()}`,
    kind: 'mio_promised_space',
    label: 'Mio 承诺暂时不打扰',
    observedAt,
    expiresAt: new Date(now.getTime() + 6 * HOUR).toISOString(),
    evidence: quoteAssistantEvidence(trimmed),
    confidence: 0.9,
  }];
}

export function applyTemporalResolutions(
  entries: TemporalStateEntry[],
  text: string,
  now = new Date(),
): TemporalStateEntry[] {
  const trimmed = text.trim();
  if (!trimmed) return entries;
  const matchedKinds = new Set<TemporalStateKind>();
  for (const rule of RESOLUTION_RULES) {
    if (!rule.patterns.some((pattern) => pattern.test(trimmed))) continue;
    for (const kind of rule.kinds) matchedKinds.add(kind);
  }
  if (matchedKinds.size === 0) return entries;
  const nowIso = now.toISOString();
  const nowMs = now.getTime();
  return entries.map((entry) => {
    if (!matchedKinds.has(entry.kind)) return entry;
    const expiresAtMs = new Date(entry.expiresAt).getTime();
    if (entry.resolvedAt || Number.isNaN(expiresAtMs) || expiresAtMs <= nowMs - RECENT_EXPIRED_WINDOW_MS) return entry;
    return resolveEntry(entry, nowIso, 'explicit_user_resolution', quoteEvidence(trimmed));
  });
}

function applyReopenedChatResolution(
  entries: TemporalStateEntry[],
  text: string,
  now: Date,
  hasNewSpaceRequest: boolean,
): TemporalStateEntry[] {
  const trimmed = text.trim();
  if (!trimmed || hasNewSpaceRequest) return entries;
  const nowMs = now.getTime();
  const nowIso = now.toISOString();
  return entries.map((entry) => {
    if (entry.kind !== 'mio_promised_space' && entry.kind !== 'user_requested_space') return entry;
    if (!isActiveEntry(entry, nowMs)) return entry;
    return resolveEntry(entry, nowIso, 'user_reopened_chat', quoteEvidence(trimmed));
  });
}

function writeTemporalState(sessionId: string, state: TemporalStateFile): void {
  const path = temporalStatePath(sessionId);
  writeFileSyncSafe(path, JSON.stringify(state, null, 2));
}

function defaultTemporalState(sessionId: string): TemporalStateFile {
  return { version: 1, sessionId, updatedAt: new Date(0).toISOString(), entries: [], events: [] };
}

function upsertDetections(entries: TemporalStateEntry[], detections: TemporalStateEntry[]): TemporalStateEntry[] {
  let next = [...entries];
  for (const detection of detections) {
    next = next.filter((entry) => entry.kind !== detection.kind);
    next.push(detection);
  }
  return next;
}

function deriveTemporalEntriesFromTranscript(sessionId: string, now: Date): TemporalStateEntry[] {
  const nowMs = now.getTime();
  let entries: TemporalStateEntry[] = [];
  const transcript = readTranscript(sessionId)
    .filter((entry) => (
      entry.type === 'message'
      && (entry.role === 'user' || entry.role === 'assistant')
      && typeof entry.content === 'string'
      && entry.timestamp
    ))
    .sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));

  for (const message of transcript) {
    const observedAt = new Date(String(message.timestamp));
    const observedAtMs = observedAt.getTime();
    if (Number.isNaN(observedAtMs)) continue;
    if (observedAtMs > nowMs) continue;
    if (observedAtMs < nowMs - 7 * DAY) continue;

    if (message.role === 'assistant') {
      entries = upsertDetections(
        entries,
        attachTemporalSource(detectAssistantTemporalCommitments(String(message.content), observedAt), sessionId),
      );
      continue;
    }

    const detections = attachTemporalSource(detectTemporalStates(String(message.content), observedAt), sessionId);
    entries = applyTemporalResolutions(entries, String(message.content), observedAt);
    entries = applyReopenedChatResolution(
      entries,
      String(message.content),
      observedAt,
      detections.some((entry) => entry.kind === 'user_requested_space'),
    );
    entries = upsertDetections(entries, detections);
  }

  return entries.filter((entry) => new Date(entry.expiresAt).getTime() > nowMs - 7 * DAY);
}

function mergeTemporalEntries(entries: TemporalStateEntry[]): TemporalStateEntry[] {
  const byId = new Map<string, TemporalStateEntry>();
  for (const entry of entries) {
    const existing = byId.get(entry.id);
    if (!existing) {
      byId.set(entry.id, entry);
      continue;
    }
    const existingExpiresAt = new Date(existing.expiresAt).getTime();
    const entryExpiresAt = new Date(entry.expiresAt).getTime();
    if (Number.isNaN(existingExpiresAt) || (!Number.isNaN(entryExpiresAt) && entryExpiresAt < existingExpiresAt)) {
      byId.set(entry.id, entry);
    }
  }
  return [...byId.values()].sort((a, b) => a.observedAt.localeCompare(b.observedAt));
}

function appendTemporalEvents(existing: TemporalStateEvent[], additions: TemporalStateEvent[]): TemporalStateEvent[] {
  const byId = new Map<string, TemporalStateEvent>();
  for (const event of [...existing, ...additions]) byId.set(event.id, event);
  return [...byId.values()]
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .slice(-200);
}

function buildDetectionEvents(
  sessionId: string,
  before: TemporalStateEntry[],
  after: TemporalStateEntry[],
  detections: TemporalStateEntry[],
  now: Date,
): TemporalStateEvent[] {
  const beforeById = new Map(before.map((entry) => [entry.id, entry]));
  const afterById = new Map(after.map((entry) => [entry.id, entry]));
  const events: TemporalStateEvent[] = [];
  for (const detection of detections) {
    if (!beforeById.has(detection.id)) {
      events.push(temporalEvent(sessionId, 'detected', detection, detection.evidence, undefined, now));
    }
  }
  return events;
}

function attachResolutionEventIds(
  sessionId: string,
  before: TemporalStateEntry[],
  after: TemporalStateEntry[],
  now: Date,
): { entries: TemporalStateEntry[]; resolutionEvents: TemporalStateEvent[] } {
  const beforeById = new Map(before.map((entry) => [entry.id, entry]));
  const resolutionEvents: TemporalStateEvent[] = [];
  const entries = after.map((entry) => {
    const previous = beforeById.get(entry.id);
    if (!previous || previous.resolvedAt || !entry.resolvedAt || entry.resolutionEventId) return entry;
    const event = temporalEvent(
      sessionId,
      'resolved',
      entry,
      entry.resolutionEvidence ?? entry.evidence,
      entry.resolutionReason,
      now,
    );
    resolutionEvents.push(event);
    return { ...entry, resolutionEventId: event.id };
  });
  return { entries, resolutionEvents };
}

function temporalEvent(
  sessionId: string,
  type: TemporalStateEventType,
  entry: TemporalStateEntry,
  evidence: string,
  reason: TemporalResolutionReason | undefined,
  now: Date,
): TemporalStateEvent {
  const timestamp = now.toISOString();
  return {
    id: `${timestamp}-${type}-${entry.id}-${hashLite(`${evidence}\n${reason ?? ''}`)}`,
    timestamp,
    sessionId,
    type,
    kind: entry.kind,
    entryId: entry.id,
    evidence,
    reason,
  };
}

function resolveEntry(
  entry: TemporalStateEntry,
  nowIso: string,
  reason: TemporalResolutionReason,
  evidence: string,
): TemporalStateEntry {
  return {
    ...entry,
    expiresAt: nowIso,
    resolvedAt: nowIso,
    resolutionReason: reason,
    resolutionEvidence: evidence,
  };
}

function attachTemporalSource(entries: TemporalStateEntry[], sessionId: string): TemporalStateEntry[] {
  return entries.map((entry) => ({ ...entry, sourceSessionId: entry.sourceSessionId ?? sessionId }));
}

function isActiveEntry(entry: TemporalStateEntry, nowMs: number): boolean {
  if (entry.resolvedAt) return false;
  const expiresAt = new Date(entry.expiresAt).getTime();
  return !Number.isNaN(expiresAt) && expiresAt > nowMs;
}

function dedupeByKind(entries: TemporalStateEntry[]): TemporalStateEntry[] {
  const seen = new Set<TemporalStateKind>();
  const out: TemporalStateEntry[] = [];
  for (const entry of entries) {
    if (seen.has(entry.kind)) continue;
    seen.add(entry.kind);
    out.push(entry);
  }
  return out;
}

function readConversationGaps(sessionId: string, now: Date): { lastUserGapMs: number | null; lastAssistantGapMs: number | null } {
  const entries = readTranscript(sessionId)
    .filter((entry) => entry.type === 'message' && entry.timestamp && (entry.role === 'user' || entry.role === 'assistant'));
  let lastUser: string | null = null;
  let lastAssistant: string | null = null;
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (!lastUser && entry.role === 'user') lastUser = entry.timestamp;
    if (!lastAssistant && entry.role === 'assistant') lastAssistant = entry.timestamp;
    if (lastUser && lastAssistant) break;
  }
  return {
    lastUserGapMs: gapMs(lastUser, now),
    lastAssistantGapMs: gapMs(lastAssistant, now),
  };
}

function gapMs(timestamp: string | null, now: Date): number | null {
  if (!timestamp) return null;
  const t = new Date(timestamp).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, now.getTime() - t);
}

function isTemporalEntry(value: unknown): value is TemporalStateEntry {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<TemporalStateEntry>;
  return typeof entry.kind === 'string'
    && typeof entry.label === 'string'
    && typeof entry.observedAt === 'string'
    && typeof entry.expiresAt === 'string'
    && typeof entry.evidence === 'string'
    && typeof entry.confidence === 'number';
}

function isTemporalEvent(value: unknown): value is TemporalStateEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as Partial<TemporalStateEvent>;
  return typeof event.id === 'string'
    && typeof event.timestamp === 'string'
    && typeof event.sessionId === 'string'
    && typeof event.type === 'string'
    && typeof event.kind === 'string'
    && typeof event.entryId === 'string'
    && typeof event.evidence === 'string';
}

function quoteEvidence(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return `用户说“${oneLine.length > 48 ? `${oneLine.slice(0, 47)}…` : oneLine}”`;
}

function quoteAssistantEvidence(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return `Mio 说“${oneLine.length > 48 ? `${oneLine.slice(0, 47)}…` : oneLine}”`;
}

function formatLocalTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function dayPart(date: Date): string {
  const h = date.getHours();
  if (h < 5) return '深夜';
  if (h < 11) return '早上';
  if (h < 14) return '中午';
  if (h < 18) return '下午';
  if (h < 23) return '晚上';
  return '深夜';
}

function formatGap(ms: number | null): string {
  if (ms === null) return '无记录';
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return '不到 1 分钟';
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = ms / HOUR;
  if (hours < 24) return `${round1(hours)} 小时`;
  return `${round1(hours / 24)} 天`;
}

function formatRelativeTime(fromIso: string, nowIso: string): string {
  const from = new Date(fromIso).getTime();
  const now = new Date(nowIso).getTime();
  if (Number.isNaN(from) || Number.isNaN(now)) return '之前';
  return `${formatGap(Math.max(0, now - from))}前`;
}

function formatGapFromIso(fromIso: string, toIso: string): string {
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  if (Number.isNaN(from) || Number.isNaN(to)) return '一段时间';
  return formatGap(Math.max(0, to - from));
}

function round1(n: number): string {
  return (Math.round(n * 10) / 10).toString();
}

function hashLite(text: string): string {
  let h = 0;
  for (const ch of text) h = ((h << 5) - h + ch.charCodeAt(0)) | 0;
  return Math.abs(h).toString(16).slice(0, 8);
}
