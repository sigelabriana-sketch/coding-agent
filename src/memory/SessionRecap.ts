// ============================================================
//  SessionRecap - 离开摘要 + 会话恢复
//  Claude Code 2.1.108 recap 功能复刻
//  结合 MemoryPalace PALACE.md 热缓存实现
//
//  场景：
//  - 长时间离开后返回 → 生成 recap 摘要
//  - 从 PALACE.md 读取上次会话状态
//  - 恢复上下文继续工作
// ============================================================

import { MemoryPalace } from './MemoryPalace.js'
import { SessionStore } from '../storage/SessionStore.js'
import { TaskStateMachine } from '../coordinator/TaskStateMachine.js'
import { LLMClient } from '../llm.js'

export interface RecapResult {
  summary: string           // 摘要文本
  previousSessionId: string
  pendingTasks: string[]    // 未完成任务列表
  lastActivity: string      // 最后活动时间
  palaceSnapshot?: string    // 从 PALACE.md 读取的热缓存
}

export class SessionRecap {
  private llm: LLMClient
  private memoryPalace: MemoryPalace | null = null
  private sessionStore: SessionStore
  private taskManager: TaskStateMachine | null = null

  constructor() {
    this.llm = new LLMClient()
    this.sessionStore = new SessionStore()
  }

  setMemoryPalace(mp: MemoryPalace): void {
    this.memoryPalace = mp
  }

  setTaskManager(tm: TaskStateMachine): void {
    this.taskManager = tm
  }

  // ============================================================
  // 生成离开摘要（返回时调用）
  // ============================================================
  async generateRecap(awayMinutes: number): Promise<RecapResult> {
    // 1. 读取 PALACE.md 热缓存
    let palaceSnapshot = ''
    if (this.memoryPalace && this.memoryPalace.exists()) {
      await this.memoryPalace.load()
      palaceSnapshot = await this.memoryPalace.getHotCache()
    }

    // 2. 读取最近一次 session
    const sessions = this.sessionStore.list()
    const lastSession = sessions[0]

    // 3. 获取未完成任务
    const pendingTasks: string[] = []
    if (this.taskManager) {
      const tasks = this.taskManager.getAll()
      for (const task of tasks) {
        if (task.status === 'pending' || task.status === 'running') {
          pendingTasks.push(`${task.description} [${task.type}]`)
        }
      }
    }

    // 4. 用 LLM 生成 recap
    const recapText = await this.buildRecapText(awayMinutes, pendingTasks, palaceSnapshot)

    return {
      summary: recapText,
      previousSessionId: lastSession?.id || 'unknown',
      pendingTasks,
      lastActivity: lastSession
        ? new Date(lastSession.updatedAt).toLocaleString()
        : 'unknown',
      palaceSnapshot,
    }
  }

  // ============================================================
  // LLM 生成摘要
  // ============================================================
  private async buildRecapText(
    awayMinutes: number,
    pendingTasks: string[],
    palaceSnapshot: string,
  ): Promise<string> {
    const timeDesc = this.formatAwayTime(awayMinutes)

    const prompt = `You are generating a recap for returning to a coding session.

Time away: ${timeDesc}

${pendingTasks.length > 0 ? `Pending tasks (DO NOT start these until user confirms):
${pendingTasks.map(t => `- ${t}`).join('\n')}` : 'No pending tasks - all done!'}

${palaceSnapshot ? `Memory Palace hot cache:
${palaceSnapshot.slice(0, 2000)}` : ''}

Generate a concise recap that:
1. Summarizes where we left off
2. Lists any pending tasks (without starting them)
3. Suggests what to say to the user when returning

Format: Markdown with sections: ## Recap, ## Pending Tasks, ## Suggestion

Keep it under 300 words.`

    try {
      const response = await this.llm.call({
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 1024,
      })
      return response.content
    } catch (e) {
      return `## Recap\n\nAway for ${timeDesc}.\n\n${pendingTasks.length > 0 ? `**Pending (do not start):**\n${pendingTasks.map(t => `- ${t}`).join('\n')}` : 'All tasks completed.'}`
    }
  }

  // ============================================================
  // 保存离开摘要（离开时调用）
  // ============================================================
  async saveAwaySummary(
    summary: string,
    pendingTasks: string[],
  ): Promise<void> {
    if (!this.memoryPalace) return

    const today = new Date().toISOString().split('T')[0]

    await this.memoryPalace.saveNote('general', {
      title: `away-summary-${today}`,
      date: today,
      source: 'conversation',
      type: 'session-summary',
      keyContent: summary,
      connectionToCurrentWork: `Pending: ${pendingTasks.join(', ') || 'none'}`,
    })
  }

  // ============================================================
  // 恢复会话（加载历史上下文）
  // ============================================================
  async restoreSession(sessionId: string): Promise<{
    session: import('../storage/SessionStore.js').Session | null
    palaceContext: string
  }> {
    const session = this.sessionStore.load(sessionId)

    let palaceContext = ''
    if (this.memoryPalace && this.memoryPalace.exists()) {
      palaceContext = await this.memoryPalace.getHotCache()
    }

    return { session, palaceContext }
  }

  // ============================================================
  // 工具方法
  // ============================================================
  private formatAwayTime(minutes: number): string {
    if (minutes < 60) return `${minutes} minutes`
    if (minutes < 1440) return `${Math.floor(minutes / 60)} hours`
    return `${Math.floor(minutes / 1440)} days`
  }
}
