// ============================================================
//  WorkerPool - 并行 Worker 执行池
//  支持多个 Worker 同时运行，通过 FileLockManager 协调文件访问
// ============================================================

import { LLMClient } from '../llm.js'
import { toolRegistry } from '../tools/index.js'
import { FileLockManager } from '../storage/FileLockManager.js'
import { API_CONFIG } from '../config.js'
import type { Task, TaskNotification } from '../types.js'

export class WorkerPool {
  private llm: LLMClient
  private lockManager: FileLockManager
  private running = new Map<string, {
    task: Task
    abort: AbortController
    promise: Promise<TaskNotification>
  }>()

  constructor() {
    this.llm = new LLMClient()
    this.lockManager = new FileLockManager()
  }

  // 启动 Worker（可并行）
  async runWorker(task: Task, systemContext: string): Promise<TaskNotification> {
    if (this.running.has(task.id)) {
      return this.running.get(task.id)!.promise
    }

    const abort = new AbortController()

    // 分析任务涉及的文件，决定是否需要锁
    const filesInTask = task.prompt ? this.extractFilesFromPrompt(task.prompt) : []

    // 如果是写任务，先请求文件锁
    const isWriteTask = task.type === 'implement' || task.type === 'verify'
    if (isWriteTask && filesInTask.length > 0) {
      const lockResult = this.lockManager.requestLock(filesInTask, task.id)
      if (!lockResult.granted) {
        return {
          taskId: task.id,
          status: 'failed',
          summary: 'Blocked by file lock',
          result: `Cannot acquire locks: ${lockResult.blockedBy}`,
        }
      }
    }

    console.log(`[WorkerPool] Starting worker: ${task.id} (${task.type}) ${isWriteTask ? '[writing]' : '[reading]'}`)

    const promise = this.executeWorker(task, systemContext)
    this.running.set(task.id, { task, abort, promise })

    try {
      const result = await promise
      // 释放锁
      if (isWriteTask && filesInTask.length > 0) {
        const released = this.lockManager.releaseLock(task.id)
        if (released.length > 0) console.log(`[WorkerPool] Released locks: ${released.join(', ')}`)
      }
      return result
    } finally {
      this.running.delete(task.id)
    }
  }

  // 停止单个 Worker
  stopWorker(taskId: string): void {
    const worker = this.running.get(taskId)
    if (worker) {
      worker.abort.abort()
      this.running.delete(taskId)
      this.lockManager.releaseLock(taskId)
      console.log(`[WorkerPool] Stopped worker: ${taskId}`)
    }
  }

  // 停止所有 Worker
  stopAll(): void {
    for (const [taskId] of this.running) {
      this.stopWorker(taskId)
    }
  }

  // 获取当前运行中的 Worker 数量
  getRunningCount(): number {
    return this.running.size
  }

  // 获取锁状态
  getLockStatus(): Record<string, string> {
    return this.lockManager.getStatus()
  }

  // 从 prompt 中提取文件路径（简单正则匹配）
  private extractFilesFromPrompt(prompt: string): string[] {
    const files: string[] = []
    const patterns = [
      /src\/[\w/.-]+/g,
      /[\w-]+\.(ts|js|tsx|jsx|py|go|rs)/g,
      /\/[\w/.-]+\.(ts|js|tsx|jsx|py|go|rs)/g,
    ]
    for (const pattern of patterns) {
      const matches = prompt.match(pattern)
      if (matches) files.push(...matches)
    }
    return [...new Set(files)]
  }

  // 执行单个 Worker（多轮对话循环）
  private async executeWorker(task: Task, systemContext: string): Promise<TaskNotification> {
    const tools = toolRegistry.getDefinitions()

    const modeInstructions: Record<string, string> = {
      research: `You are in RESEARCH mode.
- Use BashTool to explore: ls, find, grep, cat
- Use FileReadTool to read files
- Report specific findings with file paths and line numbers`,
      implement: `You are in IMPLEMENT mode.
- Use FileWriteTool to create new files
- Use FileEditTool to modify existing files
- After writing, verify the file content`,
      verify: `You are in VERIFY mode.
- Use BashTool to run tests, linters, type checkers
- Use FileReadTool to examine outputs
- Report pass/fail with specific evidence`,
      test: `You are in TEST mode.
- Run test suites with BashTool
- Report test results in detail`,
      review: `You are in REVIEW mode.
- Use BashTool and FileReadTool to analyze code
- Suggest specific improvements with examples`,
    }

    const taskInstructions = `${systemContext}

## Task
Type: ${task.type}
Description: ${task.description}

${modeInstructions[task.type] || modeInstructions.implement}

## Details
${task.prompt}

## Task ID
task-id: ${task.id}

## Output
When done, respond with this EXACT XML (include your task-id=${task.id}):
<task-notification>
<task-id>${task.id}</task-id>
<status>completed</status>
<summary>One line summary</summary>
<result>Details of what you did</result>
</task-notification>`

    // 多轮对话消息历史
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
      { role: 'user', content: taskInstructions }
    ]

    const MAX_ITERATIONS = 10

    try {
      for (let i = 0; i < MAX_ITERATIONS; i++) {
        const response = await this.llm.call({
          messages,
          tools,
          maxTokens: API_CONFIG.maxTokensPerRequest,
        })

        const content = response.content.trim()

        // 无工具调用 → 检查是否包含 XML 通知
        if (!response.toolCalls?.length) {
          if (content.includes('<task-notification>')) {
            return this.parseNotification(task.id, content)
          }
          return {
            taskId: task.id,
            status: 'failed',
            summary: 'Model returned plain text without tools or XML',
            result: `Response: ${content.slice(0, 500)}`,
          }
        }

        // 执行工具调用，把结果加入消息历史
        for (const tc of response.toolCalls) {
          const result = await toolRegistry.execute(tc.name, tc.input)
          const toolMsg = result.success
            ? `Tool ${tc.name} result: ${result.output}`
            : `Tool ${tc.name} failed: ${result.error}`
          messages.push({ role: 'user', content: toolMsg })
          console.log(`[WorkerPool] Tool ${tc.name}: ${result.success ? 'OK' : 'FAIL'}`)
        }
      }

      return {
        taskId: task.id,
        status: 'failed',
        summary: `Max iterations (${MAX_ITERATIONS}) reached without XML notification`,
        result: 'Worker loop exceeded maximum iterations',
      }
    } catch (e) {
      return { taskId: task.id, status: 'failed', summary: String(e), result: String(e) }
    }
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
}
