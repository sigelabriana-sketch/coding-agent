// ============================================================
//  TaskStateMachine - 任务状态机
//  状态流转: pending → running → completed/failed/killed
// ============================================================

import type { Task, TaskStatus } from '../types.js'

export class TaskStateMachine {
  private tasks = new Map<string, Task>()

  add(task: Task): void {
    task.status = 'pending'
    task.createdAt = Date.now()
    task.updatedAt = Date.now()
    this.tasks.set(task.id, task)
  }

  get(id: string): Task | undefined {
    return this.tasks.get(id)
  }

  getAll(): Task[] {
    return Array.from(this.tasks.values())
  }

  start(id: string): boolean {
    const task = this.tasks.get(id)
    if (!task || task.status !== 'pending') return false
    task.status = 'running'
    task.updatedAt = Date.now()
    return true
  }

  complete(id: string, result: string): void {
    const task = this.tasks.get(id)
    if (task) {
      task.status = 'completed'
      task.result = result
      task.updatedAt = Date.now()
    }
  }

  fail(id: string, error: string): void {
    const task = this.tasks.get(id)
    if (task) {
      task.status = 'failed'
      task.result = error
      task.updatedAt = Date.now()
    }
  }

  kill(id: string): void {
    const task = this.tasks.get(id)
    if (task && !this.isTerminal(task.status)) {
      task.status = 'killed'
      task.updatedAt = Date.now()
    }
  }

  isTerminal(status: TaskStatus): boolean {
    return status === 'completed' || status === 'failed' || status === 'killed'
  }

  canStart(id: string): boolean {
    const task = this.tasks.get(id)
    if (!task || task.status !== 'pending') return false
    // 检查依赖是否都完成了
    if (task.dependsOn) {
      for (const depId of task.dependsOn) {
        const dep = this.tasks.get(depId)
        if (!dep || !this.isTerminal(dep.status)) return false
      }
    }
    return true
  }

  getRunnableTasks(): Task[] {
    return this.getAll().filter(t => this.canStart(t.id))
  }

  getPendingTasks(): Task[] {
    return this.getAll().filter(t => t.status === 'pending')
  }

  isAllDone(): boolean {
    return this.getAll().every(t => this.isTerminal(t.status))
  }
}
