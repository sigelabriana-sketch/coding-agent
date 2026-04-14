// ============================================================
//  PreCompactHook - 压缩前阻断守卫
//  Claude Code 2.1.105 核心机制复刻
//
//  在每次自动压缩/总结前触发：
//  - 检查任务队列是否有未完成的任务
//  - 有未完成任务 → 返回 block，阻断本次压缩
//  - 所有任务完成 → 允许压缩，保护热缓存内容
//
//  结合 MemoryPalace：
//  - 阻断时把当前上下文快照保存到 PALACE.md
//  - 下次恢复时从 PALACE.md 读取
// ============================================================

import { MemoryPalace } from '../memory/MemoryPalace.js'
import { TaskStateMachine } from '../coordinator/TaskStateMachine.js'

export interface PreCompactResult {
  decision: 'proceed' | 'block'
  reason: string
  snapshot?: string  // 保存到 PALACE.md 的快照内容
  blockedTaskIds?: string[]
}

export class PreCompactHook {
  private taskManager: TaskStateMachine | null = null
  private memoryPalace: MemoryPalace | null = null

  // 设置关联的组件
  setTaskManager(tm: TaskStateMachine): void {
    this.taskManager = tm
  }

  setMemoryPalace(mp: MemoryPalace): void {
    this.memoryPalace = mp
  }

  // ============================================================
  // 核心：PreCompact 检查
  // ============================================================
  async check(context: PreCompactContext): Promise<PreCompactResult> {
    const pending: string[] = []
    const running: string[] = []
    const blocked: string[] = []

    // 1. 检查任务队列状态
    if (this.taskManager) {
      const tasks = this.taskManager.getAll()
      for (const task of tasks) {
        if (task.status === 'pending') pending.push(task.id)
        if (task.status === 'running') running.push(task.id)
      }
    }

    // 2. 未完成的任务 → 阻断压缩
    if (running.length > 0 || pending.length > 0) {
      const taskIds = [...running, ...pending]
      const blockedTasks = taskIds

      // 快照当前上下文到 PALACE.md
      let snapshot: string | undefined
      if (this.memoryPalace) {
        snapshot = await this.snapshotToPalace(context, taskIds)
      }

      return {
        decision: 'block',
        reason: this.buildBlockReason(running, pending),
        snapshot,
        blockedTaskIds: blockedTasks,
      }
    }

    // 3. 所有任务完成 → 允许压缩
    //    但先保存热缓存摘要到 PALACE.md
    if (this.memoryPalace) {
      await this.saveSessionSummary(context)
    }

    return {
      decision: 'proceed',
      reason: 'All tasks completed, compression allowed.',
    }
  }

  // ============================================================
  // 保存快照到 PALACE.md（阻断时）
  // ============================================================
  private async snapshotToPalace(
    context: PreCompactContext,
    blockedTaskIds: string[],
  ): Promise<string> {
    if (!this.memoryPalace) return ''

    const tasks = this.taskManager?.getAll() || []
    const activeTasks = tasks.filter(t =>
      !['completed', 'failed', 'killed'].includes(t.status)
    )

    const summary = `## 会话快照 - ${new Date().toISOString()}

### 阻断原因
还有 ${activeTasks.length} 个未完成任务，压缩被阻断。

### 活跃任务
${activeTasks.map(t => `- **${t.description}** [${t.type}] (${t.status})`).join('\n')}

### 上下文摘要
${context.summary || '(无摘要)'}

### 待补充
${blockedTaskIds.map(id => `- task-id: ${id}`).join('\n')}

---
*此快照由 PreCompactHook 自动生成，用于会话恢复*
`

    try {
      await this.memoryPalace.saveNote('general', {
        title: `snapshot-${Date.now()}`,
        date: new Date().toISOString().split('T')[0],
        source: 'conversation',
        type: 'session-summary',
        keyContent: summary,
        connectionToCurrentWork: `待完成任务: ${activeTasks.map(t => t.description).join(', ')}`,
      })
    } catch (e) {
      console.error('[PreCompactHook] Failed to save snapshot:', e)
    }

    return summary
  }

  // ============================================================
  // 保存会话摘要到 PALACE.md（允许压缩时）
  // ============================================================
  private async saveSessionSummary(context: PreCompactContext): Promise<void> {
    if (!this.memoryPalace) return

    const tasks = this.taskManager?.getAll() || []
    const completed = tasks.filter(t => t.status === 'completed')

    const summary = `## 会话完成摘要 - ${new Date().toISOString()}

### 完成的任务
${completed.map(t => `- ${t.description}`).join('\n')}

### 关键结果
${context.summary || '无'}

---
*由 PreCompactHook 自动保存*
`

    try {
      await this.memoryPalace.saveNote('general', {
        title: `session-${Date.now()}`,
        date: new Date().toISOString().split('T')[0],
        source: 'conversation',
        type: 'session-summary',
        keyContent: summary,
        connectionToCurrentWork: `完成了 ${completed.length} 个任务`,
      })
    } catch (e) {
      console.error('[PreCompactHook] Failed to save summary:', e)
    }
  }

  private buildBlockReason(running: string[], pending: string[]): string {
    const parts: string[] = []
    if (running.length > 0) parts.push(`${running.length} 个运行中`)
    if (pending.length > 0) parts.push(`${pending.length} 个待处理`)
    return `阻断压缩: ${parts.join(', ')}。上下文已快照到 PALACE.md，恢复后可继续。`
  }
}

export interface PreCompactContext {
  summary?: string      // 当前上下文摘要
  pendingCount?: number // 外部传入的 pending 任务数（可选）
  taskCount?: number    // 总任务数（可选）
}
