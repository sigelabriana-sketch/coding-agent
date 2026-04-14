// Test: verify task
import { Coordinator } from './src/coordinator/Coordinator.js'

async function main() {
  const coordinator = new Coordinator('/Users/nigo/Desktop/特朗普的办公室/10-CodingAgent')
  await coordinator.init()

  const result = await coordinator.handleUserTask(
    'Verify task: check the src/utils/LRUCache.ts file exists, read it, and verify it has get() and put() methods. Report whether the implementation looks correct.'
  )

  console.log(result)
}

main().catch(console.error)
