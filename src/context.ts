// ============================================================
//  上下文收集器
// ============================================================

import { execSync } from 'child_process'
import { readFileSync, existsSync, readdirSync } from 'fs'
import { join, resolve } from 'path'

export interface Context {
  gitStatus: string | null
  memoryFiles: MemoryFile[]
  claudeMdFiles: ClaudeMdFile[]
  currentDate: string
  projectRoot: string
}

export interface MemoryFile {
  path: string
  name: string
  type: 'user' | 'feedback' | 'project' | 'reference'
  content: string
}

export interface ClaudeMdFile {
  path: string
  content: string
}

function findClaudeMdFiles(startDir: string): ClaudeMdFile[] {
  const files: ClaudeMdFile[] = []
  let dir = resolve(startDir)
  for (let i = 0; i < 5; i++) {
    const mdPath = join(dir, 'CLAUDE.md')
    if (existsSync(mdPath)) {
      try { files.push({ path: mdPath, content: readFileSync(mdPath, 'utf-8') }) } catch {}
    }
    const parent = join(dir, '..')
    if (parent === dir) break
    dir = parent
  }
  return files
}

function scanMemoryDir(memoryDir: string): MemoryFile[] {
  const files: MemoryFile[] = []
  if (!existsSync(memoryDir)) return files
  try {
    for (const entry of readdirSync(memoryDir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'MEMORY.md') {
        const filePath = join(memoryDir, entry.name)
        try {
          const content = readFileSync(filePath, 'utf-8')
          files.push({ path: filePath, name: entry.name.replace('.md', ''), type: 'reference', content })
        } catch {}
      }
    }
  } catch {}
  return files
}

function getGitStatus(cwd: string): string | null {
  try {
    execSync('git rev-parse --is-inside-work-tree', { cwd, encoding: 'utf-8', stdio: 'pipe' }).trim()
    return [
      `Branch: ${execSync('git branch --show-current', { cwd, encoding: 'utf-8' }).trim()}`,
      `Status: ${execSync('git status --short', { cwd, encoding: 'utf-8' }).trim() || '(clean)'}`,
      `Recent commits:\n${execSync('git log --oneline -n 5', { cwd, encoding: 'utf-8' }).trim()}`,
    ].join('\n')
  } catch { return null }
}

export async function collectContext(projectRoot: string): Promise<Context> {
  const gitStatus = getGitStatus(projectRoot)
  const claudeMdFiles = findClaudeMdFiles(projectRoot)
  const memoryDir = join(projectRoot, '.claude', 'memory')
  const memoryFiles = scanMemoryDir(memoryDir)
  return {
    gitStatus,
    memoryFiles,
    claudeMdFiles,
    currentDate: new Date().toISOString().split('T')[0],
    projectRoot,
  }
}

export function buildWorkerSystemPrompt(ctx: Context): string {
  const lines = [`# Worker Context`, ``, `Date: ${ctx.currentDate}`, ``]
  if (ctx.gitStatus) lines.push(`## Git\n\`\`\`\n${ctx.gitStatus}\n\`\`\`\n`)
  for (const f of ctx.claudeMdFiles) lines.push(`## ${f.path}\n${f.content}\n`)
  if (ctx.memoryFiles.length) {
    lines.push(`## Memory`)
    for (const m of ctx.memoryFiles) lines.push(`\n### ${m.name} [${m.type}]\n${m.content.slice(0, 300)}\n`)
  }
  lines.push(`## Tools`, `Available: BashTool, FileReadTool, FileEditTool, FileWriteTool`, ``)
  return lines.join('\n')
}
