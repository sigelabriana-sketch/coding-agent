// ============================================================
//  SlashCommandSystem - 斜杠命令解析与执行
//  Claude Code 2.1.108 斜杠命令复刻
//
//  格式：/command arg1 arg2 --flag value
//  示例：/review src/utils --verbose
//       /implement "create a login form" --framework react
//       /test --watch
// ============================================================

import { SkillRegistry, SkillContext, SkillResult } from './SkillRegistry.js'

export interface ParsedSlashCommand {
  command: string    // 命令名（去掉斜杠）
  args: string       // 剩余参数
  flags: Record<string, string | boolean>  // 标志
  raw: string        // 原始输入
}

export class SlashCommandSystem {
  private registry: SkillRegistry

  constructor(registry: SkillRegistry) {
    this.registry = registry
  }

  // ============================================================
  // 解析斜杠命令
  // ============================================================
  parse(input: string): ParsedSlashCommand | null {
    const trimmed = input.trim()
    if (!trimmed.startsWith('/')) return null

    // 提取命令和剩余部分
    const spaceIdx = trimmed.indexOf(' ')
    const hasArgs = spaceIdx > 0

    const command = hasArgs
      ? trimmed.slice(1, spaceIdx)
      : trimmed.slice(1)
    const rest = hasArgs ? trimmed.slice(spaceIdx + 1) : ''

    // 解析 flags（--flag value 或 --flag）
    const { args, flags } = this.parseFlags(rest)

    return { command, args: args.trim(), flags, raw: input }
  }

  // 解析 --flag value 或 --flag 格式
  private parseFlags(rest: string): { args: string; flags: Record<string, string | boolean> } {
    const flags: Record<string, string | boolean> = {}
    const parts = rest.split(/\s+/)
    const cleanParts: string[] = []

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      if (part.startsWith('--')) {
        const key = part.slice(2)
        const next = parts[i + 1]
        if (next && !next.startsWith('-')) {
          flags[key] = next
          i++
        } else {
          flags[key] = true
        }
      } else {
        cleanParts.push(part)
      }
    }

    return { args: cleanParts.join(' '), flags }
  }

  // ============================================================
  // 执行斜杠命令
  // ============================================================
  async execute(
    input: string,
    context: SkillContext,
  ): Promise<SkillResult> {
    const parsed = this.parse(input)
    if (!parsed) {
      return {
        success: false,
        output: '',
        error: 'Not a slash command',
        summary: 'Invalid command format',
      }
    }

    const skill = this.registry.find(parsed.command)
    if (!skill) {
      const suggestions = this.suggestSimilar(parsed.command)
      return {
        success: false,
        output: `Unknown command: /${parsed.command}`,
        error: `Unknown command: /${parsed.command}. Did you mean: ${suggestions.join(', ')}?`,
        summary: `Command not found: /${parsed.command}`,
      }
    }

    return this.registry.execute(
      parsed.command,
      { args: parsed.args, raw: parsed.raw },
      context,
    )
  }

  // ============================================================
  // 建议相似命令
  // ============================================================
  private suggestSimilar(cmd: string): string[] {
    const allSkills = this.registry.getAllSkills()
    const suggestions: { skill: typeof allSkills[0]; score: number }[] = []

    for (const skill of allSkills) {
      const aliases = [skill.name, ...(skill.aliases || [])]
      for (const alias of aliases) {
        const score = this.stringSimilarity(cmd, alias)
        if (score > 0.3) suggestions.push({ skill, score })
      }
    }

    return suggestions
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(s => `/${s.skill.aliases?.[0] || s.skill.name}`)
  }

  // 字符串相似度（简单版 Levenshtein）
  private stringSimilarity(a: string, b: string): number {
    const al = a.toLowerCase(), bl = b.toLowerCase()
    if (al === bl) return 1
    if (al.includes(bl) || bl.includes(al)) return 0.8

    const lenA = al.length, lenB = bl.length
    const maxLen = Math.max(lenA, lenB)
    if (maxLen === 0) return 1

    const dist = this.levenshtein(al, bl)
    return 1 - dist / maxLen
  }

  private levenshtein(a: string, b: string): number {
    const m = a.length, n = b.length
    const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
      Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
    )
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] = a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
      }
    }
    return dp[m][n]
  }

  // ============================================================
  // 列出所有可用命令（帮助）
  // ============================================================
  help(): string {
    return this.registry.listSlashCommands()
  }
}
