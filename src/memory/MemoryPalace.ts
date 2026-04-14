// ============================================================
//  MemoryPalace - 记忆宫殿系统
//  集成 Mem-Palace-skill，用 Node.js 包装 Python CLI
//  热缓存：PALACE.md (~200行)
//  分类翼：wings/<wing-name>/
//  跨域隧道：tunnels/<name>.md
// ============================================================

import { spawn } from 'child_process'
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs'
import { join, resolve, dirname } from 'path'
import { LLMClient } from '../llm.js'

export interface Wing {
  name: string
  status: 'active' | 'paused' | 'done'
  lastUpdated: string
  keyInsights: string
  noteCount: number
}

export interface Tunnel {
  name: string
  connects: string
  coreInsight: string
}

export interface PalaceState {
  name: string
  wings: Wing[]
  tunnels: Tunnel[]
  lastUpdated: string
}

export interface NoteContent {
  title: string
  date: string
  source: 'conversation' | 'research' | 'experiment' | 'tool-review' | 'decision'
  type: 'concept-learning' | 'experiment-result' | 'decision-record' | 'session-summary' | 'paper-analysis'
  keyContent: string
  connectionToCurrentWork: string
  references?: string
}

// MemoryPalace manager - wraps Python palace CLI
export class MemoryPalace {
  private memoryDir: string
  private palaceDir: string
  private skillPath: string
  private state: PalaceState | null = null

  constructor(memoryDir: string, skillPath: string) {
    this.memoryDir = memoryDir
    this.skillPath = skillPath
    this.palaceDir = join(memoryDir, '.palace')
  }

  // ============================================================
  // 初始化记忆宫殿
  // ============================================================
  async init(name: string, wings: string[]): Promise<void> {
    await this.runPython('palace_init.py', [
      this.palaceDir,
      '--wings', wings.join(','),
      '--name', name,
      '--force',
    ])
    await this.load()
  }

  // ============================================================
  // 启动时加载热缓存
  // ============================================================
  async load(): Promise<PalaceState> {
    const palacePath = join(this.palaceDir, 'PALACE.md')
    if (!existsSync(palacePath)) {
      this.state = null
      return null!
    }

    const content = readFileSync(palacePath, 'utf-8')
    this.state = this.parsePalaceMd(content)
    return this.state
  }

  // ============================================================
  // 读取热缓存（PALACE.md）
  // ============================================================
  async getHotCache(): Promise<string> {
    const palacePath = join(this.palaceDir, 'PALACE.md')
    if (!existsSync(palacePath)) return ''
    return readFileSync(palacePath, 'utf-8')
  }

  // ============================================================
  // 读取特定 wing 的笔记
  // ============================================================
  async readWing(wingName: string): Promise<string[]> {
    const wingDir = join(this.palaceDir, 'wings', wingName)
    if (!existsSync(wingDir)) return []
    const files = readdirSync(wingDir).filter(f => f.endsWith('.md'))
    return files.map(f => readFileSync(join(wingDir, f), 'utf-8'))
  }

  // ============================================================
  // 保存笔记到 wing
  // ============================================================
  async saveNote(wing: string, note: NoteContent): Promise<string> {
    const wingDir = join(this.palaceDir, 'wings', wing)
    mkdirSync(wingDir, { recursive: true })

    const filename = `${note.date}_${note.title.replace(/\s+/g, '-').toLowerCase()}.md`
    const filepath = join(wingDir, filename)

    const content = this.formatNote(note)
    writeFileSync(filepath, content, 'utf-8')

    // 更新 PALACE.md 热缓存表
    await this.updateHotCache(wing, note)

    return filepath
  }

  // ============================================================
  // 自动保存（会话结束钩子）
  // ============================================================
  async autoSave(
    summary: string,
    wing: string,
    discoveries?: string,
    decisions?: string,
    dataPoints?: string,
  ): Promise<void> {
    await this.runPython('palace_autosave.py', [
      this.palaceDir,
      '--summary', summary,
      '--wing', wing,
      ...(discoveries ? ['--discoveries', discoveries] : []),
      ...(decisions ? ['--decisions', decisions] : []),
      ...(dataPoints ? ['--data', dataPoints] : []),
    ])
    await this.load()
  }

  // ============================================================
  // 搜索笔记
  // ============================================================
  async search(query: string, wing?: string): Promise<string> {
    const args = [this.palaceDir, query, ...(wing ? ['--wing', wing] : [])]
    return this.runPython('palace_search.py', args)
  }

  // ============================================================
  // 获取统计信息
  // ============================================================
  async getStats(): Promise<string> {
    return this.runPython('palace_stats.py', [this.palaceDir])
  }

  // ============================================================
  // 健康检查
  // ============================================================
  async healthCheck(): Promise<string> {
    return this.runPython('palace_health.py', [this.palaceDir])
  }

  // ============================================================
  // 生成可视化地图
  // ============================================================
  async generateMap(): Promise<string> {
    return this.runPython('palace_map.py', [this.palaceDir])
  }

  // ============================================================
  // 归档旧笔记
  // ============================================================
  async archive(olderThanDays: number = 90): Promise<string> {
    return this.runPython('palace_archive.py', [
      this.palaceDir,
      '--archive-age', String(olderThanDays),
    ])
  }

  // ============================================================
  // 建议创建 Tunnel（跨 wing 连接）
  // ============================================================
  async suggestTunnels(): Promise<string[]> {
    if (!this.state) return []
    const suggestions: string[] = []
    const wings = this.state.wings.map(w => w.name)

    for (let i = 0; i < wings.length; i++) {
      for (let j = i + 1; j < wings.length; j++) {
        const w1 = wings[i], w2 = wings[j]
        const existing = this.state.tunnels.find(t =>
          t.connects.includes(w1) && t.connects.includes(w2)
        )
        if (!existing) {
          suggestions.push(`${w1} ↔ ${w2}`)
        }
      }
    }
    return suggestions
  }

  // ============================================================
  // 创建 Tunnel
  // ============================================================
  async createTunnel(name: string, wingA: string, wingB: string, insight: string): Promise<void> {
    const tunnelDir = join(this.palaceDir, 'tunnels')
    mkdirSync(tunnelDir, { recursive: true })
    const content = `# Tunnel: ${name}

> Created: ${new Date().toISOString().split('T')[0]}
> Connects: ${wingA} ↔ ${wingB}

## Core Insight
${insight}

## Where to Apply
`
    writeFileSync(join(tunnelDir, `${name}.md`), content, 'utf-8')
    await this.load()
  }

  // ============================================================
  // 检查 palace 是否存在
  // ============================================================
  exists(): boolean {
    return existsSync(join(this.palaceDir, 'PALACE.md'))
  }

  // ============================================================
  // 获取当前状态
  // ============================================================
  getState(): PalaceState | null {
    return this.state
  }

  // ============================================================
  // 获取 wings 目录路径
  // ============================================================
  getWingsDir(): string {
    return join(this.palaceDir, 'wings')
  }

  // ============================================================
  // 私有方法
  // ============================================================

  // 运行 Python palace 脚本
  private runPython(script: string, args: string[] = []): Promise<string> {
    return new Promise((resolve, reject) => {
      const scriptPath = join(this.skillPath, 'scripts', script)
      const child = spawn('python3', [scriptPath, ...args], {
        timeout: 30000,
      })
      let stdout = ''
      let stderr = ''
      child.stdout?.on('data', d => stdout += d.toString())
      child.stderr?.on('data', d => stderr += d.toString())
      child.on('close', code => {
        if (code === 0) resolve(stdout)
        else reject(new Error(stderr || `Script exited with code ${code}`))
      })
      child.on('error', reject)
    })
  }

  // 解析 PALACE.md
  private parsePalaceMd(content: string): PalaceState {
    const wings: Wing[] = []
    const tunnels: Tunnel[] = []

    // 解析 Wings Summary table
    const wingMatch = content.match(/## Wings Summary[\s\S]*?\|[\s\S]*?\n\n([\s\S]*?)(?=\n##|$)/)
    if (wingMatch) {
      const table = wingMatch[1]
      const rows = table.match(/\|[^|]+\|/g) || []
      for (const row of rows.slice(2)) { // skip header rows
        const cols = row.split('|').map(c => c.trim()).filter(Boolean)
        if (cols.length >= 5) {
          wings.push({
            name: cols[0],
            status: cols[1] as Wing['status'],
            lastUpdated: cols[2],
            keyInsights: cols[3],
            noteCount: parseInt(cols[4]) || 0,
          })
        }
      }
    }

    // 解析 Tunnels table
    const tunnelMatch = content.match(/## Tunnels[\s\S]*?\|[\s\S]*?\n\n([\s\S]*?)(?=\n##|$)/)
    if (tunnelMatch) {
      const table = tunnelMatch[1]
      const rows = table.match(/\|[^|]+\|/g) || []
      for (const row of rows.slice(2)) {
        const cols = row.split('|').map(c => c.trim()).filter(Boolean)
        if (cols.length >= 3) {
          tunnels.push({
            name: cols[0].replace(/[\[\]]/g, ''),
            connects: cols[1],
            coreInsight: cols[2],
          })
        }
      }
    }

    return {
      name: content.match(/# Memory Palace — (.+)/)?.[1] || 'Memory Palace',
      wings,
      tunnels,
      lastUpdated: new Date().toISOString().split('T')[0],
    }
  }

  // 格式化笔记
  private formatNote(note: NoteContent): string {
    return `# ${note.title}

> Date: ${note.date}
> Source: ${note.source}
> Type: ${note.type}

## Key Content
${note.keyContent}

## Connection to Current Work
${note.connectionToCurrentWork}

${note.references ? `## References\n${note.references}` : ''}
`
  }

  // 更新热缓存表
  private async updateHotCache(wing: string, note: NoteContent): Promise<void> {
    const palacePath = join(this.palaceDir, 'PALACE.md')
    if (!existsSync(palacePath)) return

    let content = readFileSync(palacePath, 'utf-8')
    const today = note.date

    // 更新 wing 行（如果存在）或追加新行
    const wingLineMatch = content.match(new RegExp(`\\| ${wing} \\| ([^|]+) \\| ([^|]+) \\| ([^|]+) \\|`))
    if (wingLineMatch) {
      const newLine = `| ${wing} | active | ${today} | ${note.keyContent.split('\n')[0].slice(0, 60)} | ${(parseInt(wingLineMatch[3]) || 0) + 1} |`
      content = content.replace(wingLineMatch[0], newLine)
    }

    writeFileSync(palacePath, content, 'utf-8')
  }
}
