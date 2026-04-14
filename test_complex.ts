// Test: create a more complex coding task
import { Coordinator } from './src/coordinator/Coordinator.js'

async function main() {
  console.log('Testing complex task: LRU Cache Implementation')
  const coordinator = new Coordinator('/Users/nigo/Desktop/特朗普的办公室/10-CodingAgent')
  await coordinator.init()

  const result = await coordinator.handleUserTask(
    'Create a file src/utils/LRUCache.ts with a complete TypeScript LRU Cache implementation. Requirements: constructor accepts capacity, get returns -1 if not found, put inserts and evicts least recently used. Use Map for O(1) operations. Export the class.'
  )

  console.log('\nResult:\n', result)
  console.log('✅ Complex task test complete!')
}

main().catch(e => { console.error('❌ Error:', e); process.exit(1) })
