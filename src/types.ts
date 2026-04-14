// ============================================================
//  核心类型定义
// ============================================================

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'killed'
export type TaskType = 'research' | 'implement' | 'verify' | 'test' | 'review'

export interface TaskNotification {
  taskId: string
  status: TaskStatus
  summary: string
  result: string
  usage?: { total_tokens: number; tool_uses: number; duration_ms: number }
}

export interface Task {
  id: string
  type: TaskType
  description: string
  prompt: string
  status: TaskStatus
  assignedTo?: string
  dependsOn?: string[]
  result?: string
  createdAt: number
  updatedAt: number
}

export interface ToolCall {
  name: string
  input: Record<string, unknown>
}

export interface ToolResult {
  success: boolean
  output: string
  error?: string
}

export interface LLMMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface LLMResponse {
  content: string
  stopReason: string
  usage?: { inputTokens: number; outputTokens: number }
  toolCalls?: ToolCall[]
}

export type CoordinatorDecision =
  | { type: 'spawn'; task: Task; subagentType: 'worker' | 'researcher' }
  | { type: 'continue'; taskId: string; instruction: string }
  | { type: 'wait' }
  | { type: 'respond'; content: string }
  | { type: 'complete' }
