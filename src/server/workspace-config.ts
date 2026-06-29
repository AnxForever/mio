/**
 * Editable admin-console workspace configuration.
 *
 * This is intentionally a configuration surface, not a runtime plugin/MCP
 * loader. The UI can now persist desired skills, plugin settings, roles, and
 * MCP server definitions without pretending those capabilities are active.
 */

import { workspaceConfigPath } from '../memory/paths.js';
import { readFileSyncSafe, writeFileSyncSafe } from '../memory/bank.js';
import { logger } from '../utils/logger.js';

export interface WorkspacePersonaConfig {
  activeRole: string;
  mode: 'base' | 'deep';
  notes: string;
}

export interface WorkspaceRoleConfig {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
}

export interface WorkspaceSkillConfig {
  id: string;
  name: string;
  description: string;
  source: 'builtin' | 'external';
  enabled: boolean;
  status: 'ready' | 'partial' | 'planned';
}

export interface WorkspacePluginConfig {
  id: string;
  name: string;
  description: string;
  builtin: boolean;
  enabled: boolean;
  config: Record<string, unknown>;
}

export interface WorkspaceMcpConfig {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  command?: string;
  url?: string;
  tools: string[];
  status: 'configured' | 'planned' | 'disabled';
}

export interface WorkspaceWechatChannelConfig {
  enabled: boolean;
  entryUrl: string;
  qrImageUrl: string;
  testerCopy: string;
}

export interface WorkspaceChannelConfig {
  wechat: WorkspaceWechatChannelConfig;
}

export interface WorkspaceConfig {
  version: 1;
  updatedAt: string;
  persona: WorkspacePersonaConfig;
  roles: WorkspaceRoleConfig[];
  skills: WorkspaceSkillConfig[];
  plugins: WorkspacePluginConfig[];
  mcp: WorkspaceMcpConfig[];
  channels: WorkspaceChannelConfig;
}

export type WorkspaceConfigPatch = Partial<Omit<WorkspaceConfig, 'version' | 'updatedAt'>>;

const DEFAULT_WORKSPACE_CONFIG: WorkspaceConfig = {
  version: 1,
  updatedAt: new Date(0).toISOString(),
  persona: {
    activeRole: 'female',
    mode: 'base',
    notes: '',
  },
  roles: [
    {
      id: 'female',
      name: 'Mio - she',
      description: 'Default companion persona backed by mods/female/soul.md.',
      enabled: true,
    },
    {
      id: 'male',
      name: 'Mio - he',
      description: 'Default companion persona backed by mods/male/soul.md.',
      enabled: true,
    },
  ],
  skills: [
    {
      id: 'persona',
      name: 'Persona editing',
      description: 'Edit soul, persona mode, and role files through Studio.',
      source: 'builtin',
      enabled: true,
      status: 'ready',
    },
    {
      id: 'memory',
      name: 'Memory review',
      description: 'Review, confirm, edit, or delete long-term memory items.',
      source: 'builtin',
      enabled: true,
      status: 'ready',
    },
    {
      id: 'notify',
      name: 'Notification channels',
      description: 'Read configured notification channels and send tests.',
      source: 'builtin',
      enabled: true,
      status: 'partial',
    },
    {
      id: 'external-skills',
      name: 'External skill library',
      description: 'Reserved for future skill enumeration and install APIs.',
      source: 'external',
      enabled: false,
      status: 'planned',
    },
  ],
  plugins: [
    {
      id: 'ghost',
      name: 'Ghost silence',
      description: 'Controls low-necessity replies and silence pacing.',
      builtin: true,
      enabled: true,
      config: {},
    },
    {
      id: 'affinity',
      name: 'Affinity',
      description: 'Maintains warmth, trust, tension, and related axes.',
      builtin: true,
      enabled: true,
      config: {},
    },
    {
      id: 'pad',
      name: 'PAD emotion',
      description: 'Pleasure, arousal, dominance emotional state model.',
      builtin: true,
      enabled: true,
      config: {},
    },
    {
      id: 'frustration',
      name: 'Frustration',
      description: 'Tracks frustration, patience, and attachment signals.',
      builtin: true,
      enabled: true,
      config: {},
    },
  ],
  mcp: [
    {
      id: 'filesystem',
      name: 'Filesystem',
      description: 'Planned auditable local file MCP server definition.',
      enabled: false,
      tools: [],
      status: 'planned',
    },
    {
      id: 'browser',
      name: 'Browser automation',
      description: 'Planned browser automation server with tool approvals.',
      enabled: false,
      tools: [],
      status: 'planned',
    },
    {
      id: 'search',
      name: 'Web search',
      description: 'Planned search/fetch server with citation audit trail.',
      enabled: false,
      tools: [],
      status: 'planned',
    },
  ],
  channels: {
    wechat: {
      enabled: true,
      entryUrl: '',
      qrImageUrl: '',
      testerCopy: '扫码进入微信机器人，直接发消息就可以试用 Mio。请不要发送敏感隐私内容，测试对话可能用于调试体验。',
    },
  },
};

function cloneDefault(): WorkspaceConfig {
  return JSON.parse(JSON.stringify(DEFAULT_WORKSPACE_CONFIG)) as WorkspaceConfig;
}

function normalizeConfig(raw: unknown): WorkspaceConfig {
  const base = cloneDefault();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...base, updatedAt: new Date().toISOString() };
  }

  const input = raw as Partial<WorkspaceConfig>;
  return {
    version: 1,
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : new Date().toISOString(),
    persona: {
      ...base.persona,
      ...(input.persona && typeof input.persona === 'object' ? input.persona : {}),
    },
    roles: Array.isArray(input.roles) ? input.roles : base.roles,
    skills: Array.isArray(input.skills) ? input.skills : base.skills,
    plugins: Array.isArray(input.plugins) ? input.plugins : base.plugins,
    mcp: Array.isArray(input.mcp) ? input.mcp : base.mcp,
    channels: {
      ...base.channels,
      ...(input.channels && typeof input.channels === 'object' ? input.channels : {}),
      wechat: {
        ...base.channels.wechat,
        ...(input.channels?.wechat && typeof input.channels.wechat === 'object' ? input.channels.wechat : {}),
      },
    },
  };
}

export function readWorkspaceConfig(): WorkspaceConfig {
  const raw = readFileSyncSafe(workspaceConfigPath(), '');
  if (!raw.trim()) return normalizeConfig(null);

  try {
    return normalizeConfig(JSON.parse(raw));
  } catch (err) {
    logger.warn('workspace config unreadable; using defaults', {
      path: workspaceConfigPath(),
      error: err instanceof Error ? err.message : String(err),
    });
    return normalizeConfig(null);
  }
}

export function writeWorkspaceConfig(config: WorkspaceConfig): WorkspaceConfig {
  const normalized = normalizeConfig({
    ...config,
    version: 1,
    updatedAt: new Date().toISOString(),
  });
  writeFileSyncSafe(workspaceConfigPath(), `${JSON.stringify(normalized, null, 2)}\n`);
  return normalized;
}

export function updateWorkspaceConfig(patch: WorkspaceConfigPatch): WorkspaceConfig {
  const current = readWorkspaceConfig();
  return writeWorkspaceConfig({
    ...current,
    persona: patch.persona ? { ...current.persona, ...patch.persona } : current.persona,
    roles: patch.roles ?? current.roles,
    skills: patch.skills ?? current.skills,
    plugins: patch.plugins ?? current.plugins,
    mcp: patch.mcp ?? current.mcp,
    channels: patch.channels ? { ...current.channels, ...patch.channels } : current.channels,
  });
}
