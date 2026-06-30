/**
 * Mio — 配置中心
 * 管理角色性别、名字、API key、语音开关等全局配置
 *
 * 持久化:
 * - 默认值取自 env vars + DEFAULT_CONFIG
 * - 用户通过 updateConfig() 做的修改会同步写到 `<dataDir>/config.json`
 * - 启动时按以下优先级回填:显式 env var > config.json > DEFAULT_CONFIG
 * - 注意:env var 永远是最高优先级(进程级显式意图,不应该被磁盘覆盖)
 */

import { existsSync, readFileSync } from 'node:fs';
import type { Gender, ProviderPreset, ProviderPresetConfig, ProviderResolution } from './types.js';
import { logger } from './utils/logger.js';
import { writeFileSyncSafe } from './memory/bank.js';

export type { Gender };

// ─── Provider presets ───

/**
 * All known provider presets.
 *
 * Each preset defines the API endpoint, auth scheme, default model, and
 * available models. When the user sets `provider: "auto"`, the factory
 * probes environment variables in the order listed here and picks the first
 * one with a key set.
 */
export const PROVIDER_PRESETS: Record<string, ProviderPresetConfig> = {
  anthropic: {
    name: 'anthropic',
    label: 'Anthropic (Claude)',
    baseUrl: 'https://api.anthropic.com/v1/messages',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    defaultModel: 'claude-sonnet-4-20250514',
    authHeader: 'x-api-key: ${apiKey}',
    supportsVision: true,
    supportsToolCalling: true,
    models: [
      { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
      { id: 'claude-opus-4-20250514', label: 'Claude Opus 4' },
      { id: 'claude-haiku-4-20250514', label: 'Claude Haiku 4' },
      { id: 'claude-fable-5', label: 'Claude Fable 5' },
    ],
  },
  openai: {
    name: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyEnv: 'OPENAI_API_KEY',
    defaultModel: 'gpt-4o',
    authHeader: 'Bearer ${apiKey}',
    supportsVision: true,
    supportsToolCalling: true,
    models: [
      { id: 'gpt-4o', label: 'GPT-4o' },
      { id: 'gpt-4o-mini', label: 'GPT-4o Mini' },
      { id: 'gpt-4.1', label: 'GPT-4.1' },
      { id: 'o4-mini', label: 'o4 Mini' },
    ],
  },
  deepseek: {
    name: 'deepseek',
    label: 'DeepSeek（深度求索）',
    baseUrl: 'https://api.deepseek.com/v1',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    defaultModel: 'deepseek-chat',
    authHeader: 'Bearer ${apiKey}',
    supportsVision: false,
    supportsToolCalling: true,
    models: [
      { id: 'deepseek-chat', label: 'DeepSeek V3' },
      { id: 'deepseek-reasoner', label: 'DeepSeek R1' },
    ],
  },
  moonshot: {
    name: 'moonshot',
    label: 'Moonshot / Kimi（月之暗面）',
    baseUrl: 'https://api.moonshot.cn/v1',
    apiKeyEnv: 'MOONSHOT_API_KEY',
    defaultModel: 'moonshot-v1-8k',
    authHeader: 'Bearer ${apiKey}',
    supportsVision: false,
    supportsToolCalling: true,
    models: [
      { id: 'moonshot-v1-8k', label: 'Moonshot v1 8K' },
      { id: 'moonshot-v1-32k', label: 'Moonshot v1 32K' },
      { id: 'moonshot-v1-128k', label: 'Moonshot v1 128K' },
      { id: 'kimi-latest', label: 'Kimi Latest' },
    ],
  },
  zhipu: {
    name: 'zhipu',
    label: 'Zhipu / GLM（智谱清言）',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    apiKeyEnv: 'ZHIPU_API_KEY',
    defaultModel: 'glm-4-flash',
    authHeader: 'Bearer ${apiKey}',
    supportsVision: true,
    supportsToolCalling: true,
    models: [
      { id: 'glm-4-flash', label: 'GLM-4 Flash（免费）' },
      { id: 'glm-4-plus', label: 'GLM-4 Plus' },
      { id: 'glm-4-air', label: 'GLM-4 Air' },
      { id: 'glm-4-long', label: 'GLM-4 Long (128K)' },
    ],
  },
  minimax: {
    name: 'minimax',
    label: 'MiniMax（稀宇科技）',
    baseUrl: 'https://api.minimax.chat/v1',
    apiKeyEnv: 'MINIMAX_API_KEY',
    defaultModel: 'MiniMax-M3',
    authHeader: 'Bearer ${apiKey}',
    supportsVision: true,
    supportsToolCalling: true,
    models: [
      { id: 'MiniMax-M3', label: 'MiniMax M3（最新）' },
      { id: 'MiniMax-M2.5', label: 'MiniMax M2.5' },
      { id: 'MiniMax-Text-01', label: 'MiniMax Text 01' },
      { id: 'abab6.5s-chat', label: 'abab6.5s Chat（旧）' },
    ],
  },
  hybgzs: {
    name: 'hybgzs',
    label: 'Gemini @ hybgzs（OpenAI 兼容代理）',
    baseUrl: 'https://ai.hybgzs.com/v1',
    apiKeyEnv: 'HYBGZS_API_KEY',
    defaultModel: 'gemini-2.5-flash',
    authHeader: 'Bearer ${apiKey}',
    supportsVision: true,
    supportsToolCalling: true,
    models: [
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    ],
  },
  qwen: {
    name: 'qwen',
    label: 'Qwen / 通义千问（阿里云）',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKeyEnv: 'DASHSCOPE_API_KEY',
    defaultModel: 'qwen-plus',
    authHeader: 'Bearer ${apiKey}',
    supportsVision: true,
    supportsToolCalling: true,
    models: [
      { id: 'qwen-max', label: 'Qwen Max' },
      { id: 'qwen-plus', label: 'Qwen Plus' },
      { id: 'qwen-turbo', label: 'Qwen Turbo' },
      { id: 'qwen3-235b-a22b', label: 'Qwen3 235B' },
    ],
  },
  doubao: {
    name: 'doubao',
    label: 'Doubao / 豆包（字节跳动）',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    apiKeyEnv: 'DOUBAO_API_KEY',
    defaultModel: 'doubao-pro-32k',
    authHeader: 'Bearer ${apiKey}',
    supportsVision: false,
    supportsToolCalling: true,
    models: [
      { id: 'doubao-pro-32k', label: 'Doubao Pro 32K' },
      { id: 'doubao-pro-128k', label: 'Doubao Pro 128K' },
      { id: 'doubao-lite-32k', label: 'Doubao Lite 32K' },
      { id: 'doubao-lite-128k', label: 'Doubao Lite 128K' },
    ],
  },
  siliconflow: {
    name: 'siliconflow',
    label: 'SiliconFlow（硅基流动）',
    baseUrl: 'https://api.siliconflow.cn/v1',
    apiKeyEnv: 'SILICONFLOW_API_KEY',
    defaultModel: 'deepseek-ai/DeepSeek-V3',
    authHeader: 'Bearer ${apiKey}',
    supportsVision: false,
    supportsToolCalling: true,
    models: [
      { id: 'deepseek-ai/DeepSeek-V3', label: 'DeepSeek V3 (托管)' },
      { id: 'deepseek-ai/DeepSeek-R1', label: 'DeepSeek R1 (托管)' },
      { id: 'Qwen/Qwen3-235B-A22B', label: 'Qwen3 235B (托管)' },
      { id: 'Qwen/Qwen2.5-72B-Instruct', label: 'Qwen2.5 72B' },
      { id: 'Pro/zai-org/GLM-4.7', label: 'GLM-4.7 (托管)' },
    ],
  },
  lora: {
    name: 'lora',
    label: 'Local LoRA Adapter',
    baseUrl: 'http://127.0.0.1:8000',
    apiKeyEnv: 'MIO_LORA_API_KEY',
    defaultModel: 'mio-lora-qwen7b',
    authHeader: 'Bearer ${apiKey}',
    supportsVision: false,
    supportsToolCalling: false,
    models: [{ id: 'mio-lora-qwen7b', label: 'Mio LoRA Qwen 7B' }],
  },
  mock: {
    name: 'mock',
    label: 'Mock（离线测试）',
    baseUrl: '',
    apiKeyEnv: '',
    defaultModel: 'mock',
    authHeader: '',
    supportsVision: false,
    supportsToolCalling: false,
    models: [{ id: 'mock', label: 'Mock' }],
  },
};

/**
 * Auto-detect order: probe env vars in this order; first one with a key wins.
 * 'anthropic' is first because it's the default for this project.
 */
const AUTO_DETECT_ORDER: ProviderPreset[] = [
  'anthropic',
  'deepseek',
  'moonshot',
  'zhipu',
  'minimax',
  'qwen',
  'doubao',
  'siliconflow',
  'lora',
  'openai',
];

/**
 * Resolve a provider preset. If 'auto', probe env vars.
 * Returns the resolved preset + apiKey + model, or null if nothing is available.
 */
export function resolveProvider(
  presetName: string,
  explicitModel?: string,
): ProviderResolution | null {
  if (presetName === 'auto') {
    for (const name of AUTO_DETECT_ORDER) {
      const cfg = PROVIDER_PRESETS[name];
      if (!cfg || !cfg.apiKeyEnv) continue;
      const key = process.env[cfg.apiKeyEnv];
      if (key && key.length > 0) {
        return {
          preset: cfg,
          apiKey: key,
          model: explicitModel || cfg.defaultModel,
        };
      }
    }
    // No keys found → fall back to mock
    return {
      preset: PROVIDER_PRESETS.mock,
      apiKey: '',
      model: 'mock',
    };
  }

  const cfg = PROVIDER_PRESETS[presetName];
  if (!cfg) {
    // Unknown preset → mock
    return {
      preset: PROVIDER_PRESETS.mock,
      apiKey: '',
      model: 'mock',
    };
  }

  if (presetName === 'mock') {
    return { preset: cfg, apiKey: '', model: 'mock' };
  }

  const key = cfg.apiKeyEnv ? (process.env[cfg.apiKeyEnv] ?? '') : '';
  if (!key) {
    // Preset specified but no key → still return the preset so the caller
    // can report a clear error instead of silently falling back to mock.
    return { preset: cfg, apiKey: '', model: explicitModel || cfg.defaultModel };
  }

  return {
    preset: cfg,
    apiKey: key,
    model: explicitModel || cfg.defaultModel,
  };
}

export interface MioConfig {
  /** 角色性别 */
  gender: Gender;
  /** 角色名字（显示用） */
  name: string;
  /** AI provider preset (auto = detect from env vars) */
  provider: ProviderPreset;
  /** Override base URL for the provider */
  providerBaseUrl?: string;
  /** 模型名 */
  model: string;
  /** API key (deprecated — prefer PROVIDER_API_KEY env vars) */
  apiKey: string | undefined;
  /** 语音输入开关 */
  voiceInput: boolean;
  /** 语音输出开关 */
  voiceOutput: boolean;
  /** STT 方案 */
  sttProvider: 'openai-whisper' | 'local';
  /** TTS 方案 */
  ttsProvider: 'edge-tts' | 'system';
  /** HTTP 服务器端口（0 = 不启动） */
  httpPort: number;
  /** 数据目录 */
  dataDir: string;
  /** 夜间整合 cron */
  nightlyCron: string;
  /** 主动消息开关 */
  proactiveEnabled: boolean;
  /** Server auth token (empty = no auth) */
  authToken?: string;
  /** Toggle emotional engine modules */
  features: {
    /** Ghost silence mechanism — Mio can choose not to reply */
    ghost: boolean;
    /** Multi-axis affinity (warmth/trust/intimacy/patience/tension) */
    multiAxisAffinity: boolean;
    /** Frustration/attachment tracking */
    frustrationTracking: boolean;
    /** Log prompt budget breakdown each turn */
    promptBudgetLog: boolean;
    /** Use independent model for compression summaries */
    independentSummarizer: boolean;
    /** Poisson-based smart proactive messaging scheduler */
    smartProactive: boolean;
    /** Multi-axis relationship (closeness/trust/neediness) */
    multiAxisRelationship: boolean;
    /** ACE memory reflector — quality check pass during nightly consolidation */
    aceReflector: boolean;
    /** Multi-model task router — route tasks to different models */
    modelRouter: boolean;
    /** Telegram notification — deliver proactive messages to Telegram */
    telegramNotify: boolean;
    /** Use XML context tags instead of Markdown headers for prompt sections */
    xmlContext: boolean;
    /** Split prompt into pre-history (light) and post-history (heavy) injection */
    postHistoryInjection: boolean;
    /** Lorebook triggered memory — keyword-triggered context fragments */
    lorebook: boolean;
    /** 3-Phase nightly consolidation (LIGHT → DEEP → REM) */
    threePhaseConsolidation: boolean;
    /** Procedural memory — learn "how to interact" patterns */
    proceduralMemory: boolean;
    /** Trait-state separation — decouple emotion into OCEAN/PAD/mood layers */
    traitStateSeparation: boolean;
    /** Adaptive History AFM — three-fidelity conversation history management */
    adaptiveHistory: boolean;
    /** LLM-as-Judge consistency check during nightly consolidation */
    llmJudge: boolean;
    /** Experience-to-trait feedback cycle during nightly consolidation */
    experienceTraitFeedback: boolean;
    /** Entity-relation lightweight graph for system prompt injection */
    entityRelationGraph: boolean;
    /** Dynamic few-shot learning from real conversations */
    dynamicFewShot: boolean;
    /** Personality driver — Mio has moods, initiative, and her own "life" */
    personalityDriver: boolean;
    /** Autonomous life engine — custom character life events, story arcs, crises */
    lifeEngine: boolean;
    /** IM pacing — 私聊里模拟"真人打字"：按长度延迟 + 把长回复分段成多条短消息 */
    imPacing: boolean;
    /** Provider fallback chain — on recoverable failure (network/5xx/429), retry with another provider that has an API key set */
    providerFallback: boolean;
  };
}

const DEFAULT_CONFIG: MioConfig = {
  gender: 'female',
  name: 'Mio',
  provider: 'auto',
  model: '',
  apiKey: undefined,
  voiceInput: false,
  voiceOutput: false,
  sttProvider: 'openai-whisper',
  ttsProvider: 'edge-tts',
  httpPort: 0,
  dataDir: '',
  nightlyCron: '30 21 * * *',
  proactiveEnabled: true,
  features: {
    ghost: true,
    multiAxisAffinity: true,
    multiAxisRelationship: true,
    frustrationTracking: true,
    promptBudgetLog: false,
    independentSummarizer: false,
    smartProactive: true,
    aceReflector: true,
    modelRouter: false,
    telegramNotify: !!process.env.MIO_TELEGRAM_BOT_TOKEN,
    xmlContext: true,
    postHistoryInjection: false,
    lorebook: true,
    threePhaseConsolidation: true,
    proceduralMemory: true,
    traitStateSeparation: true,
    adaptiveHistory: false,
    llmJudge: true,
    experienceTraitFeedback: true,
    entityRelationGraph: true,
    dynamicFewShot: true,
    personalityDriver: true,
    lifeEngine: false,
    imPacing: false,
    providerFallback: true,
  },
};

/**
 * Env-var overrides applied on top of DEFAULT_CONFIG at boot.
 * These are the only env vars that get baked into the config — every other
 * env var is read at use-site (e.g. ANTHROPIC_API_KEY, OPENAI_API_KEY, MIO_DIR).
 */
function envOverrides(): Partial<MioConfig> {
  const patch: Partial<MioConfig> = {};
  if (process.env.COLA_MODEL) patch.model = process.env.COLA_MODEL;
  if (process.env.MIO_PROVIDER) patch.provider = process.env.MIO_PROVIDER as ProviderPreset;
  if (process.env.MIO_PROVIDER_BASE_URL) patch.providerBaseUrl = process.env.MIO_PROVIDER_BASE_URL;
  if (process.env.MIO_LORA_BASE_URL) patch.providerBaseUrl = process.env.MIO_LORA_BASE_URL;
  if (process.env.MIO_AUTH_TOKEN) patch.authToken = process.env.MIO_AUTH_TOKEN;
  if (process.env.MIO_DIR) patch.dataDir = process.env.MIO_DIR;
  if (process.env.MIO_NIGHTLY_CRON) patch.nightlyCron = process.env.MIO_NIGHTLY_CRON;
  if (process.env.MIO_HTTP_PORT) {
    const p = parseInt(process.env.MIO_HTTP_PORT, 10);
    if (!isNaN(p)) patch.httpPort = p;
  }
  // Feature flags via env — collect then assign to avoid partial type issues
  const featureOverrides: Partial<MioConfig['features']> = {};
  if (process.env.MIO_FEATURE_GHOST) featureOverrides.ghost = process.env.MIO_FEATURE_GHOST === 'true';
  if (process.env.MIO_FEATURE_AFFINITY) featureOverrides.multiAxisAffinity = process.env.MIO_FEATURE_AFFINITY === 'true';
  if (process.env.MIO_FEATURE_MULTI_AXIS_RELATIONSHIP) featureOverrides.multiAxisRelationship = process.env.MIO_FEATURE_MULTI_AXIS_RELATIONSHIP === 'true';
  if (process.env.MIO_FEATURE_FRUSTRATION) featureOverrides.frustrationTracking = process.env.MIO_FEATURE_FRUSTRATION === 'true';
  if (process.env.MIO_FEATURE_BUDGET_LOG) featureOverrides.promptBudgetLog = process.env.MIO_FEATURE_BUDGET_LOG === 'true';
  if (process.env.MIO_FEATURE_INDEPENDENT_SUMMARIZER) featureOverrides.independentSummarizer = process.env.MIO_FEATURE_INDEPENDENT_SUMMARIZER === 'true';
  if (process.env.MIO_FEATURE_SMART_PROACTIVE) featureOverrides.smartProactive = process.env.MIO_FEATURE_SMART_PROACTIVE === 'true';
  if (process.env.MIO_FEATURE_ACE_REFLECTOR) featureOverrides.aceReflector = process.env.MIO_FEATURE_ACE_REFLECTOR === 'true';
  if (process.env.MIO_FEATURE_MODEL_ROUTER) featureOverrides.modelRouter = process.env.MIO_FEATURE_MODEL_ROUTER === 'true';
  if (process.env.MIO_FEATURE_PROVIDER_FALLBACK) featureOverrides.providerFallback = process.env.MIO_FEATURE_PROVIDER_FALLBACK === 'true';
  if (process.env.MIO_FEATURE_TELEGRAM_NOTIFY) featureOverrides.telegramNotify = process.env.MIO_FEATURE_TELEGRAM_NOTIFY === 'true';
  if (process.env.MIO_FEATURE_XML_CONTEXT) featureOverrides.xmlContext = process.env.MIO_FEATURE_XML_CONTEXT === 'true';
  if (process.env.MIO_FEATURE_POST_HISTORY) featureOverrides.postHistoryInjection = process.env.MIO_FEATURE_POST_HISTORY === 'true';
  if (process.env.MIO_FEATURE_LOREBOOK) featureOverrides.lorebook = process.env.MIO_FEATURE_LOREBOOK === 'true';
  if (process.env.MIO_FEATURE_3_PHASE_CONSOLIDATION) featureOverrides.threePhaseConsolidation = process.env.MIO_FEATURE_3_PHASE_CONSOLIDATION === 'true';
  if (process.env.MIO_FEATURE_PROCEDURAL_MEMORY) featureOverrides.proceduralMemory = process.env.MIO_FEATURE_PROCEDURAL_MEMORY === 'true';
  if (process.env.MIO_FEATURE_TRAIT_STATE) featureOverrides.traitStateSeparation = process.env.MIO_FEATURE_TRAIT_STATE === 'true';
  if (process.env.MIO_FEATURE_ADAPTIVE_HISTORY) featureOverrides.adaptiveHistory = process.env.MIO_FEATURE_ADAPTIVE_HISTORY === 'true';
  if (process.env.MIO_FEATURE_LLM_JUDGE) featureOverrides.llmJudge = process.env.MIO_FEATURE_LLM_JUDGE === 'true';
  if (process.env.MIO_FEATURE_EXPERIENCE_TRAIT) featureOverrides.experienceTraitFeedback = process.env.MIO_FEATURE_EXPERIENCE_TRAIT === 'true';
  if (process.env.MIO_FEATURE_ENTITY_GRAPH) featureOverrides.entityRelationGraph = process.env.MIO_FEATURE_ENTITY_GRAPH === 'true';
  if (process.env.MIO_FEATURE_DYNAMIC_FEWSHOT) featureOverrides.dynamicFewShot = process.env.MIO_FEATURE_DYNAMIC_FEWSHOT === 'true';
  if (process.env.MIO_FEATURE_LIFE_ENGINE) featureOverrides.lifeEngine = process.env.MIO_FEATURE_LIFE_ENGINE === 'true';
  if (process.env.MIO_FEATURE_IM_PACING) featureOverrides.imPacing = process.env.MIO_FEATURE_IM_PACING === 'true';
  if (Object.keys(featureOverrides).length > 0) {
    patch.features = { ...DEFAULT_CONFIG.features, ...featureOverrides } as MioConfig['features'];
  }
  return patch;
}

let currentConfig: MioConfig = buildInitialConfig();

/**
 * Resolve the data directory: env var MIO_DIR wins; else `<project>/data`.
 * Resolves to an absolute path (no `..` segments) so the persisted config
 * is human-readable.
 */
function resolveDataDir(): string {
  const raw = process.env.MIO_DIR || joinPath(import.meta.dirname ?? process.cwd(), '..', 'data');
  return resolveAbsolute(raw);
}

/**
 * Lightweight path resolution: turns `..` segments into real path moves.
 * Avoids importing `node:path` (which is fine but adds noise to the helper).
 */
function resolveAbsolute(p: string): string {
  const isAbs = p.startsWith('/');
  const parts = p.split('/').filter((s) => s.length > 0);
  const out: string[] = [];
  for (const part of parts) {
    if (part === '.') continue;
    if (part === '..') {
      out.pop();
      continue;
    }
    out.push(part);
  }
  return (isAbs ? '/' : '') + out.join('/');
}

export function getConfig(): MioConfig {
  return currentConfig;
}

/**
 * Merge a patch into the current config and persist to disk.
 *
 * Behavior:
 * - Updates the in-memory config.
 * - Writes the full config (minus the apiKey) to `<dataDir>/config.json` for
 *   human inspection. The apiKey is written too — this is a local-only
 *   data file, but if you want to keep it out of disk, set apiKey via env var.
 * - Does NOT write when dataDir is empty (during early bootstrap before
 *   paths are resolved). In that case the patch is held in memory and will
 *   be persisted on the next updateConfig() call once dataDir is known.
 */
export function updateConfig(patch: Partial<MioConfig>): MioConfig {
  currentConfig = { ...currentConfig, ...patch };
  if (currentConfig.dataDir) {
    try {
      persistConfig(currentConfig);
    } catch (err) {
      // Persistence failure shouldn't break the call — log and continue.
      // We deliberately swallow this; the in-memory config still works.
      logger.error('[config] failed to persist', { err: err instanceof Error ? err.message : String(err) });
    }
  }
  return currentConfig;
}

export function getDataDir(): string {
  if (currentConfig.dataDir) return currentConfig.dataDir;
  return resolveDataDir();
}

export function getModsDir(): string {
  return joinPath(import.meta.dirname ?? process.cwd(), '..', 'mods');
}

function joinPath(...parts: string[]): string {
  return parts.join('/').replace(/\/+/g, '/').replace(/\\/g, '/');
}

// ─── Persistence helpers ───

/**
 * Build the initial config without referring to currentConfig (TDZ-safe).
 *
 * Order:
 *  1. DEFAULT_CONFIG (defaults)
 *  2. envOverrides() (env vars — highest priority for boot-time intent)
 *  3. loadPersistedConfig() (user's saved changes from a previous run)
 *
 * The dataDir is computed inline because getDataDir() reads currentConfig.
 */
function buildInitialConfig(): MioConfig {
  const dataDir = resolveDataDir();
  const persisted = loadPersistedConfigFrom(dataDir);
  return {
    ...DEFAULT_CONFIG,
    ...persisted,
    ...envOverrides(),   // env always wins over persisted
    dataDir,
  };
}

function loadPersistedConfigFrom(dataDir: string): Partial<MioConfig> {
  const path = joinPath(dataDir, 'config.json');
  if (!existsSync(path)) return {};
  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<MioConfig>;
    // Strip any fields that aren't in MioConfig (forward-compat with old files).
    const allowed: (keyof MioConfig)[] = [
      'gender', 'name', 'provider', 'providerBaseUrl', 'model', 'apiKey',
      'voiceInput', 'voiceOutput', 'sttProvider', 'ttsProvider',
      'httpPort', 'dataDir', 'nightlyCron', 'proactiveEnabled', 'authToken', 'features',
    ];
    const result: Partial<MioConfig> = {};
    for (const k of allowed) {
      if (k === 'features') continue; // handled separately below
      if (parsed[k] !== undefined) (result as Record<string, unknown>)[k] = parsed[k];
    }
    // Merge persisted features with current defaults so new feature flags
    // (e.g. xmlContext, postHistoryInjection) don't break old persisted configs.
    if (parsed.features && typeof parsed.features === 'object') {
      (result as Record<string, unknown>).features = {
        ...DEFAULT_CONFIG.features,
        ...parsed.features,
      } as MioConfig['features'];
    }
    return result;
  } catch {
    // Corrupted config — return empty so we fall back to defaults.
    return {};
  }
}

function configPath(): string {
  return joinPath(getDataDir(), 'config.json');
}

function persistConfig(config: MioConfig): void {
  const path = configPath();
  // Strip secrets — API keys live in env vars, never on disk
  const safe = { ...config, apiKey: undefined, authToken: undefined };
  writeFileSyncSafe(path, JSON.stringify(safe, null, 2));
}
