// ============================================================
//  Coordinator - 任务协调器（完整版 + MemoryPalace）
//  核心：理解 → 拆解 → 并行分发 → 收集 → 合成 → 验收
//  记忆：热缓存(PALACE.md) + Wings + Tunnels
// ============================================================

import { LLMClient } from '../llm.js'
import { TaskStateMachine } from './TaskStateMachine.js'
import { WorkerPool } from './WorkerPool.js'
import { collectContext, buildWorkerSystemPrompt } from '../context.js'
import { SessionStore } from '../storage/SessionStore.js'
import { MemoryPalace } from '../memory/MemoryPalace.js'
import { API_CONFIG } from '../config.js'
import type { Task, TaskNotification } from '../types.js'

export interface PlanTask {
  type: Task['type']
  description: string
  prompt: string
  dependsOn?: (string | number)[]
}

export class Coordinator {
  private llm: LLMClient
  private taskManager: TaskStateMachine
  private workerPool: WorkerPool
  private sessionStore: SessionStore
  private memoryPalace: MemoryPalace | null = null
  private memoryContext: string = ''

  private context: string = ''
  private projectRoot: string
  private sessionId: string
  private skillPath: string

  constructor(
    projectRoot: string,
    sessionId?: string,
    memoryDir?: string,
    skillPath?: string,
  ) {
    this.llm = new LLMClient()
    this.taskManager = new TaskStateMachine()
    this.workerPool = new WorkerPool()
    this.sessionStore = new SessionStore()
    this.projectRoot = projectRoot
    this.sessionId = sessionId || this.generateSessionId()
    this.skillPath = skillPath || join(process.cwd(), '..', 'Mem-Palace-skill')

    if (memoryDir) {
      this.memoryPalace = new MemoryPalace(memoryDir, this.skillPath)
    }
  }

  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  }

  async init(): Promise<void> {
    const ctx = await collectContext(this.projectRoot)
    this.context = buildWorkerSystemPrompt(ctx)

    // 加载 Memory Palace 热缓存
    if (this.memoryPalace && this.memoryPalace.exists()) {
      await this.memoryPalace.load()
      const hotCache = await this.memoryPalace.getHotCache()
      this.memoryContext = `\n\n## 🏛️ Memory Palace (Hot Cache)\n${hotCache}\n`
      console.log('[Coordinator] Memory Palace loaded')
    }

    console.log(`[Coordinator] Session: ${this.sessionId}`)
    console.log('[Coordinator] Initialized')
  }

  async resume(sessionId: string): Promise<boolean> {
    const session = this.sessionStore.load(sessionId)
    if (!session) return false
    this.sessionId = session.id
    this.context = session.coordinatorContext
    console.log(`[Coordinator] Resumed session: ${sessionId}`)
    return true
  }

  save(): void {
    this.sessionStore.save({
      id: this.sessionId,
      projectRoot: this.projectRoot,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      tasks: this.taskManager.getAll(),
      coordinatorContext: this.context,
      completedTaskIds: this.taskManager.getAll().filter(t => t.status === 'completed').map(t => t.id),
      failedTaskIds: this.taskManager.getAll().filter(t => t.status === 'failed').map(t => t.id),
    })
  }

  async handleUserTask(userPrompt: string): Promise<string> {
    console.log(`\n[Coordinator] New task: ${userPrompt.slice(0, 80)}`)
    this.save()

    const plan = await this.plan(userPrompt)
    console.log(`[Coordinator] Planned ${plan.tasks.length} task(s)`)

    const results = await this.execute(plan.tasks)
    const response = await this.synthesize(userPrompt, results)

    // 会话结束：自动保存到 Memory Palace
    await this.autoSaveToPalace(userPrompt, results)

    this.save()
    return response
  }

  // ============================================================
  // 阶段一：规划
  // ============================================================
  private async plan(userPrompt: string): Promise<{ tasks: PlanTask[] }> {
    const memorySection = this.memoryContext
      ? `\n\n## Relevant Memory Palace Context\n${this.memoryContext}\n\nWhen planning, consider what was previously discussed in active wings.`
      : ''

    const systemPrompt = `You are an expert task planner for a coding agent.
Analyze the user's request and break it down into the smallest meaningful tasks.

Task types:
- research: Explore codebase, understand structure (can run in parallel with other research)
- implement: Write or modify code (requires file locks, runs after research for that area)
- verify: Check correctness, run tests (runs after implement)
- test: Execute test suites (runs after implement)
- review: Code review, suggestions (can run in parallel with other reviews)

Rules:
1. Research tasks can ALWAYS run in parallel with each other
2. Implement tasks should be split by FILE, not by step. One task = one file or one change
3. If two implement tasks touch the same file, MERGE them into one task
4. Verify/test tasks run AFTER the implement tasks they depend on
5. Output valid JSON with a "tasks" array
6. For dependsOn, use EXACT description strings of the tasks being depended on${memorySection}`

    try {
      const response = await this.llm.call({
        messages: [{ role: 'user', content: systemPrompt + '\n\nUser request: ' + userPrompt }],
        maxTokens: 2048,
      })
      const cleaned = response.content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
      return JSON.parse(cleaned)
    } catch (e) {
      console.error('[Coordinator] Plan failed, using fallback:', e)
      return { tasks: [{ type: 'implement', description: 'Execute task', prompt: userPrompt }] }
    }
  }

  // ============================================================
  // 阶段二：执行 - 真正并行
  // ============================================================
  private async execute(planTasks: PlanTask[]): Promise<Map<string, TaskNotification>> {
    const results = new Map<string, TaskNotification>()
    const pending = new Map<string, PlanTask>()
    const running = new Map<string, Task>()

    const descToId = new Map<string, string>()
    const taskObjects: Task[] = []

    for (const pt of planTasks) {
      const task: Task = {
        id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        type: pt.type,
        description: pt.description,
        prompt: pt.prompt,
        status: 'pending',
        dependsOn: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      descToId.set(task.description, task.id)
      taskObjects.push(task)
      this.taskManager.add(task)
    }

    // 解析 dependsOn 并建立 pending 队列（所有任务先进 pending）
    for (const task of taskObjects) {
      const pt = planTasks.find(p => p.description === task.description)
      if (pt?.dependsOn) {
        task.dependsOn = (pt.dependsOn as (string | number)[])
          .map((dep: string | number) => {
            const depStr = String(dep)
            const byDesc = descToId.get(depStr)
            if (byDesc) return byDesc
            const m = depStr.match(/^task(\d+)$/)
            if (m) return taskObjects[parseInt(m[1]) - 1]?.id
            const idx = parseInt(depStr)
            if (!isNaN(idx) && idx >= 0 && idx < taskObjects.length) return taskObjects[idx].id
            for (const [desc, id] of descToId) {
              if (desc.slice(0, 25) === depStr.slice(0, 25)) return id
            }
            return null
          })
          .filter(Boolean) as string[]
      }
      // 所有任务都要进 pending 队列，不管有没有依赖
      pending.set(task.id, task)
    }

    // 并行执行
    while (pending.size > 0 || running.size > 0) {
      for (const [taskId, pt] of pending) {
        const task = this.taskManager.get(taskId)!
        if (this.canStart(taskId) && this.workerPool.getRunningCount() < API_CONFIG.maxConcurrentWorkers) {
          pending.delete(taskId)
          running.set(taskId, task)
          this.taskManager.start(taskId)
          console.log(`[Coordinator] Starting: ${task.description} (${task.type})`)

          // 把记忆上下文注入 Worker
          const workerContext = this.context + this.memoryContext

          this.workerPool.runWorker(task, workerContext).then(result => {
            results.set(taskId, result)
            running.delete(taskId)
            if (result.status === 'completed') {
              this.taskManager.complete(taskId, result.result)
            } else {
              this.taskManager.fail(taskId, result.result)
            }
            this.context += `\n\n[TASK ${taskId} ${result.status}]: ${result.summary}`
            console.log(`[Coordinator] ${task.description}: ${result.status}`)
          })
        }
      }

      if (pending.size > 0 && running.size === 0) {
        console.error('[Coordinator] DEADLOCK: No tasks can start')
        break
      }

      await new Promise(r => setTimeout(r, 500))
    }

    return results
  }

  private canStart(taskId: string): boolean {
    const task = this.taskManager.get(taskId)!
    if (task.status !== 'pending') return false
    if (!task.dependsOn?.length) return true
    return task.dependsOn.every(depId => {
      const dep = this.taskManager.get(depId)
      return dep && this.taskManager.isTerminal(dep.status)
    })
  }

  // ============================================================
  // 阶段三：合成
  // ============================================================
  private async synthesize(
    userPrompt: string,
    results: Map<string, TaskNotification>,
  ): Promise<string> {
    const tasks = this.taskManager.getAll()
    const lines: string[] = ['## 任务完成\n']

    for (const task of tasks) {
      const result = results.get(task.id)
      const icon = result?.status === 'completed' ? '✅' : '❌'
      lines.push(`${icon} **${task.description}** (${task.type})`)
      if (result) {
        lines.push(`   ${result.summary}`)
        if (result.status === 'failed') lines.push(`   Error: ${String(result.result).slice(0, 200)}`)
      }
      lines.push('')
    }

    const synthesisPrompt = `Based on the user's original request and all task results, provide a clear summary.

User request: ${userPrompt}

Task results:
${tasks.map(t => {
  const r = results.get(t.id)
  return `- [${r?.status || 'unknown'}] ${t.description}: ${r?.summary || 'no result'}`
}).join('\n')}

Provide a concise summary of:
1. What was accomplished
2. Any errors or issues
3. What the user should know or do next`

    try {
      const response = await this.llm.call({
        messages: [{ role: 'user', content: synthesisPrompt }],
        maxTokens: 1024,
      })
      lines.push('## 总结\n')
      lines.push(response.content)
    } catch {
      lines.push('\n(Could not generate summary)')
    }

    return lines.join('\n')
  }

  // ============================================================
  // 自动保存到 Memory Palace
  // ============================================================
  private async autoSaveToPalace(
    userPrompt: string,
    results: Map<string, TaskNotification>,
  ): Promise<void> {
    if (!this.memoryPalace) return

    const tasks = this.taskManager.getAll()
    const completed = tasks.filter(t => t.status === 'completed')
    const failed = tasks.filter(t => t.status === 'failed')

    if (completed.length === 0) return

    // 提取关键发现
    const discoveries = completed
      .map(t => results.get(t.id)?.summary)
      .filter(Boolean)
      .join('; ')

    const decisions = failed.length > 0
      ? `Failed: ${failed.map(t => t.description).join(', ')}`
      : ''

    // 检测适合的 wing（基于任务描述）
    const wing = this.detectWing(userPrompt)

    try {
      await this.memoryPalace.autoSave(
        `${userPrompt.slice(0, 50)}...`,
        wing || 'general',
        discoveries,
        decisions,
      )
      console.log('[Coordinator] Auto-saved to Memory Palace')
    } catch (e) {
      console.error('[Coordinator] Auto-save failed:', e)
    }
  }

  // 检测 wing 归属
  private detectWing(prompt: string): string {
    const lower = prompt.toLowerCase()
    if (lower.includes('research') || lower.includes('paper') || lower.includes('study')) return 'research'
    if (lower.includes('infra') || lower.includes('deploy') || lower.includes('server')) return 'infrastructure'
    if (lower.includes('test') || lower.includes('verify')) return 'testing'
    if (lower.includes('design') || lower.includes('api') || lower.includes('feature')) return 'product-development'
    return 'general'
  }
}

function join(...parts: string[]): string {
  return parts.filter(Boolean).join('/').replace(/\/+/g, '/')
}
