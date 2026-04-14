// ============================================================
//  WorkerManager - Worker 生命周期管理
// ============================================================

import { LLMClient } from '../llm.js'
import { toolRegistry } from '../tools/index.js'
import { API_CONFIG } from '../config.js'
import type { Task, TaskNotification } from '../types.js'

export class WorkerManager {
  private llm: LLMClient
  private activeWorkers = new Map<string, { taskId: string; abort: AbortController }>()

  constructor() {
    this.llm = new LLMClient()
  }

  buildWorkerPrompt(task: Task, systemContext: string): string {
    const taskInstructions: Record<string, string> = {
      research: `You are in RESEARCH mode. Investigate the codebase.
- Use BashTool to run git log, find, grep as needed.
- Use FileReadTool to examine files.`,
      implement: `You are in IMPLEMENT mode. Write code.
- Use FileWriteTool to create new files.
- Use FileEditTool to modify existing files.`,
      verify: `You are in VERIFY mode. Test the implementation.`,
      test: `You are in TEST mode. Run the test suite.`,
      review: `You are in REVIEW mode. Review code quality.`,
    }

    return `${systemContext}

## Task
Type: ${task.type}
Description: ${task.description}

${taskInstructions[task.type] || taskInstructions.implement}

## Details
${task.prompt}

## Output
When done, respond with this EXACT XML format (include your task-id=${task.id}):
<task-notification>
<task-id>${task.id}</task-id>
<status>completed</status>
<summary>One line summary of what you did</summary>
<result>Details of what you accomplished</result>
</task-notification>`
  }

  async spawnWorker(task: Task, systemContext: string): Promise<TaskNotification> {
    console.log(`[WorkerManager] Spawning worker: ${task.id} (${task.type})`)

    const tools = toolRegistry.getDefinitions()

    try {
      // 第一次调用
      const r1 = await this.llm.call({
        messages: [{ role: 'user' as const, content: this.buildWorkerPrompt(task, systemContext) }],
        tools,
        maxTokens: API_CONFIG.maxTokensPerRequest,
      })

      // 如果没有工具调用，直接解析
      if (!r1.toolCalls?.length) {
        return this.parseNotification(task.id, r1.content)
      }

      // 执行所有工具调用
      const toolResults: Array<{ name: string; success: boolean; output: string; error?: string }> = []
      for (const tc of r1.toolCalls) {
        const result = await toolRegistry.execute(tc.name, tc.input)
        toolResults.push({ name: tc.name, ...result })
        console.log(`[WorkerManager] Tool ${tc.name}: ${result.success ? 'OK' : 'FAIL'}`)
      }

      // 检查是否所有工具都成功
      const allSuccess = toolResults.every(r => r.success)
      
      if (allSuccess) {
        // 所有工具都成功，直接构建成功响应，不依赖模型的自然语言
        const resultsSummary = toolResults.map(r => `${r.name}: ${r.output}`).join('\n')
        return {
          taskId: task.id,
          status: 'completed',
          summary: `Executed ${toolResults.length} tool(s) successfully`,
          result: resultsSummary,
        }
      } else {
        // 有工具失败，反馈给模型尝试恢复
        const failureMsg = toolResults.map(r => `${r.name}: ${r.error || r.output}`).join('\n')
        const r2 = await this.llm.call({
          messages: [{
            role: 'user' as const,
            content: `Some tools failed:\n${failureMsg}\n\nFix the errors or report the failure with XML:\n<task-notification>\n<task-id>${task.id}</task-id>\n<status>failed</status>\n<summary>Error summary</summary>\n<result>Error details</result>\n</task-notification>`,
          }],
          tools,
          maxTokens: 500,
        })
        return this.parseNotification(task.id, r2.content)
      }
    } catch (e) {
      return { taskId: task.id, status: 'failed', summary: String(e), result: String(e) }
    }
  }

  stopWorker(taskId: string): void {
    const w = this.activeWorkers.get(taskId)
    if (w) { w.abort.abort(); this.activeWorkers.delete(taskId) }
  }

  private parseNotification(taskId: string, content: string): TaskNotification {
    const s = content.match(/<status>([^<]+)<\/status>/)?.[1] as TaskNotification['status'] | undefined
    return {
      taskId,
      status: s || 'completed',
      summary: content.match(/<summary>([^<]+)<\/summary>/)?.[1] || 'No summary',
      result: content.match(/<result>([\s\S]+?)<\/result>/)?.[1] || content.slice(0, 300),
    }
  }

  getActiveCount(): number { return this.activeWorkers.size }
}
