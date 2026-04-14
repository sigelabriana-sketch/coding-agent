// ============================================================
//  Main Entry - 交互式入口
//  集成：SkillRegistry + SlashCommandSystem + PreCompactHook + SessionRecap
// ============================================================

import * as readline from 'readline'
import * as fs from 'fs'
import * as path from 'path'
import { Coordinator } from './coordinator/Coordinator.js'
import { SkillRegistry } from './registry/SkillRegistry.js'
import { SlashCommandSystem } from './registry/SlashCommandSystem.js'
import { SessionRecap } from './memory/SessionRecap.js'
import { PreCompactHook, type PreCompactContext } from './hooks/PreCompactHook.js'
import { MemoryPalace } from './memory/MemoryPalace.js'
import { TaskStateMachine } from './coordinator/TaskStateMachine.js'

// 初始化全局注册表
const skillRegistry = new SkillRegistry()
const slashCommands = new SlashCommandSystem(skillRegistry)
const memoryPalace = new MemoryPalace()
const sessionRecap = new SessionRecap(memoryPalace)
const preCompactHook = new PreCompactHook()

async function main() {
  const projectRoot = process.argv[2] || process.cwd()

  console.log('╔══════════════════════════════════════════╗')
  console.log('║   Local Coding Agent (MiniMax M2.7)     ║')
  console.log('║   Full Featured Edition                 ║')
  console.log('╚══════════════════════════════════════════╝')
  console.log(`Project: ${projectRoot}`)
  console.log(`Model: MiniMax M2.7 via local proxy`)
  console.log('')

  // 初始化 Coordinator
  const coordinator = new Coordinator(projectRoot)
  await coordinator.init()

  // 关联 PreCompactHook
  preCompactHook.setTaskManager(coordinator.taskManager)
  preCompactHook.setMemoryPalace(memoryPalace)

  // 尝试加载 recap（上次离开摘要）
  const recap = await sessionRecap.generateRecap(coordinator.sessionId || 'unknown')
  if (recap) {
    console.log('📋 [Recap] ' + recap.split('\n').slice(0, 3).join(' | '))
  }

  // 检查 PALACE.md 热缓存
  const palaceStatus = await memoryPalace.showStatus()
  if (palaceStatus.includes('Wings:')) {
    console.log('🏛️  [Memory Palace] ' + palaceStatus.split('\n')[0])
  }

  console.log('\nReady. Commands: /init, /review, /implement, /test, /recap, /palace, /mcp, /compact\n')

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

  while (true) {
    const input = await new Promise<string>(resolve => rl.question('> ', resolve))
    if (!input.trim()) continue

    try {
      // 检查是否是斜杠命令
      if (input.startsWith('/')) {
        const response = await handleSlashCommand(input, coordinator, projectRoot)
        console.log('\n' + response + '\n')
      } else {
        // PreCompact 检查：压缩前阻断守卫
        const pendingTasks = coordinator.taskManager.getAll()
          .filter(t => !['completed', 'failed', 'killed'].includes(t.status))
        if (pendingTasks.length > 0) {
          const preCompactCtx: PreCompactContext = {
            summary: `User request: ${input.slice(0, 100)}`,
            pendingCount: pendingTasks.length,
            taskCount: pendingTasks.length,
          }
          const preResult = await preCompactHook.check(preCompactCtx)
          if (preResult.decision === 'block') {
            console.log('\n⚠️  [PreCompact Hook] ' + preResult.reason + '\n')
          }
        }

        const response = await coordinator.handleUserTask(input)
        console.log('\n' + response + '\n')

        // 会话结束自动保存 recap
        await sessionRecap.saveRecap(coordinator.sessionId || 'unknown', response)
      }
    } catch (e) {
      console.error('Error:', e)
    }
  }
}

// ============================================================
//  斜杠命令处理
// ============================================================
async function handleSlashCommand(
  input: string,
  coordinator: Coordinator,
  projectRoot: string,
): Promise<string> {
  const trimmed = input.trim()

  // 解析命令和参数
  const parts = trimmed.slice(1).split(/\s+/)
  const cmd = parts[0]
  const args = parts.slice(1).join(' ')

  // 从 SkillRegistry 查找匹配命令
  const match = skillRegistry.findCommand(trimmed)
  if (match) {
    return `[Skill: ${match.skill.name}] ${match.command.name} — ${match.command.description}\nArgs: ${args}`
  }

  // 内置命令处理
  switch (cmd) {
    case 'help':
      return `Available commands:\n` +
        skillRegistry.getAllCommands()
          .map(c => `  ${c.name} - ${c.description}`)
          .join('\n')

    case 'recap': {
      const sessionId = coordinator.sessionId || 'unknown'
      const recap = await sessionRecap.generateRecap(sessionId)
      return recap || 'No recap available for this session.'
    }

    case 'palace': {
      const action = args.trim() || 'status'
      if (action === 'status' || action === 'show') {
        return await memoryPalace.showStatus()
      }
      if (action.startsWith('save ')) {
        const content = action.slice(5)
        await memoryPalace.saveNote('general', {
          title: `manual-${Date.now()}`,
          date: new Date().toISOString().split('T')[0],
          source: 'manual',
          type: 'note',
          keyContent: content,
          connectionToCurrentWork: '',
        })
        return 'Saved to Memory Palace.'
      }
      return await memoryPalace.showStatus()
    }

    case 'compact': {
      // 手动触发 PreCompact 检查
      const preCtx: PreCompactContext = { summary: 'Manual /compact invoked' }
      const result = await preCompactHook.check(preCtx)
      return result.decision === 'proceed'
        ? '✅ Compression allowed. All tasks completed.'
        : `⛔ Blocked: ${result.reason}`
    }

    case 'init':
      return await coordinator.handleUserTask(
        `Initialize a new project: ${args || 'create package.json, setup src directories, add TypeScript config'}`
      )

    case 'review':
      return await coordinator.handleUserTask(
        `Review code: ${args || 'check src/ for bugs, quality issues, security vulnerabilities'}`
      )

    case 'implement':
      return await coordinator.handleUserTask(
        `Implement code: ${args || 'describe what to build'}`
      )

    case 'test':
      return await coordinator.handleUserTask(
        `Run tests: ${args || 'execute test suite, report results'}`
      )

    default:
      // 模糊匹配建议
      const allCmds = skillRegistry.getAllCommands()
      const suggestions = allCmds.filter(c =>
        c.name.includes(cmd) || c.aliases?.some(a => a.includes(cmd))
      )
      if (suggestions.length > 0) {
        return `Unknown command '${cmd}'. Did you mean: ${suggestions.map(s => s.name).join(', ')}?`
      }
      return `Unknown command: /${cmd}. Type /help for available commands.`
  }
}

main().catch(console.error)
