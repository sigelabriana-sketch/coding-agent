// ============================================================
//  MCPBridge - MCP 工具桥接
//  连接外部 MCP 服务器，将工具暴露给 Agent
// ============================================================

import { spawn, ChildProcess } from 'child_process'
import { toolRegistry, type Tool } from '../tools/index.js'
import type { ToolDefinition } from '../llm.js'

interface McpTool {
  name: string
  description?: string
  inputSchema: Record<string, unknown>
}

interface McpServerConfig {
  command: string
  args?: string[]
  env?: Record<string, string>
}

// MCP JSON-RPC message types
interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: number | string
  method: string
  params?: Record<string, unknown>
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: number | string
  result?: unknown
  error?: { code: number; message: string }
}

export class McpBridge {
  private servers = new Map<string, {
    process: ChildProcess
    tools: Map<string, McpTool>
    requestId: number
    pendingRequests: Map<number | string, { resolve: (r: unknown) => void; reject: (e: Error) => void }>
  }>()

  // 注册 MCP 服务器
  async addServer(name: string, config: McpServerConfig): Promise<void> {
    const { command, args = [], env = {} } = config

    const proc = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    })

    const ctx = {
      process: proc,
      tools: new Map(),
      requestId: 0,
      pendingRequests: new Map(),
    }

    // 监听 MCP 消息
    let buffer = ''
    proc.stdout?.on('data', (data: Buffer) => {
      buffer += data.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        if (line.trim()) {
          this.handleMcpMessage(name, JSON.parse(line))
        }
      }
    })

    proc.stderr?.on('data', (data: Buffer) => {
      console.error(`[MCP ${name}] stderr:`, data.toString())
    })

    // 初始化：发送 initialize 请求
    const initialized = await this.sendRequest(name, {
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        clientInfo: { name: 'coding-agent', version: '0.1.0' },
      },
    })

    // 通知服务器客户端已初始化
    await this.sendNotification(name, { method: 'notifications/initialized' })

    // 获取可用工具列表
    const toolsResult = await this.sendRequest(name, { method: 'tools/list' })
    const tools = (toolsResult as { tools?: McpTool[] })?.tools || []
    for (const tool of tools) {
      ctx.tools.set(tool.name, tool)
      // 注册到工具表
      toolRegistry.register(this.createMcpToolWrapper(name, tool))
    }

    this.servers.set(name, ctx)
    console.log(`[McpBridge] Server "${name}" connected with ${tools.length} tools`)
  }

  // 移除 MCP 服务器
  removeServer(name: string): void {
    const ctx = this.servers.get(name)
    if (ctx) {
      ctx.process.kill()
      // 从注册表移除该服务器的工具
      for (const toolName of ctx.tools.keys()) {
        // 工具注册表不支持移除，这里记录一下即可
      }
      this.servers.delete(name)
    }
  }

  // 发送 JSON-RPC 请求（带响应）
  private sendRequest(serverName: string, req: Omit<JsonRpcRequest, 'jsonrpc' | 'id'>): Promise<unknown> {
    const ctx = this.servers.get(serverName)
    if (!ctx) throw new Error(`MCP server "${serverName}" not found`)

    const id = ++ctx.requestId
    const request: JsonRpcRequest = { jsonrpc: '2.0', id, ...req }

    return new Promise((resolve, reject) => {
      ctx.pendingRequests.set(id, { resolve, reject })
      ctx.process.stdin?.write(JSON.stringify(request) + '\n')

      // 超时 30s
      setTimeout(() => {
        if (ctx.pendingRequests.has(id)) {
          ctx.pendingRequests.delete(id)
          reject(new Error(`MCP request ${id} timed out`))
        }
      }, 30000)
    })
  }

  // 发送 JSON-RPC 通知（无响应）
  private sendNotification(serverName: string, req: Omit<JsonRpcRequest, 'jsonrpc' | 'id'>): void {
    const ctx = this.servers.get(serverName)
    if (!ctx) return
    const request: JsonRpcRequest = { jsonrpc: '2.0', id: -1, ...req }
    ctx.process.stdin?.write(JSON.stringify(request) + '\n')
  }

  // 处理 MCP 响应
  private handleMcpMessage(serverName: string, msg: JsonRpcResponse | { method: string; params?: unknown }): void {
    const ctx = this.servers.get(serverName)
    if (!ctx) return

    // 响应类消息
    if ('id' in msg && msg.id !== -1) {
      const pending = ctx.pendingRequests.get(msg.id)
      if (pending) {
        ctx.pendingRequests.delete(msg.id)
        if ('error' in msg && msg.error) {
          pending.reject(new Error(msg.error.message))
        } else {
          pending.resolve('result' in msg ? msg.result : undefined)
        }
      }
      return
    }

    // 通知类消息（tool_use 等）
    if ('method' in msg && msg.method === 'tools/call') {
      const params = (msg as { method: string; params: { name: string; arguments: Record<string, unknown> } }).params
      this.handleMcpToolCall(serverName, params.name, params.arguments)
    }
  }

  // 处理 MCP 工具调用
  private async handleMcpToolCall(serverName: string, toolName: string, args: Record<string, unknown>): Promise<void> {
    // 通过工具注册表执行
    const result = await toolRegistry.execute(toolName, args)
    // 发送结果回 MCP 服务器
    await this.sendRequest(serverName, {
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: args,
        result: result,
      },
    })
  }

  // 创建 MCP 工具的注册包装器
  private createMcpToolWrapper(serverName: string, tool: McpTool): Tool {
    return {
      name: tool.name,
      description: tool.description || `MCP tool: ${tool.name}`,
      definition: {
        name: tool.name,
        description: tool.description || `MCP tool from ${serverName}`,
        input_schema: {
          type: 'object',
          properties: tool.inputSchema.properties || {},
          required: tool.inputSchema.required || [],
        },
      },
      async execute(input: Record<string, unknown>) {
        // 通过 MCP 服务器执行
        try {
          const result = await this.sendRequest(serverName, {
            method: 'tools/call',
            params: { name: tool.name, arguments: input },
          })
          return { success: true, output: JSON.stringify(result) }
        } catch (e) {
          return { success: false, output: '', error: String(e) }
        }
      },
    }
  }

  getServerTools(serverName: string): string[] {
    return Array.from(this.servers.get(serverName)?.tools.keys() || [])
  }

  listServers(): string[] {
    return Array.from(this.servers.keys())
  }
}

// 模拟 MCP 服务器连接（MCP 工具桥接的简化实现）
// 实际使用时通过 addServer 添加真实 MCP 服务器
export const mcpBridge = new McpBridge()
