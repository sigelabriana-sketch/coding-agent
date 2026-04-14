// Full integration test: parallel workers + MemoryPalace + SkillRegistry
import { Coordinator } from './src/coordinator/Coordinator.js'
import { MemoryPalace } from './src/memory/MemoryPalace.js'
import { SessionRecap } from './src/memory/SessionRecap.js'
import { skillRegistry, registerBuiltinSkills } from './src/registry/SkillRegistry.js'
import { SlashCommandSystem } from './src/registry/SlashCommandSystem.js'

async function main() {
  const PROJECT_ROOT = '/Users/nigo/Desktop/特朗普的办公室/10-CodingAgent'
  const MEMORY_DIR = `${PROJECT_ROOT}/memory`
  const SKILL_PATH = '/Users/nigo/Desktop/Mem-Palace-skill'

  // 初始化 MemoryPalace
  const mp = new MemoryPalace(MEMORY_DIR, SKILL_PATH)
  if (!mp.exists()) {
    await mp.init('Coding Agent', ['coding', 'research', 'infrastructure'])
    console.log('[Test] Memory Palace initialized')
  } else {
    await mp.load()
    console.log('[Test] Memory Palace loaded')
  }

  // 初始化 Skill 注册表
  registerBuiltinSkills()
  const slash = new SlashCommandSystem(skillRegistry)

  // 测试斜杠命令
  console.log('\n[Test] Available slash commands:')
  console.log(slash.help())

  // 测试 SessionRecap
  const recap = new SessionRecap()
  recap.setMemoryPalace(mp)
  const recapResult = await recap.generateRecap(60)
  console.log('\n[Test] Recap generated:', recapResult.summary.slice(0, 200))

  // 测试 Coordinator（带 MemoryPalace）
  const coordinator = new Coordinator(PROJECT_ROOT, undefined, MEMORY_DIR, SKILL_PATH)
  await coordinator.init()

  console.log('\n[Test] Running parallel task test...')
  const result = await coordinator.handleUserTask(
    'Create src/utils/LinkedList.ts with a TypeScript generic LinkedList class (add/remove/get/size). Also create src/utils/HashSet.ts with a HashSet class (add/has/delete/size). Create both in parallel.'
  )
  console.log('\n=== RESULT ===\n', result)

  // 验证文件
  const { existsSync } = require('fs')
  console.log('\n[Test] Files created:')
  console.log('  LinkedList.ts:', existsSync(`${PROJECT_ROOT}/src/utils/LinkedList.ts`) ? 'YES' : 'NO')
  console.log('  HashSet.ts:', existsSync(`${PROJECT_ROOT}/src/utils/HashSet.ts`) ? 'YES' : 'NO')
}

main().catch(console.error)
