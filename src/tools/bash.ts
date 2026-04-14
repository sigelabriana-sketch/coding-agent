// ============================================================
//  BashTool - 执行 Shell 命令
// ============================================================

import { spawn } from 'child_process'
import { API_CONFIG } from '../config.js'

export const BashTool = {
  name: 'BashTool',
  description: 'Execute shell commands. Use for git, npm, file operations, etc.',
  definition: {
    name: 'BashTool',
    description: 'Execute shell commands',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to execute' },
        workingDir: { type: 'string', description: 'Optional working directory' },
        timeout: { type: 'number', description: 'Timeout in milliseconds (default: 30000)' },
      },
      required: ['command'],
    },
  },

  async execute(input: Record<string, unknown>) {
    const command = input.command as string
    if (!command) return { success: false, output: '', error: 'command is required' }

    // 安全检查
    const dangerous = ['rm -rf /', 'dd if=', ':(){', '> /dev/sda']
    for (const pattern of dangerous) {
      if (command.includes(pattern)) {
        return { success: false, output: '', error: `Command blocked: ${pattern}` }
      }
    }

    // 命令白名单检查
    const firstWord = command.trim().split(/\s+/)[0]
    if (!API_CONFIG.allowedCommands.includes(firstWord)) {
      return { success: false, output: '', error: `Command not allowed: ${firstWord}` }
    }

    const timeout = (input.timeout as number) || 30000
    const workingDir = input.workingDir as string | undefined

    return new Promise((resolve) => {
      const startTime = Date.now()
      const opts: Record<string, unknown> = { shell: true, timeout, killSignal: 'SIGTERM' as const }
      if (workingDir) opts.cwd = workingDir

      const child = spawn(command, [], opts as Parameters<typeof spawn>[2])
      let stdout = ''
      let stderr = ''

      child.stdout?.on('data', (data) => { stdout += data.toString() })
      child.stderr?.on('data', (data) => { stderr += data.toString() })

      const timer = setTimeout(() => {
        child.kill('SIGTERM')
        resolve({ success: false, output: stdout, error: `Timeout after ${timeout}ms` })
      }, timeout)

      child.on('close', (code) => {
        clearTimeout(timer)
        const duration = Date.now() - startTime
        if (code === 0) {
          resolve({ success: true, output: stdout || `Done in ${duration}ms` })
        } else {
          resolve({ success: false, output: stdout, error: stderr || `Exit code: ${code}` })
        }
      })

      child.on('error', (err) => {
        clearTimeout(timer)
        resolve({ success: false, output: '', error: String(err) })
      })
    })
  },
}
