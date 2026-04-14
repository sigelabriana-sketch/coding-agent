// ============================================================
//  LLM API 调用层（通过 MiniMax M2.7 代理）
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

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: maxTokens,
      temperature,
      messages,
      // 禁用 thinking，减少 token 消耗
      thinking: { type: 'disabled' },
    }

    if (systemPrompt) {
      // 张宁修复了代理，现在支持 system 角色
      body.messages = [
        { role: 'system' as const, content: systemPrompt },
        ...messages,
      ]
    } else {
      body.messages = messages
    }

    if (tools && tools.length > 0) {
      body.tools = tools
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
      content?: Array<{ type: string; text?: string; name?: string; input?: Record<string, unknown> }>
      stop_reason?: string
      usage?: { input_tokens: number; output_tokens: number }
    }

    // 解析响应内容（跳过 thinking 块）
    const content: string[] = []
    const toolCalls: ToolCall[] = []

    if (data.content) {
      for (const block of data.content) {
        if (block.type === 'text') {
          const text = (block as { type: 'text'; text?: string }).text || ''
          content.push(text.trim())
        } else if (block.type === 'tool_use') {
          toolCalls.push({
            name: (block as { type: 'tool_use'; name?: string }).name || '',
            input: (block as { type: 'tool_use'; input?: Record<string, unknown> }).input || {},
          })
        }
        // 忽略 thinking 块
      }
    }

    return {
      content: content.join('\n'),
      stopReason: data.stop_reason || 'unknown',
      usage: data.usage ? {
        inputTokens: data.usage.input_tokens,
        outputTokens: data.usage.output_tokens,
      } : undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    }
  }
}
