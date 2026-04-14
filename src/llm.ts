// ============================================================
//  LLM API 调用层（MiniMax M2.7 代理 - Anthropic /v1/messages）
// ============================================================

import { API_CONFIG } from './config.js'
import type { LLMMessage, LLMResponse, ToolCall } from './types.js'

export interface ToolDefinition {
  name: string
  description: string
  input_schema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

export class LLMClient {
  private baseUrl: string
  private apiKey: string
  private model: string

  constructor() {
    this.baseUrl = API_CONFIG.baseUrl
    this.apiKey = API_CONFIG.apiKey
    this.model = API_CONFIG.model
  }

  async call(options: {
    messages: LLMMessage[]
    systemPrompt?: string
    maxTokens?: number
    temperature?: number
    tools?: ToolDefinition[]
  }): Promise<LLMResponse> {
    const {
      messages,
      systemPrompt,
      maxTokens = API_CONFIG.maxTokens,
      temperature = API_CONFIG.temperature,
      tools,
    } = options

    // Anthropic /v1/messages 格式
    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: Math.max(1, maxTokens),
      temperature,
    }

    // 构建 messages
    if (systemPrompt) {
      body.system = systemPrompt
      body.messages = messages
    } else {
      body.messages = messages
    }

    // Anthropic tools 格式
    if (tools && tools.length > 0) {
      body.tools = tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema,
      }))
    }

    const response = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`API Error ${response.status}: ${errorText}`)
    }

    const data = await response.json() as {
      content?: Array<{ type?: string; text?: string; name?: string; input?: Record<string, unknown> }>
      stop_reason?: string
      usage?: { input_tokens: number; output_tokens: number; total_tokens: number }
    }

    // 解析响应
    const textParts: string[] = []
    const toolCalls: ToolCall[] = []

    if (data.content) {
      for (const block of data.content) {
        if (block.type === 'text') {
          textParts.push(block.text || '')
        } else if (block.type === 'tool_use') {
          toolCalls.push({
            name: block.name || '',
            input: block.input || {},
          })
        }
      }
    }

    return {
      content: textParts.join(''),
      stopReason: data.stop_reason || 'end_turn',
      usage: data.usage ? {
        inputTokens: data.usage.input_tokens,
        outputTokens: data.usage.output_tokens,
        totalTokens: data.usage.total_tokens,
      } : undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    }
  }
}
