// tools/registry.ts — 工具注册框架（适配自 cola-companion，使用 Mio 类型）
// 关键差异：ToolCall 使用 .input（非 .arguments），ToolResult 使用 .output（非 .result）

import type { ToolDef, ToolHandler, RegisteredTool, SessionContext, ToolCall, ToolResult } from '../types.js';

/**
 * ToolRegistry — 工具注册表与执行器
 */
export class ToolRegistry {
  private tools = new Map<string, RegisteredTool>();

  /** 注册工具 */
  register(def: ToolDef, handler: ToolHandler): void {
    if (this.tools.has(def.name)) {
      throw new Error(`Duplicate tool name: "${def.name}"`);
    }
    this.tools.set(def.name, { ...def, handler });
  }

  /** 批量注册 */
  registerAll(entries: { def: ToolDef; handler: ToolHandler }[]): void {
    for (const e of entries) this.register(e.def, e.handler);
  }

  /** 获取工具定义列表（传给 AI provider 的） */
  listDefs(names?: string[]): ToolDef[] {
    const all = Array.from(this.tools.values());
    if (!names) return all.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
    return all.filter((t) => names.includes(t.name)).map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
  }

  /** 按名称过滤（支持 customToolsMode: replace/additive） */
  filter(names: string[], mode: 'replace' | 'additive' = 'replace', baseNames?: string[]): ToolDef[] {
    if (mode === 'additive') {
      const base = baseNames ?? [];
      const merged = [...new Set([...base, ...names])];
      return this.listDefs(merged);
    }
    return this.listDefs(names);
  }

  /** 执行工具调用 — 使用 call.input 和返回 result.output */
  async execute(call: ToolCall, ctx: SessionContext): Promise<ToolResult> {
    const tool = this.tools.get(call.name);
    if (!tool) {
      return { id: call.id, name: call.name, output: `Tool not found: ${call.name}`, isError: true };
    }
    try {
      const output = await tool.handler(call.input, ctx);
      return { id: call.id, name: call.name, output };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { id: call.id, name: call.name, output: `Tool error: ${msg}`, isError: true };
    }
  }

  /** 是否注册 */
  has(name: string): boolean {
    return this.tools.has(name);
  }
}

/** 全局工具注册表单例 */
let _registry: ToolRegistry | null = null;
export function toolRegistry(): ToolRegistry {
  if (!_registry) _registry = new ToolRegistry();
  return _registry;
}

/** 工具结果转文本（供 message 历史） — output 已是 string */
export function toolResultToText(r: ToolResult): string {
  return r.output;
}
