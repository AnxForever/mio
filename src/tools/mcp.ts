/**
 * Mio — MCP Tool Bridge
 *
 * Registers tools from external MCP servers into Mio's tool registry.
 * When the LLM calls an MCP tool, execution is routed through the
 * MCP client to the external server.
 */

import { getAllMcpTools, callMcpTool, isMcpTool } from '../mcp/client.js';
import { logger } from '../utils/logger.js';

export interface McpToolContext {
  name: string;
  serverName: string;
  args: Record<string, unknown>;
}

/**
 * Parse an MCP tool name into its components.
 */
export function parseMcpToolName(fullName: string): { serverName: string; toolName: string } | null {
  const match = fullName.match(/^mcp_(.+?)__(.+)$/);
  if (!match) return null;
  return { serverName: match[1], toolName: match[2] };
}

/**
 * Register all MCP tools and their handlers into the tool registry.
 * Idempotent — MCP tools are named with a `mcp_<server>__` prefix
 * to avoid collisions with built-in tools.
 */
export function registerMcpTools(
  registry: {
    register: (def: { name: string; description: string; inputSchema: Record<string, unknown> }, handler: (args: Record<string, unknown>) => Promise<string>) => void;
    listDefs: () => Array<{ name: string }>;
  },
): void {
  const tools = getAllMcpTools();
  if (tools.length === 0) return;

  for (const tool of tools) {
    registry.register(
      {
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema as Record<string, unknown>,
      },
      async (args: Record<string, unknown>) => {
        logger.info('[mcp] tool called', { tool: tool.name, args: JSON.stringify(args).slice(0, 200) });
        try {
          const result = await callMcpTool(tool.name, args);
          return result;
        } catch (err) {
          return `[MCP error] ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    );
  }

  logger.info(`[mcp] registered ${tools.length} MCP tools into registry`);
}
