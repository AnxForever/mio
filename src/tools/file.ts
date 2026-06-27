// tools/file.ts — 通用文件工具 read/write/edit/find/bash（适配自 cola-companion）

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname, isAbsolute, relative, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { getDataDir } from '../config.js';
import type { ToolDef, ToolHandler } from '../types.js';

// ─── Path safety ───

/** Directories that file tools are allowed to access. */
function allowedDirs(): string[] {
  return [...new Set([getDataDir(), process.cwd()].map((dir) => resolve(dir)))];
}

/** Resolve a path and verify it's within allowed directories. Returns null if blocked. */
function safeResolve(rawPath: string): string | null {
  const resolved = resolve(rawPath);
  for (const dir of allowedDirs()) {
    const rel = relative(dir, resolved);
    if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) {
      return resolved;
    }
  }
  return null;
}

const READ_DEF: ToolDef = {
  name: 'read',
  description: 'Read the contents of a file. Supports text files. Returns the file content as text.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute or relative path to the file to read.' },
      offset: { type: 'number', description: 'Line number to start reading from (1-indexed).' },
      limit: { type: 'number', description: 'Number of lines to read.' },
    },
    required: ['path'],
  },
};

const READ_HANDLER: ToolHandler = async (args) => {
  const { path, offset, limit } = args as { path: string; offset?: number; limit?: number };
  const safePath = safeResolve(path);
  if (!safePath) return `Access denied: "${path}" is outside allowed directories`;
  if (!existsSync(safePath)) return `File not found: ${path}`;
  const content = readFileSync(safePath, 'utf-8');
  const lines = content.split('\n');
  const start = (offset ?? 1) - 1;
  const end = limit ? start + limit : lines.length;
  return lines.slice(start, end).join('\n');
};

const WRITE_DEF: ToolDef = {
  name: 'write',
  description: 'Write content to a file. Creates parent directories if needed. Overwrites existing content.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Absolute or relative path to the file to write.' },
      content: { type: 'string', description: 'The content to write to the file.' },
    },
    required: ['path', 'content'],
  },
};

const WRITE_HANDLER: ToolHandler = async (args) => {
  const { path, content } = args as { path: string; content: string };
  const safePath = safeResolve(path);
  if (!safePath) return `Access denied: "${path}" is outside allowed directories`;
  mkdirSync(dirname(safePath), { recursive: true });
  writeFileSync(safePath, content, 'utf-8');
  return `Wrote ${content.length} chars to ${path}`;
};

const EDIT_DEF: ToolDef = {
  name: 'edit',
  description: 'Perform exact string replacement in a file. old_string must match exactly (including whitespace).',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Path to the file to edit.' },
      old_string: { type: 'string', description: 'The exact text to replace.' },
      new_string: { type: 'string', description: 'The text to replace it with.' },
    },
    required: ['path', 'old_string', 'new_string'],
  },
};

const EDIT_HANDLER: ToolHandler = async (args) => {
  const { path, old_string, new_string } = args as { path: string; old_string: string; new_string: string };
  const safePath = safeResolve(path);
  if (!safePath) return `Access denied: "${path}" is outside allowed directories`;
  if (!existsSync(safePath)) return `File not found: ${path}`;
  const content = readFileSync(safePath, 'utf-8');
  if (!content.includes(old_string)) return `old_string not found in ${path}`;
  const updated = content.replace(old_string, new_string);
  writeFileSync(safePath, updated, 'utf-8');
  return `Edited ${path}: replaced ${old_string.length} chars`;
};

const FIND_DEF: ToolDef = {
  name: 'find',
  description: 'List files in a directory tree. Returns relative file paths.',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Directory to search in.' },
      pattern: { type: 'string', description: 'Glob pattern to match (e.g. "*.md").' },
    },
    required: ['path'],
  },
};

const FIND_HANDLER: ToolHandler = async (args) => {
  const { path, pattern } = args as { path: string; pattern?: string };
  const safePath = safeResolve(path);
  if (!safePath) return `Access denied: "${path}" is outside allowed directories`;
  if (!existsSync(safePath)) return `Directory not found: ${path}`;
  const results: string[] = [];
  const walk = (dir: string) => {
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        if (e.name.startsWith('.') || e.name === 'node_modules') continue;
        const full = join(dir, e.name);
        const rel = relative(safePath, full);
        if (e.isDirectory()) walk(full);
        else if (!pattern || matchGlob(e.name, pattern)) results.push(rel);
      }
    } catch { /* ignore */ }
  };
  walk(safePath);
  return results.length ? results.join('\n') : 'No files found';
};

function matchGlob(name: string, pattern: string): boolean {
  const re = pattern.replace(/\./g, '\\.').replace(/\*/g, '.*');
  return new RegExp(`^${re}$`).test(name);
}

const BASH_DEF: ToolDef = {
  name: 'bash',
  description: 'Execute a restricted read-only shell command. Returns stdout.',
  inputSchema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The shell command to execute.' },
      cwd: { type: 'string', description: 'Working directory.' },
    },
    required: ['command'],
  },
};

/**
 * Read-only commands allowed in bash tool.
 *
 * Keep this deliberately narrower than a developer shell. The tool is exposed
 * to the model, so commands that can execute code, install packages, mutate git
 * state, or leak environment secrets are not allowed by default.
 */
const READ_ONLY_COMMANDS = new Set([
  'ls', 'cat', 'head', 'tail', 'wc', 'find', 'grep', 'pwd', 'which',
  'date', 'df', 'du', 'sort', 'uniq', 'pgrep', 'ps',
]);

const READ_ONLY_GIT_SUBCOMMANDS = new Set([
  'status', 'diff', 'show', 'log', 'branch', 'rev-parse', 'ls-files', 'grep', 'describe',
]);

function tokenizeCommand(command: string): string[] {
  return command.trim().split(/\s+/).filter(Boolean);
}

function validateBashCommand(command: string, cwd?: string): string | null {
  const trimmed = command.trim();
  if (!trimmed) return 'Command is empty';

  // execSync runs through a shell. Disallow shell composition entirely so a
  // permitted first token cannot hide a second mutating command.
  if (/[;&|`<>$\\\n\r]/.test(trimmed)) {
    return 'Shell control operators, redirection, interpolation, and escapes are not allowed';
  }

  const tokens = tokenizeCommand(trimmed);
  const cmdName = tokens[0]!;
  if (cmdName === 'git') {
    const subcommand = tokens[1];
    if (!subcommand || !READ_ONLY_GIT_SUBCOMMANDS.has(subcommand)) {
      return `Git subcommand "${subcommand ?? '(none)'}" not allowed. Allowed: ${[...READ_ONLY_GIT_SUBCOMMANDS].sort().join(', ')}`;
    }
    if (tokens.some((t) => t === '--output' || t.startsWith('--output=') || t === '-o')) {
      return 'Git output-writing options are not allowed';
    }
  } else if (!READ_ONLY_COMMANDS.has(cmdName)) {
    return `Command "${cmdName}" not allowed. Allowed: ${[...READ_ONLY_COMMANDS, 'git'].sort().join(', ')}`;
  }

  if (cmdName === 'find' && tokens.some((t) => t === '-exec' || t === '-delete')) {
    return 'find -exec and -delete are not allowed';
  }

  for (const token of tokens.slice(1)) {
    const unquoted = token.replace(/^['"]|['"]$/g, '');
    if (/(^|\/)\.\.(\/|$)/.test(unquoted)) {
      return 'Parent-directory path traversal is not allowed';
    }
    if (unquoted.startsWith('/') && safeResolve(unquoted) === null) {
      return `Absolute path outside allowed directories is not allowed: ${unquoted}`;
    }
  }

  if (cwd && safeResolve(cwd) === null) {
    return `Access denied: cwd "${cwd}" is outside allowed directories`;
  }

  return null;
}

const BASH_HANDLER: ToolHandler = async (args, ctx) => {
  const { command, cwd } = args as { command: string; cwd?: string };
  const validationError = validateBashCommand(command, cwd);
  if (validationError) return validationError;
  const safeCwd = safeResolve(cwd ?? ctx.colaDir);
  if (!safeCwd) return `Access denied: cwd "${cwd ?? ctx.colaDir}" is outside allowed directories`;
  try {
    const out = execSync(command, {
      cwd: safeCwd,
      encoding: 'utf-8',
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    });
    return out || '(no output)';
  } catch (err) {
    const e = err as { stderr?: string; message: string };
    return e.stderr || e.message;
  }
};

/** 注册所有通用文件工具 */
export function registerFileTools(registry: { register: (def: ToolDef, handler: ToolHandler) => void }): void {
  registry.register(READ_DEF, READ_HANDLER);
  registry.register(WRITE_DEF, WRITE_HANDLER);
  registry.register(EDIT_DEF, EDIT_HANDLER);
  registry.register(FIND_DEF, FIND_HANDLER);
  registry.register(BASH_DEF, BASH_HANDLER);
}

/** 默认通用工具名列表 */
export const FILE_TOOL_NAMES = ['read', 'write', 'edit', 'find', 'bash'];
