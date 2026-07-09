/**
 * Mio — MCP Client (Model Context Protocol)
 *
 * Connects to external MCP servers via SSE (Server-Sent Events) transport.
 * Enables Mio to use external tools during chat: web search, image generation,
 * voice synthesis, external memory, etc.
 *
 * Protocol: JSON-RPC 2.0 over SSE (https://modelcontextprotocol.io)
 *
 * Lifecycle:
 *   1. connect(serverUrl) → POST initialize → SSE stream
 *   2. listTools() → fetch tools/list → ToolDef[]
 *   3. callTool(name, args) → POST tools/call → result
 *
 * Tools from MCP servers are merged into Mio's tool registry at chat time,
 * appearing alongside built-in tools (session management, emotion tracking, etc.).
 */

import { logger } from '../utils/logger.js';
import type { ToolDef } from '../types.js';

// ─── Types ───

export interface McpServerConfig {
  /** Display name for the server (shown in logs / UI). */
  name: string;
  /** SSE endpoint URL (e.g. "http://localhost:3001/sse"). */
  url: string;
  /** Optional auth token sent as Bearer. */
  token?: string;
  /** Auto-connect on agent startup. */
  autoConnect?: boolean;
  /** Disabled servers are skipped. */
  enabled?: boolean;
}

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

interface McpToolDef {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

// ─── MCP Client ───

class McpConnection {
  readonly config: McpServerConfig;
  private messageEndpoint: string | null = null;
  private requestId = 0;
  private connected = false;
  private tools: ToolDef[] = [];

  constructor(config: McpServerConfig) {
    this.config = config;
  }

  get isConnected(): boolean { return this.connected; }
  get serverName(): string { return this.config.name; }
  get toolDefs(): ToolDef[] { return this.tools; }

  /**
   * Connect to the MCP server.
   * 1. POST initialize → get session
   * 2. Open SSE stream for notifications
   */
  async connect(): Promise<void> {
    if (this.connected) return;
    const { url, token } = this.config;

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
      };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      // Initialize session
      const initRes = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: ++this.requestId,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'mio', version: '0.6.0' },
          },
        }),
      });

      if (!initRes.ok) {
        throw new Error(`MCP initialize failed: HTTP ${initRes.status}`);
      }

      const initData = await initRes.json() as JsonRpcResponse;
      if (initData.error) {
        throw new Error(`MCP initialize error: ${initData.error.message}`);
      }

      // Extract message endpoint from response headers (SSE-style)
      const mcpsId = initRes.headers.get('mcp-session-id');
      // For SSE transport, the message endpoint is same URL with session
      this.messageEndpoint = url;

      this.connected = true;
      logger.info(`[mcp] connected to ${this.config.name}`, {
        url,
        sessionId: mcpsId ?? 'none',
      });

      // Fetch available tools
      await this.refreshTools();
    } catch (err) {
      logger.warn(`[mcp] failed to connect to ${this.config.name}`, {
        error: err instanceof Error ? err.message : String(err),
      });
      this.connected = false;
    }
  }

  /**
   * Refresh the tool list from the server.
   */
  async refreshTools(): Promise<ToolDef[]> {
    if (!this.connected || !this.messageEndpoint) return [];

    try {
      const res = await fetch(this.messageEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.token ? { 'Authorization': `Bearer ${this.config.token}` } : {}),
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: ++this.requestId,
          method: 'tools/list',
        }),
      });

      const data = await res.json() as JsonRpcResponse;
      if (data.error) {
        logger.warn(`[mcp] tools/list failed for ${this.config.name}: ${data.error.message}`);
        return [];
      }

      const tools = (data.result as { tools?: McpToolDef[] })?.tools ?? [];
      this.tools = tools.map((t) => ({
        name: `mcp_${this.config.name}__${t.name}`,
        description: t.description ?? `MCP tool: ${t.name} (from ${this.config.name})`,
        inputSchema: (t.inputSchema ?? {
          type: 'object',
          properties: {},
        }) as ToolDef['inputSchema'],
      }));

      logger.info(`[mcp] ${this.config.name}: ${this.tools.length} tools available`);
      return this.tools;
    } catch (err) {
      logger.warn(`[mcp] tools/list error for ${this.config.name}: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }

  /**
   * Call a tool on the MCP server.
   *
   * Includes timeout (default 30s), structured error recovery messages
   * that help the LLM understand and retry, and connection health checks.
   */
  async callTool(
    toolName: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<string> {
    if (!this.connected || !this.messageEndpoint) {
      return jsonError(
        'connection_lost',
        `MCP server "${this.config.name}" is not connected. Suggest retrying or using an alternative.`,
      );
    }

    const originalName = toolName.replace(`mcp_${this.config.name}__`, '');
    const timeoutMs = 30_000;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      // Forward external abort signal
      if (signal) {
        signal.addEventListener('abort', () => controller.abort());
      }

      const res = await fetch(this.messageEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.token ? { 'Authorization': `Bearer ${this.config.token}` } : {}),
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: ++this.requestId,
          method: 'tools/call',
          params: { name: originalName, arguments: args },
        }),
        signal: controller.signal,
      }).finally(() => clearTimeout(timeoutId));

      const data = await res.json() as JsonRpcResponse;

      if (data.error) {
        const code = data.error.code;
        if (code === -32601) {
          return jsonError('tool_not_found', `Tool "${originalName}" not found on server "${this.config.name}". It may have been removed.`);
        }
        if (code === -32602) {
          return jsonError('invalid_params', `Invalid parameters for "${originalName}": ${data.error.message}. Check the input schema and retry.`);
        }
        return jsonError('tool_error', data.error.message);
      }

      const result = data.result as { content?: Array<{ type: string; text?: string }> };
      if (result?.content) {
        return result.content.map((c) => c.text ?? '').join('\n');
      }
      return JSON.stringify(data.result, null, 2);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return jsonError(
          'timeout',
          `Tool "${originalName}" timed out after ${timeoutMs / 1000}s. The server may be overloaded. Retry with simpler parameters or try later.`,
        );
      }
      return jsonError('network_error', err instanceof Error ? err.message : String(err));
    }
  }

  /** Disconnect from the server. */
  disconnect(): void {
    this.connected = false;
    this.messageEndpoint = null;
    this.tools = [];
  }
}

// ─── Registry ───

const connections = new Map<string, McpConnection>();

/** Load MCP server configs from environment. */
function loadMcpConfigs(): McpServerConfig[] {
  const servers: McpServerConfig[] = [];
  // MIO_MCP_SERVERS = name1@url1,name2@url2
  const raw = process.env.MIO_MCP_SERVERS;
  if (!raw) return servers;

  for (const entry of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
    // Format: name@url or name@url@token
    const parts = entry.split('@');
    if (parts.length >= 2) {
      servers.push({
        name: parts[0].trim(),
        url: parts.slice(1, -1).join('@') || parts[1].trim(),
        token: parts.length >= 3 ? parts[parts.length - 1].trim() : undefined,
        autoConnect: true,
        enabled: true,
      });
    }
  }
  return servers;
}

/**
 * Connect to all configured MCP servers.
 * Called once at agent startup. Non-blocking — failed connections
 * are logged but don't prevent the agent from starting.
 */
export async function connectAllMcpServers(): Promise<void> {
  const configs = loadMcpConfigs();
  if (configs.length === 0) {
    logger.info('[mcp] no MCP servers configured (set MIO_MCP_SERVERS)');
    return;
  }

  const results = await Promise.allSettled(
    configs
      .filter((c) => c.enabled !== false)
      .map(async (config) => {
        const conn = new McpConnection(config);
        await conn.connect();
        connections.set(config.name, conn);
      }),
  );

  const succeeded = results.filter((r) => r.status === 'fulfilled').length;
  logger.info(`[mcp] connected to ${succeeded}/${configs.length} servers`);
}

/**
 * Get all available MCP tools (from all connected servers).
 */
export function getAllMcpTools(): ToolDef[] {
  const tools: ToolDef[] = [];
  for (const conn of connections.values()) {
    tools.push(...conn.toolDefs);
  }
  return tools;
}

/**
 * Call an MCP tool by its full name (mcp_<server>__<tool>).
 */
export async function callMcpTool(
  fullName: string,
  args: Record<string, unknown>,
): Promise<string> {
  // Parse: mcp_<serverName>__<toolName>
  const match = fullName.match(/^mcp_(.+?)__(.+)$/);
  if (!match) return `[MCP] invalid tool name: ${fullName}`;

  const serverName = match[1];
  const conn = connections.get(serverName);
  if (!conn) return `[MCP] server "${serverName}" not found or not connected`;

  return conn.callTool(fullName, args);
}

/**
 * Check if a tool name is an MCP tool.
 */
export function isMcpTool(name: string): boolean {
  return name.startsWith('mcp_');
}

/**
 * Format an error as structured JSON so the LLM can parse and recover.
 * Error codes: timeout / connection_lost / tool_not_found / invalid_params / tool_error / network_error
 */
function jsonError(code: string, message: string): string {
  return JSON.stringify({ error: true, code, message });
}

/**
 * Disconnect all MCP servers.
 */
export function disconnectAllMcpServers(): void {
  for (const conn of connections.values()) {
    conn.disconnect();
  }
  connections.clear();
}
