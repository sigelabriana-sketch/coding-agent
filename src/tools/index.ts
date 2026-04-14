// ============================================================
//  工具注册表
// ============================================================

import { BashTool } from './bash.js'
import { FileReadTool } from './file_read.js'
import { FileEditTool } from './file_edit.js'
import { FileWriteTool } from './file_write.js'
import type { ToolDefinition } from '../llm.js'

export interface Tool {
  name: string
  description: string
  definition: ToolDefinition
  execute(input: Record<string, unknown>): Promise<{ success: boolean; output: string; error?: string }>
}

class ToolRegistry {
  private tools = new Map<string, Tool>()

  register(tool: Tool) { this.tools.set(tool.name, tool) }
  get(name: string) { return this.tools.get(name) }
  getAll() { return Array.from(this.tools.values()) }
  getDefinitions() { return this.getAll().map(t => t.definition) }

  async execute(name: string, input: Record<string, unknown>) {
    const tool = this.get(name)
    if (!tool) return { success: false, output: '', error: `Unknown tool: ${name}` }
    try {
      return await tool.execute(input)
    } catch (e) {
      return { success: false, output: '', error: String(e) }
    }
  }
}

export const toolRegistry = new ToolRegistry()
toolRegistry.register(BashTool)
toolRegistry.register(FileReadTool)
toolRegistry.register(FileEditTool)
toolRegistry.register(FileWriteTool)
