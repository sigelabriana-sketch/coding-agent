// ============================================================
//  FileLockManager - 文件锁机制
//  防止多 Worker 同时写同一文件导致冲突
// ============================================================

export class FileLockManager {
  private locks = new Map<string, { taskId: string; acquiredAt: number }>()

  // 请求文件锁
  // 返回是否获得锁；如果被占用，返回占用者的 taskId
  requestLock(files: string[], taskId: string): { granted: boolean; blockedBy?: string } {
    for (const file of files) {
      const existing = this.locks.get(file)
      if (existing && existing.taskId !== taskId) {
        return { granted: false, blockedBy: `${file} (locked by ${existing.taskId})` }
      }
    }
    // 全部获得
    for (const file of files) {
      this.locks.set(file, { taskId, acquiredAt: Date.now() })
    }
    return { granted: true }
  }

  // 释放某个任务的所有锁
  releaseLock(taskId: string): string[] {
    const released: string[] = []
    for (const [file, lock] of this.locks.entries()) {
      if (lock.taskId === taskId) {
        this.locks.delete(file)
        released.push(file)
      }
    }
    return released
  }

  // 检查某个任务是否持有某文件的锁
  hasLock(taskId: string, file: string): boolean {
    return this.locks.get(file)?.taskId === taskId
  }

  // 获取当前所有锁状态（调试用）
  getStatus(): Record<string, string> {
    const status: Record<string, string> = {}
    for (const [file, lock] of this.locks.entries()) {
      status[file] = lock.taskId
    }
    return status
  }
}
