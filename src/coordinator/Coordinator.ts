// ============================================================
//  Coordinator - 任务协调器（核心大脑）
//  职责：理解 → 拆解 → 分发 → 合成 → 验收
// ============================================================

import { LLMClient } from '../llm.js'
import { toolRegistry } from '../tools/index.js'
import { TaskStateMachine } from './TaskStateMachine.js'
import { WorkerManager } from './WorkerManager.js'
import { collectContext, buildWorkerSystemPrompt } from '../context.js'
import { API_CONFIG } from '../config.js'
import type { Task, TaskNotification, CoordinatorDecision } from '../types.js'

export class Coordinator {
  private llm: LLMClient
  private taskManager: TaskStateMachine
  private workerManager: WorkerManager
  private context: string = ''
  private projectRoot: string

  constructor(projectRoot: string) {
    this.llm = new LLMClient()
    this.taskManager = new TaskStateMachine()
    this.workerManager = new WorkerManager()
    this.projectRoot = projectRoot
  }

  async init() {
    const ctx = await collectContext(this.projectRoot)
    this.context = buildWorkerSystemPrompt(ctx)
    console.log('[Coordinator] Initialized')
  }

  // 处理用户指令
  async handleUserTask(userPrompt: string): Promise<string> {
    console.log('\n[Coordinator] New task:', userPrompt.slice(0, 80))
    
    // 阶段一：规划 - 理解任务并拆解
    const plan = await this.plan(userPrompt)
    console.log(`[Coordinator] Planned ${plan.tasks.length} task(s)`)

    // 阶段二：执行
    const results = await this.execute(plan.tasks)

    // 阶段三：合成响应
    return this.synthesize(userPrompt, results)
  }

  // 阶段一：规划
  private async plan(userPrompt: string): Promise<{
    tasks: Array<{ type: Task['type']; description: string; prompt: string; dependsOn?: string[] }>
  }> {
    const systemPrompt = `You are a task planner for a coding agent.
Given the user's request, break it down into tasks for workers.
Each task should be one of: research, implement, verify, test, review

Rules:
- research tasks explore and understand (can run in parallel)
- implement tasks write code (run sequentially per file)
- verify tasks check correctness (can run after implement)
- Output valid JSON with a "tasks" array`

    try {
      const response = await this.llm.call({
        // MiniMax 代理不支持 system 角色，把 system prompt 合并到 user 消息
        messages: [
          { role: 'user', content: `You are a task planner. Output valid JSON with a "tasks" array. Each task has: type, description, prompt, dependsOn. User request: ${userPrompt}` },
        ],
        maxTokens: 2048,
      })

      const cleaned = response.content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
      return JSON.parse(cleaned)
    } catch (e) {
      console.error('[Coordinator] Plan parse failed, using fallback:', e)
      return { tasks: [{ type: 'implement', description: 'Execute task', prompt: userPrompt }] }
    }
  }

  // 阶段二：执行计划
  private async execute(
    taskDefs: Array<{ type: Task['type']; description: string; prompt: string; dependsOn?: string[] }>
  ): Promise<Map<string, TaskNotification>> {
    const results = new Map<string, TaskNotification>()

    for (const def of taskDefs) {
      const task: Task = {
        id: `task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        type: def.type,
        description: def.description,
        prompt: def.prompt,
        status: 'pending',
        dependsOn: def.dependsOn,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }

      this.taskManager.add(task)

      // 等待依赖满足
      if (def.dependsOn?.length) {
        console.log(`[Coordinator] Task ${task.id} waiting for dependencies...`)
        while (!this.taskManager.canStart(task.id)) {
          await new Promise(r => setTimeout(r, 500))
        }
      }

      this.taskManager.start(task.id)
      console.log(`[Coordinator] Running task: ${task.description}`)

      const result = await this.workerManager.spawnWorker(task, this.context)
      results.set(task.id, result)

      if (result.status === 'completed') {
        this.taskManager.complete(task.id, result.result)
      } else {
        this.taskManager.fail(task.id, result.result)
      }

      // 写任务结果加到上下文（后续任务可以看到）
      this.context += `\n\n[TASK ${task.id} RESULT]: ${result.summary}\n${result.result.slice(0, 200)}`
    }

    return results
  }

  // 阶段三：合成最终响应
  private synthesize(userPrompt: string, results: Map<string, TaskNotification>): string {
    const lines = [`## 任务完成\n`]
    for (const [taskId, result] of results) {
      const icon = result.status === 'completed' ? '✅' : '❌'
      lines.push(`${icon} **${taskId}** (${result.status})`)
      lines.push(`   ${result.summary}`)
      if (result.status === 'failed') {
        lines.push(`   Error: ${result.result.slice(0, 200)}`)
      }
      lines.push('')
    }
    return lines.join('\n')
  }
}
