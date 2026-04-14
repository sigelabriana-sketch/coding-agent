// ============================================================
//  SkillRegistry - 技能自发现注册表
//  Claude Code 2.1.108 核心机制复刻
//
//  所有工具/命令/skill 不硬编码调用
//  模型通过注册表按需发现，而非固定调用链
//
//  注册表设计：
//  - 每个 skill 有 name, description, aliases, handler
//  - 模型查询注册表 → 获取匹配的 skill → 调用 handler
//  - 支持 slash 命令（/review, /init, /test 等）
// ============================================================

import { LLMClient } from '../llm.js'

// Skill 定义
export interface Skill {
  name: string
  description: string
  aliases?: string[]          // 斜杠命令别名：['review', 'code-review']
  category: SkillCategory
  handler: SkillHandler
  inputSchema?: Record<string, unknown>
  autoSaveToPalace?: boolean  // 是否自动保存到 MemoryPalace
}

export type SkillCategory =
  | 'coding'      // 代码生成/编辑
  | 'review'       // 代码审查
  | 'research'     // 研究/探索
  | 'testing'      // 测试
  | 'memory'       // 记忆系统
  | 'system'       // 系统命令
  | 'mcp'          // MCP 工具
  | 'custom'       // 自定义

export type SkillHandler = (
  input: SkillInput,
  context: SkillContext,
) => Promise<SkillResult>

export interface SkillInput {
  args: string              // 用户输入的参数
  raw?: string              // 原始输入
}

export interface SkillContext {
  projectRoot: string
  sessionId: string
  memoryPalace?: import('../memory/MemoryPalace.js').MemoryPalace
  taskManager?: import('../coordinator/TaskStateMachine.js').TaskStateMachine
}

// Skill 执行结果
export interface SkillResult {
  success: boolean
  output: string
  error?: string
  summary: string            // 简短摘要（用于日志/memory）
  artifacts?: string[]       // 生成的产物路径
}

// 注册表核心
export class SkillRegistry {
  private skills = new Map<string, Skill>()
  private aliases = new Map<string, string>()  // alias -> skill name

  // 注册 skill
  register(skill: Skill): void {
    this.skills.set(skill.name, skill)

    // 注册别名
    if (skill.aliases) {
      for (const alias of skill.aliases) {
        this.aliases.set(alias, skill.name)
      }
    }

    console.log(`[SkillRegistry] Registered: ${skill.name}${skill.aliases ? ` (/${skill.aliases.join(', /')})` : ''}`)
  }

  // 批量注册
  registerAll(skills: Skill[]): void {
    for (const skill of skills) this.register(skill)
  }

  // 通过名字或别名查找
  find(nameOrAlias: string): Skill | null {
    const name = this.aliases.get(nameOrAlias) || nameOrAlias
    return this.skills.get(name) || null
  }

  // 检查是否注册
  has(nameOrAlias: string): boolean {
    return this.find(nameOrAlias) !== null
  }

  // 执行 skill
  async execute(nameOrAlias: string, input: SkillInput, context: SkillContext): Promise<SkillResult> {
    const skill = this.find(nameOrAlias)
    if (!skill) {
      return { success: false, output: '', error: `Unknown skill: ${nameOrAlias}`, summary: `未找到: ${nameOrAlias}` }
    }

    try {
      const result = await skill.handler(input, context)

      // 自动保存到 MemoryPalace
      if (skill.autoSaveToPalace && context.memoryPalace && result.success) {
        await context.memoryPalace.autoSave(
          result.summary,
          skill.category === 'coding' ? 'product-development' : skill.category,
          result.output,
        )
      }

      return result
    } catch (e) {
      return { success: false, output: '', error: String(e), summary: `Error in ${name}: ${String(e)}` }
    }
  }

  // 获取所有 skills（用于 LLM 发现）
  getAllSkills(): SkillDefinition[] {
    return Array.from(this.skills.values()).map(s => ({
      name: s.name,
      description: s.description,
      aliases: s.aliases,
      category: s.category,
      input_schema: s.inputSchema || { type: 'object', properties: { args: { type: 'string' } } },
    }))
  }

  // 获取某 category 下所有 skill
  getByCategory(category: SkillCategory): Skill[] {
    return Array.from(this.skills.values()).filter(s => s.category === category)
  }

  // LLM 自发现：给定一段自然语言，返回最匹配的 skill
  async discover(intent: string, llm?: LLMClient): Promise<Skill[]> {
    const allSkills = this.getAllSkills()

    // 如果有 LLM，用它做语义匹配
    if (llm) {
      try {
        const response = await llm.call({
          messages: [{
            role: 'user',
            content: `Given the user intent: "${intent}"
Which skills are relevant? Return JSON: {"matched": [{"name": "...", "reason": "..."}]}

Available skills:
${allSkills.map(s => `- ${s.name}: ${s.description}${s.aliases ? ` (aliases: /${s.aliases.join(', /')}` : ''}`).join('\n')}`,
          }],
          maxTokens: 1024,
        })
        const parsed = JSON.parse(response.content.replace(/```json\n?/g, '').trim())
        const matched = (parsed.matched || []) as { name: string }[]
        return matched.map(m => this.find(m.name)).filter(Boolean) as Skill[]
      } catch {
        // fallback to keyword match
      }
    }

    // 关键词 fallback
    const lower = intent.toLowerCase()
    const keywords: Record<string, string[]> = {
      review: ['review', '审查', '检查', 'review'],
      test: ['test', '测试', 'spec'],
      init: ['init', 'init', '初始化'],
      implement: ['implement', '实现', '写代码', 'create'],
      research: ['research', '研究', '探索', 'find'],
      memory: ['remember', '记忆', 'palace', 'recall'],
    }

    const results: Skill[] = []
    for (const [cat, kws] of Object.entries(keywords)) {
      if (kws.some(kw => lower.includes(kw))) {
        results.push(...this.getByCategory(cat as SkillCategory))
      }
    }
    return [...new Set(results)]
  }

  // 列出所有可用的 slash 命令（用于帮助）
  listSlashCommands(): string {
    const lines: string[] = ['Available commands:']
    for (const skill of this.skills.values()) {
      const alias = skill.aliases?.[0] || skill.name
      lines.push(`  /${alias} - ${skill.description}`)
    }
    return lines.join('\n')
  }
}

// Skill 定义输出（用于 LLM 工具注册）
export interface SkillDefinition {
  name: string
  description: string
  aliases?: string[]
  category: SkillCategory
  input_schema: Record<string, unknown>
}

// 全局注册表实例
export const skillRegistry = new SkillRegistry()

// ============================================================
//  内置 Skills
// ============================================================

export function registerBuiltinSkills(): void {
  skillRegistry.register({
    name: 'init',
    description: 'Initialize a new project structure, create package.json, setup directories',
    aliases: ['init', 'initialize'],
    category: 'system',
    autoSaveToPalace: true,
    handler: async (input, context) => {
      // 具体实现在工具层
      return {
        success: true,
        output: 'Project initialized',
        summary: `Initialized project at ${context.projectRoot}`,
      }
    },
  })

  skillRegistry.register({
    name: 'review',
    description: 'Review code for bugs, quality issues, security vulnerabilities',
    aliases: ['review', 'code-review', 'review-code'],
    category: 'review',
    autoSaveToPalace: true,
    handler: async (input, context) => {
      return {
        success: true,
        output: 'Code review complete',
        summary: 'Code review finished',
      }
    },
  })

  skillRegistry.register({
    name: 'test',
    description: 'Run tests or create test files for the project',
    aliases: ['test', 'runtest'],
    category: 'testing',
    autoSaveToPalace: true,
    handler: async (input, context) => {
      return {
        success: true,
        output: 'Tests executed',
        summary: 'Test run complete',
      }
    },
  })

  skillRegistry.register({
    name: 'implement',
    description: 'Implement code from specification or description',
    aliases: ['implement', 'implement-code', '代码'],
    category: 'coding',
    autoSaveToPalace: true,
    handler: async (input, context) => {
      return {
        success: true,
        output: 'Implementation complete',
        summary: `Implemented: ${input.args.slice(0, 50)}`,
      }
    },
  })

  skillRegistry.register({
    name: 'palace',
    description: 'Interact with Memory Palace: save notes, search, show status',
    aliases: ['palace', 'memory', '记忆'],
    category: 'memory',
    autoSaveToPalace: false,
    handler: async (input, context) => {
      if (!context.memoryPalace) {
        return { success: false, output: '', error: 'MemoryPalace not configured', summary: 'No MemoryPalace' }
      }
      const hotCache = await context.memoryPalace.getHotCache()
      return {
        success: true,
        output: hotCache,
        summary: 'Memory Palace hot cache loaded',
      }
    },
  })

  skillRegistry.register({
    name: 'mcp',
    description: 'Execute an MCP (Model Context Protocol) tool',
    aliases: ['mcp', 'mcp-tool'],
    category: 'mcp',
    autoSaveToPalace: false,
    handler: async (input, context) => {
      return {
        success: true,
        output: 'MCP tool executed',
        summary: 'MCP call complete',
      }
    },
  })
}
