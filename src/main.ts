// ============================================================
//  Main Entry - 交互式入口
// ============================================================

import * as readline from 'readline'
import { Coordinator } from './coordinator/Coordinator.js'

async function main() {
  const projectRoot = process.argv[2] || process.cwd()

  console.log('╔══════════════════════════════════════╗')
  console.log('║   Local Coding Agent (MiniMax M2.7)  ║')
  console.log('╚══════════════════════════════════════╝')
  console.log(`Project: ${projectRoot}`)
  console.log(`Model: MiniMax M2.7 via local proxy`)
  console.log('')

  const coordinator = new Coordinator(projectRoot)
  await coordinator.init()

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  console.log('Ready. Type your task (Ctrl+C to exit):\n')

  while (true) {
    const input = await new Promise<string>(resolve => rl.question('> ', resolve))
    if (!input.trim()) continue

    try {
      const response = await coordinator.handleUserTask(input)
      console.log('\n' + response + '\n')
    } catch (e) {
      console.error('Error:', e)
    }
  }
}

main().catch(console.error)
