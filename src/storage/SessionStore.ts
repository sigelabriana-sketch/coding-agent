// ============================================================
//  SessionStore - Session 持久化
//  支持断点恢复，保存任务状态和上下文
// ============================================================

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import type { Task } from '../types.js'

export interface Session {
  id: string
  projectRoot: string
  createdAt: number
  updatedAt: number
  tasks: Task[]
  coordinatorContext: string
  completedTaskIds: string[]
  failedTaskIds: string[]
}

export class SessionStore {
  private sessionDir: string

  constructor(sessionDir: string = join(process.cwd(), '.coding-agent', 'sessions')) {
    this.sessionDir = sessionDir
    mkdirSync(this.sessionDir, { recursive: true })
  }

  private sessionPath(sessionId: string): string {
    return join(this.sessionDir, `${sessionId}.json`)
  }

  save(session: Session): void {
    session.updatedAt = Date.now()
    writeFileSync(this.sessionPath(session.id), JSON.stringify(session, null, 2), 'utf-8')
  }

  load(sessionId: string): Session | null {
    const path = this.sessionPath(sessionId)
    if (!existsSync(path)) return null
    try {
      return JSON.parse(readFileSync(path, 'utf-8')) as Session
    } catch {
      return null
    }
  }

  list(): Session[] {
    const { readdirSync, statSync } = require('fs')
    const sessions: Session[] = []
    try {
      for (const file of readdirSync(this.sessionDir)) {
        if (!file.endsWith('.json')) continue
        const s = this.load(file.replace('.json', ''))
        if (s) sessions.push(s)
      }
    } catch {}
    return sessions.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  delete(sessionId: string): void {
    const { unlinkSync } = require('fs')
    const path = this.sessionPath(sessionId)
    if (existsSync(path)) unlinkSync(path)
  }
}
